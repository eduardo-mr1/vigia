import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeFiles, collectTestFiles, isFlowFile, isTestFile } from './analyze';

describe('isTestFile', () => {
  it.each(['a.test.ts', 'b.spec.ts', 'c.test.tsx', 'd.spec.js'])(
    'reconoce %s como archivo de prueba',
    (file) => {
      expect(isTestFile(file)).toBe(true);
    },
  );

  it.each(['index.ts', 'testing.ts', 'spec.ts', 'README.md'])(
    'descarta %s',
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

  it('analiza solo archivos de prueba y flujos', () => {
    const test = write('a.test.ts', `it('vacia', () => {});`);
    const source = write('a.ts', `export const x = 1;`);

    const result = analyzeFiles([test, source]);
    expect(result.filesAnalyzed).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it('detecta una aserción negativa huérfana en un flujo de Maestro', () => {
    write('pantalla.tsx', `<View testID="lista" />`);
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "no-existe"');

    const result = analyzeFiles([flow], { sourceRoot: dir });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe('assercion-negativa-huerfana');
  });

  // Sin saber que identificadores existen, cualquier hallazgo seria una
  // suposicion: la regla no se aplica.
  it('omite la regla de aserciones huérfanas si no se da la raíz del código', () => {
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "no-existe"');
    expect(analyzeFiles([flow]).findings).toEqual([]);
  });

  it('acepta una aserción negativa sobre un identificador real', () => {
    write('pantalla.tsx', `<View testID="badge-pending" />`);
    const flow = write('flujo.yaml', '- assertNotVisible:\n    id: "badge-pending"');

    expect(analyzeFiles([flow], { sourceRoot: dir }).findings).toEqual([]);
  });

  it('ordena los hallazgos por archivo y línea', () => {
    const b = write('b.test.ts', `it('vacia', () => {});`);
    const a = write('a.test.ts', `it('vacia', () => {});`);

    const files = analyzeFiles([b, a]).findings.map((f) => f.file);
    expect([...files].sort()).toEqual(files);
  });

  // Un archivo borrado en el PR sigue apareciendo en el diff.
  it('ignora archivos que ya no existen en lugar de fallar', () => {
    const result = analyzeFiles([path.join(dir, 'borrado.test.ts')]);
    expect(result.filesAnalyzed).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('acumula hallazgos de varios archivos', () => {
    const a = write('a.test.ts', `it('vacia', () => {});`);
    const b = write('b.test.ts', `it.only('enfocada', () => { expect(1).toBe(2); });`);

    expect(analyzeFiles([a, b]).findings).toHaveLength(2);
  });

  it('aplica reglas concretas cuando se le indican', () => {
    const a = write('a.test.ts', `it.skip('omitida', () => { expect(1).toBe(2); });`);
    expect(analyzeFiles([a], { rules: [] }).findings).toEqual([]);
  });

  it('devuelve vacío sin archivos', () => {
    expect(analyzeFiles([])).toEqual({ findings: [], filesAnalyzed: 0 });
  });
});

describe('isFlowFile', () => {
  it.each(['flujo.yaml', 'flujo.yml'])('reconoce %s', (file) => {
    expect(isFlowFile(file)).toBe(true);
  });

  it('descarta otros formatos', () => {
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

  it('encuentra archivos de prueba en subdirectorios', () => {
    fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'src', 'lib', 'b.spec.ts'), '');
    fs.writeFileSync(path.join(dir, 'src', 'c.ts'), '');

    expect(collectTestFiles(dir)).toHaveLength(2);
  });

  it('incluye los flujos E2E en YAML', () => {
    fs.writeFileSync(path.join(dir, 'flujo.yaml'), '');
    expect(collectTestFiles(dir)).toHaveLength(1);
  });

  it('no entra a node_modules', () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'paquete'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'paquete', 'x.test.ts'), '');

    expect(collectTestFiles(dir)).toEqual([]);
  });

  it('devuelve una lista ordenada y estable', () => {
    fs.writeFileSync(path.join(dir, 'z.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'a.test.ts'), '');

    const found = collectTestFiles(dir).map((f) => path.basename(f));
    expect(found).toEqual(['a.test.ts', 'z.test.ts']);
  });

  it('tolera un directorio inexistente', () => {
    expect(collectTestFiles(path.join(dir, 'no-existe'))).toEqual([]);
  });
});
