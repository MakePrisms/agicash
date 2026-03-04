import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === 'agicash') return dir;
    }
    dir = join(dir, '..');
  }
  throw new Error('Could not find agicash project root');
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
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

export function writeState(state: WorktreeState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function acquireLock(): void {
  if (existsSync(LOCK_FILE)) {
    const content = readFileSync(LOCK_FILE, 'utf-8').trim();
    throw new Error(
      `Another db operation is in progress (lock held by pid ${content}). If this is stale, remove ${LOCK_FILE}`,
    );
  }
  writeFileSync(LOCK_FILE, `${process.pid}`);
}

export function releaseLock(): void {
  if (existsSync(LOCK_FILE)) {
    unlinkSync(LOCK_FILE);
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
  return sanitized;
}

export function dbNameForBranch(branch: string): string {
  const sanitized = sanitizeBranchName(branch);
  return `wt_${sanitized}`;
}

export function currentWorktreePath(): string {
  return process.cwd();
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
