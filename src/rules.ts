/**
 * Rules that detect tests incapable of failing.
 *
 * They all start from the same principle: a test that can't fail is worse
 * than no test at all, because it occupies the place of one that would
 * actually verify something and earns confidence nobody has won.
 *
 * The analysis uses the TypeScript AST instead of regular expressions: an
 * `expect` inside a comment or a string isn't an assertion, and only the
 * syntax tree tells the difference.
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

/** Converts an AST position into a 1-based line and column. */
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

/** Invoked name, following chains like `it.each(...)` or `describe.skip`. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return calleeName(expression.expression);
  if (ts.isCallExpression(expression)) return calleeName(expression.expression);
  if (ts.isTaggedTemplateExpression(expression)) return calleeName(expression.tag);
  return null;
}

/** Chained modifiers: `it.skip.each` returns ['skip', 'each']. */
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
 * Assertion forms recognized beyond `expect`.
 *
 * Cypress asserts with `.should()` and `.and()`; Chai also offers `assert.*`.
 * Without this, every Cypress test would be reported as "no assertion": a
 * false positive that would make the tool unusable on those projects.
 */
const ASSERTION_METHODS = new Set(['should', 'and']);

/** Does the node contain at least one assertion, in any of its forms? */
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
      // .should(...) / .and(...) from Cypress
      if (ASSERTION_METHODS.has(callee.name.text)) {
        found = true;
        return;
      }
      // assert.equal(...) and the rest, from Chai
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'assert') {
        found = true;
      }
    }
  });

  return found;
}

// ---------------------------------------------------------------- rules

/** A test with no `expect` always passes: it verifies nothing. */
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

/** `expect(x)` with no matcher chained checks nothing. */
export const expectWithoutMatcher: Rule = (context) => {
  const findings: Finding[] = [];

  walk(context.source, (node) => {
    if (!ts.isExpressionStatement(node)) return;
    const { expression } = node;
    if (!ts.isCallExpression(expression)) return;
    if (calleeName(expression.expression) !== 'expect') return;
    // A useful expect always shows up inside a property access
    // (expect(x).toBe), never as a bare statement.
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

/** Comparing a literal against itself checks the language, not the code. */
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

/** A skipped test protects nothing, and gets forgotten. */
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

/** `it.only` leaves the rest of the suite out without anyone noticing in CI. */
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
 * An async assertion with no `await` never gets checked.
 *
 * `expect(promise).rejects.toThrow()` returns a promise. Without `await` or
 * `return`, the test ends before it settles and the failure is lost — or
 * worse, it surfaces in a different test, blamed on the wrong case.
 *
 * It's the most common defect in async suites and the hardest to spot by
 * reading: the line looks complete. Jest sometimes warns and sometimes
 * doesn't, depending on the version and on whether another test absorbs
 * the rejection.
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
 * Playwright matchers that wait for the element and return a promise.
 *
 * In Playwright EVERY assertion on a locator is asynchronous: it retries
 * until it passes or times out. Without `await`, the assertion gets
 * discarded and the test passes without having checked anything — the same
 * defect as with `.rejects`, but far more frequent because the line looks
 * complete.
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

/** Does the file import Playwright? Only then are its matchers asynchronous. */
function usesPlaywright(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.includes('@playwright/'),
  );
}

/**
 * Returns the async modifier (`resolves` / `rejects`) of an expression that
 * starts at `expect(...)`, or null if it isn't that shape.
 *
 * Only the bare expression is inspected: if the node were `await ...` or
 * `return ...`, it wouldn't be an ExpressionStatement with this shape.
 */
function findAsyncExpect(expression: ts.Expression, playwright: boolean): string | null {
  let current: ts.Node = expression;
  let modifier: string | null = null;

  // Walked from the chain back to its root: expect(x).rejects.toThrow()
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
