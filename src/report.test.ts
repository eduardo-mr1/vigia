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
  it('informa cuando no hay hallazgos', () => {
    const report = renderReport({ findings: [], filesAnalyzed: 4 });
    expect(report).toContain('No findings in 4 test files');
  });

  it('concuerda el singular con un solo archivo', () => {
    expect(renderReport({ findings: [], filesAnalyzed: 1 })).toContain('1 test file');
  });

  it('incluye el resumen por severidad', () => {
    const report = renderReport({
      findings: [finding(), finding({ severity: 'P3' })],
      filesAnalyzed: 1,
    });
    expect(report).toContain('**1 P1**');
    expect(report).toContain('**1 P3**');
  });

  it('omite las severidades sin hallazgos', () => {
    const report = renderReport({ findings: [finding()], filesAnalyzed: 1 });
    expect(report).not.toContain('P2');
  });

  it('agrupa por archivo', () => {
    const report = renderReport({
      findings: [finding({ file: 'a.test.ts' }), finding({ file: 'b.test.ts' })],
      filesAnalyzed: 2,
    });
    expect(report).toContain('`a.test.ts`');
    expect(report).toContain('`b.test.ts`');
  });

  it('ordena los P1 antes que los P3 dentro de un archivo', () => {
    const report = renderReport({
      findings: [finding({ severity: 'P3', line: 1 }), finding({ severity: 'P1', line: 99 })],
      filesAnalyzed: 1,
    });
    expect(report.indexOf('**P1**')).toBeLessThan(report.indexOf('**P3**'));
  });

  it('incluye la sugerencia de corrección', () => {
    expect(renderReport({ findings: [finding()], filesAnalyzed: 1 })).toContain(
      'Add an expect.',
    );
  });

  // La marca permite reemplazar el comentario anterior en vez de acumular uno
  // por commit.
  it('deja una marca para poder actualizar el comentario', () => {
    expect(renderReport({ findings: [finding()], filesAnalyzed: 1 })).toContain(
      '<!-- vigia -->',
    );
  });
});

describe('countBySeverity', () => {
  it('cuenta por severidad', () => {
    expect(
      countBySeverity([finding(), finding(), finding({ severity: 'P2' })]),
    ).toEqual({ P1: 2, P2: 1, P3: 0 });
  });

  it('devuelve ceros sin hallazgos', () => {
    expect(countBySeverity([])).toEqual({ P1: 0, P2: 0, P3: 0 });
  });
});
