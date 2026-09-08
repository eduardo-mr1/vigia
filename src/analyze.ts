/**
 * Recorre archivos de prueba y aplica las reglas.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { collectKnownIds, orphanNegativeAssertions, type KnownIds } from './orphan';
import { rules, type Rule, type RuleContext } from './rules';
import type { AnalysisResult, Finding } from './types';

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const FLOW_FILE = /\.(ya?ml)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'build']);

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

/** Flujos E2E en YAML (Maestro). Se analizan solo por aserciones negativas. */
export function isFlowFile(file: string): boolean {
  return FLOW_FILE.test(file);
}

export interface AnalyzeOptions {
  readonly rules?: readonly Rule[];
  /**
   * Raíz del código fuente. Con ella se recogen los identificadores que la app
   * puede producir, para detectar aserciones negativas huérfanas. Sin ella esa
   * regla no se aplica: sin saber qué identificadores existen, cualquier
   * hallazgo sería una suposición.
   */
  readonly sourceRoot?: string;
}

/** Analiza el contenido de un archivo. Separado del disco para poder probarlo. */
export function analyzeSource(file: string, code: string, active: readonly Rule[] = rules): Finding[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const context: RuleContext = { file, source };

  return active
    .flatMap((rule) => rule(context))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

export function analyzeFiles(
  files: readonly string[],
  options: AnalyzeOptions = {},
): AnalysisResult {
  const active = options.rules ?? rules;
  const known: KnownIds | null = options.sourceRoot
    ? collectKnownIds(options.sourceRoot)
    : null;

  const findings: Finding[] = [];
  let filesAnalyzed = 0;

  for (const file of files) {
    const test = isTestFile(file);
    const flow = isFlowFile(file);
    if (!test && !flow) continue;

    let code: string;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      // Un archivo borrado en el PR sigue apareciendo en el diff. No es un
      // error: simplemente ya no hay nada que analizar.
      continue;
    }

    filesAnalyzed += 1;
    // Los flujos YAML no tienen AST de TypeScript: solo aplica la regla de
    // aserciones negativas.
    if (test) findings.push(...analyzeSource(file, code, active));
    if (known) findings.push(...orphanNegativeAssertions(file, code, known));
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, filesAnalyzed };
}

/** Lista los archivos de prueba y los flujos E2E bajo un directorio. */
export function collectTestFiles(root: string): string[] {
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
      } else if (isTestFile(entry.name) || isFlowFile(entry.name)) {
        found.push(full);
      }
    }
  }

  visit(root);
  return found.sort();
}
