import { execSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

export type DbBranchInfo = {
  parent: string | null;
  created: string;
};

export type WorktreeInfo = {
  dbBranch: string;
  devPort: number;
};

export type WorktreeState = {
  version: number;
  activeDbBranch: string;
  dbBranches: Record<string, DbBranchInfo>;
  worktrees: Record<string, WorktreeInfo>;
};

type LockData = {
  pid: number;
  command: string;
  acquired: string;
};

const RESERVED_DB_NAMES = ['postgres', 'template0', 'template1'];

function findProjectRoot(): string {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // --git-common-dir returns a path relative to cwd (or absolute).
    // The project root is the parent of the .git directory.
    const absoluteGitDir = resolve(gitCommonDir);
    // For a main repo, gitCommonDir is ".git" → parent is the root.
    // For a worktree, gitCommonDir is "/abs/path/to/.git" → parent is the root.
    return resolve(absoluteGitDir, '..');
  } catch {
    throw new Error(
      'Could not find project root via git. Are you inside a git repository?',
    );
  }
}

const PROJECT_ROOT = findProjectRoot();
const STATE_FILE = join(PROJECT_ROOT, '.worktree-state.json');
const LOCK_FILE = join(PROJECT_ROOT, '.worktree-state.lock');

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

function defaultState(): WorktreeState {
  return {
    version: 1,
    activeDbBranch: 'master',
    dbBranches: {
      master: { parent: null, created: new Date().toISOString().slice(0, 10) },
    },
    worktrees: {
      [PROJECT_ROOT]: { dbBranch: 'master', devPort: 3000 },
    },
  };
}

export function readState(): WorktreeState {
  if (!existsSync(STATE_FILE)) {
    const state = defaultState();
    writeState(state);
    return state;
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    throw new Error(
      `Failed to parse ${STATE_FILE}. Delete the file to reset, or fix it manually.`,
    );
  }
}

export function writeState(state: WorktreeState): void {
  const tmpPath = `${STATE_FILE}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmpPath, STATE_FILE);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(command: string, force = false): void {
  const maxWaitMs = 30_000;
  const startTime = Date.now();

  while (true) {
    try {
      // Atomic creation: O_CREAT | O_EXCL fails if file exists
      const fd = openSync(
        LOCK_FILE,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      );
      const lockData: LockData = {
        pid: process.pid,
        command,
        acquired: new Date().toISOString(),
      };
      writeFileSync(fd, JSON.stringify(lockData));
      closeSync(fd);
      return;
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !('code' in err) ||
        (err as NodeJS.ErrnoException).code !== 'EEXIST'
      ) {
        throw err;
      }
    }

    // Lock file exists — check if holder is alive
    let lockData: LockData | null = null;
    try {
      lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    } catch {
      // Corrupted lock file — remove and retry
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        // best-effort removal
      }
      continue;
    }

    if (!lockData) continue;

    if (force) {
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        // best-effort removal
      }
      continue;
    }

    if (!isProcessAlive(lockData.pid)) {
      // Stale lock from dead process — remove and retry
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        // best-effort removal
      }
      continue;
    }

    // Process is alive — wait
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new Error(
        `Lock held by pid ${lockData.pid} (${lockData.command}) for ${Math.round(elapsed / 1000)}s. ` +
          `If this is stale, remove ${LOCK_FILE}`,
      );
    }

    // Synchronous poll (these are CLI tools, blocking is fine)
    execSync('sleep 0.5', { stdio: 'ignore' });
  }
}

export function releaseLock(): void {
  if (!existsSync(LOCK_FILE)) return;

  try {
    const lockData: LockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    if (lockData.pid !== process.pid) {
      // Not our lock — don't touch it
      return;
    }
  } catch {
    // Can't read/parse — remove defensively
  }

  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // best-effort removal
  }
}

export function sanitizeBranchName(name: string): string {
  // Strip everything except alphanumeric, underscore, hyphen
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  // Must start with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    throw new Error(
      `Invalid branch name "${name}": must start with a letter and contain only a-z, 0-9, _, -`,
    );
  }
  // Reject reserved database names
  if (RESERVED_DB_NAMES.includes(sanitized.toLowerCase())) {
    throw new Error(
      `"${sanitized}" is a reserved PostgreSQL database name and cannot be used as a branch name`,
    );
  }
  return sanitized;
}

export function dbNameForBranch(branch: string): string {
  const sanitized = sanitizeBranchName(branch);
  return `wt_${sanitized}`;
}

export function currentWorktreePath(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
