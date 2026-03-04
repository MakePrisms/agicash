import { execSync } from 'node:child_process';
import { Command } from 'commander';
import {
  acquireLock,
  confirm,
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
  listDatabases,
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

const SENTINEL_DB = 'wt___switching__';

/**
 * Perform a 3-step sentinel database switch.
 * Caller MUST hold the lock. This function does NOT acquire/release the lock.
 *
 * Steps:
 *   A: postgres → wt___switching__
 *   B: wt_<target> → postgres
 *   C: wt___switching__ → wt_<old_active>
 */
function performSwitch(targetBranch: string): void {
  const state = readState();

  if (!state.dbBranches[targetBranch]) {
    throw new Error(`DB branch "${targetBranch}" does not exist`);
  }

  if (state.activeDbBranch === targetBranch) {
    log.info(`"${targetBranch}" is already the active DB branch`);
    return;
  }

  const currentActive = state.activeDbBranch;
  const currentActiveDbName = dbNameForBranch(currentActive);
  const targetDbName = dbNameForBranch(targetBranch);

  log.step(`Switching: ${currentActive} → shelved, ${targetBranch} → active`);

  // Terminate connections on BOTH databases before stopping services
  terminateConnections('postgres');
  terminateConnections(targetDbName);

  // Stop all non-DB containers so postgres has zero connections
  stopServiceContainers();

  // Step A: postgres → sentinel
  log.step(`[A] Renaming postgres → ${SENTINEL_DB}`);
  try {
    renameDatabase('postgres', SENTINEL_DB);
  } catch (e) {
    // A failed: nothing changed, restart and abort
    log.error('Step A failed — nothing was changed');
    startServiceContainers();
    throw e;
  }

  // Step B: wt_<target> → postgres
  log.step(`[B] Renaming ${targetDbName} → postgres`);
  try {
    renameDatabase(targetDbName, 'postgres');
  } catch (e) {
    // B failed: roll back sentinel → postgres
    log.error('Step B failed — rolling back');
    try {
      renameDatabase(SENTINEL_DB, 'postgres');
    } catch {
      log.error(
        `Rollback also failed! Sentinel "${SENTINEL_DB}" exists. Manual intervention needed.`,
      );
    }
    startServiceContainers();
    throw e;
  }

  // Step C: sentinel → wt_<old_active>
  log.step(`[C] Renaming ${SENTINEL_DB} → ${currentActiveDbName}`);
  try {
    renameDatabase(SENTINEL_DB, currentActiveDbName);
  } catch {
    // C failed: postgres is correct (target is active), but old active is stuck as sentinel
    log.warn(
      `Step C failed: "${SENTINEL_DB}" should be "${currentActiveDbName}". The active database is correct. Run "db doctor" to fix.`,
    );
  }

  // Update state
  state.activeDbBranch = targetBranch;
  writeState(state);

  // Restart service containers
  startServiceContainers();

  log.success(`Active DB branch is now "${targetBranch}"`);
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
    const sanitized = parseBranchName(name);

    acquireLock('db fork');
    try {
      // Read state inside lock to avoid stale reads
      const state = readState();

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
    } finally {
      releaseLock();
    }
  });

// --- db switch ---
program
  .command('switch <name>')
  .description(
    'Activate a DB branch (3-step sentinel rename + restart services)',
  )
  .option('--yes', 'Skip confirmation prompt')
  .action(async (name: string, opts: { yes?: boolean }) => {
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

    if (!opts.yes) {
      const ok = await confirm(
        `Switch active database from "${state.activeDbBranch}" to "${sanitized}"?`,
      );
      if (!ok) {
        log.info('Aborted');
        return;
      }
    }

    acquireLock('db switch');
    try {
      performSwitch(sanitized);
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
  .description('Drop a DB branch (auto-switches to master if active)')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (name: string, opts: { yes?: boolean }) => {
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

    if (!opts.yes) {
      const ok = await confirm(
        `Delete database branch '${sanitized}'? This cannot be undone.`,
      );
      if (!ok) {
        log.info('Aborted');
        return;
      }
    }

    acquireLock('db delete');
    try {
      // If deleting the active branch, switch to master first
      if (state.activeDbBranch === sanitized) {
        log.step(
          `"${sanitized}" is the active branch — switching to master first`,
        );
        performSwitch('master');
      }

      const dbName = dbNameForBranch(sanitized);
      dropDatabase(dbName);

      // Re-read state since performSwitch may have written it
      const freshState = readState();
      delete freshState.dbBranches[sanitized];
      writeState(freshState);

      log.success(`DB branch "${sanitized}" deleted`);
    } finally {
      releaseLock();
    }
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

    acquireLock('db link');
    try {
      const oldBranch = state.worktrees[cwd].dbBranch;
      state.worktrees[cwd].dbBranch = sanitized;
      writeState(state);

      log.success(`Linked ${cwd}: ${oldBranch} → ${sanitized}`);
    } finally {
      releaseLock();
    }
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

// --- db doctor ---
program
  .command('doctor')
  .description(
    'Check consistency between state file, git worktrees, and databases',
  )
  .action(async () => {
    const state = readState();
    const issues: { description: string; fix?: () => void }[] = [];

    // Source 1: git worktree list
    const gitWorktrees: Map<string, string> = new Map();
    try {
      const output = execSync('git worktree list --porcelain', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let currentPath = '';
      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice('worktree '.length);
        } else if (line.startsWith('branch ')) {
          gitWorktrees.set(currentPath, line.slice('branch '.length));
        }
      }
    } catch {
      log.warn('Could not list git worktrees');
    }

    // Source 2: actual databases
    let actualDbs: string[] = [];
    try {
      ensureSupabaseRunning();
      actualDbs = listDatabases();
    } catch {
      log.warn('Could not list databases (is Supabase running?)');
    }

    const actualDbSet = new Set(actualDbs);

    // Check: orphaned state entries (worktree in state but not in git)
    for (const path of Object.keys(state.worktrees)) {
      if (!gitWorktrees.has(path)) {
        issues.push({
          description: `Orphaned state entry: worktree "${path}" is in state but not in git`,
          fix: () => {
            const s = readState();
            delete s.worktrees[path];
            writeState(s);
            log.success(`Removed orphaned worktree entry: ${path}`);
          },
        });
      }
    }

    // Check: unregistered worktrees (in git but not in state)
    for (const [path] of gitWorktrees) {
      if (!state.worktrees[path]) {
        issues.push({
          description: `Unregistered worktree: "${path}" exists in git but not in state`,
        });
      }
    }

    // Check: missing databases (in state but not in postgres)
    for (const branch of Object.keys(state.dbBranches)) {
      const expectedDb =
        branch === state.activeDbBranch ? 'postgres' : dbNameForBranch(branch);
      if (!actualDbSet.has(expectedDb)) {
        issues.push({
          description: `Missing database: branch "${branch}" expects "${expectedDb}" but it doesn't exist`,
        });
      }
    }

    // Check: unregistered databases (wt_* in postgres but not in state)
    for (const db of actualDbs) {
      if (db === 'postgres') continue;
      if (!db.startsWith('wt_')) continue;
      if (db === SENTINEL_DB) continue; // handled separately
      const branchName = db.slice('wt_'.length);
      if (!state.dbBranches[branchName]) {
        issues.push({
          description: `Unregistered database: "${db}" exists in Postgres but branch "${branchName}" is not in state`,
          fix: () => {
            const s = readState();
            s.dbBranches[branchName] = {
              parent: null,
              created: todayString(),
            };
            writeState(s);
            log.success(
              `Registered database "${db}" as branch "${branchName}"`,
            );
          },
        });
      }
    }

    // Check: stale sentinel
    if (actualDbSet.has(SENTINEL_DB)) {
      issues.push({
        description: `Stale sentinel: "${SENTINEL_DB}" exists — a previous switch likely failed`,
        fix: () => {
          // Try to figure out what it should be named
          const s = readState();
          // Find branches that are in state but missing from postgres
          for (const branch of Object.keys(s.dbBranches)) {
            const expectedDb =
              branch === s.activeDbBranch
                ? 'postgres'
                : dbNameForBranch(branch);
            if (!actualDbSet.has(expectedDb) && expectedDb !== 'postgres') {
              log.step(`Renaming ${SENTINEL_DB} → ${expectedDb}`);
              terminateConnections(SENTINEL_DB);
              renameDatabase(SENTINEL_DB, expectedDb);
              log.success(`Fixed: renamed sentinel to "${expectedDb}"`);
              return;
            }
          }
          log.warn(
            `Could not determine what to rename "${SENTINEL_DB}" to. Manual intervention needed.`,
          );
        },
      });
    }

    if (issues.length === 0) {
      log.success('No issues found — state, git, and databases are consistent');
      return;
    }

    log.header(`Found ${issues.length} issue(s)`);
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const fixable = issue.fix ? ' (auto-fixable)' : '';
      log.warn(`${i + 1}. ${issue.description}${fixable}`);
    }

    const fixable = issues.filter((i) => i.fix);
    if (fixable.length === 0) {
      log.info('No auto-fixable issues. Manual intervention required.');
      return;
    }

    const ok = await confirm(`Auto-fix ${fixable.length} issue(s)?`);
    if (!ok) {
      log.info('No changes made');
      return;
    }

    acquireLock('db doctor');
    try {
      for (const issue of fixable) {
        issue.fix?.();
      }
      log.success('Doctor fixes applied');
    } finally {
      releaseLock();
    }
  });

program.parse();
