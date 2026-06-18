import { describe, expect, it } from 'bun:test';
import type { SdkConfig } from '../../config';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import {
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
} from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createBackgroundDomain } from './background-domain';

function fakeRealtime() {
  const builder = {
    topic: 'realtime:wallet:u1',
    on: () => builder,
  };
  return {
    channel: () => builder,
    addChannel: () => ({ topic: builder.topic }),
    subscribe: async () => undefined,
    removeChannel: async () => undefined,
  } as never;
}

function makeBackgroundTestCtx(): {
  ctx: DomainContext;
  accountRepository: AccountRepository;
} {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const config = {
    storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
  } as unknown as SdkConfig;

  const connections = {
    supabase: makeFakeDb({}),
    encryption: {} as never,
    cashuCrypto: {} as never,
    realtime: fakeRealtime(),
    cashuWallets: {} as never,
    sparkWallets: {} as never,
    mintAuth: {} as never,
    getCashuSeed: async () => new Uint8Array(),
    cashuMintValidator: (() => undefined) as never,
  } as unknown as DomainContext['connections'];

  const accountRepository = {
    get: async () => null,
    getAllActive: async () => [],
  } as unknown as AccountRepository;

  return { ctx: { config, connections, emitter }, accountRepository };
}

describe('createBackgroundDomain', () => {
  it('returns a BackgroundDomain that starts in stopped', () => {
    const { ctx, accountRepository } = makeBackgroundTestCtx();
    const background = createBackgroundDomain(ctx, accountRepository);
    expect(background.state()).toBe('stopped');
  });

  it('start() then stop() round-trips to stopped and emits background:state transitions', async () => {
    const { ctx, accountRepository } = makeBackgroundTestCtx();
    const states: string[] = [];
    ctx.emitter.on('background:state', (e) => states.push(e.state));
    const background = createBackgroundDomain(ctx, accountRepository);

    await background.start();
    await background.stop();

    expect(states[0]).toBe('starting');
    expect(states.at(-1)).toBe('stopped');
    expect(background.state()).toBe('stopped');
  });
});
