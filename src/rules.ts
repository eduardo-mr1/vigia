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
  return '(sin título)';
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

/** ¿El nodo contiene al menos una llamada a `expect`? */
function containsExpect(node: ts.Node): boolean {
  let found = false;
  walk(node, (current) => {
    if (found) return;
    if (ts.isCallExpression(current) && calleeName(current.expression) === 'expect') {
      found = true;
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
    if (!body || containsExpect(body)) return;

    findings.push(
      finding(
        context,
        node,
        'sin-assercion',
        'P1',
        `La prueba "${titleOf(node)}" no contiene ninguna aserción.`,
        'Agrega un expect, o borra la prueba: hoy pasa aunque el código esté roto.',
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
        'expect-sin-matcher',
        'P1',
        'expect() sin matcher encadenado.',
        'Encadena un matcher, por ejemplo .toBe(...) o .toHaveLength(...).',
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
        'tautologia',
        'P1',
        `expect(${actual.getText(context.source)}) comparado consigo mismo.`,
        'Compara el resultado del código bajo prueba, no un literal contra sí mismo.',
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
        'prueba-omitida',
        'P3',
        `"${titleOf(node)}" está omitida.`,
        'Reactívala o bórrala. Una prueba desactivada da la ilusión de cobertura.',
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
        'prueba-enfocada',
        'P1',
        `"${titleOf(node)}" usa .only: el resto de la suite no se ejecuta.`,
        'Quita .only antes de integrar. En CI esto silencia el resto de las pruebas.',
      ),
    );
  });

  return findings;
};

export const rules: readonly Rule[] = [
  noAssertion,
  expectWithoutMatcher,
  tautology,
  skippedTest,
  focusedTest,
];
