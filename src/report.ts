/**
 * Formato del comentario que se publica en el Pull Request.
 *
 * En Markdown y agrupado por archivo: quien lee un PR revisa archivo por
 * archivo, no regla por regla.
 */

import type { AnalysisResult, Finding, Severity } from './types';

const SEVERITY_ORDER: Record<Severity, number> = { P1: 0, P2: 1, P3: 2 };

export function renderReport(result: AnalysisResult): string {
  const { findings, filesAnalyzed } = result;
  const plural = filesAnalyzed === 1 ? 'archivo' : 'archivos';

  if (findings.length === 0) {
    return `## Vigía\n\nSin hallazgos en ${filesAnalyzed} ${plural} de prueba.`;
  }

  const counts = countBySeverity(findings);
  const summary = (['P1', 'P2', 'P3'] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => `**${counts[s]} ${s}**`)
    .join(' · ');

  const lines = [
    '## Vigía',
    '',
    `${findings.length} ${findings.length === 1 ? 'hallazgo' : 'hallazgos'} en ${filesAnalyzed} ${plural}: ${summary}`,
    '',
  ];

  for (const [file, group] of groupByFile(findings)) {
    lines.push(`### \`${file}\``, '');
    for (const f of group) {
      lines.push(`- **${f.severity}** · línea ${f.line} · \`${f.rule}\``);
      lines.push(`  ${f.message}`);
      lines.push(`  _${f.hint}_`);
    }
    lines.push('');
  }

  lines.push('<!-- vigia -->');
  return lines.join('\n');
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { P1: 0, P2: 0, P3: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = groups.get(f.file);
    if (bucket) bucket.push(f);
    else groups.set(f.file, [f]);
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line,
    );
  }
  return groups;
}
