#!/usr/bin/env node
/**
 * Usage:
 *   vigia [path]               analyzes the tests and flows under that path
 *   vigia --files a.ts b.ts    analyzes specific files (the PR's own)
 *   vigia --src ./src          source root, enables detection of orphan
 *                              negative assertions
 *   vigia --format markdown    emits the comment ready to post
 *
 * Exit code 1 when there's a P1 finding: that's what fails the CI job.
 */

import { analyzeFiles, collectTestFiles } from './analyze';
import { countBySeverity, renderReport } from './report';

interface Args {
  readonly files: string[];
  readonly format: string;
  readonly root: string;
  readonly sourceRoot?: string;
}

/**
 * Walked by position, not by value: `--src ./demo ./demo` repeats the same
 * text in two different roles, and filtering by value would have dropped
 * the positional one.
 */
function parseArgs(argv: readonly string[]): Args {
  const files: string[] = [];
  let format = 'text';
  let root: string | undefined;
  let sourceRoot: string | undefined;
  let collectingFiles = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--files') {
      collectingFiles = true;
      continue;
    }
    if (arg === '--format') {
      format = argv[i + 1] ?? 'text';
      i += 1;
      collectingFiles = false;
      continue;
    }
    if (arg === '--src') {
      sourceRoot = argv[i + 1];
      i += 1;
      collectingFiles = false;
      continue;
    }
    if (arg.startsWith('--')) {
      collectingFiles = false;
      continue;
    }

    if (collectingFiles) files.push(arg);
    else root ??= arg;
  }

  return { files, format, root: root ?? '.', ...(sourceRoot ? { sourceRoot } : {}) };
}

function main(): void {
  const { files, format, root, sourceRoot } = parseArgs(process.argv.slice(2));
  const targets = files.length > 0 ? files : collectTestFiles(root);
  const result = analyzeFiles(targets, sourceRoot ? { sourceRoot } : {});

  if (format === 'markdown') {
    process.stdout.write(`${renderReport(result)}\n`);
  } else if (result.findings.length === 0) {
    process.stdout.write(`No findings in ${result.filesAnalyzed} file(s).\n`);
  } else {
    for (const f of result.findings) {
      process.stdout.write(`${f.file}:${f.line}:${f.column}  ${f.severity}  ${f.rule}  ${f.message}\n`);
    }
    const counts = countBySeverity(result.findings);
    process.stdout.write(`\n${result.findings.length} finding(s): ${counts.P1} P1, ${counts.P2} P2, ${counts.P3} P3\n`);
  }

  // Only P1s break the build. A P3 just informs; making it blocking teaches
  // people to ignore the tool.
  process.exitCode = countBySeverity(result.findings).P1 > 0 ? 1 : 0;
}

main();
