import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import {
  currentWorktreePath,
  getProjectRoot,
  readState,
  writeState,
} from './shared/config.ts';
import * as log from './shared/log.ts';
import { allocatePort } from './shared/ports.ts';

const program = new Command();

program
  .name('wt')
  .description('Git worktree lifecycle management')
  .version('0.1.0');

// --- wt setup ---
program
  .command('setup <name>')
  .description(
    'Create git worktree + bun install + generate .env.local + assign port',
  )
  .option('--base <branch>', 'Base branch for the worktree', 'HEAD')
  .action((name: string, opts: { base: string }) => {
    const root = getProjectRoot();
    const worktreeDir = join(root, '.claude', 'worktrees');
    const worktreePath = join(worktreeDir, name);

    if (existsSync(worktreePath)) {
      log.error(`Worktree path already exists: ${worktreePath}`);
      process.exit(1);
    }

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
        process.exit(1);
      }
    }
    log.success('Git worktree created');

    // Allocate port
    const port = allocatePort();

    // Register in state
    state.worktrees[worktreePath] = {
      dbBranch: 'master',
      devPort: port,
    };
    writeState(state);

    // Run setup steps in the worktree
    setupWorktree(worktreePath, port);

    log.success(`Worktree "${name}" ready!`);
    log.info(`  Path: ${worktreePath}`);
    log.info(`  Port: ${port}`);
    log.info('  DB branch: master');
    log.info(`  cd ${worktreePath} && bun run dev`);
  });

// --- wt init ---
program
  .command('init')
  .description(
    'Setup env in existing worktree (bun install + .env.local + register)',
  )
  .action(() => {
    const cwd = currentWorktreePath();
    const state = readState();

    if (state.worktrees[cwd]) {
      log.info(`Worktree already registered at ${cwd}`);
      log.info('Re-running setup steps...');
    }

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
  });

// --- wt teardown ---
program
  .command('teardown <name>')
  .description('Remove worktree + unlink DB branch + free port')
  .action((name: string) => {
    const root = getProjectRoot();
    const worktreePath = resolve(join(root, '.claude', 'worktrees', name));
    const state = readState();

    if (!state.worktrees[worktreePath]) {
      log.error(`Worktree "${name}" is not registered`);
      log.info('Available worktrees:');
      for (const path of Object.keys(state.worktrees)) {
        log.step(path);
      }
      process.exit(1);
    }

    // Remove from state
    delete state.worktrees[worktreePath];
    writeState(state);
    log.success('Unregistered worktree from state');

    // Remove git worktree
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
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

    log.success(`Worktree "${name}" torn down`);
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

    const rows: string[][] = [];
    const cwd = currentWorktreePath();

    for (const [path, info] of Object.entries(state.worktrees)) {
      const isHere = path === cwd ? '←' : ' ';
      const shortPath = path
        .replace(root, '.')
        .replace(process.env.HOME ?? '', '~');
      const dbMatch =
        info.dbBranch === state.activeDbBranch ? '✓' : '✗ (not active)';

      rows.push([
        isHere,
        shortPath,
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

  // Generate .env.local with port override
  const envPath = join(worktreePath, '.env.local');
  const envContent = `# Generated by wt init — worktree-specific overrides
PORT=${port}
`;

  if (existsSync(envPath)) {
    log.info('.env.local already exists, skipping generation');
  } else {
    writeFileSync(envPath, envContent);
    log.success(`.env.local generated (PORT=${port})`);
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
