import { Command } from 'commander';
import {
  acquireLock,
  currentWorktreePath,
  dbNameForBranch,
  readState,
  releaseLock,
  sanitizeBranchName,
  todayString,
  writeState,
} from './shared/config.ts';
import * as log from './shared/log.ts';
import {
  databaseExists,
  dropDatabase,
  forkDatabase,
  renameDatabase,
  terminateConnections,
} from './shared/postgres.ts';
import {
  ensureSupabaseRunning,
  startServiceContainers,
  stopServiceContainers,
} from './shared/supabase.ts';

function parseBranchName(name: string): string {
  try {
    return sanitizeBranchName(name);
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const program = new Command();

program
  .name('db')
  .description('Database branching for local Supabase development')
  .version('0.1.0');

// --- db fork ---
program
  .command('fork <name>')
  .description('Create a DB branch via pg_dump, auto-link current worktree')
  .option(
    '--from <branch>',
    'Source branch to fork from (default: active branch)',
  )
  .action((name: string, opts: { from?: string }) => {
    ensureSupabaseRunning();
    const state = readState();
    const sanitized = parseBranchName(name);

    if (state.dbBranches[sanitized]) {
      log.error(`DB branch "${sanitized}" already exists`);
      process.exit(1);
    }

    const sourceBranch = opts.from ?? state.activeDbBranch;
    if (!state.dbBranches[sourceBranch]) {
      log.error(`Source branch "${sourceBranch}" does not exist`);
      process.exit(1);
    }

    // The active branch is currently named "postgres"
    // Non-active branches are named "wt_<branch>"
    const sourceDbName =
      sourceBranch === state.activeDbBranch
        ? 'postgres'
        : dbNameForBranch(sourceBranch);

    const targetDbName = dbNameForBranch(sanitized);

    if (databaseExists(targetDbName)) {
      log.error(
        `Database "${targetDbName}" already exists in Postgres. Clean it up first.`,
      );
      process.exit(1);
    }

    forkDatabase(sourceDbName, targetDbName);

    // Register in state
    state.dbBranches[sanitized] = {
      parent: sourceBranch,
      created: todayString(),
    };

    // Auto-link current worktree
    const cwd = currentWorktreePath();
    if (state.worktrees[cwd]) {
      state.worktrees[cwd].dbBranch = sanitized;
      log.success(`Linked worktree ${cwd} → ${sanitized}`);
    }

    writeState(state);
    log.success(`DB branch "${sanitized}" created from "${sourceBranch}"`);
    log.info(`Use "db switch ${sanitized}" to activate it`);
  });

// --- db switch ---
program
  .command('switch <name>')
  .description('Activate a DB branch (rename + restart services)')
  .action((name: string) => {
    ensureSupabaseRunning();

    const sanitized = parseBranchName(name);

    const state = readState();

    if (!state.dbBranches[sanitized]) {
      log.error(`DB branch "${sanitized}" does not exist`);
      log.info(`Available: ${Object.keys(state.dbBranches).join(', ')}`);
      process.exit(1);
    }

    if (state.activeDbBranch === sanitized) {
      log.info(`"${sanitized}" is already the active DB branch`);
      return;
    }

    acquireLock();
    try {
      const currentActive = state.activeDbBranch;
      const currentActiveDbName = dbNameForBranch(currentActive);
      const targetDbName = dbNameForBranch(sanitized);

      log.step(`Switching: ${currentActive} → shelved, ${sanitized} → active`);

      // Step 1: Stop all non-DB containers so postgres has zero connections
      stopServiceContainers();

      // Step 2: Terminate any remaining connections
      terminateConnections('postgres');

      // Step 3: Rename current "postgres" → "wt_<current>"
      log.step(`Renaming postgres → ${currentActiveDbName}`);
      renameDatabase('postgres', currentActiveDbName);

      // Step 4: Rename "wt_<target>" → "postgres"
      log.step(`Renaming ${targetDbName} → postgres`);
      renameDatabase(targetDbName, 'postgres');

      // Step 5: Update state
      state.activeDbBranch = sanitized;
      writeState(state);

      // Step 6: Restart service containers
      startServiceContainers();

      log.success(`Active DB branch is now "${sanitized}"`);
    } finally {
      releaseLock();
    }
  });

// --- db list ---
program
  .command('list')
  .alias('ls')
  .description('Show all DB branches with active marker and linked worktrees')
  .action(() => {
    const state = readState();

    log.header('DB Branches');
    const rows: string[][] = [];

    for (const [branch, info] of Object.entries(state.dbBranches)) {
      const isActive = branch === state.activeDbBranch;
      const marker = isActive ? '● active' : '  idle';

      // Find linked worktrees
      const linked = Object.entries(state.worktrees)
        .filter(([_, wt]) => wt.dbBranch === branch)
        .map(([path]) => path.replace(process.env.HOME ?? '', '~'));

      const parentStr = info.parent ? `(from ${info.parent})` : '(root)';

      rows.push([
        marker,
        branch,
        parentStr,
        linked.length > 0 ? linked.join(', ') : '—',
      ]);
    }

    log.table(rows);
  });

// --- db delete ---
program
  .command('delete <name>')
  .description('Drop a DB branch (fails if worktrees still linked)')
  .action((name: string) => {
    ensureSupabaseRunning();
    const sanitized = parseBranchName(name);
    const state = readState();

    if (sanitized === 'master') {
      log.error('Cannot delete the master DB branch');
      process.exit(1);
    }

    if (!state.dbBranches[sanitized]) {
      log.error(`DB branch "${sanitized}" does not exist`);
      process.exit(1);
    }

    // Check for linked worktrees
    const linked = Object.entries(state.worktrees)
      .filter(([_, wt]) => wt.dbBranch === sanitized)
      .map(([path]) => path);

    if (linked.length > 0) {
      log.error(`Cannot delete: worktrees still linked to "${sanitized}":`);
      for (const path of linked) {
        log.step(path);
      }
      log.info('Unlink them first with "db link master" from each worktree');
      process.exit(1);
    }

    if (state.activeDbBranch === sanitized) {
      log.error(
        `Cannot delete the active DB branch. Switch away first with "db switch master"`,
      );
      process.exit(1);
    }

    const dbName = dbNameForBranch(sanitized);
    dropDatabase(dbName);

    delete state.dbBranches[sanitized];
    writeState(state);

    log.success(`DB branch "${sanitized}" deleted`);
  });

// --- db link ---
program
  .command('link <branch>')
  .description('Link current worktree to an existing DB branch')
  .action((branch: string) => {
    const sanitized = parseBranchName(branch);
    const state = readState();

    if (!state.dbBranches[sanitized]) {
      log.error(`DB branch "${sanitized}" does not exist`);
      log.info(`Available: ${Object.keys(state.dbBranches).join(', ')}`);
      process.exit(1);
    }

    const cwd = currentWorktreePath();
    if (!state.worktrees[cwd]) {
      log.error(`Current directory is not a registered worktree: ${cwd}`);
      log.info('Register it with "wt init" first');
      process.exit(1);
    }

    const oldBranch = state.worktrees[cwd].dbBranch;
    state.worktrees[cwd].dbBranch = sanitized;
    writeState(state);

    log.success(`Linked ${cwd}: ${oldBranch} → ${sanitized}`);
  });

// --- db status ---
program
  .command('status')
  .description(
    "Show current active branch, this worktree's linked branch, migration diff",
  )
  .action(() => {
    const state = readState();
    const cwd = currentWorktreePath();
    const worktree = state.worktrees[cwd];

    log.header('DB Status');
    log.info(`Active DB branch: ${state.activeDbBranch}`);

    if (worktree) {
      log.info(`This worktree linked to: ${worktree.dbBranch}`);

      if (worktree.dbBranch !== state.activeDbBranch) {
        log.warn(
          `Mismatch! Active branch is "${state.activeDbBranch}" but this worktree expects "${worktree.dbBranch}"`,
        );
        log.info(`Run "db switch ${worktree.dbBranch}" to fix`);
      } else {
        log.success('Active branch matches this worktree');
      }
    } else {
      log.warn(`Current directory (${cwd}) is not a registered worktree`);
    }
  });

program.parse();
