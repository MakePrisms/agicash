// Bun test preload. Polyfills browser globals that some module-level code
// depends on (most notably `app/features/agicash-db/database.client.ts`),
// so unit tests can load services that transitively pull in those modules.
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
