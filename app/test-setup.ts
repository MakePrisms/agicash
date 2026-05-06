// Bun test preload. Polyfills browser globals that some module-level code
// depends on, so that unit tests can load services which transitively
// pull in those modules.
//
// Specifically, `app/features/agicash-db/database.client.ts` evaluates at
// module load:
//   - `(window as any).agicashRealtime = ...` (top-level assignment)
//   - `createClient(...)` which kicks off a Supabase auth fetch that calls
//     `isLoggedIn()` -> `window.localStorage.getItem(...)` (no typeof guard)
// Both throw `ReferenceError: window is not defined` under bun test.
//
// `mock.module()` cannot replace those exports from inside a test file,
// because static imports are hoisted above any `mock.module()` call in the
// same file, so the real module evaluates before the mock is registered.
// A preload polyfill is the simplest fix and stays a no-op in environments
// that already have these globals (browser, jsdom, etc.).
//
// Wire this up via bunfig.toml: [test] preload = ["./app/test-setup.ts"]

// biome-ignore lint/suspicious/noExplicitAny: shim for module-load side effects
const g = globalThis as any;

if (typeof g.window === 'undefined') {
  g.window = g;
}

if (typeof g.window.location === 'undefined') {
  g.window.location = {
    protocol: 'http:',
    hostname: 'localhost',
    href: 'http://localhost/',
  };
}

if (typeof g.window.localStorage === 'undefined') {
  const store = new Map<string, string>();
  g.window.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}
