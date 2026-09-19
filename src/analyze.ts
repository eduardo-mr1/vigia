/**
 * Walks test files and applies the rules.
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

/** E2E flows in YAML (Maestro). Only analyzed for negative assertions. */
export function isFlowFile(file: string): boolean {
  return FLOW_FILE.test(file);
}

export interface AnalyzeOptions {
  readonly rules?: readonly Rule[];
  /**
   * Source code root. With it, the identifiers the app can produce are
   * collected, to detect orphan negative assertions. Without it, that rule
   * doesn't apply: without knowing what identifiers exist, any finding
   * would be a guess.
   */
  readonly sourceRoot?: string;
}

/** Analyzes a file's contents. Kept separate from disk access so it's testable. */
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
      // A file deleted in the PR still shows up in the diff. Not an
      // error: there's simply nothing left to analyze.
      continue;
    }

    filesAnalyzed += 1;
    // YAML flows have no TypeScript AST: only the negative-assertion rule
    // applies to them.
    if (test) findings.push(...analyzeSource(file, code, active));
    if (known) findings.push(...orphanNegativeAssertions(file, code, known));
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, filesAnalyzed };
}

/** Lists the test files and E2E flows under a directory. */
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
