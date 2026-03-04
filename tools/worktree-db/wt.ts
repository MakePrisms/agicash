import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import {
  acquireLock,
  currentWorktreePath,
  getProjectRoot,
  readState,
  releaseLock,
  writeState,
} from './shared/config.ts';
import * as log from './shared/log.ts';
import { allocatePort } from './shared/ports.ts';

const WORKTREE_DIR_NAME = '.trees';

const program = new Command();

program
  .name('wt')
  .description('Git worktree lifecycle management')
  .version('0.1.0');

// --- wt setup ---
program
  .command('setup <name>')
  .description(
    'Create git worktree + bun install + generate .env + assign port',
  )
  .option('--base <branch>', 'Base branch for the worktree', 'HEAD')
  .action((name: string, opts: { base: string }) => {
    const root = getProjectRoot();
    const worktreeDir = join(root, WORKTREE_DIR_NAME);
    const worktreePath = join(worktreeDir, name);

    if (existsSync(worktreePath)) {
      log.error(`Worktree path already exists: ${worktreePath}`);
      process.exit(1);
    }

    acquireLock('wt setup');
    try {
      // Read state inside lock to avoid stale reads
      const state = readState();
      if (state.worktrees[worktreePath]) {
        log.error(`Worktree "${name}" already registered`);
        process.exit(1);
      }

      // Create the git worktree
      const branchName = `wt/${name}`;
      log.step(`Creating git worktree at ${worktreePath}`);
      try {
        execSync(
          `git worktree add -b "${branchName}" "${worktreePath}" ${opts.base}`,
          {
            encoding: 'utf-8',
            cwd: root,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
      } catch {
        // If branch already exists, try without -b
        try {
          execSync(`git worktree add "${worktreePath}" ${opts.base}`, {
            encoding: 'utf-8',
            cwd: root,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          log.error(`Failed to create worktree: ${msg}`);
          // Cleanup: remove git worktree if partially created
          try {
            execSync(`git worktree remove "${worktreePath}" --force`, {
              encoding: 'utf-8',
              cwd: root,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } catch {
            // best-effort cleanup
          }
          process.exit(1);
        }
      }
      log.success('Git worktree created');

      // Allocate port
      const port = allocatePort();

      // Run setup steps in the worktree
      try {
        setupWorktree(worktreePath, port);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Setup failed: ${msg}`);
        // Cleanup: remove git worktree
        try {
          execSync(`git worktree remove "${worktreePath}" --force`, {
            encoding: 'utf-8',
            cwd: root,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // best-effort cleanup
        }
        process.exit(1);
      }

      // Register in state AFTER all setup steps succeed
      state.worktrees[worktreePath] = {
        dbBranch: 'master',
        devPort: port,
      };
      writeState(state);

      log.success(`Worktree "${name}" ready!`);
      log.info(`  Path: ${worktreePath}`);
      log.info(`  Port: ${port}`);
      log.info('  DB branch: master');
      log.info(`  cd ${worktreePath} && bun run dev`);
    } finally {
      releaseLock();
    }
  });

// --- wt init ---
program
  .command('init')
  .description('Setup env in existing worktree (bun install + .env + register)')
  .action(() => {
    const cwd = currentWorktreePath();
    const state = readState();

    if (state.worktrees[cwd]) {
      log.info(`Worktree already registered at ${cwd}`);
      log.info('Re-running setup steps...');
    }

    acquireLock('wt init');
    try {
      const port = state.worktrees[cwd]?.devPort ?? allocatePort();

      state.worktrees[cwd] = {
        dbBranch: state.worktrees[cwd]?.dbBranch ?? 'master',
        devPort: port,
      };
      writeState(state);

      setupWorktree(cwd, port);

      log.success('Worktree initialized');
      log.info(`  Path: ${cwd}`);
      log.info(`  Port: ${port}`);
      log.info(`  DB branch: ${state.worktrees[cwd].dbBranch}`);
    } finally {
      releaseLock();
    }
  });

// --- wt teardown ---
program
  .command('teardown <name>')
  .description('Remove worktree + unlink DB branch + free port')
  .option('--force', 'Force removal even if worktree has uncommitted changes')
  .action((name: string, opts: { force?: boolean }) => {
    const root = getProjectRoot();
    const worktreePath = resolve(join(root, WORKTREE_DIR_NAME, name));
    const state = readState();

    if (!state.worktrees[worktreePath]) {
      log.error(`Worktree "${name}" is not registered`);
      log.info('Available worktrees:');
      for (const path of Object.keys(state.worktrees)) {
        log.step(path);
      }
      process.exit(1);
    }

    // Check for dirty state unless --force
    if (existsSync(worktreePath) && !opts.force) {
      try {
        const porcelain = execSync('git status --porcelain', {
          encoding: 'utf-8',
          cwd: worktreePath,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (porcelain.length > 0) {
          log.error('Worktree has uncommitted changes:');
          log.step(porcelain.split('\n').slice(0, 5).join('\n'));
          log.info('Use --force to remove anyway');
          process.exit(1);
        }
      } catch {
        // If git status fails, warn but continue
        log.warn('Could not check worktree status');
      }
    }

    acquireLock('wt teardown');
    try {
      const dbBranch = state.worktrees[worktreePath].dbBranch;

      // Remove from state
      delete state.worktrees[worktreePath];
      writeState(state);
      log.success('Unregistered worktree from state');

      // Remove git worktree
      if (existsSync(worktreePath)) {
        try {
          const forceFlag = opts.force ? ' --force' : '';
          execSync(`git worktree remove "${worktreePath}"${forceFlag}`, {
            encoding: 'utf-8',
            cwd: root,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          log.success('Removed git worktree');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.warn(`Could not remove git worktree: ${msg}`);
          log.info(`Remove manually: git worktree remove "${worktreePath}"`);
        }
      }

      // Hint about orphaned DB branch
      if (dbBranch !== 'master') {
        const freshState = readState();
        const stillLinked = Object.values(freshState.worktrees).some(
          (wt) => wt.dbBranch === dbBranch,
        );
        if (!stillLinked) {
          log.info(
            `DB branch "${dbBranch}" has no remaining linked worktrees. ` +
              `Consider running: db delete ${dbBranch}`,
          );
        }
      }

      log.success(`Worktree "${name}" torn down`);
    } finally {
      releaseLock();
    }
  });

// --- wt list ---
program
  .command('list')
  .alias('ls')
  .description('Show all worktrees with DB branch links, ports, and status')
  .action(() => {
    const state = readState();
    const root = getProjectRoot();

    log.header('Worktrees');

    if (Object.keys(state.worktrees).length === 0) {
      log.info('No worktrees registered');
      return;
    }

    // Cross-reference with git worktree list (paths + branches in one pass)
    const gitWorktrees = new Set<string>();
    const gitBranches = new Map<string, string>();
    try {
      const output = execSync('git worktree list --porcelain', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let currentPath = '';
      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice('worktree '.length);
          gitWorktrees.add(currentPath);
        } else if (line.startsWith('branch ')) {
          const branch = line.slice('branch '.length);
          gitBranches.set(currentPath, branch.replace('refs/heads/', ''));
        }
      }
    } catch {
      // If git worktree list fails, skip cross-reference
    }

    const rows: string[][] = [];
    const cwd = currentWorktreePath();

    for (const [path, info] of Object.entries(state.worktrees)) {
      const isHere = path === cwd ? '←' : ' ';
      const shortPath = path
        .replace(root, '.')
        .replace(process.env.HOME ?? '', '~');
      const dbMatch =
        info.dbBranch === state.activeDbBranch ? '✓' : '✗ (not active)';

      const gitBranch = gitBranches.get(path) ?? '';
      const stale = !gitWorktrees.has(path) ? ' [STALE]' : '';

      rows.push([
        isHere,
        `${shortPath}${stale}`,
        gitBranch ? `git:${gitBranch}` : '',
        `:${info.devPort}`,
        `db:${info.dbBranch}`,
        dbMatch,
      ]);
    }

    log.table(rows);
  });

function setupWorktree(worktreePath: string, port: number): void {
  // Install dependencies
  log.step('Installing dependencies...');
  try {
    execSync('bun install', {
      encoding: 'utf-8',
      cwd: worktreePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    log.success('Dependencies installed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`bun install had issues: ${msg}`);
  }

  // Generate .env: copy from main workspace and set PORT
  const root = getProjectRoot();
  const sourceEnv = join(root, '.env');
  const targetEnv = join(worktreePath, '.env');

  if (existsSync(targetEnv)) {
    log.info('.env already exists, skipping generation');
  } else if (existsSync(sourceEnv)) {
    let envContent = readFileSync(sourceEnv, 'utf-8');
    // Replace existing PORT line or append
    if (/^PORT=.*/m.test(envContent)) {
      envContent = envContent.replace(/^PORT=.*/m, `PORT=${port}`);
    } else {
      envContent = `${envContent.trimEnd()}\nPORT=${port}\n`;
    }
    writeFileSync(targetEnv, envContent);
    log.success(`.env generated (PORT=${port})`);
  } else {
    writeFileSync(targetEnv, `PORT=${port}\n`);
    log.success(`.env generated (PORT=${port}) — no root .env found to copy`);
  }

  // Allow direnv so the devenv shell activates automatically
  log.step('Allowing direnv...');
  try {
    execSync('direnv allow', {
      encoding: 'utf-8',
      cwd: worktreePath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log.success('direnv allowed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`direnv allow failed: ${msg}`);
  }
}

program.parse();
