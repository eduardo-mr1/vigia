#!/usr/bin/env node
/**
 * Uso:
 *   vigia [ruta]              analiza las pruebas y flujos bajo esa ruta
 *   vigia --files a.ts b.ts   analiza archivos concretos (los del PR)
 *   vigia --src ./src         raíz del código, habilita la deteccion de
 *                             aserciones negativas huerfanas
 *   vigia --format markdown   emite el comentario listo para publicar
 *
 * Código de salida 1 si hay hallazgos P1: es lo que hace fallar el job de CI.
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
 * Recorre por posición y no por valor: `--src ./demo ./demo` repite el mismo
 * texto en dos papeles distintos, y filtrar por valor descartaba el
 * posicional.
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

  // Solo los P1 rompen el build. Un P3 informa; hacerlo bloqueante enseña a
  // ignorar la herramienta.
  process.exitCode = countBySeverity(result.findings).P1 > 0 ? 1 : 0;
}

main();
