import { describe, expect, it } from 'bun:test';
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
    client.realtime.log('transport', 'connected', { detail: 'kept' });

    const push = lines.find((line) => line.message.includes('Realtime push:'));
    expect(push).toBeDefined();
    expect(JSON.stringify(push?.meta ?? null)).not.toContain('secret');

    const receive = lines.find((line) =>
      line.message.includes('Realtime receive:'),
    );
    expect(receive).toBeDefined();
    expect(JSON.stringify(receive?.meta ?? null)).not.toContain('secret');

    const transport = lines.find((line) =>
      line.message.includes('Realtime transport:'),
    );
    expect(transport?.meta).toEqual({ data: { detail: 'kept' } });
    expect(client.realtime.logLevel).toBe('info');

    const bare = createAgicashDbClient(baseConfig);
    const bareAgain = createAgicashDbClient(baseConfig);
    expect(bare.realtime.logLevel).toBeUndefined();
    expect(bareAgain.realtime.logLevel).toBeUndefined();
    expect(bare.realtime.logger).toBe(bareAgain.realtime.logger);
    expect(bare.realtime.logger).not.toBe(client.realtime.logger);
  });
});
