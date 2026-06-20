import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..'); // packages/wallet-sdk/src
const ENGINE = join(SRC, 'internal', 'engine');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('engine seam', () => {
  it('confines all @tanstack/* imports to internal/engine/', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith(ENGINE))
      .filter((f) => /from ['"]@tanstack\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('resolves a single @tanstack/query-core copy', () => {
    // One patchedDependencies pin line + one resolution line is the single-copy
    // signature; >2 means a duplicate copy crept into the lockfile.
    const root = join(SRC, '..', '..', '..'); // repo root
    const lock = readFileSync(join(root, 'bun.lock'), 'utf8');
    const matches = lock.match(/"@tanstack\/query-core@5\.90\.20"/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});
