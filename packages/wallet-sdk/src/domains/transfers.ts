/**
 * `TransfersDomain` implementation — §9 of the contract, Slice 4.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transfer/transfer-hooks.ts` (`useGetTransferQuote` /
 * `useInitiateTransfer`) + `transfer-service.ts`. Master expresses these as TanStack mutations
 * over the service; the SDK exposes them as `createQuote` / `executeQuote` (naming aligned with
 * cashu/spark, decision 4) over the re-housed `internal/transfer-service.ts`.
 *
 * A transfer COMPOSES a Slice-3 cashu leg + a spark leg: `createQuote` fetches both legs'
 * lightning quotes (does not persist); `executeQuote` persists the paired send + receive quotes
 * linked by a `transferId`, AUTO-FAILING the receive if the send fails to persist (§9). The
 * background processor then drives the send to completion (no `transfer:*` events, decision 5 —
 * the consumer reconstructs status from the two linked `transaction:*` events).
 *
 * Two-mode API rule: `executeQuote` takes the FULL public {@link TransferQuote}. Because the
 * public quote is a slim cost-preview (§9) while persisting the legs needs the live mint/Breez
 * quotes, `createQuote` STASHES the internal quote (with the live legs) on the returned object
 * under a non-enumerable carrier; `executeQuote` recovers it — so the SDK never re-quotes the
 * mint, honoring the rule.
 *
 * @module
 */
import type { SessionResolver } from '../internal/session';
import type {
  TransferQuoteInternal,
  TransferService,
} from '../internal/transfer-service';
import type { TransfersDomain } from '../domains';
import type { Account } from '../types/account';
import { DomainError } from '../errors';
import type { Money } from '../types/money';
import type {
  TransferLeg,
  TransferQuote,
  TransferResult,
} from '../types/transfer';

/**
 * The non-enumerable property on a returned {@link TransferQuote} that carries the INTERNAL quote
 * (with the live lightning-quote legs) so `executeQuote` can persist without re-quoting. A symbol
 * keeps it off the public shape (it does not serialise / enumerate) yet survives the round-trip
 * the two-mode rule relies on (the caller hands the same object straight back).
 */
const INTERNAL_QUOTE = Symbol('agicash.sdk.transferQuoteInternal');

/** A public {@link TransferQuote} with the internal (live-leg) quote stashed for `executeQuote`. */
type TransferQuoteWithInternal = TransferQuote & {
  [INTERNAL_QUOTE]?: TransferQuoteInternal;
};

/** Project an internal transfer leg to the slim public {@link TransferLeg}. */
function toPublicLeg(side: { account: Account; fee?: Money }): TransferLeg {
  // The account is narrowed to cashu/spark already; fee defaults to the send leg's (no fee field).
  return { account: side.account, fee: side.fee } as TransferLeg;
}

/**
 * The transfers domain. Construct with the internal transfer service and the session resolver
 * (current user id, for the persist path).
 */
export class TransfersDomainImpl implements TransfersDomain {
  /**
   * @param transferService - the re-housed cross-account transfer service.
   * @param session - resolves the current user (id).
   */
  constructor(
    private readonly transferService: TransferService,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Quote a cross-account transfer (cost preview; not persisted). Re-houses master
   * `useGetTransferQuote` → `getTransferQuote`. Returns the slim public {@link TransferQuote} and
   * stashes the internal (live-leg) quote on it for `executeQuote`.
   *
   * @param params - `{ sourceAccount, destinationAccount, amount }`.
   * @returns the public transfer quote.
   * @throws DomainError if the source can't send / the destination can't receive over Lightning.
   */
  async createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote> {
    const internal = await this.transferService.getTransferQuote(params);

    const publicQuote: TransferQuoteWithInternal = {
      amount: internal.amount,
      amountToReceive: internal.amountToReceive,
      totalFees: internal.totalFees,
      totalCost: internal.totalCost,
      receive: toPublicLeg(internal.receive),
      send: toPublicLeg({ account: internal.send.account, fee: undefined }),
    };
    // Stash the live-leg quote (non-enumerable; recovered in executeQuote).
    Object.defineProperty(publicQuote, INTERNAL_QUOTE, {
      value: internal,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return publicQuote;
  }

  /**
   * Execute a previously-created transfer quote (FULL object). Re-houses master
   * `useInitiateTransfer` → `initiateTransfer`: persists the paired send + receive quotes linked
   * by a `transferId` (auto-failing the receive on send-persist failure, §9). Resolves with both
   * leg transaction ids + the shared `transferId`; the background processor drives the send.
   *
   * @param quote - the quote returned by {@link createQuote} (carries the live legs).
   * @returns `{ transferId, receiveTransactionId, sendTransactionId }`.
   * @throws DomainError if the quote was not produced by `createQuote` (its live legs are missing).
   */
  async executeQuote(quote: TransferQuote): Promise<TransferResult> {
    const internal = (quote as TransferQuoteWithInternal)[INTERNAL_QUOTE];
    if (!internal) {
      throw new DomainError(
        'Transfer quote must be created via transfers.createQuote',
      );
    }

    const user = await this.session.requireCurrentUser();
    return this.transferService.initiateTransfer({
      userId: user.id,
      quote: internal,
    });
  }
}
