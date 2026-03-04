import { readState } from './config.ts';

const MIN_WORKTREE_PORT = 3001;

export function allocatePort(): number {
  const state = readState();
  const usedPorts = new Set(
    Object.values(state.worktrees).map((wt) => wt.devPort),
  );

  let port = MIN_WORKTREE_PORT;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}
