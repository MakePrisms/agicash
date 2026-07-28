import { describe, expect, it } from 'bun:test';
import type { AuthUser } from '.';
import { DisposedError, SessionEndedError } from '../../lib/error';
import type { Account } from '../accounts/account';
import type { User } from '../user/user';
import { createUserProvisioner } from './user-provisioner';

const authUser = (id: string): AuthUser =>
  ({
    id,
    email: 'a@b.c',
    email_verified: true,
  }) as AuthUser;

const makeHarness = (
  provision?: () => Promise<{ user: User; accounts: Account[] }>,
) => {
  let provisionCalls = 0;
  const emitted: { user: User; accounts: Account[] }[] = [];
  const provisioner = createUserProvisioner({
    provision:
      provision ??
      (async () => {
        provisionCalls += 1;
        return { user: { id: 'user-1' } as unknown as User, accounts: [] };
      }),
    emit: (payload) => {
      emitted.push(payload);
    },
  });
  return { provisioner, emitted, provisionCalls: () => provisionCalls };
};

describe('createUserProvisioner', () => {
  it('provisions and emits on the first establish', async () => {
    const { provisioner, emitted, provisionCalls } = makeHarness();
    await provisioner.provision(authUser('user-1'));
    expect(emitted).toHaveLength(1);
    expect(provisionCalls()).toBe(1);
  });

  it('skips a same-user re-establish (fingerprint guard) without a session end', async () => {
    const { provisioner, emitted, provisionCalls } = makeHarness();
    await provisioner.provision(authUser('user-1'));
    await provisioner.provision(authUser('user-1'));
    expect(emitted).toHaveLength(1);
    expect(provisionCalls()).toBe(1);
  });

  it('re-provisions and re-emits on a same-user re-establish after reset', async () => {
    const { provisioner, emitted, provisionCalls } = makeHarness();
    await provisioner.provision(authUser('user-1'));
    provisioner.reset();
    await provisioner.provision(authUser('user-1'));
    expect(emitted).toHaveLength(2);
    expect(provisionCalls()).toBe(2);
  });

  it('re-provisions when the identity changes', async () => {
    const { provisioner, emitted } = makeHarness();
    await provisioner.provision(authUser('user-1'));
    await provisioner.provision(authUser('user-2'));
    expect(emitted).toHaveLength(2);
  });

  it('propagates a terminal provision failure', async () => {
    const { provisioner } = makeHarness(async () => {
      throw new Error('provision failed');
    });
    await expect(provisioner.provision(authUser('user-1'))).rejects.toThrow(
      'provision failed',
    );
  });

  it('swallows a session-lifecycle abort without emitting', async () => {
    const { provisioner, emitted } = makeHarness(async () => {
      throw new SessionEndedError();
    });
    await provisioner.provision(authUser('user-1'));
    expect(emitted).toHaveLength(0);
  });

  it('swallows a DisposedError without emitting', async () => {
    const { provisioner, emitted } = makeHarness(async () => {
      throw new DisposedError();
    });
    await provisioner.provision(authUser('user-1'));
    expect(emitted).toHaveLength(0);
  });
});
