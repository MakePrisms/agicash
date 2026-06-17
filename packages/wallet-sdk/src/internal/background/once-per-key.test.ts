import { describe, expect, test } from 'bun:test';
import { OncePerKey } from './once-per-key';

describe('OncePerKey', () => {
  test('runs fn once per newly-appeared key', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'b'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'b']);

    dispatcher.run(['a', 'b', 'c'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'b', 'c']); // only the new key 'c' fires
  });

  test('prunes absent keys so they re-run if they return', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'b'], (k) => calls.push(k));
    dispatcher.run(['a'], (k) => calls.push(k)); // 'b' leaves → pruned
    dispatcher.run(['a', 'b'], (k) => calls.push(k)); // 'b' returns → re-fires
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  test('a key duplicated within one call fires once', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'a'], (k) => calls.push(k));
    expect(calls).toEqual(['a']);
  });

  test('prunes multiple absent keys in one call (delete-while-iterating is safe)', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'b', 'c', 'd'], (k) => calls.push(k));
    dispatcher.run(['c'], (k) => calls.push(k)); // a, b, d all leave at once
    dispatcher.run(['a', 'b', 'c', 'd'], (k) => calls.push(k)); // a, b, d return; c persists
    expect(calls).toEqual(['a', 'b', 'c', 'd', 'a', 'b', 'd']);
  });

  test('reset clears all tracked keys', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a'], (k) => calls.push(k));
    dispatcher.reset();
    dispatcher.run(['a'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'a']);
  });
});
