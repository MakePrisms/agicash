import { describe, expect, test } from 'bun:test';
import type { Token } from '@cashu/cashu-ts';
import { validateTokenSpendingConditions } from './spending-conditions-validation';
import type { UnlockingData } from './types';

// Test vectors based on NUT-11 specification
// https://github.com/cashubtc/nuts/blob/main/tests/11-test.md

describe('validateTokenSpendingConditions - NUT-11 Test Vectors', () => {
  describe('Plain Secrets', () => {
    test('should validate token with plain hex secret', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              'daf4dd00814ac2dc6cd2c5f8b8ba9bc57b6ab3c094a84a169c4fa4c48523c0ba', // Plain hex string
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({ success: true });
    });

    test('should validate token with multiple plain secrets', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              'daf4dd00814ac2dc6cd2c5f8b8ba9bc57b6ab3c094a84a169c4fa4c48523c0ba',
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
          {
            id: '009a1f293253e41e',
            amount: 2,
            secret:
              'abc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab',
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({ success: true });
    });
  });

  describe('P2PK Conditions', () => {
    // Test vector: Valid P2PK condition with correct signature
    test('should validate P2PK token with correct private key', () => {
      // Known private key for testing
      const privateKey =
        '0000000000000000000000000000000000000000000000000000000000000001';
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'; // Pubkey for private key 0x01

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [privateKey],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({ success: true });
    });

    test('should reject P2PK token with incorrect private key', () => {
      const wrongPrivateKey =
        '0000000000000000000000000000000000000000000000000000000000000002';
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'; // Pubkey for private key 0x01

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [wrongPrivateKey],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({
        success: false,
        error: 'Provided signing key does not match required public key',
      });
    });

    test('should reject P2PK token without unlocking data', () => {
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'P2PK spending condition requires unlocking data',
      });
    });

    test('should reject P2PK token with empty signing keys', () => {
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({
        success: false,
        error: 'P2PK unlocking data must provide signing keys',
      });
    });

    test('should reject P2PK token with wrong unlocking data kind', () => {
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'HTLC',
        preimages: ['test'],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({
        success: false,
        error: 'Expected P2PK unlocking data, got HTLC',
      });
    });
  });

  describe('Timelock Conditions', () => {
    test('should validate P2PK token with expired timelock and no refund keys', () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}","tags":[["locktime","${expiredTimestamp}"]]}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({ success: true });
    });

    test('should reject P2PK token with expired timelock but with refund keys', () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const refundKey =
        '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}","tags":[["locktime","${expiredTimestamp}"],["refund","${refundKey}"]]}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'P2PK spending condition requires unlocking data',
      });
    });

    test('should require unlocking data for non-expired timelock', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const privateKey =
        '0000000000000000000000000000000000000000000000000000000000000001';
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}","tags":[["locktime","${futureTimestamp}"]]}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      // Without unlocking data, should fail
      const resultWithoutUnlocking = validateTokenSpendingConditions(token);
      expect(resultWithoutUnlocking).toEqual({
        success: false,
        error: 'P2PK spending condition requires unlocking data',
      });

      // With correct unlocking data, should succeed
      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [privateKey],
      };

      const resultWithUnlocking = validateTokenSpendingConditions(
        token,
        unlockingData,
      );
      expect(resultWithUnlocking).toEqual({ success: true });
    });

    test('should handle invalid locktime tag format', () => {
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}","tags":[["locktime","invalid_timestamp"]]}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'P2PK spending condition requires unlocking data',
      });
    });
  });

  describe('Unsupported Conditions', () => {
    test('should reject HTLC tokens', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              '["HTLC",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"}]',
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: "Spending condition 'HTLC' is not currently supported",
      });
    });

    test('should reject tokens with unknown spending conditions', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              '["UNKNOWN",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"somedata"}]',
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'Invalid secret format',
      });
    });
  });

  describe('Invalid Secret Formats', () => {
    test('should reject malformed JSON secrets', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: '["P2PK",{invalid json}]', // Malformed JSON
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'Invalid secret',
      });
    });

    test('should reject non-hex plain secrets', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: 'not_valid_hex_string!@#', // Contains non-hex characters
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'Invalid secret',
      });
    });

    test('should reject empty secrets', () => {
      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret: '', // Empty secret
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const result = validateTokenSpendingConditions(token);
      expect(result).toEqual({
        success: false,
        error: 'Invalid secret',
      });
    });
  });

  describe('Mixed Token Conditions', () => {
    test('should validate token with mix of plain and valid P2PK proofs', () => {
      const privateKey =
        '0000000000000000000000000000000000000000000000000000000000000001';
      const expectedPubkey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              'daf4dd00814ac2dc6cd2c5f8b8ba9bc57b6ab3c094a84a169c4fa4c48523c0ba', // Plain secret
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
          {
            id: '009a1f293253e41f',
            amount: 2,
            secret: `["P2PK",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"${expectedPubkey}"}]`,
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [privateKey],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({ success: true });
    });

    test('should reject token if any proof is invalid', () => {
      const privateKey =
        '0000000000000000000000000000000000000000000000000000000000000001';

      const token: Token = {
        mint: 'https://testnut.cashu.space',
        proofs: [
          {
            id: '009a1f293253e41e',
            amount: 1,
            secret:
              'daf4dd00814ac2dc6cd2c5f8b8ba9bc57b6ab3c094a84a169c4fa4c48523c0ba', // Valid plain secret
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
          {
            id: '009a1f293253e41f',
            amount: 2,
            secret:
              '["HTLC",{"nonce":"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000","data":"somedata"}]', // Unsupported condition
            C: '02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0',
          },
        ],
      };

      const unlockingData: UnlockingData = {
        kind: 'P2PK',
        signingKeys: [privateKey],
      };

      const result = validateTokenSpendingConditions(token, unlockingData);
      expect(result).toEqual({
        success: false,
        error: "Spending condition 'HTLC' is not currently supported",
      });
    });
  });
});
