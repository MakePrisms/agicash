#!/usr/bin/env bash
# Disable any stale `prek` (pre-commit) hook left over from the React-app
# era. Run once per checkout / worktree.
#
# Background:
#   The pre-flake-migration `devenv.nix` installed a `prek` hook that ran
#   `bun run typecheck`, `bun run db:generate-types`, `bun run fix:staged`.
#   When the React app + devenv were deleted in the rust-primary migration
#   (commit 12f6a317), `.pre-commit-config.yaml` (gitignored) went with
#   them — but the per-checkout `.git/hooks/pre-commit` script that calls
#   `prek hook-impl --config=.pre-commit-config.yaml` is NOT tracked, so
#   existing checkouts still try to run prek against a missing config and
#   hang commits for 2+ minutes.
#
# This script renames the broken hook out of the way in every worktree.
# Safe to re-run: it skips hooks already renamed.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
common_dir="$(cd "$repo_root" && git rev-parse --git-common-dir 2>/dev/null || echo "$repo_root/.git")"
common_dir="$(cd "$repo_root" && cd "$common_dir" && pwd)"

disable_in() {
    local hook_dir="$1"
    local hook="$hook_dir/pre-commit"
    if [ ! -e "$hook" ]; then
        return 0
    fi
    if ! grep -q "prek" "$hook" 2>/dev/null; then
        # Not a prek hook — leave it alone.
        echo "  skip: $hook (not a prek hook)"
        return 0
    fi
    mv "$hook" "$hook.disabled-stale-devenv"
    echo "  disabled: $hook -> $hook.disabled-stale-devenv"
}

echo "Disabling stale prek hooks under $common_dir"
disable_in "$common_dir/hooks"

# Each linked worktree has its own hooks dir under .git/worktrees/<name>/hooks.
if [ -d "$common_dir/worktrees" ]; then
    for wt in "$common_dir/worktrees"/*/; do
        [ -d "$wt/hooks" ] || continue
        disable_in "$wt/hooks"
    done
fi

echo "Done. PREK_ALLOW_NO_CONFIG=1 is no longer needed in this checkout."
