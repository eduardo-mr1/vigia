/**
 * Model of a finding.
 *
 * `line` and `column` are 1-based, the way any editor reports them: a
 * finding the user can't jump to with one click isn't useful.
 */

export type Severity = 'P1' | 'P2' | 'P3';

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** What to do about it. A finding with no way out is just a complaint. */
  readonly hint: string;
}

export interface AnalysisResult {
  readonly findings: Finding[];
  readonly filesAnalyzed: number;
}
