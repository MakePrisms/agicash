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
 * Two-mode API rule: `executeQuote` takes the FULL {@link TransferQuote} returned by
 * `createQuote`. That quote is the VERBATIM-FULL master shape (§9) — each leg's live Lightning
 * quote is a VISIBLE, plain-data field — so `executeQuote` hands the quote straight back to the
 * service, which reads the live legs DIRECTLY (no slim projection, no symbol carrier, no
 * "must be created via createQuote" guard, no re-quoting the mint).
 *
 * @module
 */
import type { SessionResolver } from '../internal/session';
import type { TransferService } from '../internal/transfer-service';
import type { TransfersDomain } from '../domains';
import type { Account } from '../types/account';
import type { Money } from '../types/money';
import type { TransferQuote, TransferResult } from '../types/transfer';

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
   * `useGetTransferQuote` → `getTransferQuote`. Returns the VERBATIM-FULL {@link TransferQuote}:
   * both legs expose their live Lightning quote as plain data, so the quote round-trips to
   * `executeQuote` with no symbol carrier and no re-quoting.
   *
   * @param params - `{ sourceAccount, destinationAccount, amount }`.
   * @returns the full transfer quote (live legs visible).
   * @throws DomainError if the source can't send / the destination can't receive over Lightning.
   */
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote> {
    return this.transferService.getTransferQuote(params);
  }

  /**
   * Execute a previously-created transfer quote (FULL object). Re-houses master
   * `useInitiateTransfer` → `initiateTransfer`: persists the paired send + receive quotes linked
   * by a `transferId` (auto-failing the receive on send-persist failure, §9). Resolves with both
   * leg transaction ids + the shared `transferId`; the background processor drives the send.
   *
   * Reads the live legs DIRECTLY off the full `quote` (the verbatim-full master shape) — no
   * symbol recovery, no guard.
   *
   * @param quote - the full quote returned by {@link createQuote} (its legs carry the live
   *   Lightning quotes the persist path consumes).
   * @returns `{ transferId, receiveTransactionId, sendTransactionId }`.
   */
  async executeQuote(quote: TransferQuote): Promise<TransferResult> {
    const user = await this.session.requireCurrentUser();
    return this.transferService.initiateTransfer({
      userId: user.id,
      quote,
    });
  }
}
