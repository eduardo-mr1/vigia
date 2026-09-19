import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classify,
  collectKnownIds,
  collectSourceFiles,
  findNegativeAssertions,
  isKnown,
  orphanNegativeAssertions,
} from './orphan';
import type { KnownIds } from './orphan';

function known(exact: string[] = [], prefixes: string[] = []): KnownIds {
  return { exact: new Set(exact), prefixes };
}

describe('collectKnownIds', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, code: string): void {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, code);
  }

  it('recoge identificadores literales', () => {
    write('boton.tsx', `<Pressable testID="fab-agregar" />`);
    expect(collectKnownIds(dir).exact.has('fab-agregar')).toBe(true);
  });

  it('acepta comillas simples y data-testid', () => {
    write('a.tsx', `<div data-testid='menu-principal' />`);
    expect(collectKnownIds(dir).exact.has('menu-principal')).toBe(true);
  });

  // Un id construido solo revela su prefijo: gasto-0, gasto-1... son validos.
  it('recoge el prefijo de un identificador construido', () => {
    write('fila.tsx', '<View testID={`gasto-${index}`} />');
    expect(collectKnownIds(dir).prefixes).toContain('gasto-');
  });

  it('no lee los archivos de prueba', () => {
    write('a.test.tsx', `<View testID="solo-en-pruebas" />`);
    expect(collectKnownIds(dir).exact.size).toBe(0);
  });

  it('no entra a node_modules', () => {
    write('node_modules/lib/a.tsx', `<View testID="de-libreria" />`);
    expect(collectKnownIds(dir).exact.size).toBe(0);
  });

  it('devuelve conjuntos vacíos en un proyecto sin identificadores', () => {
    write('a.ts', `export const x = 1;`);
    expect(collectKnownIds(dir)).toEqual({ exact: new Set(), prefixes: [] });
  });

  it('tolera un directorio inexistente', () => {
    expect(collectSourceFiles(path.join(dir, 'no-existe'))).toEqual([]);
  });
});

describe('isKnown', () => {
  it('reconoce un identificador literal', () => {
    expect(isKnown('fab-agregar', known(['fab-agregar']))).toBe(true);
  });

  it('reconoce uno que coincide con un prefijo construido', () => {
    expect(isKnown('gasto-42', known([], ['gasto-']))).toBe(true);
  });

  it('rechaza uno que no existe', () => {
    expect(isKnown('inventado', known(['fab-agregar'], ['gasto-']))).toBe(false);
  });

  // Un prefijo vacio haria que todo identificador pareciera valido y la regla
  // dejaria de detectar nada.
  it('ignora un prefijo vacío', () => {
    expect(isKnown('lo-que-sea', known([], ['']))).toBe(false);
  });
});

describe('classify', () => {
  it('un literal declarado es exacto', () => {
    expect(classify('fab-agregar', known(['fab-agregar']))).toBe('exact');
  });

  it('un sufijo simple sobre un prefijo construido es exacto', () => {
    expect(classify('gasto-42', known([], ['gasto-']))).toBe('exact');
    expect(classify('categoria-comida', known([], ['categoria-']))).toBe('exact');
  });

  // El caso que originó la herramienta.
  it('un sufijo compuesto sobre un prefijo construido es solo probable', () => {
    expect(classify('gasto-monto-9999-duplicado', known([], ['gasto-monto-']))).toBe(
      'probable',
    );
  });

  it('sin coincidencia alguna es inexistente', () => {
    expect(classify('inventado', known(['real'], ['gasto-']))).toBe('nonexistent');
  });

  it('usa el prefijo más específico cuando varios coinciden', () => {
    // 'gasto-monto-7' encaja con 'gasto-' y con 'gasto-monto-'; el segundo deja
    // el sufijo '7', que sí es un valor de interpolacion.
    expect(classify('gasto-monto-7', known([], ['gasto-', 'gasto-monto-']))).toBe('exact');
  });
});

describe('findNegativeAssertions', () => {
  it('encuentra assertNotVisible con id anidado, como en Maestro', () => {
    const result = findNegativeAssertions(
      'flujo.yaml',
      ['- assertNotVisible:', '    id: "gasto-duplicado"'].join('\n'),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('gasto-duplicado');
    expect(result[0]?.line).toBe(2);
  });

  it('encuentra assertNotVisible en la misma línea', () => {
    const result = findNegativeAssertions('flujo.yaml', '- assertNotVisible: pantalla-error');
    expect(result[0]?.id).toBe('pantalla-error');
  });

  it.each([
    `expect(queryByTestId('x')).toBeNull()`,
    `expect(queryByTestId("x")).toBeFalsy()`,
    `expect(screen.queryByTestId('x')).toBeUndefined()`,
    `expect(queryByTestId('x')).not.toBeVisible()`,
    `expect(screen.queryByTestId('x')).not.toBeTruthy()`,
  ])('encuentra la forma %s', (code) => {
    const result = findNegativeAssertions('prueba.test.ts', code);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('x');
  });

  it('ignora una aserción positiva', () => {
    expect(
      findNegativeAssertions('prueba.test.ts', `expect(getByTestId('x')).toBeVisible()`),
    ).toEqual([]);
  });

  it('ignora assertVisible', () => {
    expect(findNegativeAssertions('flujo.yaml', '- assertVisible:\n    id: "boton"')).toEqual(
      [],
    );
  });

  it('reporta la línea correcta en un archivo largo', () => {
    const code = ['', '', `expect(queryByTestId('tardio')).toBeNull()`].join('\n');
    expect(findNegativeAssertions('prueba.test.ts', code)[0]?.line).toBe(3);
  });

  // El autoanalisis de la propia herramienta delato este falso positivo: la
  // version con expresiones regulares marcaba codigo escrito dentro de una
  // cadena de texto.
  it('no marca una aserción escrita dentro de una cadena', () => {
    const code = `it('describe la regla', () => {
      const ejemplo = "expect(queryByTestId('inventado')).toBeNull()";
      expect(analizar(ejemplo)).toHaveLength(1);
    });`;
    expect(findNegativeAssertions('meta.test.ts', code)).toEqual([]);
  });

  it('no marca una aserción escrita en un comentario', () => {
    const code = `// expect(queryByTestId('inventado')).toBeNull()`;
    expect(findNegativeAssertions('meta.test.ts', code)).toEqual([]);
  });

  it('devuelve vacío sin aserciones', () => {
    expect(findNegativeAssertions('prueba.test.ts', 'const x = 1;')).toEqual([]);
  });
});

describe('orphanNegativeAssertions', () => {
  // El caso real: un identificador que la app nunca genera.
  it('reporta una aserción sobre un identificador inexistente', () => {
    const result = orphanNegativeAssertions(
      'flujo.yaml',
      '- assertNotVisible:\n    id: "gasto-monto-9999-duplicado"',
      known(['gasto-monto-0'], ['gasto-monto-']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('orphan-negative-assertion');
    expect(result[0]?.message).toContain('gasto-monto-9999-duplicado');
    // El prefijo 'gasto-monto-' existe, pero el sufijo '9999-duplicado' no es
    // un valor de interpolacion: se reporta como sospechoso, no como certeza.
    expect(result[0]?.severity).toBe('P2');
  });

  it('acepta una aserción sobre un identificador que sí existe', () => {
    expect(
      orphanNegativeAssertions(
        'flujo.yaml',
        '- assertNotVisible:\n    id: "badge-pending"',
        known(['badge-pending']),
      ),
    ).toEqual([]);
  });

  it('reporta P1 cuando el identificador no coincide con nada', () => {
    const result = orphanNegativeAssertions(
      'flujo.yaml',
      '- assertNotVisible:\n    id: "pantalla-que-no-existe"',
      known(['boton'], ['gasto-']),
    );
    expect(result[0]?.severity).toBe('P1');
  });

  it('acepta una aserción que coincide con un prefijo construido', () => {
    expect(
      orphanNegativeAssertions(
        'flujo.yaml',
        '- assertNotVisible:\n    id: "gasto-7"',
        known([], ['gasto-']),
      ),
    ).toEqual([]);
  });

  it('la sugerencia nombra el identificador para poder actuar', () => {
    const result = orphanNegativeAssertions(
      'x.test.ts',
      `expect(queryByTestId('inventado')).toBeNull()`,
      known(['real']),
    );
    expect(result[0]?.hint).toContain('inventado');
  });

  it('reporta varias aserciones huérfanas en un mismo archivo', () => {
    const result = orphanNegativeAssertions(
      'flujo.yaml',
      [
        '- assertNotVisible:',
        '    id: "uno"',
        '- assertNotVisible:',
        '    id: "dos"',
      ].join('\n'),
      known(['tres']),
    );
    expect(result).toHaveLength(2);
  });
});
