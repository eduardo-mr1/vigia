import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeFiles, collectTestFiles, isFlowFile, isTestFile } from './analyze';

describe('isTestFile', () => {
  it.each(['a.test.ts', 'b.spec.ts', 'c.test.tsx', 'd.spec.js'])(
    'recognizes %s as a test file',
    (file) => {
      expect(isTestFile(file)).toBe(true);
    },
  );

  it.each(['index.ts', 'testing.ts', 'spec.ts', 'README.md'])(
    'rejects %s',
    (file) => {
      expect(isTestFile(file)).toBe(false);
    },
  );
});

describe('analyzeFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, code: string): string {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, code);
    return full;
  }

  it('analyzes only test files and flows', () => {
    const test = write('a.test.ts', `it('vacia', () => {});`);
    const source = write('a.ts', `export const x = 1;`);

    const result = analyzeFiles([test, source]);
    expect(result.filesAnalyzed).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it('detects an orphan negative assertion in a Maestro flow', () => {
    write('pantalla.tsx', `<View testID="lista" />`);
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "no-existe"');

    const result = analyzeFiles([flow], { sourceRoot: dir });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe('orphan-negative-assertion');
  });

  // Without knowing which identifiers exist, any finding would be a
  // guess: the rule doesn't apply.
  it('skips the orphan-assertion rule when no source root is given', () => {
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "no-existe"');
    expect(analyzeFiles([flow]).findings).toEqual([]);
  });

  it('accepts a negative assertion on a real identifier', () => {
    write('pantalla.tsx', `<View testID="badge-pending" />`);
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "badge-pending"');

    expect(analyzeFiles([flow], { sourceRoot: dir }).findings).toEqual([]);
  });

  it('sorts findings by file and line', () => {
    const b = write('b.test.ts', `it('vacia', () => {});`);
    const a = write('a.test.ts', `it('vacia', () => {});`);

    const files = analyzeFiles([b, a]).findings.map((f) => f.file);
    expect([...files].sort()).toEqual(files);
  });

  // A file deleted in the PR still shows up in the diff.
  it('ignores files that no longer exist instead of failing', () => {
    const result = analyzeFiles([path.join(dir, 'borrado.test.ts')]);
    expect(result.filesAnalyzed).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('accumulates findings across several files', () => {
    const a = write('a.test.ts', `it('vacia', () => {});`);
    const b = write('b.test.ts', `it.only('enfocada', () => { expect(1).toBe(2); });`);

    expect(analyzeFiles([a, b]).findings).toHaveLength(2);
  });

  it('applies specific rules when given', () => {
    const a = write('a.test.ts', `it.skip('omitida', () => { expect(1).toBe(2); });`);
    expect(analyzeFiles([a], { rules: [] }).findings).toEqual([]);
  });

  it('returns empty with no files', () => {
    expect(analyzeFiles([])).toEqual({ findings: [], filesAnalyzed: 0 });
  });
});

describe('isFlowFile', () => {
  it.each(['flujo.yaml', 'flujo.yml'])('recognizes %s', (file) => {
    expect(isFlowFile(file)).toBe(true);
  });

  it('rejects other formats', () => {
    expect(isFlowFile('config.json')).toBe(false);
  });
});

describe('collectTestFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds test files in subdirectories', () => {
    fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'src', 'lib', 'b.spec.ts'), '');
    fs.writeFileSync(path.join(dir, 'src', 'c.ts'), '');

    expect(collectTestFiles(dir)).toHaveLength(2);
  });

  it('includes YAML E2E flows', () => {
    fs.writeFileSync(path.join(dir, 'flujo.yaml'), '');
    expect(collectTestFiles(dir)).toHaveLength(1);
  });

  it('does not walk into node_modules', () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'paquete'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'paquete', 'x.test.ts'), '');

    expect(collectTestFiles(dir)).toEqual([]);
  });

  it('returns a sorted, stable list', () => {
    fs.writeFileSync(path.join(dir, 'z.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'a.test.ts'), '');

    const found = collectTestFiles(dir).map((f) => path.basename(f));
    expect(found).toEqual(['a.test.ts', 'z.test.ts']);
  });

  it('tolerates a nonexistent directory', () => {
    expect(collectTestFiles(path.join(dir, 'no-existe'))).toEqual([]);
  });
});
