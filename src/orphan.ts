/**
 * Aserciones negativas sobre identificadores que no existen.
 *
 * El caso que originó esta herramienta: un flujo E2E hacía
 * `assertNotVisible` sobre un identificador que la app nunca genera. Una
 * aserción negativa sobre algo imposible pasa siempre. La prueba estuvo
 * semanas en verde sin comprobar nada.
 *
 * La detección cruza dos lados: qué identificadores puede producir el código
 * fuente, y cuáles esperan las pruebas. Lo que aparece solo en las pruebas es
 * sospechoso.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import type { Finding } from './types';

/** Identificadores que el código fuente puede producir. */
export interface KnownIds {
  /** Literales exactos: testID="fab-agregar". */
  readonly exact: ReadonlySet<string>;
  /** Prefijos de identificadores construidos: testID={`gasto-${index}`}. */
  readonly prefixes: readonly string[];
}

const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'build']);

// testID="algo" | testId='algo' | data-testid="algo"
const LITERAL_ID = /(?:testID|testId|data-testid)\s*=\s*["']([^"']+)["']/g;
// testID={`prefijo-${...}`} — el prefijo es lo único conocido de antemano.
const TEMPLATE_ID = /(?:testID|testId)\s*=\s*\{\s*`([^`$]*)\$\{/g;
// accessibilityLabel y otros identificadores no se consideran: son texto para
// el usuario, no anclas de prueba.

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

/** Archivos de código fuente, excluidos los de prueba. */
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

/** Qué tan seguro es que el código pueda producir un identificador. */
export type Confidence = 'exacto' | 'probable' | 'inexistente';

/**
 * Un identificador construido (`gasto-${index}`) solo revela su prefijo, así
 * que la coincidencia por prefijo es ambigua a propósito.
 *
 * El criterio: una interpolación produce UN valor —un índice, un id, una
 * clave—, no una estructura. Si lo que sigue al prefijo trae más separadores,
 * es más probable que sea un identificador inventado que un valor real.
 *
 * Es exactamente el caso que originó la herramienta: `gasto-monto-` existía
 * como prefijo, y `gasto-monto-9999-duplicado` se colaba como válido.
 */
export function classify(id: string, known: KnownIds): Confidence {
  if (known.exact.has(id)) return 'exacto';

  const matching = known.prefixes.filter((p) => p !== '' && id.startsWith(p));
  if (matching.length === 0) return 'inexistente';

  // El sufijo más corto es el que corresponde al prefijo más específico.
  const suffix = matching
    .map((p) => id.slice(p.length))
    .reduce((shortest, current) => (current.length < shortest.length ? current : shortest));

  return /^[A-Za-z0-9_]+$/.test(suffix) ? 'exacto' : 'probable';
}

export function isKnown(id: string, known: KnownIds): boolean {
  return classify(id, known) === 'exacto';
}

export interface NegativeAssertion {
  readonly id: string;
  readonly line: number;
  readonly column: number;
  readonly form: string;
}

/**
 * Aserciones negativas en un flujo de Maestro (YAML).
 *
 * Aquí sí se analiza el texto línea a línea: YAML no tiene un AST a mano y su
 * estructura es lo bastante plana para hacerlo sin ambigüedad.
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
 * Aserciones negativas en código TypeScript, con el AST.
 *
 * El regex equivalente marcaba código escrito dentro de una cadena de texto —
 * el propio archivo de pruebas de esta regla lo delató en el autoanálisis. Es
 * el mismo motivo por el que las demás reglas ya usaban el árbol sintáctico.
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
        // Con matcher negado hay un `.not` intermedio que hay que atravesar.
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

/** Extrae el identificador de `expect(queryByTestId('x'))`, si es esa forma. */
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

/** Aserciones negativas de un archivo, según su tipo. */
export function findNegativeAssertions(file: string, code: string): NegativeAssertion[] {
  const results = /\.ya?ml$/.test(file)
    ? findFlowAssertions(code)
    : findCodeAssertions(file, code);

  return [...results].sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Reporta las aserciones negativas cuyo identificador nadie puede producir. */
export function orphanNegativeAssertions(
  file: string,
  code: string,
  known: KnownIds,
): Finding[] {
  const findings: Finding[] = [];

  for (const assertion of findNegativeAssertions(file, code)) {
    const confidence = classify(assertion.id, known);
    if (confidence === 'exacto') continue;

    const orphan = confidence === 'inexistente';
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
