import { describe, expect, test } from 'bun:test';
import type { Proof } from '@cashu/cashu-ts';
import type { CashuProof } from '../../../types/account';
import { getClaimableProofs, sumProofs, toProof } from './proof';

const proofWithP2PKSecret: Proof = {
  amount: 1,
  secret:
    '["P2PK",{"nonce":"0","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","SIG_INPUTS"]]}]',
  C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
  id: '009a1f293253e41e',
};

const proofWithPlainSecret: Proof = {
  amount: 1,
  secret: '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
  C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
  id: '009a1f293253e41e',
};

const unknownTypeProof: Proof = {
  amount: 1,
  secret: '["UNKNOWN_TYPE",{"some":"data"}]',
  C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
  id: '009a1f293253e41e',
};

describe('getClaimableProofs', () => {
  const pubkey =
    '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7';
  const differentPubkey =
    '0349098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a8';

  test('should return all proofs with plain secrets', () => {
    const result = getClaimableProofs([proofWithPlainSecret], [pubkey]);
    expect(result.claimableProofs).toHaveLength(1);
    expect(result.cannotClaimReason).toBeNull();
  });

  test('should return proofs that match the pubkey', () => {
    const result = getClaimableProofs([proofWithP2PKSecret], [pubkey]);
    expect(result.claimableProofs).toHaveLength(1);
    expect(result.cannotClaimReason).toBeNull();
  });

  test('should not return P2PK proofs with non-matching pubkeys', () => {
    const result = getClaimableProofs([proofWithP2PKSecret], [differentPubkey]);
    expect(result.claimableProofs).toBeNull();
    expect(result.cannotClaimReason).toBe(
      'You do not have permission to claim this ecash',
    );
  });

  test('should not allow claiming proofs with unknown spending conditions', () => {
    const result = getClaimableProofs([unknownTypeProof], [pubkey]);
    expect(result.claimableProofs).toBeNull();
    expect(result.cannotClaimReason).toBe(
      'This ecash contains invalid spending conditions.',
    );
  });

  test('should return both plain and matching P2PK proofs', () => {
    const result = getClaimableProofs(
      [proofWithPlainSecret, proofWithP2PKSecret],
      [pubkey],
    );
    expect(result.claimableProofs).toHaveLength(2);
    expect(result.cannotClaimReason).toBeNull();
  });

  test('should not return any proofs if none are claimable', () => {
    const result = getClaimableProofs([proofWithP2PKSecret], [differentPubkey]);
    expect(result.claimableProofs).toBeNull();
    expect(result.cannotClaimReason).toBe(
      'You do not have permission to claim this ecash',
    );
  });
});

const baseCashuProof: CashuProof = {
  id: 'proof-uuid-1',
  accountId: 'account-uuid-1',
  userId: 'user-uuid-1',
  keysetId: '009a1f293253e41e',
  amount: 64,
  secret: 'test-secret-abc',
  unblindedSignature:
    '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
  publicKeyY:
    '02abc4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda123',
  dleq: undefined,
  witness: undefined,
  state: 'UNSPENT',
  version: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('toProof', () => {
  test('maps domain CashuProof fields to cashu-ts Proof fields', () => {
    const result = toProof(baseCashuProof);
    expect(result.id).toBe(baseCashuProof.keysetId);
    expect(result.amount).toBe(baseCashuProof.amount);
    expect(result.secret).toBe(baseCashuProof.secret);
    expect(result.C).toBe(baseCashuProof.unblindedSignature);
  });

  test('omits dleq when undefined', () => {
    const result = toProof({ ...baseCashuProof, dleq: undefined });
    expect('dleq' in result).toBe(false);
  });

  test('includes dleq when present', () => {
    const dleq = { e: 'aabbcc', s: 'ddeeff', r: '001122' };
    const result = toProof({ ...baseCashuProof, dleq });
    expect(result.dleq).toEqual(dleq);
  });

  test('omits witness when undefined', () => {
    const result = toProof({ ...baseCashuProof, witness: undefined });
    expect('witness' in result).toBe(false);
  });

  test('includes witness when present', () => {
    const witness = '{"signatures":["sig1"]}';
    const result = toProof({ ...baseCashuProof, witness });
    expect(result.witness).toBe(witness);
  });
});

describe('sumProofs', () => {
  test('should sum the amounts of a list of proofs', () => {
    const proofs = [
      {
        amount: 1,
        secret:
          '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
        C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
        id: '009a1f293253e41e',
      },
      {
        amount: 1,
        secret:
          '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a8',
        C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
        id: '009a1f293253e41e',
      },
    ];
    expect(sumProofs(proofs)).toBe(2);
  });
});
