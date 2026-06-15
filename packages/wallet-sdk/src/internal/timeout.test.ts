import { describe, expect, test } from 'bun:test';
import { clearLongTimeout, setLongTimeout } from './timeout';

describe('setLongTimeout', () => {
  test('fires after a short delay', async () => {
    let fired = false;
    setLongTimeout(() => {
      fired = true;
    }, 5);
    await new Promise((r) => setTimeout(r, 25));
    expect(fired).toBe(true);
  });
  test('clearLongTimeout prevents firing', async () => {
    let fired = false;
    const t = setLongTimeout(() => {
      fired = true;
    }, 20);
    clearLongTimeout(t);
    await new Promise((r) => setTimeout(r, 45));
    expect(fired).toBe(false);
  });
});
