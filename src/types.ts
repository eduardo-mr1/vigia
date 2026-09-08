/**
 * Modelo de un hallazgo.
 *
 * `line` y `column` son 1-based, como los reporta cualquier editor: un hallazgo
 * que el usuario no puede localizar de un clic no sirve.
 */

export type Severity = 'P1' | 'P2' | 'P3';

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** Qué hacer al respecto. Un hallazgo sin salida es solo un reproche. */
  readonly hint: string;
}

export interface AnalysisResult {
  readonly findings: Finding[];
  readonly filesAnalyzed: number;
}
