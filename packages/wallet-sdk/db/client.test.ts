import { describe, expect, it } from 'bun:test';
import { RealtimeClient } from '@supabase/supabase-js';
import type { Logger } from '../domain/sdk';
import { createAgicashDbClient } from './client';

const accessToken = () => Promise.resolve<string | null>(null);

const baseConfig = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'anon-key',
  accessToken,
};

describe('createAgicashDbClient realtime logger', () => {
  it('drops push and receive frame bodies, keeps transport data, and installs nothing without a logger', () => {
    const lines: { message: string; meta: unknown }[] = [];
    const logger: Logger = {
      debug: (message, meta) => {
        lines.push({ message, meta });
      },
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    const client = createAgicashDbClient({ ...baseConfig, logger });
    client.realtime.log('push', 'wallet:x phx_join (1)', {
      access_token: 'secret',
    });
    client.realtime.log('receive', 'wallet:x broadcast', {
      payload: 'secret',
    });
    client.realtime.log(
      'channel',
      'discarded push due to buffer overflow: access_token',
      { access_token: 'secret' },
    );
    client.realtime.log('channel', 'close wallet:x', { detail: 'kept' });
    client.realtime.log('transport', 'connected', { detail: 'kept' });

    const push = lines.find((line) => line.message.includes('Realtime push:'));
    expect(push).toBeDefined();
    expect(JSON.stringify(push?.meta ?? null)).not.toContain('secret');

    const receive = lines.find((line) =>
      line.message.includes('Realtime receive:'),
    );
    expect(receive).toBeDefined();
    expect(JSON.stringify(receive?.meta ?? null)).not.toContain('secret');

    const discarded = lines.find((line) =>
      line.message.includes('Realtime channel: discarded push'),
    );
    expect(discarded).toBeDefined();
    expect(JSON.stringify(discarded?.meta ?? null)).not.toContain('secret');

    const channel = lines.find((line) =>
      line.message.includes('Realtime channel: close'),
    );
    expect(channel?.meta).toEqual({ data: { detail: 'kept' } });

    const transport = lines.find((line) =>
      line.message.includes('Realtime transport:'),
    );
    expect(transport?.meta).toEqual({ data: { detail: 'kept' } });
    expect(client.realtime.logLevel).toBe('info');

    const bare = createAgicashDbClient(baseConfig);
    const fresh = new RealtimeClient('ws://x', { params: { apikey: 'k' } });
    expect(bare.realtime.logLevel).toBeUndefined();
    expect(bare.realtime.logger).toBe(fresh.logger);
    expect(bare.realtime.logger).not.toBe(client.realtime.logger);
  });
});
