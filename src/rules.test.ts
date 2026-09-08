import { analyzeSource } from './analyze';
import {
  expectWithoutMatcher,
  focusedTest,
  missingAwait,
  noAssertion,
  skippedTest,
  tautology,
} from './rules';

function findings(code: string, rule: Parameters<typeof analyzeSource>[2]) {
  return analyzeSource('ejemplo.test.ts', code, rule);
}

describe('noAssertion', () => {
  it('detecta una prueba sin expect', () => {
    const result = findings(
      `it('suma dos numeros', () => {
         const total = 1 + 1;
       });`,
      [noAssertion],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('sin-assercion');
    expect(result[0]?.message).toContain('suma dos numeros');
  });

  it('acepta una prueba con expect', () => {
    expect(
      findings(`it('suma', () => { expect(1 + 1).toBe(2); });`, [noAssertion]),
    ).toEqual([]);
  });

  it('reconoce expect anidado dentro de un callback', () => {
    expect(
      findings(
        `it('itera', () => { [1, 2].forEach((n) => { expect(n).toBeGreaterThan(0); }); });`,
        [noAssertion],
      ),
    ).toEqual([]);
  });

  it('acepta una prueba asíncrona con expect', () => {
    expect(
      findings(`it('espera', async () => { await expect(f()).resolves.toBe(1); });`, [
        noAssertion,
      ]),
    ).toEqual([]);
  });

  // Un expect dentro de un comentario o de una cadena no es una asercion: es la
  // razon por la que el analisis usa el AST y no expresiones regulares.
  it('no se deja engañar por un expect en un comentario', () => {
    expect(
      findings(`it('finge', () => { /* expect(1).toBe(1) */ const x = 1; });`, [
        noAssertion,
      ]),
    ).toHaveLength(1);
  });

  it('no se deja engañar por un expect dentro de una cadena', () => {
    expect(
      findings(`it('finge', () => { const s = 'expect(1).toBe(1)'; });`, [noAssertion]),
    ).toHaveLength(1);
  });

  it('funciona con test() además de it()', () => {
    expect(findings(`test('vacia', () => {});`, [noAssertion])).toHaveLength(1);
  });

  it('reporta la línea correcta', () => {
    const result = findings(`\n\nit('vacia', () => {});`, [noAssertion]);
    expect(result[0]?.line).toBe(3);
  });
});

describe('expectWithoutMatcher', () => {
  it('detecta expect() suelto', () => {
    const result = findings(`it('a', () => { expect(valor); });`, [expectWithoutMatcher]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('expect-sin-matcher');
  });

  it('acepta expect con matcher', () => {
    expect(
      findings(`it('a', () => { expect(valor).toBe(1); });`, [expectWithoutMatcher]),
    ).toEqual([]);
  });

  it('acepta expect con matcher negado', () => {
    expect(
      findings(`it('a', () => { expect(valor).not.toBe(1); });`, [expectWithoutMatcher]),
    ).toEqual([]);
  });
});

describe('tautology', () => {
  it('detecta expect(true).toBe(true)', () => {
    const result = findings(`it('a', () => { expect(true).toBe(true); });`, [tautology]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('tautologia');
  });

  it.each([
    `expect(1).toBe(1)`,
    `expect('x').toEqual('x')`,
    `expect(null).toStrictEqual(null)`,
  ])('detecta %s', (assertion) => {
    expect(findings(`it('a', () => { ${assertion}; });`, [tautology])).toHaveLength(1);
  });

  it('acepta comparar una variable contra un literal', () => {
    expect(findings(`it('a', () => { expect(total).toBe(2); });`, [tautology])).toEqual([]);
  });

  it('acepta literales distintos: eso sí puede fallar', () => {
    expect(findings(`it('a', () => { expect(1).toBe(2); });`, [tautology])).toEqual([]);
  });
});

describe('skippedTest', () => {
  it.each(['it.skip', 'test.skip', 'describe.skip', 'xit', 'xdescribe'])(
    'detecta %s',
    (form) => {
      const result = findings(`${form}('algo', () => { expect(1).toBe(2); });`, [
        skippedTest,
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]?.severity).toBe('P3');
    },
  );

  it('acepta una prueba activa', () => {
    expect(
      findings(`it('activa', () => { expect(1).toBe(2); });`, [skippedTest]),
    ).toEqual([]);
  });
});

describe('focusedTest', () => {
  it.each(['it.only', 'describe.only', 'test.only'])('detecta %s', (form) => {
    const result = findings(`${form}('algo', () => { expect(1).toBe(2); });`, [
      focusedTest,
    ]);
    expect(result).toHaveLength(1);
    // Es P1: en CI silencia el resto de la suite sin avisar.
    expect(result[0]?.severity).toBe('P1');
  });

  it('acepta una prueba normal', () => {
    expect(findings(`it('normal', () => { expect(1).toBe(2); });`, [focusedTest])).toEqual(
      [],
    );
  });
});

describe('todas las reglas juntas', () => {
  it('ordena los hallazgos por línea', () => {
    const result = analyzeSource(
      'x.test.ts',
      `it.only('enfocada', () => { expect(1).toBe(1); });
       it('vacia', () => {});`,
    );

    expect(result.length).toBeGreaterThan(1);
    const lines = result.map((f) => f.line);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });

  it('no reporta nada en un archivo sano', () => {
    expect(
      analyzeSource(
        'sano.test.ts',
        `describe('suma', () => {
           it('suma dos numeros', () => {
             expect(sumar(1, 2)).toBe(3);
           });
         });`,
      ),
    ).toEqual([]);
  });

  it('tolera código con errores de sintaxis sin lanzar', () => {
    expect(() => analyzeSource('roto.test.ts', `it('a', () => { expect(`)).not.toThrow();
  });
});

describe('formas poco comunes de declarar pruebas', () => {
  it('reconoce it.each con plantilla etiquetada', () => {
    const result = findings(
      'it.each`\n  a\n  ${1}\n`("caso $a", () => {});',
      [noAssertion],
    );
    expect(result).toHaveLength(1);
  });

  it('reconoce una prueba escrita con function() en vez de flecha', () => {
    expect(
      findings(`it('clasica', function () { const x = 1; });`, [noAssertion]),
    ).toHaveLength(1);
  });

  it('ignora una llamada sin cuerpo, como it.todo', () => {
    // it.todo solo lleva titulo: no hay cuerpo que revisar, y ya lo cubre
    // la regla de pruebas omitidas.
    expect(findings(`it.todo('pendiente');`, [noAssertion])).toEqual([]);
  });

  it('detecta el título ausente sin romperse', () => {
    const result = findings(`it(nombreDinamico, () => {});`, [noAssertion]);
    expect(result[0]?.message).toContain('(sin título)');
  });
});

describe('missingAwait', () => {
  // El defecto: la promesa se resuelve despues de que la prueba termino, y el
  // fallo se pierde o se atribuye a otro caso.
  it.each([
    `expect(login('malo')).rejects.toThrow();`,
    `expect(cargar()).resolves.toBe(1);`,
    `expect(f()).rejects.toThrowError('x');`,
    `expect(f()).resolves.toEqual({ a: 1 });`,
  ])('detecta %s sin await', (assertion) => {
    const result = findings(`it('a', async () => { ${assertion} });`, [missingAwait]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('await-faltante');
    expect(result[0]?.severity).toBe('P1');
  });

  it('acepta la versión con await', () => {
    expect(
      findings(`it('a', async () => { await expect(f()).rejects.toThrow(); });`, [
        missingAwait,
      ]),
    ).toEqual([]);
  });

  it('acepta la versión con return', () => {
    expect(
      findings(`it('a', () => { return expect(f()).rejects.toThrow(); });`, [missingAwait]),
    ).toEqual([]);
  });

  it('acepta una aserción síncrona sin await', () => {
    expect(
      findings(`it('a', () => { expect(sumar(1, 1)).toBe(2); });`, [missingAwait]),
    ).toEqual([]);
  });

  it('no marca una promesa asignada a una variable', () => {
    // Aqui la promesa se guarda, presumiblemente para esperarla despues.
    expect(
      findings(`it('a', async () => { const p = expect(f()).rejects.toThrow(); await p; });`, [
        missingAwait,
      ]),
    ).toEqual([]);
  });

  it('nombra el modificador en el mensaje', () => {
    const result = findings(`it('a', async () => { expect(f()).rejects.toThrow(); });`, [
      missingAwait,
    ]);
    expect(result[0]?.message).toContain('rejects');
  });

  it('detecta varias en la misma prueba', () => {
    const result = findings(
      `it('a', async () => {
         expect(f()).rejects.toThrow();
         expect(g()).resolves.toBe(1);
       });`,
      [missingAwait],
    );
    expect(result).toHaveLength(2);
  });

  it('no marca un expect sin modificador asíncrono', () => {
    expect(
      findings(`it('a', () => { expect(obj).toHaveProperty('rejects'); });`, [missingAwait]),
    ).toEqual([]);
  });
});
