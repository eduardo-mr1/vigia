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

  it('collects literal identifiers', () => {
    write('boton.tsx', `<Pressable testID="fab-agregar" />`);
    expect(collectKnownIds(dir).exact.has('fab-agregar')).toBe(true);
  });

  it('accepts single quotes and data-testid', () => {
    write('a.tsx', `<div data-testid='menu-principal' />`);
    expect(collectKnownIds(dir).exact.has('menu-principal')).toBe(true);
  });

  // A constructed id only reveals its prefix: gasto-0, gasto-1... are valid.
  it('collects the prefix of a constructed identifier', () => {
    write('fila.tsx', '<View testID={`gasto-${index}`} />');
    expect(collectKnownIds(dir).prefixes).toContain('gasto-');
  });

  it('does not read test files', () => {
    write('a.test.tsx', `<View testID="solo-en-pruebas" />`);
    expect(collectKnownIds(dir).exact.size).toBe(0);
  });

  it('does not walk into node_modules', () => {
    write('node_modules/lib/a.tsx', `<View testID="de-libreria" />`);
    expect(collectKnownIds(dir).exact.size).toBe(0);
  });

  it('returns empty sets in a project with no identifiers', () => {
    write('a.ts', `export const x = 1;`);
    expect(collectKnownIds(dir)).toEqual({ exact: new Set(), prefixes: [] });
  });

  it('tolerates a nonexistent directory', () => {
    expect(collectSourceFiles(path.join(dir, 'no-existe'))).toEqual([]);
  });
});

describe('isKnown', () => {
  it('recognizes a literal identifier', () => {
    expect(isKnown('fab-agregar', known(['fab-agregar']))).toBe(true);
  });

  it('recognizes one that matches a constructed prefix', () => {
    expect(isKnown('gasto-42', known([], ['gasto-']))).toBe(true);
  });

  it('rejects one that does not exist', () => {
    expect(isKnown('inventado', known(['fab-agregar'], ['gasto-']))).toBe(false);
  });

  // An empty prefix would make every identifier look valid, and the rule
  // would stop detecting anything.
  it('ignores an empty prefix', () => {
    expect(isKnown('lo-que-sea', known([], ['']))).toBe(false);
  });
});

describe('classify', () => {
  it('a declared literal is exact', () => {
    expect(classify('fab-agregar', known(['fab-agregar']))).toBe('exact');
  });

  it('a simple suffix over a constructed prefix is exact', () => {
    expect(classify('gasto-42', known([], ['gasto-']))).toBe('exact');
    expect(classify('categoria-comida', known([], ['categoria-']))).toBe('exact');
  });

  // The case that started the tool.
  it('a compound suffix over a constructed prefix is only probable', () => {
    expect(classify('gasto-monto-9999-duplicado', known([], ['gasto-monto-']))).toBe(
      'probable',
    );
  });

  it('no match at all is nonexistent', () => {
    expect(classify('inventado', known(['real'], ['gasto-']))).toBe('nonexistent');
  });

  it('uses the most specific prefix when several match', () => {
    // 'gasto-monto-7' matches 'gasto-' and 'gasto-monto-'; the latter leaves
    // the suffix '7', which is indeed an interpolated value.
    expect(classify('gasto-monto-7', known([], ['gasto-', 'gasto-monto-']))).toBe('exact');
  });
});

describe('findNegativeAssertions', () => {
  it('finds assertNotVisible with a nested id, like in Maestro', () => {
    const result = findNegativeAssertions(
      'flujo.yaml',
      ['- assertNotVisible:', '    id: "gasto-duplicado"'].join('\n'),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('gasto-duplicado');
    expect(result[0]?.line).toBe(2);
  });

  it('finds assertNotVisible on the same line', () => {
    const result = findNegativeAssertions('flujo.yaml', '- assertNotVisible: pantalla-error');
    expect(result[0]?.id).toBe('pantalla-error');
  });

  it.each([
    `expect(queryByTestId('x')).toBeNull()`,
    `expect(queryByTestId("x")).toBeFalsy()`,
    `expect(screen.queryByTestId('x')).toBeUndefined()`,
    `expect(queryByTestId('x')).not.toBeVisible()`,
    `expect(screen.queryByTestId('x')).not.toBeTruthy()`,
  ])('finds the %s form', (code) => {
    const result = findNegativeAssertions('prueba.test.ts', code);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('x');
  });

  it('ignores a positive assertion', () => {
    expect(
      findNegativeAssertions('prueba.test.ts', `expect(getByTestId('x')).toBeVisible()`),
    ).toEqual([]);
  });

  it('ignores assertVisible', () => {
    expect(findNegativeAssertions('flujo.yaml', '- assertVisible:\n    id: "boton"')).toEqual(
      [],
    );
  });

  it('reports the correct line in a long file', () => {
    const code = ['', '', `expect(queryByTestId('tardio')).toBeNull()`].join('\n');
    expect(findNegativeAssertions('prueba.test.ts', code)[0]?.line).toBe(3);
  });

  // The tool's own self-analysis caught this false positive: the
  // regex-based version flagged code written inside a string
  // literal.
  it('does not flag an assertion written inside a string', () => {
    const code = `it('describe la regla', () => {
      const ejemplo = "expect(queryByTestId('inventado')).toBeNull()";
      expect(analizar(ejemplo)).toHaveLength(1);
    });`;
    expect(findNegativeAssertions('meta.test.ts', code)).toEqual([]);
  });

  it('does not flag an assertion written in a comment', () => {
    const code = `// expect(queryByTestId('inventado')).toBeNull()`;
    expect(findNegativeAssertions('meta.test.ts', code)).toEqual([]);
  });

  it('returns empty with no assertions', () => {
    expect(findNegativeAssertions('prueba.test.ts', 'const x = 1;')).toEqual([]);
  });
});

describe('orphanNegativeAssertions', () => {
  // The real case: an identifier the app never generates.
  it('reports an assertion on a nonexistent identifier', () => {
    const result = orphanNegativeAssertions(
      'flujo.yaml',
      '- assertNotVisible:\n    id: "gasto-monto-9999-duplicado"',
      known(['gasto-monto-0'], ['gasto-monto-']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('orphan-negative-assertion');
    expect(result[0]?.message).toContain('gasto-monto-9999-duplicado');
    // The prefix 'gasto-monto-' exists, but the suffix '9999-duplicado' isn't
    // an interpolated value: it's reported as suspicious, not certain.
    expect(result[0]?.severity).toBe('P2');
  });

  it('accepts an assertion on an identifier that does exist', () => {
    expect(
      orphanNegativeAssertions(
        'flujo.yaml',
        '- assertNotVisible:\n    id: "badge-pending"',
        known(['badge-pending']),
      ),
    ).toEqual([]);
  });

  it('reports P1 when the identifier matches nothing', () => {
    const result = orphanNegativeAssertions(
      'flujo.yaml',
      '- assertNotVisible:\n    id: "pantalla-que-no-existe"',
      known(['boton'], ['gasto-']),
    );
    expect(result[0]?.severity).toBe('P1');
  });

  it('accepts an assertion that matches a constructed prefix', () => {
    expect(
      orphanNegativeAssertions(
        'flujo.yaml',
        '- assertNotVisible:\n    id: "gasto-7"',
        known([], ['gasto-']),
      ),
    ).toEqual([]);
  });

  it('the hint names the identifier, so there is something to act on', () => {
    const result = orphanNegativeAssertions(
      'x.test.ts',
      `expect(queryByTestId('inventado')).toBeNull()`,
      known(['real']),
    );
    expect(result[0]?.hint).toContain('inventado');
  });

  it('reports several orphan assertions in the same file', () => {
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
