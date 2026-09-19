/**
 * Reglas que detectan pruebas incapaces de fallar.
 *
 * Todas parten del mismo principio: una prueba que no puede fallar es peor que
 * ninguna prueba, porque ocupa el lugar de la que sí verificaría algo y aporta
 * confianza que nadie gana.
 *
 * El análisis usa el AST de TypeScript en lugar de expresiones regulares: un
 * `expect` dentro de un comentario o de una cadena no es una aserción, y solo
 * el árbol sintáctico distingue la diferencia.
 */

import ts from 'typescript';

import type { Finding, Severity } from './types';

const TEST_NAMES = new Set(['it', 'test']);
const SUITE_NAMES = new Set(['describe']);

export interface RuleContext {
  readonly file: string;
  readonly source: ts.SourceFile;
}

export type Rule = (context: RuleContext) => Finding[];

/** Convierte una posición del AST en línea y columna 1-based. */
function locate(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, column: character + 1 };
}

function finding(
  context: RuleContext,
  node: ts.Node,
  rule: string,
  severity: Severity,
  message: string,
  hint: string,
): Finding {
  return { rule, severity, file: context.file, ...locate(context.source, node), message, hint };
}

/** Nombre invocado, siguiendo cadenas como `it.each(...)` o `describe.skip`. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return calleeName(expression.expression);
  if (ts.isCallExpression(expression)) return calleeName(expression.expression);
  if (ts.isTaggedTemplateExpression(expression)) return calleeName(expression.tag);
  return null;
}

/** Modificadores encadenados: `it.skip.each` devuelve ['skip', 'each']. */
function modifiers(expression: ts.Expression): string[] {
  if (ts.isPropertyAccessExpression(expression)) {
    return [...modifiers(expression.expression), expression.name.text];
  }
  if (ts.isCallExpression(expression)) return modifiers(expression.expression);
  return [];
}

function isTestCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node.expression);
  return name !== null && (TEST_NAMES.has(name) || name === 'xit' || name === 'xtest');
}

function isSuiteCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node.expression);
  return name !== null && (SUITE_NAMES.has(name) || name === 'xdescribe');
}

function titleOf(call: ts.CallExpression): string {
  const first = call.arguments[0];
  if (first && ts.isStringLiteralLike(first)) return first.text;
  return '(untitled)';
}

function bodyOf(call: ts.CallExpression): ts.Node | null {
  for (const argument of call.arguments) {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      return argument.body;
    }
  }
  return null;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * Formas de aserción reconocidas, más allá de `expect`.
 *
 * Cypress asierta con `.should()` y `.and()`; Chai también ofrece `assert.*`.
 * Sin esto, toda prueba de Cypress se reportaría como "sin aserción": un falso
 * positivo que haría inservible la herramienta en esos proyectos.
 */
const ASSERTION_METHODS = new Set(['should', 'and']);

/** ¿El nodo contiene al menos una aserción, en cualquiera de sus formas? */
function containsAssertion(node: ts.Node): boolean {
  let found = false;

  walk(node, (current) => {
    if (found || !ts.isCallExpression(current)) return;

    const callee = current.expression;
    if (calleeName(callee) === 'expect') {
      found = true;
      return;
    }

    if (ts.isPropertyAccessExpression(callee)) {
      // .should(...) / .and(...) de Cypress
      if (ASSERTION_METHODS.has(callee.name.text)) {
        found = true;
        return;
      }
      // assert.equal(...) y demás de Chai
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'assert') {
        found = true;
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------- reglas

/** Una prueba sin `expect` pasa siempre: no verifica nada. */
export const noAssertion: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!isTestCall(node)) return;
    const body = bodyOf(node);
    if (!body || containsAssertion(body)) return;

    findings.push(
      finding(
        context,
        node,
        'no-assertion',
        'P1',
        `Test "${titleOf(node)}" contains no assertion.`,
        'Add an expect, or delete the test: right now it passes even if the code is broken.',
      ),
    );
  });

  return findings;
};

/** `expect(x)` sin matcher encadenado no comprueba nada. */
export const expectWithoutMatcher: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!ts.isExpressionStatement(node)) return;
    const { expression } = node;
    if (!ts.isCallExpression(expression)) return;
    if (calleeName(expression.expression) !== 'expect') return;
    // Un expect util siempre aparece dentro de un acceso a propiedad
    // (expect(x).toBe), nunca como sentencia suelta.
    if (!ts.isIdentifier(expression.expression)) return;

    findings.push(
      finding(
        context,
        node,
        'expect-without-matcher',
        'P1',
        'expect() with no matcher chained.',
        'Chain a matcher, e.g. .toBe(...) or .toHaveLength(...).',
      ),
    );
  });

  return findings;
};

/** Comparar un literal consigo mismo comprueba el lenguaje, no el código. */
export const tautology: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isPropertyAccessExpression(node.expression)) return;

    const matcher = node.expression.name.text;
    if (matcher !== 'toBe' && matcher !== 'toEqual' && matcher !== 'toStrictEqual') return;

    const receiver = node.expression.expression;
    if (!ts.isCallExpression(receiver)) return;
    if (calleeName(receiver.expression) !== 'expect') return;

    const actual = receiver.arguments[0];
    const expected = node.arguments[0];
    if (!actual || !expected) return;
    if (!isLiteral(actual) || !isLiteral(expected)) return;
    if (actual.getText(context.source) !== expected.getText(context.source)) return;

    findings.push(
      finding(
        context,
        node,
        'tautology',
        'P1',
        `expect(${actual.getText(context.source)}) compared against itself.`,
        'Compare the result of the code under test, not a literal against itself.',
      ),
    );
  });

  return findings;
};

function isLiteral(node: ts.Node): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

/** Una prueba omitida no protege nada, y se olvida. */
export const skippedTest: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!isTestCall(node) && !isSuiteCall(node)) return;

    const name = calleeName(node.expression);
    const chain = modifiers(node.expression);
    const omitted = chain.includes('skip') || chain.includes('todo') || name === 'xit' || name === 'xtest' || name === 'xdescribe';
    if (!omitted) return;

    findings.push(
      finding(
        context,
        node,
        'skipped-test',
        'P3',
        `"${titleOf(node)}" is skipped.`,
        'Re-enable it or delete it. A disabled test gives the illusion of coverage.',
      ),
    );
  });

  return findings;
};

/** `it.only` deja fuera al resto de la suite sin que nadie lo note en CI. */
export const focusedTest: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!isTestCall(node) && !isSuiteCall(node)) return;
    if (!modifiers(node.expression).includes('only')) return;

    findings.push(
      finding(
        context,
        node,
        'focused-test',
        'P1',
        `"${titleOf(node)}" uses .only: the rest of the suite doesn't run.`,
        'Remove .only before merging. In CI this silences the rest of the tests.',
      ),
    );
  });

  return findings;
};



/**
 * Una aserción asíncrona sin `await` no se comprueba.
 *
 * `expect(promesa).rejects.toThrow()` devuelve una promesa. Sin `await` ni
 * `return`, la prueba termina antes de que se resuelva y el fallo se pierde —
 * o peor, aparece en otra prueba, atribuido al caso equivocado.
 *
 * Es el defecto más común en suites asíncronas y el más difícil de ver leyendo:
 * la línea parece completa. Jest a veces avisa y a veces no, según la versión
 * y según si otra prueba absorbe el rechazo.
 */
export const missingAwait: Rule = (context) => {
  const findings: Finding[] = [];
  const playwright = usesPlaywright(context.source);

  walk(context.source, (node) => {
    if (!ts.isExpressionStatement(node)) return;

    const asyncExpect = findAsyncExpect(node.expression, playwright);
    if (asyncExpect === null) return;

    findings.push(
      finding(
        context,
        node,
        'missing-await',
        'P1',
        `expect(...).${asyncExpect} with no await: the test ends before checking anything.`,
        'Add await, or return the expression.',
      ),
    );
  });

  return findings;
};

const ASYNC_MODIFIERS = new Set(['resolves', 'rejects']);

/**
 * Matchers de Playwright que esperan al elemento y devuelven una promesa.
 *
 * En Playwright TODA aserción sobre un locator es asíncrona: reintenta hasta
 * que se cumple o se agota el tiempo. Sin `await`, la aserción se descarta y
 * la prueba pasa sin haber comprobado nada — el mismo defecto que con
 * `.rejects`, pero mucho más frecuente porque la línea se ve completa.
 */
const PLAYWRIGHT_MATCHERS = new Set([
  'toBeVisible',
  'toBeHidden',
  'toBeEnabled',
  'toBeDisabled',
  'toBeChecked',
  'toBeEditable',
  'toBeEmpty',
  'toBeFocused',
  'toBeAttached',
  'toBeInViewport',
  'toContainText',
  'toHaveText',
  'toHaveValue',
  'toHaveValues',
  'toHaveAttribute',
  'toHaveClass',
  'toHaveCount',
  'toHaveCSS',
  'toHaveId',
  'toHaveJSProperty',
  'toHaveScreenshot',
  'toHaveTitle',
  'toHaveURL',
  'toBeOK',
]);

/** ¿El archivo importa Playwright? Solo entonces sus matchers son asíncronos. */
function usesPlaywright(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.includes('@playwright/'),
  );
}

/**
 * Devuelve el modificador asíncrono (`resolves` / `rejects`) de una expresión
 * que arranca en `expect(...)`, o null si no es esa forma.
 *
 * Solo se inspecciona la expresión desnuda: si el nodo fuera `await ...` o
 * `return ...`, no sería un ExpressionStatement con esta forma.
 */
function findAsyncExpect(expression: ts.Expression, playwright: boolean): string | null {
  let current: ts.Node = expression;
  let modifier: string | null = null;

  // Se recorre la cadena hacia la raíz: expect(x).rejects.toThrow()
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      const name = current.name.text;
      if (ASYNC_MODIFIERS.has(name)) modifier = name;
      else if (playwright && modifier === null && PLAYWRIGHT_MATCHERS.has(name)) {
        modifier = name;
      }
      current = current.expression;
    } else {
      current = current.expression;
    }
  }

  if (modifier === null) return null;
  return ts.isIdentifier(current) && current.text === 'expect' ? modifier : null;
}

export const rules: readonly Rule[] = [
  noAssertion,
  expectWithoutMatcher,
  tautology,
  skippedTest,
  focusedTest,
  missingAwait,
];
