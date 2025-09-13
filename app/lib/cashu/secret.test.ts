import { describe, expect, test } from 'bun:test';
import { parseSecret } from './secret';

describe('parseSecret', () => {
  test('should return success with data for a plain secret', () => {
    const result = parseSecret(
      '859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f',
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: 'plain',
        secret:
          '859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f',
      });
    }
  });

  test('should successfully parse a valid NUT10 secret', () => {
    const result = parseSecret(
      '["P2PK",{"nonce":"abc123","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","SIG_INPUTS"]]}]',
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: 'nut10',
        secret: {
          kind: 'P2PK',
          nonce: 'abc123',
          data: '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
          tags: [['sigflag', 'SIG_INPUTS']],
        },
      });
    }
  });

  describe('should handle valid variations', () => {
    test('tags are not provided', () => {
      const result = parseSecret(
        '["P2PK",{"nonce":"abc123","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7"}]',
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          type: 'nut10',
          secret: {
            kind: 'P2PK',
            nonce: 'abc123',
            data: '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
          },
        });
      }
    });

    test('a tag has multiple values', () => {
      const result = parseSecret(
        '["P2PK",{"nonce":"abc123","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","a","b"]]}]',
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          type: 'nut10',
          secret: {
            kind: 'P2PK',
            nonce: 'abc123',
            data: '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
            tags: [['sigflag', 'a', 'b']],
          },
        });
      }
    });
  });

  describe('should return failure for invalid NUT10 secret if', () => {
    test('secret is not in WELL_KNOWN_SECRET_KINDS', () => {
      const result = parseSecret(
        '["UNKNOWN",{"nonce":"0","data":"0","tags":[]}]',
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    test('nonce is not a string', () => {
      const result = parseSecret('["P2PK",{"nonce":123,"data":"test"}]');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Invalid secret format');
      }
    });

    test('data is not a string', () => {
      const result = parseSecret('["P2PK",{"nonce":"test","data":false}]');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Invalid secret format');
      }
    });

    test('tags is not an array of string arrays', () => {
      const result = parseSecret(
        '["P2PK",{"nonce":"test","data":"test","tags":["invalid"]}]',
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Invalid secret format');
      }
    });
  });
});
