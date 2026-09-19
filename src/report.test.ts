import { countBySeverity, renderReport } from './report';
import type { Finding } from './types';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule: 'no-assertion',
    severity: 'P1',
    file: 'src/a.test.ts',
    line: 10,
    column: 3,
    message: 'Test "x" contains no assertion.',
    hint: 'Add an expect.',
    ...overrides,
  };
}

describe('renderReport', () => {
  it('reports when there are no findings', () => {
    const report = renderReport({ findings: [], filesAnalyzed: 4 });
    expect(report).toContain('No findings in 4 test files');
  });

  it('matches the singular with a single file', () => {
    expect(renderReport({ findings: [], filesAnalyzed: 1 })).toContain('1 test file');
  });

  it('includes the summary by severity', () => {
    const report = renderReport({
      findings: [finding(), finding({ severity: 'P3' })],
      filesAnalyzed: 1,
    });
    expect(report).toContain('**1 P1**');
    expect(report).toContain('**1 P3**');
  });

  it('omits severities with no findings', () => {
    const report = renderReport({ findings: [finding()], filesAnalyzed: 1 });
    expect(report).not.toContain('P2');
  });

  it('groups by file', () => {
    const report = renderReport({
      findings: [finding({ file: 'a.test.ts' }), finding({ file: 'b.test.ts' })],
      filesAnalyzed: 2,
    });
    expect(report).toContain('`a.test.ts`');
    expect(report).toContain('`b.test.ts`');
  });

  it('sorts P1s before P3s within a file', () => {
    const report = renderReport({
      findings: [finding({ severity: 'P3', line: 1 }), finding({ severity: 'P1', line: 99 })],
      filesAnalyzed: 1,
    });
    expect(report.indexOf('**P1**')).toBeLessThan(report.indexOf('**P3**'));
  });

  it('includes the fix suggestion', () => {
    expect(renderReport({ findings: [finding()], filesAnalyzed: 1 })).toContain(
      'Add an expect.',
    );
  });

  // The marker lets the previous comment be replaced instead of piling up
  // one per commit.
  it('leaves a marker so the comment can be updated', () => {
    expect(renderReport({ findings: [finding()], filesAnalyzed: 1 })).toContain(
      '<!-- vigia -->',
    );
  });
});

describe('countBySeverity', () => {
  it('counts by severity', () => {
    expect(
      countBySeverity([finding(), finding(), finding({ severity: 'P2' })]),
    ).toEqual({ P1: 2, P2: 1, P3: 0 });
  });

  it('returns zeros with no findings', () => {
    expect(countBySeverity([])).toEqual({ P1: 0, P2: 0, P3: 0 });
  });
});
