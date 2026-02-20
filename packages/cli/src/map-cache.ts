import type { Cache } from '@agicash/core';

export function createMapCache(): Cache {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async fetchQuery<T>(opts: {
      queryKey: readonly unknown[];
      queryFn: () => Promise<T>;
      staleTime?: number;
    }): Promise<T> {
      const key = JSON.stringify(opts.queryKey);
      const entry = store.get(key);
      if (entry && Date.now() < entry.expiresAt) return entry.value as T;
      const value = await opts.queryFn();
      store.set(key, {
        value,
        expiresAt: Date.now() + (opts.staleTime ?? 60_000),
      });
      return value;
    },
    async cancelQueries() {
      /* no-op for CLI */
    },
  };
}
