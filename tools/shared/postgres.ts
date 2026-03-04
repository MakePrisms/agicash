import { execSync } from 'node:child_process';
import * as log from './log.ts';
import { getDbContainer } from './supabase.ts';

/**
 * Run SQL inside the Supabase postgres container via docker exec.
 * Uses stdin piping to avoid shell quoting issues with -c.
 */
export function psql(sql: string, db = 'postgres'): string {
  const container = getDbContainer();
  try {
    return execSync(
      `echo ${shellEscape(sql)} | docker exec -i ${container} psql -U postgres -d ${shellEscape(db)}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (e) {
    throwFriendlyError(e, 'psql');
  }
}

/** Run SQL and return just the value (no headers, no alignment). */
export function psqlQuiet(sql: string, db = 'postgres'): string {
  const container = getDbContainer();
  try {
    return execSync(
      `echo ${shellEscape(sql)} | docker exec -i ${container} psql -U postgres -d ${shellEscape(db)} -tA`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (e) {
    throwFriendlyError(e, 'psql');
  }
}

export function databaseExists(name: string): boolean {
  const result = psqlQuiet(
    `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
  );
  return result.trim() === '1';
}

export function listDatabases(): string[] {
  const result = psqlQuiet(
    "SELECT datname FROM pg_database WHERE datname LIKE 'wt_%' OR datname = 'postgres' ORDER BY datname",
  );
  return result
    .trim()
    .split('\n')
    .filter((s) => s.length > 0);
}

/**
 * Fork a database using pg_dump | psql inside the Supabase container.
 * Atomic: if the restore fails, the target database is dropped.
 */
export function forkDatabase(sourceName: string, targetName: string): void {
  log.step(`Forking ${sourceName} → ${targetName}...`);
  const container = getDbContainer();

  // Terminate connections to source for clean snapshot
  terminateConnections(sourceName);

  // Create empty target database
  psql(`CREATE DATABASE "${targetName}"`, 'template1');

  try {
    // Dump source and restore into target — both inside the container
    execSync(
      `docker exec ${container} pg_dump -U postgres ${shellEscape(sourceName)} | docker exec -i ${container} psql -U postgres -d ${shellEscape(targetName)}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
      },
    );
  } catch (e) {
    // Atomic cleanup: drop the empty/partial target
    log.warn('pg_dump | psql failed, cleaning up...');
    try {
      dropDatabase(targetName);
    } catch {
      // best-effort cleanup
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Fork failed: ${msg}`);
  }

  log.success(`Database ${targetName} created`);
}

export function renameDatabase(oldName: string, newName: string): void {
  terminateConnections(oldName);
  psql(`ALTER DATABASE "${oldName}" RENAME TO "${newName}"`, 'template1');
}

export function dropDatabase(name: string): void {
  terminateConnections(name);
  psql(`DROP DATABASE IF EXISTS "${name}"`, 'template1');
}

export function terminateConnections(dbName: string): void {
  try {
    psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
      'template1',
    );
  } catch {
    // Ignore — connections may already be gone
  }
}

/** Shell-escape a string using single quotes (handles all special chars). */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function throwFriendlyError(e: unknown, tool: string): never {
  if (
    e instanceof Error &&
    'code' in e &&
    (e as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    throw new Error(
      `"${tool}" not found. Make sure Docker is running and the Supabase DB container is up.`,
    );
  }
  throw e;
}
