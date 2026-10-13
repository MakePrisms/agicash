import { describe, expect, it } from 'bun:test';
import { createBrowserActivity } from './browser-activity.client';

function withFakeBrowser(
  run: (harness: {
    fire: (type: string) => void;
    setVisibility: (state: string) => void;
    listeners: Map<string, Set<() => void>>;
  }) => void,
): void {
  const host = globalThis as { window?: unknown; document?: unknown };
  const savedWindow = host.window;
  const savedDocument = host.document;
  const listeners = new Map<string, Set<() => void>>();
  const fakeDocument = { visibilityState: 'visible' };
  host.window = {
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  host.document = fakeDocument;
  try {
    run({
      fire: (type) => {
        for (const listener of listeners.get(type) ?? []) {
          listener();
        }
      },
      setVisibility: (state) => {
        fakeDocument.visibilityState = state;
      },
      listeners,
    });
  } finally {
    host.window = savedWindow;
    host.document = savedDocument;
  }
}

describe('createBrowserActivity', () => {
  it('is active only while visible and online', () => {
    withFakeBrowser(({ fire, setVisibility }) => {
      const activity = createBrowserActivity();
      activity.subscribe(() => undefined);
      expect(activity.isActive()).toBe(true);
      setVisibility('hidden');
      expect(activity.isActive()).toBe(false);
      setVisibility('visible');
      fire('offline');
      expect(activity.isActive()).toBe(false);
      fire('online');
      expect(activity.isActive()).toBe(true);
    });
  });

  it('keeps the online flag fresh across unsubscribe/resubscribe', () => {
    withFakeBrowser(({ fire, listeners }) => {
      const activity = createBrowserActivity();
      let changes = 0;
      const unsubscribe = activity.subscribe(() => {
        changes += 1;
      });
      fire('offline');
      expect(activity.isActive()).toBe(false);
      expect(changes).toBe(1);

      unsubscribe();
      expect(listeners.get('visibilitychange')?.size ?? 0).toBe(0);

      fire('online');
      expect(activity.isActive()).toBe(true);
      expect(changes).toBe(1);

      activity.subscribe(() => {
        changes += 1;
      });
      fire('visibilitychange');
      expect(changes).toBe(2);
    });
  });
});
