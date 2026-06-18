import { describe, expect, test } from 'bun:test';
import { MintOperationError } from '@cashu/cashu-ts';
import { CashuErrorCodes, isTransientCashuSwapError } from './error-codes';

const mintError = (code: CashuErrorCodes) =>
  new MintOperationError(code, `mint error ${code}`);

describe('isTransientCashuSwapError', () => {
  test('treats OUTPUTS_ARE_PENDING (11004) as transient', () => {
    expect(
      isTransientCashuSwapError(mintError(CashuErrorCodes.OUTPUTS_ARE_PENDING)),
    ).toBe(true);
  });

  test('treats PROOFS_ARE_PENDING (11002) as transient', () => {
    expect(
      isTransientCashuSwapError(mintError(CashuErrorCodes.PROOFS_ARE_PENDING)),
    ).toBe(true);
  });

  test('does not treat OUTPUT_ALREADY_SIGNED (11003) as transient', () => {
    expect(
      isTransientCashuSwapError(
        mintError(CashuErrorCodes.OUTPUT_ALREADY_SIGNED),
      ),
    ).toBe(false);
  });

  test('does not treat TOKEN_ALREADY_SPENT (11001) as transient', () => {
    expect(
      isTransientCashuSwapError(mintError(CashuErrorCodes.TOKEN_ALREADY_SPENT)),
    ).toBe(false);
  });

  test('does not treat other mint operation errors as transient', () => {
    expect(
      isTransientCashuSwapError(
        mintError(CashuErrorCodes.TRANSACTION_NOT_BALANCED),
      ),
    ).toBe(false);
    expect(
      isTransientCashuSwapError(mintError(CashuErrorCodes.KEYSET_INACTIVE)),
    ).toBe(false);
  });

  test('does not treat non-mint errors as transient', () => {
    expect(isTransientCashuSwapError(new Error('boom'))).toBe(false);
    expect(isTransientCashuSwapError('outputs are pending')).toBe(false);
    expect(isTransientCashuSwapError(undefined)).toBe(false);
  });
});
