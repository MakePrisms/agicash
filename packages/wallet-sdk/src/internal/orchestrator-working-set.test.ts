import { describe, expect, test } from 'bun:test';
import { OrchestratorWorkingSet } from './orchestrator-working-set';

describe('OrchestratorWorkingSet', () => {
  test('track + getByProtocolId resolves the agicash id and mint URL', () => {
    const set = new OrchestratorWorkingSet();
    set.track({
      protocolId: 'melt-1',
      agicashId: 'quote-1',
      mintUrl: 'https://mint.test',
    });

    expect(set.getByProtocolId('melt-1')).toEqual({
      agicashId: 'quote-1',
      mintUrl: 'https://mint.test',
    });
    expect(set.hasAgicashId('quote-1')).toBe(true);
  });

  test('getByProtocolId returns undefined for an untracked protocol id', () => {
    const set = new OrchestratorWorkingSet();
    expect(set.getByProtocolId('nope')).toBeUndefined();
    expect(set.hasAgicashId('nope')).toBe(false);
  });

  test('untrackByAgicashId removes BOTH the protocol-id and agicash-id mappings', () => {
    const set = new OrchestratorWorkingSet();
    set.track({ protocolId: 'melt-1', agicashId: 'quote-1' });

    set.untrackByAgicashId('quote-1');

    expect(set.getByProtocolId('melt-1')).toBeUndefined();
    expect(set.hasAgicashId('quote-1')).toBe(false);
  });

  test('untrackByAgicashId is a no-op for an unknown id', () => {
    const set = new OrchestratorWorkingSet();
    expect(() => set.untrackByAgicashId('ghost')).not.toThrow();
  });

  test('track is idempotent — re-registering the same pair refreshes it', () => {
    const set = new OrchestratorWorkingSet();
    set.track({ protocolId: 'melt-1', agicashId: 'quote-1', mintUrl: 'a' });
    set.track({ protocolId: 'melt-1', agicashId: 'quote-1', mintUrl: 'b' });

    expect(set.getByProtocolId('melt-1')?.mintUrl).toBe('b');
  });

  test('clear drops everything', () => {
    const set = new OrchestratorWorkingSet();
    set.track({ protocolId: 'm1', agicashId: 'q1' });
    set.track({ protocolId: 'm2', agicashId: 'q2' });

    set.clear();

    expect(set.getByProtocolId('m1')).toBeUndefined();
    expect(set.getByProtocolId('m2')).toBeUndefined();
    expect(set.hasAgicashId('q1')).toBe(false);
  });
});
