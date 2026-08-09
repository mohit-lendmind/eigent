// The transport/reducer boundary rule (doc 10 §10 WP2): everything the
// renderer needs from the aion backend flows through src/api/aion/v1, and
// that boundary depends on nothing outside itself — no legacy Brain/server
// API modules, no stores, no Electron IPC. This keeps the boundary pure and
// makes "renderer stores do not call legacy routes" enforceable one layer up.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const boundaryDir = join(__dirname, '../../../src/api/aion/v1');

function moduleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return moduleFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe('aion boundary imports', () => {
  it('src/api/aion/v1 imports only within itself', () => {
    const files = moduleFiles(boundaryDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf-8'))) {
        expect(
          specifier.startsWith('./') || specifier.startsWith('../'),
          `${file} imports "${specifier}" — the aion boundary must not depend on app modules or packages`
        ).toBe(true);
        expect(
          specifier.includes('../..'),
          `${file} imports "${specifier}" — relative imports must stay inside src/api/aion/v1`
        ).toBe(false);
      }
    }
  });
});
