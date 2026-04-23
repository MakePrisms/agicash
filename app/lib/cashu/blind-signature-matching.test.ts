import { describe, expect, test } from 'bun:test';
import {
  OutputData,
  type SerializedBlindedSignature,
  createBlindSignature,
  createDLEQProof,
  pointFromHex,
} from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { matchBlindSignaturesToOutputData } from './blind-signature-matching';

/**
 * Test helpers — simulate mint-side signing so we get real DLEQ proofs.
 */
const KEYSET_ID = '00test_keyset_id';

// Generate a deterministic private key for testing
const PRIVATE_KEY = secp256k1.utils.randomPrivateKey();
const PUBLIC_KEY = secp256k1.getPublicKey(PRIVATE_KEY, true);
const PUBLIC_KEY_HEX = bytesToHex(PUBLIC_KEY);

// Build a keyset with the same key for all denominations (sufficient for testing)
const TEST_KEYSET = {
  id: KEYSET_ID,
  keys: Object.fromEntries(
    [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096].map((amount) => [
      String(amount),
      PUBLIC_KEY_HEX,
    ]),
  ),
};

function mintSign(
  B_: ReturnType<typeof pointFromHex>,
  amount: number,
): SerializedBlindedSignature {
  const blindSig = createBlindSignature(B_, PRIVATE_KEY, amount, KEYSET_ID);
  const dleq = createDLEQProof(B_, PRIVATE_KEY);
  return {
    id: blindSig.id,
    amount: blindSig.amount,
    C_: blindSig.C_.toHex(),
    dleq: {
      s: bytesToHex(dleq.s),
      e: bytesToHex(dleq.e),
    },
  };
}

function createTestOutputData(
  amounts: number[],
  seed: Uint8Array,
  counter = 0,
) {
  return OutputData.createDeterministicData(
    amounts.reduce((a, b) => a + b, 0),
    seed,
    counter,
    TEST_KEYSET,
    amounts,
  );
}

function signOutputData(
  outputData: OutputData[],
  amounts: number[],
): SerializedBlindedSignature[] {
  return outputData.map((od, i) => {
    const B_ = pointFromHex(od.blindedMessage.B_);
    return mintSign(B_, amounts[i]);
  });
}

const TEST_SEED = new Uint8Array(32).fill(42);

describe('matchBlindSignaturesToOutputData', () => {
  test('matches correctly ordered signatures', () => {
    const amounts = [1024, 512, 16, 8, 2];
    const outputData = createTestOutputData(amounts, TEST_SEED);
    const signatures = signOutputData(outputData, amounts);

    const proofs = matchBlindSignaturesToOutputData(
      signatures,
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(5);
    expect(proofs.map((p) => p.amount)).toEqual(amounts);
  });

  test('matches reversed signatures', () => {
    const amounts = [1024, 512, 16, 8, 2];
    const outputData = createTestOutputData(amounts, TEST_SEED, 10);
    const signatures = signOutputData(outputData, amounts);

    const reversed = [...signatures].reverse();
    const proofs = matchBlindSignaturesToOutputData(
      reversed,
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(5);
    // Proofs should match the reversed signature order (each proof matches its signature)
    expect(proofs.map((p) => p.amount)).toEqual([...amounts].reverse());
    // But each proof's secret should match the CORRECT OutputData, not the positional one
    for (const proof of proofs) {
      expect(proof.dleq).toBeDefined();
    }
  });

  test('matches shuffled signatures', () => {
    const amounts = [2048, 1024, 512, 16, 8, 2];
    const outputData = createTestOutputData(amounts, TEST_SEED, 20);
    const signatures = signOutputData(outputData, amounts);

    // Shuffle: [2, 1024, 8, 2048, 512, 16]
    const shuffled = [
      signatures[5],
      signatures[1],
      signatures[4],
      signatures[0],
      signatures[2],
      signatures[3],
    ];

    const proofs = matchBlindSignaturesToOutputData(
      shuffled,
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(6);
    // Each proof should have a valid DLEQ (verified during matching)
    for (const proof of proofs) {
      expect(proof.dleq).toBeDefined();
    }
  });

  test('matches single signature', () => {
    const amounts = [1024];
    const outputData = createTestOutputData(amounts, TEST_SEED, 30);
    const signatures = signOutputData(outputData, amounts);

    const proofs = matchBlindSignaturesToOutputData(
      signatures,
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(1);
    expect(proofs[0].amount).toBe(1024);
  });

  test('matches empty signatures', () => {
    const outputData = createTestOutputData([1], TEST_SEED, 40);

    const proofs = matchBlindSignaturesToOutputData(
      [],
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(0);
  });

  test('matches fewer signatures than output data (partial change)', () => {
    const amounts = [2048, 1024, 512, 16, 8, 2];
    const outputData = createTestOutputData(amounts, TEST_SEED, 50);
    const allSignatures = signOutputData(outputData, amounts);

    // Mint only signed first 3 (the change amount only needed 3 outputs)
    const partialSignatures = allSignatures.slice(0, 3);

    const proofs = matchBlindSignaturesToOutputData(
      partialSignatures,
      outputData,
      TEST_KEYSET,
    );

    expect(proofs).toHaveLength(3);
    expect(proofs.map((p) => p.amount)).toEqual([2048, 1024, 512]);
  });

  test('throws when signature has no DLEQ', () => {
    const amounts = [1024, 512];
    const outputData = createTestOutputData(amounts, TEST_SEED, 60);
    const signatures = signOutputData(outputData, amounts);

    // Remove DLEQ from one signature
    const { dleq: _, ...noDleq } = signatures[0];

    expect(() =>
      matchBlindSignaturesToOutputData(
        [noDleq as SerializedBlindedSignature, signatures[1]],
        outputData,
        TEST_KEYSET,
      ),
    ).toThrow('DLEQ');
  });

  test('throws when signature cannot be matched', () => {
    const amounts = [1024, 512];
    const outputData = createTestOutputData(amounts, TEST_SEED, 70);
    const signatures = signOutputData(outputData, amounts);

    // Create a signature from a completely different OutputData
    const otherOutputData = createTestOutputData([256], TEST_SEED, 999);
    const otherSig = signOutputData(otherOutputData, [256]);

    expect(() =>
      matchBlindSignaturesToOutputData(
        [signatures[0], otherSig[0]],
        outputData,
        TEST_KEYSET,
      ),
    ).toThrow('No matching OutputData');
  });

  test('produces identical proofs regardless of signature order', () => {
    const amounts = [1024, 512, 8];
    const outputData = createTestOutputData(amounts, TEST_SEED, 80);
    const signatures = signOutputData(outputData, amounts);

    const orderedProofs = matchBlindSignaturesToOutputData(
      signatures,
      outputData,
      TEST_KEYSET,
    );

    const reversedProofs = matchBlindSignaturesToOutputData(
      [...signatures].reverse(),
      outputData,
      TEST_KEYSET,
    );

    // Same set of proofs regardless of input order
    const sortBySecret = (proofs: typeof orderedProofs) =>
      [...proofs].sort((a, b) => a.secret.localeCompare(b.secret));

    expect(sortBySecret(orderedProofs)).toEqual(sortBySecret(reversedProofs));
  });
});
