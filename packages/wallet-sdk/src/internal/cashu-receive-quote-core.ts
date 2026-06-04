/**
 * Cashu receive-quote CORE — Slice 3 / PR5b (framework-free).
 *
 * EXTRACTED VERBATIM (logic) from
 * `apps/web-wallet/app/features/receive/cashu-receive-quote-core.ts`. This module is already
 * framework-free in master (pure `@cashu/cashu-ts` + `Money` + `@scure/bip32` + the
 * `derivePublicKey` HDKey helper) — re-housed here with the SDK-internal imports. It owns:
 *  - {@link getLightningQuote} — creates a NUT-20-locked mint quote on the mint;
 *  - {@link deriveNut20LockingPublicKey} — derives the random locking key off the xPub;
 *  - {@link computeQuoteExpiry} / {@link computeTotalFee} — quote bookkeeping;
 *  - the {@link CreateQuoteBaseParams} / {@link RepositoryCreateQuoteParams} param shapes.
 *
 * @module
 */
import type { MintQuoteBolt11Response, Proof } from '@cashu/cashu-ts';
import { HARDENED_OFFSET } from '@scure/bip32';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  derivePublicKey,
} from './lib-cashu-crypto';
import { getCashuUnit } from './lib-cashu';
import { decodeBolt11 } from './lib-scan';
import type { CashuAccount } from '../types/account';
import type { ExtendedCashuWallet } from '../types/account';
import { type Currency, Money } from '../types/money';

/** The locked mint quote + the data needed to create a receive quote (master verbatim). */
export type CashuReceiveLightningQuote = {
  mintQuote: MintQuoteBolt11Response;
  lockingPublicKey: string;
  fullLockingDerivationPath: string;
  expiresAt: string;
  amount: Money;
  description?: string;
  mintingFee?: Money;
  paymentHash: string;
};

/** Params for {@link getLightningQuote}. */
export type GetLightningQuoteParams = {
  wallet: ExtendedCashuWallet;
  amount: Money;
  description?: string;
  xPub: string;
};

/** Params for creating a receive quote in the service (master `CreateQuoteBaseParams`). */
export type CreateQuoteBaseParams = {
  userId: string;
  /** The cashu account the money will be received into (only `id` is read here). */
  account: Pick<CashuAccount, 'id'>;
  lightningQuote: CashuReceiveLightningQuote;
  receiveType: 'LIGHTNING' | 'CASHU_TOKEN';
  purpose?: string;
  transferId?: string;
} & (
  | { receiveType: 'LIGHTNING' }
  | {
      receiveType: 'CASHU_TOKEN';
      tokenAmount: Money;
      sourceMintUrl: string;
      tokenProofs: Proof[];
      meltQuoteId: string;
      meltQuoteExpiresAt: string;
      cashuReceiveFee: Money;
      lightningFeeReserve: Money;
    }
);

/** Params for creating a receive quote in the repository (master `RepositoryCreateQuoteParams`). */
export type RepositoryCreateQuoteParams = {
  userId: string;
  accountId: string;
  amount: Money;
  quoteId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  description?: string;
  lockingDerivationPath: string;
  receiveType: 'LIGHTNING' | 'CASHU_TOKEN';
  mintingFee?: Money;
  totalFee: Money;
  purpose?: string;
  transferId?: string;
} & (
  | { receiveType: 'LIGHTNING' }
  | {
      receiveType: 'CASHU_TOKEN';
      meltData: {
        tokenMintUrl: string;
        meltQuoteId: string;
        tokenAmount: Money;
        tokenProofs: Proof[];
        cashuReceiveFee: Money;
        lightningFeeReserve: Money;
      };
    }
);

/**
 * Derive a NUT-20 locking public key for a cashu mint quote (master verbatim): a random
 * unhardened index off the locking xPub.
 *
 * @param xPub - the user's cashu locking xPub.
 * @returns the locking public key + its full derivation path.
 */
export async function deriveNut20LockingPublicKey(xPub: string): Promise<{
  lockingPublicKey: string;
  fullLockingDerivationPath: string;
}> {
  const unhardenedIndex = Math.floor(
    Math.random() * (HARDENED_OFFSET - 1),
  ).toString();
  const lockingKey = derivePublicKey(xPub, `m/${unhardenedIndex}`);
  return {
    lockingPublicKey: lockingKey,
    fullLockingDerivationPath: `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${unhardenedIndex}`,
  };
}

/**
 * Get a NUT-20-locked mint quote for a lightning receive (master verbatim): derives the
 * locking key, calls the mint's `createLockedMintQuote`, and returns the quote + invoice data.
 *
 * @param params - the wallet, amount, optional description, and locking xPub.
 * @returns the locked mint quote + derived data.
 */
export async function getLightningQuote(
  params: GetLightningQuoteParams,
): Promise<CashuReceiveLightningQuote> {
  const { wallet, amount, description, xPub } = params;
  const cashuUnit = getCashuUnit(amount.currency);

  const { lockingPublicKey, fullLockingDerivationPath } =
    await deriveNut20LockingPublicKey(xPub);

  const mintQuoteResponse = await wallet.createLockedMintQuote(
    amount.toNumber(cashuUnit),
    lockingPublicKey,
    description,
  );

  const expiresAt = new Date(mintQuoteResponse.expiry * 1000).toISOString();

  const mintingFee = mintQuoteResponse.fee
    ? new Money({
        amount: mintQuoteResponse.fee,
        currency: amount.currency,
        unit: cashuUnit,
      })
    : undefined;

  const {
    decoded: { paymentHash },
  } = decodeBolt11(mintQuoteResponse.request);

  return {
    mintQuote: mintQuoteResponse,
    lockingPublicKey,
    fullLockingDerivationPath,
    expiresAt,
    amount,
    description,
    mintingFee,
    paymentHash,
  };
}

/**
 * Compute a receive quote's expiry (master verbatim). LIGHTNING = the mint quote expiry;
 * CASHU_TOKEN = the earlier of the mint quote + melt quote expiry.
 */
export function computeQuoteExpiry(params: CreateQuoteBaseParams): string {
  if (params.receiveType === 'LIGHTNING') {
    return params.lightningQuote.expiresAt;
  }
  return new Date(
    Math.min(
      new Date(params.lightningQuote.expiresAt).getTime(),
      new Date(params.meltQuoteExpiresAt).getTime(),
    ),
  ).toISOString();
}

/**
 * Compute a receive quote's total fee (master verbatim). LIGHTNING = the minting fee;
 * CASHU_TOKEN = minting fee + cashu receive fee + lightning fee reserve.
 */
export function computeTotalFee(params: CreateQuoteBaseParams): Money {
  const mintingFee =
    params.lightningQuote.mintingFee ??
    Money.zero(params.lightningQuote.amount.currency as Currency);

  if (params.receiveType === 'LIGHTNING') {
    return mintingFee;
  }
  return mintingFee.add(params.cashuReceiveFee).add(params.lightningFeeReserve);
}
