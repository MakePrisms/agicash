import type { Database } from 'bun:sqlite';
import type { StorageProvider } from '@agicash/opensecret-sdk';

function makeStore(
  db: Database,
  namespace: string,
): StorageProvider['persistent'] {
  return {
    getItem(key: string): string | null {
      const row = db
        .query('SELECT value FROM kv_store WHERE namespace = ? AND key = ?')
        .get(namespace, key) as { value: string } | null;
      return row?.value ?? null;
    },
    setItem(key: string, value: string): void {
      db.prepare(
        'INSERT INTO kv_store (namespace, key, value) VALUES (?, ?, ?) ' +
          'ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value',
      ).run(namespace, key, value);
    },
    removeItem(key: string): void {
      db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?').run(
        namespace,
        key,
      );
    },
  };
}

export function makeStorageProvider(db: Database): StorageProvider {
  return {
    persistent: makeStore(db, 'persistent'),
    session: makeStore(db, 'session'),
  };
}
