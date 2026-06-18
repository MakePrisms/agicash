import { describe, expect, it, mock } from 'bun:test';
import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { PendingCashuSendSwap } from '../../../types/cashu';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';
import type { ExtendedCashuWallet } from './utils';

function fakeWallet() {
  let cb: ((u: ProofState & { proof: Proof }) => void) | undefined;
  const wallet = {
    on: {
      proofStateUpdates: mock(
        async (
          _proofs: Proof[],
          onUpdate: (u: ProofState & { proof: Proof }) => void,
          _onErr: (e: unknown) => void,
        ) => {
          cb = onUpdate;
          return mock(() => undefined);
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => undefined) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, fire: (u: ProofState & { proof: Proof }) => cb?.(u) };
}

const swap = {
  id: 'swap-1',
  state: 'PENDING',
  proofsToSend: [{ unblindedSignature: 'C1' }, { unblindedSignature: 'C2' }],
} as unknown as PendingCashuSendSwap;

describe('ProofStateSubscriptionManager', () => {
  it('fires onSpent only after every proof of the swap is SPENT', async () => {
    const { wallet, fire } = fakeWallet();
    const manager = new ProofStateSubscriptionManager(async () => wallet);
    const spent: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      swaps: [swap],
      onSpent: (s) => spent.push(s.id),
    });

    fire({ state: 'SPENT', proof: { C: 'C1' } } as ProofState & {
      proof: Proof;
    });
    expect(spent).toEqual([]); // one of two proofs spent
    fire({ state: 'SPENT', proof: { C: 'C2' } } as ProofState & {
      proof: Proof;
    });
    expect(spent).toEqual(['swap-1']); // all spent
  });
});
