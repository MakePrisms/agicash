/**
 * Runs a side effect exactly once per item while that item is present in the
 * work set, re-running if the item leaves and later returns. Framework-free port
 * of the app's `useQueries({ staleTime: Infinity, gcTime: 0 })` one-shot trigger
 * for the draft cashu-send-swap and pending cashu-receive-swap processing paths.
 */
export class OncePerKey {
  private readonly active = new Set<string>();

  /**
   * For each key not seen since it last left, run `fn(key)` once. Prune absent keys.
   * A key is marked consumed BEFORE `fn` runs, so a throwing `fn` does not re-fire on a
   * later identical set (matches the app's `retry: 0` + caller-owned retry — do not
   * reorder add-after-fn).
   */
  run(keys: string[], fn: (key: string) => void): void {
    const current = new Set(keys);
    for (const key of this.active) {
      if (!current.has(key)) this.active.delete(key);
    }
    for (const key of keys) {
      if (!this.active.has(key)) {
        this.active.add(key);
        fn(key);
      }
    }
  }

  reset(): void {
    this.active.clear();
  }
}
