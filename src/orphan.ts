/**
 * Negative assertions on identifiers that don't exist.
 *
 * The case that started this tool: an E2E flow did `assertNotVisible` on
 * an identifier the app never generates. A negative assertion on something
 * impossible always passes. The test stayed green for weeks without
 * checking anything.
 *
 * Detection cross-references two sides: which identifiers the source code
 * can produce, and which ones the tests expect. Whatever shows up only in
 * the tests is suspect.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import type { Finding } from './types';

/** Identifiers the source code can produce. */
export interface KnownIds {
  /** Exact literals: testID="add-fab". */
  readonly exact: ReadonlySet<string>;
  /** Prefixes of constructed identifiers: testID={`expense-${index}`}. */
  readonly prefixes: readonly string[];
}

const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'build']);

// testID="something" | testId='something' | data-testid="something"
const LITERAL_ID = /(?:testID|testId|data-testid)\s*=\s*["']([^"']+)["']/g;
// testID={`prefix-${...}`} — the prefix is the only part known ahead of time.
const TEMPLATE_ID = /(?:testID|testId)\s*=\s*\{\s*`([^`$]*)\$\{/g;
// accessibilityLabel and other identifiers aren't considered: they're text
// for the user, not test anchors.

export function collectKnownIds(root: string): KnownIds {
  const exact = new Set<string>();
  const prefixes: string[] = [];

  for (const file of collectSourceFiles(root)) {
    let code: string;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const match of code.matchAll(LITERAL_ID)) {
      if (match[1]) exact.add(match[1]);
    }
    for (const match of code.matchAll(TEMPLATE_ID)) {
      if (match[1]) prefixes.push(match[1]);
    }
  }

  return { exact, prefixes };
}

/** Source code files, excluding test files. */
export function collectSourceFiles(root: string): string[] {
  const found: string[] = [];

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(full);
      } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
        found.push(full);
      }
    }
  }

  visit(root);
  return found.sort();
}

/** How confident we are that the code can produce an identifier. */
export type Confidence = 'exact' | 'probable' | 'nonexistent';

/**
 * A constructed identifier (`expense-${index}`) only reveals its prefix, so
 * matching by prefix is deliberately ambiguous.
 *
 * The criterion: an interpolation produces ONE value — an index, an id, a
 * key — not a structure. If what follows the prefix carries more separators,
 * it's more likely to be a made-up identifier than a real value.
 *
 * It's exactly the case that started the tool: `expense-amount-` existed as
 * a prefix, and `expense-amount-9999-duplicate` slipped through as valid.
 */
export function classify(id: string, known: KnownIds): Confidence {
  if (known.exact.has(id)) return 'exact';

  const matching = known.prefixes.filter((p) => p !== '' && id.startsWith(p));
  if (matching.length === 0) return 'nonexistent';

  // The shortest suffix is the one that matches the most specific prefix.
  const suffix = matching
    .map((p) => id.slice(p.length))
    .reduce((shortest, current) => (current.length < shortest.length ? current : shortest));

  return /^[A-Za-z0-9_]+$/.test(suffix) ? 'exact' : 'probable';
}

export function isKnown(id: string, known: KnownIds): boolean {
  return classify(id, known) === 'exact';
}

export interface NegativeAssertion {
  readonly id: string;
  readonly line: number;
  readonly column: number;
  readonly form: string;
}

/**
 * Negative assertions in a Maestro (YAML) flow.
 *
 * Here the text really is analyzed line by line: YAML has no AST at hand,
 * and its structure is flat enough to do this unambiguously.
 */
export function findFlowAssertions(code: string): NegativeAssertion[] {
  const results: NegativeAssertion[] = [];
  const lines = code.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!/assertNotVisible/.test(line)) return;

    const inline = /assertNotVisible:\s*["']?([\w.-]+)["']?\s*$/.exec(line);
    if (inline?.[1]) {
      results.push({
        id: inline[1],
        line: index + 1,
        column: line.indexOf('assertNotVisible') + 1,
        form: 'assertNotVisible',
      });
      return;
    }

    const next = lines[index + 1];
    if (next === undefined) return;

    const nested = /^\s*id:\s*["']([^"']+)["']/.exec(next);
    if (nested?.[1]) {
      results.push({
        id: nested[1],
        line: index + 2,
        column: next.indexOf('id:') + 1,
        form: 'assertNotVisible',
      });
    }
  });

  return results;
}

const NEGATIVE_MATCHERS = new Set(['toBeNull', 'toBeFalsy', 'toBeUndefined']);
const NEGATED_MATCHERS = new Set(['toBeVisible', 'toBeTruthy', 'toBeOnTheScreen']);
const QUERY_FNS = new Set(['queryByTestId', 'queryAllByTestId']);

/**
 * Negative assertions in TypeScript code, using the AST.
 *
 * The regex equivalent flagged code written inside a string literal — this
 * rule's own test file gave it away during self-analysis. It's the same
 * reason the other rules already used the syntax tree.
 */
export function findCodeAssertions(file: string, code: string): NegativeAssertion[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const results: NegativeAssertion[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text;
      const negative = NEGATIVE_MATCHERS.has(matcher);
      const negated = NEGATED_MATCHERS.has(matcher);

      if (negative || negated) {
        // With a negated matcher there's an intermediate `.not` to walk through.
        let receiver: ts.Expression = node.expression.expression;
        if (
          negated &&
          ts.isPropertyAccessExpression(receiver) &&
          receiver.name.text === 'not'
        ) {
          receiver = receiver.expression;
        } else if (negated) {
          receiver = undefined as unknown as ts.Expression;
        }

        const id = receiver ? testIdFromExpect(receiver) : null;
        if (id !== null) {
          const { line, character } = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          results.push({
            id,
            line: line + 1,
            column: character + 1,
            form: 'queryByTestId',
          });
        }
      }
    }
    node.forEachChild(visit);
  }

  visit(source);
  return results;
}

/** Extracts the identifier from `expect(queryByTestId('x'))`, if that's the shape. */
function testIdFromExpect(node: ts.Expression): string | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'expect') return null;

  const inner = node.arguments[0];
  if (!inner) return null;

  const call = ts.isAwaitExpression(inner) ? inner.expression : inner;
  if (!ts.isCallExpression(call)) return null;

  const callee = call.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null;
  if (name === null || !QUERY_FNS.has(name)) return null;

  const argument = call.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

/** Negative assertions in a file, based on its type. */
export function findNegativeAssertions(file: string, code: string): NegativeAssertion[] {
  const results = /\.ya?ml$/.test(file)
    ? findFlowAssertions(code)
    : findCodeAssertions(file, code);

  return [...results].sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Reports the negative assertions whose identifier nobody can produce. */
export function orphanNegativeAssertions(
  file: string,
  code: string,
  known: KnownIds,
): Finding[] {
  const findings: Finding[] = [];

  for (const assertion of findNegativeAssertions(file, code)) {
    const confidence = classify(assertion.id, known);
    if (confidence === 'exact') continue;

    const orphan = confidence === 'nonexistent';
    findings.push({
      rule: 'orphan-negative-assertion',
      severity: orphan ? 'P1' : 'P2',
      file,
      line: assertion.line,
      column: assertion.column,
      message: orphan
        ? `"${assertion.id}" doesn't appear anywhere in the source: this negative assertion always passes.`
        : `"${assertion.id}" only partially matches a constructed identifier: the code may never produce it.`,
      hint: orphan
        ? `Check the identifier, or make sure the code can generate "${assertion.id}" in some state.`
        : 'Check what values the interpolation actually takes, or assert on visible data instead of the absence of an element.',
    });
  }

  return findings;
}
