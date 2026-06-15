import { describe, expect, it } from 'bun:test';

/**
 * Encapsulation invariant: the web app must reach the SDK only through its
 * curated surfaces, never an `sdk.<domain>.internal.*` escape hatch. The
 * internal-hatch elimination effort drove this count to zero; this test keeps
 * it there. The repo's pre-commit/CI gates are not committed in this worktree,
 * so the invariant is enforced here in the SDK's test suite (it runs under
 * `bun run test`).
 *
 * If this fails, a new `.internal.` site was introduced in apps/web-wallet —
 * expose the capability through a curated method on the domain api instead.
 */
describe('encapsulation: no .internal. sites in the web app', () => {
  it('git grep "\\.internal\\." -- apps/web-wallet returns nothing', () => {
    const repoRoot = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd: import.meta.dir,
    })
      .stdout.toString()
      .trim();

    // git grep exits 1 with no output when there are no matches (the wanted
    // case) and 0 when there are; anything else is a real error.
    const grep = Bun.spawnSync(
      ['git', 'grep', '--no-color', '\\.internal\\.', '--', 'apps/web-wallet'],
      { cwd: repoRoot },
    );

    const hits = grep.stdout.toString().trim();
    expect(hits).toBe('');
  });
});
