import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { toDecryptedCashuProofs, toEncryptedProofData } from './cashu-proofs';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

describe('cashu-proofs mapping', () => {
  it('round-trips a proof through encrypt -> decrypt mapping', async () => {
    const enc = await encryption.get();
    const proof = { id: 'ks1', amount: 21, secret: 's3cret', C: 'sig' } as never;
    const encrypted = await toEncryptedProofData([proof], enc);
    expect(typeof encrypted[0]?.amount).toBe('string');

    const decrypted = await enc.decryptBatch([encrypted[0]!.amount, encrypted[0]!.secret]);
    const dbRows = [
      {
        id: 'p1',
        account_id: 'a1',
        user_id: 'u1',
        keyset_id: 'ks1',
        unblinded_signature: 'sig',
        public_key_y: 'Y',
        dleq: null,
        witness: null,
        state: 'UNSPENT',
        version: 1,
        created_at: 't',
        reserved_at: null,
      },
    ] as never;
    const mapped = toDecryptedCashuProofs(dbRows, decrypted);
    expect(mapped[0]?.amount).toBe(21);
    expect(mapped[0]?.secret).toBe('s3cret');
  });

  it('maps a 2-proof batch to the right offsets (index * 2)', async () => {
    const enc = await encryption.get();
    const proofs = [
      { id: 'ks1', amount: 21, secret: 'first', C: 'sigA' },
      { id: 'ks2', amount: 99, secret: 'second', C: 'sigB' },
    ] as never;
    const encrypted = await toEncryptedProofData(proofs, enc);

    const decrypted = await enc.decryptBatch([
      encrypted[0]!.amount,
      encrypted[0]!.secret,
      encrypted[1]!.amount,
      encrypted[1]!.secret,
    ]);
    const dbRows = [
      {
        id: 'p1',
        account_id: 'a1',
        user_id: 'u1',
        keyset_id: 'ks1',
        unblinded_signature: 'sigA',
        public_key_y: 'Y1',
        dleq: null,
        witness: null,
        state: 'UNSPENT',
        version: 1,
        created_at: 't',
        reserved_at: null,
      },
      {
        id: 'p2',
        account_id: 'a1',
        user_id: 'u1',
        keyset_id: 'ks2',
        unblinded_signature: 'sigB',
        public_key_y: 'Y2',
        dleq: null,
        witness: null,
        state: 'UNSPENT',
        version: 1,
        created_at: 't',
        reserved_at: null,
      },
    ] as never;
    const mapped = toDecryptedCashuProofs(dbRows, decrypted);
    expect(mapped[0]?.amount).toBe(21);
    expect(mapped[0]?.secret).toBe('first');
    expect(mapped[1]?.amount).toBe(99);
    expect(mapped[1]?.secret).toBe('second');
  });
});
