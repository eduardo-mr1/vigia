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
  it('detects a test with no expect', () => {
    const result = findings(
      `it('suma dos numeros', () => {
         const total = 1 + 1;
       });`,
      [noAssertion],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('no-assertion');
    expect(result[0]?.message).toContain('suma dos numeros');
  });

  it('accepts a test with expect', () => {
    expect(
      findings(`it('suma', () => { expect(1 + 1).toBe(2); });`, [noAssertion]),
    ).toEqual([]);
  });

  it('recognizes an expect nested inside a callback', () => {
    expect(
      findings(
        `it('itera', () => { [1, 2].forEach((n) => { expect(n).toBeGreaterThan(0); }); });`,
        [noAssertion],
      ),
    ).toEqual([]);
  });

  it('accepts an async test with expect', () => {
    expect(
      findings(`it('espera', async () => { await expect(f()).resolves.toBe(1); });`, [
        noAssertion,
      ]),
    ).toEqual([]);
  });

  // An expect inside a comment or a string isn't an assertion: that's why
  // the analysis uses the AST instead of regular expressions.
  it('is not fooled by an expect inside a comment', () => {
    expect(
      findings(`it('finge', () => { /* expect(1).toBe(1) */ const x = 1; });`, [
        noAssertion,
      ]),
    ).toHaveLength(1);
  });

  it('is not fooled by an expect inside a string', () => {
    expect(
      findings(`it('finge', () => { const s = 'expect(1).toBe(1)'; });`, [noAssertion]),
    ).toHaveLength(1);
  });

  it('works with test() as well as it()', () => {
    expect(findings(`test('vacia', () => {});`, [noAssertion])).toHaveLength(1);
  });

  it('reports the correct line', () => {
    const result = findings(`\n\nit('vacia', () => {});`, [noAssertion]);
    expect(result[0]?.line).toBe(3);
  });
});

describe('expectWithoutMatcher', () => {
  it('detects a bare expect()', () => {
    const result = findings(`it('a', () => { expect(valor); });`, [expectWithoutMatcher]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('expect-without-matcher');
  });

  it('accepts expect with a matcher', () => {
    expect(
      findings(`it('a', () => { expect(valor).toBe(1); });`, [expectWithoutMatcher]),
    ).toEqual([]);
  });

  it('accepts expect with a negated matcher', () => {
    expect(
      findings(`it('a', () => { expect(valor).not.toBe(1); });`, [expectWithoutMatcher]),
    ).toEqual([]);
  });
});

describe('tautology', () => {
  it('detects expect(true).toBe(true)', () => {
    const result = findings(`it('a', () => { expect(true).toBe(true); });`, [tautology]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('tautology');
  });

  it.each([
    `expect(1).toBe(1)`,
    `expect('x').toEqual('x')`,
    `expect(null).toStrictEqual(null)`,
  ])('detects %s', (assertion) => {
    expect(findings(`it('a', () => { ${assertion}; });`, [tautology])).toHaveLength(1);
  });

  it('accepts comparing a variable against a literal', () => {
    expect(findings(`it('a', () => { expect(total).toBe(2); });`, [tautology])).toEqual([]);
  });

  it('accepts different literals: that actually can fail', () => {
    expect(findings(`it('a', () => { expect(1).toBe(2); });`, [tautology])).toEqual([]);
  });
});

describe('skippedTest', () => {
  it.each(['it.skip', 'test.skip', 'describe.skip', 'xit', 'xdescribe'])(
    'detects %s',
    (form) => {
      const result = findings(`${form}('algo', () => { expect(1).toBe(2); });`, [
        skippedTest,
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]?.severity).toBe('P3');
    },
  );

  it('accepts an active test', () => {
    expect(
      findings(`it('activa', () => { expect(1).toBe(2); });`, [skippedTest]),
    ).toEqual([]);
  });
});

describe('focusedTest', () => {
  it.each(['it.only', 'describe.only', 'test.only'])('detects %s', (form) => {
    const result = findings(`${form}('algo', () => { expect(1).toBe(2); });`, [
      focusedTest,
    ]);
    expect(result).toHaveLength(1);
    // It's P1: in CI it silences the rest of the suite without warning.
    expect(result[0]?.severity).toBe('P1');
  });

  it('accepts a normal test', () => {
    expect(findings(`it('normal', () => { expect(1).toBe(2); });`, [focusedTest])).toEqual(
      [],
    );
  });
});

describe('all the rules together', () => {
  it('sorts findings by line', () => {
    const result = analyzeSource(
      'x.test.ts',
      `it.only('enfocada', () => { expect(1).toBe(1); });
       it('vacia', () => {});`,
    );

    expect(result.length).toBeGreaterThan(1);
    const lines = result.map((f) => f.line);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });

  it('reports nothing in a healthy file', () => {
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

  it('tolerates code with syntax errors without throwing', () => {
    expect(() => analyzeSource('roto.test.ts', `it('a', () => { expect(`)).not.toThrow();
  });
});

describe('uncommon ways of declaring tests', () => {
  it('recognizes it.each with a tagged template', () => {
    const result = findings(
      'it.each`\n  a\n  ${1}\n`("caso $a", () => {});',
      [noAssertion],
    );
    expect(result).toHaveLength(1);
  });

  it('recognizes a test written with function() instead of an arrow', () => {
    expect(
      findings(`it('clasica', function () { const x = 1; });`, [noAssertion]),
    ).toHaveLength(1);
  });

  it('ignores a call with no body, like it.todo', () => {
    // it.todo only carries a title: there's no body to inspect, and the
    // skipped-test rule already covers it.
    expect(findings(`it.todo('pendiente');`, [noAssertion])).toEqual([]);
  });

  it('detects the missing title without breaking', () => {
    const result = findings(`it(nombreDinamico, () => {});`, [noAssertion]);
    expect(result[0]?.message).toContain('(untitled)');
  });
});

describe('missingAwait', () => {
  // The defect: the promise settles after the test has already finished,
  // and the failure is lost or blamed on a different case.
  it.each([
    `expect(login('malo')).rejects.toThrow();`,
    `expect(cargar()).resolves.toBe(1);`,
    `expect(f()).rejects.toThrowError('x');`,
    `expect(f()).resolves.toEqual({ a: 1 });`,
  ])('detects %s without await', (assertion) => {
    const result = findings(`it('a', async () => { ${assertion} });`, [missingAwait]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('missing-await');
    expect(result[0]?.severity).toBe('P1');
  });

  it('accepts the version with await', () => {
    expect(
      findings(`it('a', async () => { await expect(f()).rejects.toThrow(); });`, [
        missingAwait,
      ]),
    ).toEqual([]);
  });

  it('accepts the version with return', () => {
    expect(
      findings(`it('a', () => { return expect(f()).rejects.toThrow(); });`, [missingAwait]),
    ).toEqual([]);
  });

  it('accepts a synchronous assertion with no await', () => {
    expect(
      findings(`it('a', () => { expect(sumar(1, 1)).toBe(2); });`, [missingAwait]),
    ).toEqual([]);
  });

  it('does not flag a promise assigned to a variable', () => {
    // Here the promise is stored, presumably to be awaited later.
    expect(
      findings(`it('a', async () => { const p = expect(f()).rejects.toThrow(); await p; });`, [
        missingAwait,
      ]),
    ).toEqual([]);
  });

  it('names the modifier in the message', () => {
    const result = findings(`it('a', async () => { expect(f()).rejects.toThrow(); });`, [
      missingAwait,
    ]);
    expect(result[0]?.message).toContain('rejects');
  });

  it('detects several in the same test', () => {
    const result = findings(
      `it('a', async () => {
         expect(f()).rejects.toThrow();
         expect(g()).resolves.toBe(1);
       });`,
      [missingAwait],
    );
    expect(result).toHaveLength(2);
  });

  it('does not flag an expect with no async modifier', () => {
    expect(
      findings(`it('a', () => { expect(obj).toHaveProperty('rejects'); });`, [missingAwait]),
    ).toEqual([]);
  });
});

describe('missingAwait in Playwright', () => {
  const IMPORT = `import { expect, test } from '@playwright/test';\n`;

  it.each([
    `expect(page.locator('#boton')).toBeVisible();`,
    `expect(page.getByRole('button')).toBeEnabled();`,
    `expect(page.getByTestId('total')).toHaveText('$0.00');`,
    `expect(page.locator('.fila')).toHaveCount(3);`,
    `expect(page).toHaveURL('/inicio');`,
  ])('detects %s without await', (assertion) => {
    const result = findings(
      `${IMPORT}test('a', async ({ page }) => { ${assertion} });`,
      [missingAwait],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('missing-await');
  });

  it('accepts the version with await', () => {
    expect(
      findings(
        `${IMPORT}test('a', async ({ page }) => { await expect(page.locator('#x')).toBeVisible(); });`,
        [missingAwait],
      ),
    ).toEqual([]);
  });

  it('accepts a negated assertion with await', () => {
    expect(
      findings(
        `${IMPORT}test('a', async ({ page }) => { await expect(page.locator('#x')).not.toBeVisible(); });`,
        [missingAwait],
      ),
    ).toEqual([]);
  });

  // Without the Playwright import, toBeVisible is the synchronous matcher
  // from jest-dom or React Native Testing Library: requiring await would be
  // a false positive.
  it('does not flag toBeVisible in a file that does not use Playwright', () => {
    expect(
      findings(`it('a', () => { expect(getByTestId('x')).toBeVisible(); });`, [
        missingAwait,
      ]),
    ).toEqual([]);
  });

  it('still detects .rejects in a Playwright file', () => {
    expect(
      findings(`${IMPORT}test('a', async () => { expect(f()).rejects.toThrow(); });`, [
        missingAwait,
      ]),
    ).toHaveLength(1);
  });

  it('recognizes the Playwright import with a subpath', () => {
    expect(
      findings(
        `import { expect } from '@playwright/test/index';\ntest('a', async ({ page }) => { expect(page.locator('#x')).toBeVisible(); });`,
        [missingAwait],
      ),
    ).toHaveLength(1);
  });
});

describe('noAssertion with other assertion forms', () => {
  // Cypress asserts with .should(), not expect. Without recognizing that,
  // every Cypress test would be reported as defective.
  it('accepts a Cypress test with should', () => {
    expect(
      findings(`it('a', () => { cy.get('#total').should('have.text', '$0.00'); });`, [
        noAssertion,
      ]),
    ).toEqual([]);
  });

  it('accepts the chained and', () => {
    expect(
      findings(`it('a', () => { cy.get('#x').should('exist').and('be.visible'); });`, [
        noAssertion,
      ]),
    ).toEqual([]);
  });

  it('accepts Chai assert', () => {
    expect(
      findings(`it('a', () => { assert.equal(sumar(1, 1), 2); });`, [noAssertion]),
    ).toEqual([]);
  });

  // A Cypress test that only performs actions still verifies nothing.
  it('detects a Cypress test with no assertion at all', () => {
    expect(
      findings(`it('a', () => { cy.visit('/'); cy.get('#boton').click(); });`, [
        noAssertion,
      ]),
    ).toHaveLength(1);
  });
});
