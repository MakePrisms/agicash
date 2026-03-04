import { execSync } from 'node:child_process';
import * as log from './log.ts';

const SUPABASE_PROJECT_ID = 'agicash';
const DB_CONTAINER = `supabase_db_${SUPABASE_PROJECT_ID}`;

/** Non-database Supabase containers that hold connections to postgres. */
const SERVICE_CONTAINERS = [
  'auth',
  'rest',
  'realtime',
  'studio',
  'pg_meta',
  'edge_runtime',
  'analytics',
  'kong',
  'vector',
  'inbucket',
].map((s) => `supabase_${s}_${SUPABASE_PROJECT_ID}`);

type SupabaseStatus = {
  running: boolean;
  dbUrl?: string;
  dbPort?: number;
};

export function getDbContainer(): string {
  return DB_CONTAINER;
}

export function getSupabaseStatus(): SupabaseStatus {
  try {
    const output = execSync(
      `docker inspect -f '{{.State.Status}}' ${DB_CONTAINER}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (output.trim() !== 'running') return { running: false };

    // Get the host port mapped to container port 5432
    const portOutput = execSync(`docker port ${DB_CONTAINER} 5432`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const portMatch = portOutput.match(/:(\d+)/);
    const port = portMatch ? Number.parseInt(portMatch[1], 10) : 54322;

    return {
      running: true,
      dbUrl: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      dbPort: port,
    };
  } catch {
    return { running: false };
  }
}

export function ensureSupabaseRunning(): void {
  const status = getSupabaseStatus();
  if (!status.running) {
    log.error('Supabase is not running. Start it with: supabase start');
    process.exit(1);
  }
}

/** Stop all non-database Supabase containers so postgres has no active connections. */
export function stopServiceContainers(): void {
  log.step('Stopping Supabase service containers...');
  const running = getRunningServiceContainers();
  if (running.length === 0) return;

  execSync(`docker stop ${running.join(' ')}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  log.success(`Stopped ${running.length} service containers`);
}

/** Start all non-database Supabase containers. */
export function startServiceContainers(): void {
  log.step('Starting Supabase service containers...');
  const stopped = getStoppedServiceContainers();
  if (stopped.length === 0) return;

  execSync(`docker start ${stopped.join(' ')}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  log.success(`Started ${stopped.length} service containers`);
}

function getRunningServiceContainers(): string[] {
  const output = execSync(
    'docker ps --format "{{.Names}}" --filter "status=running"',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const running = new Set(output.trim().split('\n').filter(Boolean));
  return SERVICE_CONTAINERS.filter((c) => running.has(c));
}

function getStoppedServiceContainers(): string[] {
  const output = execSync(
    'docker ps -a --format "{{.Names}}" --filter "status=exited"',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const stopped = new Set(output.trim().split('\n').filter(Boolean));
  return SERVICE_CONTAINERS.filter((c) => stopped.has(c));
}
