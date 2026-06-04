import { describe, expect, test } from 'bun:test';
import {
  HttpResponseError,
  MintOperationError,
  NetworkError,
} from '@cashu/cashu-ts';
import { classify } from './classify';
import {
  ConcurrencyError,
  DomainError,
  NotFoundError,
  NotImplementedError,
} from './errors';
import { CashuErrorCodes } from './internal/cashu-error-codes';

describe('classify', () => {
  describe('transient', () => {
    test('ConcurrencyError (SDK optimistic-lock signal)', () => {
      expect(classify(new ConcurrencyError('stale', 'CONCURRENCY_ERROR'))).toBe(
        'transient',
      );
    });

    test('NetworkError (connectivity/transport failure)', () => {
      expect(classify(new NetworkError('connection refused'))).toBe(
        'transient',
      );
    });

    test('bare HttpResponseError such as 429 / 5xx', () => {
      expect(classify(new HttpResponseError('rate limited', 429))).toBe(
        'transient',
      );
      expect(classify(new HttpResponseError('bad gateway', 502))).toBe(
        'transient',
      );
    });

    test('in-flight-elsewhere mint codes (OUTPUTS/PROOFS pending, quote pending)', () => {
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.OUTPUTS_ARE_PENDING, // 11004
            'outputs are pending',
          ),
        ),
      ).toBe('transient');
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.PROOFS_ARE_PENDING, // 11002
            'proofs are pending',
          ),
        ),
      ).toBe('transient');
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.QUOTE_PENDING, // 20005
            'quote is pending',
          ),
        ),
      ).toBe('transient');
    });
  });

  describe('already-resolved', () => {
    test('token already spent', () => {
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.TOKEN_ALREADY_SPENT, // 11001
            'Token already spent',
          ),
        ),
      ).toBe('already-resolved');
    });

    test('output already signed', () => {
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.OUTPUT_ALREADY_SIGNED, // 11003
            'Output already signed',
          ),
        ),
      ).toBe('already-resolved');
    });

    test('quote already issued', () => {
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.QUOTE_ALREADY_ISSUED, // 20002
            'Tokens already issued for quote',
          ),
        ),
      ).toBe('already-resolved');
    });

    test('invoice already paid', () => {
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.INVOICE_ALREADY_PAID, // 20006
            'Invoice already paid',
          ),
        ),
      ).toBe('already-resolved');
    });
  });

  describe('permanent', () => {
    test('DomainError (definitive, user-facing failure)', () => {
      expect(classify(new DomainError('insufficient balance', 'DOMAIN'))).toBe(
        'permanent',
      );
    });

    test('NotFoundError (requested entity missing)', () => {
      expect(
        classify(new NotFoundError('account not found', 'NOT_FOUND')),
      ).toBe('permanent');
    });

    test('other mint rejections (deterministic, never succeed on retry)', () => {
      // transaction not balanced
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.TRANSACTION_NOT_BALANCED, // 11005
            'Transaction is not balanced',
          ),
        ),
      ).toBe('permanent');
      // amount out of limits
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.AMOUNT_OUT_OF_LIMITS, // 11006
            'Amount outside of limit range',
          ),
        ),
      ).toBe('permanent');
      // keyset inactive
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.KEYSET_INACTIVE, // 12002
            'Keyset is inactive',
          ),
        ),
      ).toBe('permanent');
      // quote not paid
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.QUOTE_NOT_PAID, // 20001
            'Quote is not paid',
          ),
        ),
      ).toBe('permanent');
      // blind auth required
      expect(
        classify(
          new MintOperationError(
            CashuErrorCodes.BLIND_AUTH_REQUIRED, // 31001
            'Endpoint requires blind auth',
          ),
        ),
      ).toBe('permanent');
    });
  });

  describe('unhandled', () => {
    test('a plain Error is not recognised', () => {
      expect(classify(new Error('boom'))).toBe('unhandled');
    });

    test('a TypeError is not recognised', () => {
      expect(classify(new TypeError('x is not a function'))).toBe('unhandled');
    });

    test('non-Error thrown values (string, null, undefined, object)', () => {
      expect(classify('a string')).toBe('unhandled');
      expect(classify(null)).toBe('unhandled');
      expect(classify(undefined)).toBe('unhandled');
      expect(classify({ code: 11004 })).toBe('unhandled');
    });

    test('NotImplementedError is an SdkError but not Domain/NotFound -> unhandled', () => {
      // NotImplementedError extends SdkError but neither DomainError nor
      // NotFoundError, so classify falls through to 'unhandled'.
      expect(classify(new NotImplementedError('cashu.send'))).toBe('unhandled');
    });
  });
});
