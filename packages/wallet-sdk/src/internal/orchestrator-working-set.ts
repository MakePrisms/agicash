/**
 * Orchestrator in-flight working-set — Slice 3 / PR5d.
 *
 * The framework-free replacement for the TanStack caches master's `useProcess*Tasks` hooks read
 * (`unresolved*Cache.get(id)` / `getByMeltQuoteId` / `getByMintQuoteId`). It is the contract's
 * §0 state kind 1 — "the quotes/swaps a running orchestrator is actively driving (a task queue,
 * bounded)" — NOT a domain cache: it holds NO entity bodies, only the protocol-id → agicash-id
 * INDEX a WebSocket/Breez update needs to find which agicash quote a mint event refers to.
 *
 * WHY this exists (the #1 correctness substitution). A mint melt/mint-quote WS update arrives keyed
 * by the MINT's quote id, and a Breez event by the spark transfer/payment id — not by the agicash
 * quote id. Master resolved that mapping by scanning a TanStack cache of full quotes. The SDK has
 * no such cache, so on the WS/Breez signal it:
 *   1. resolves `protocolId → agicashId` from THIS index (registered at `executeQuote` kickoff +
 *      refreshed by a resume sweep), then
 *   2. reads FRESH state from the DB via `repo.get(agicashId)` — never from a stale in-memory body.
 * That two-step (index here, body from DB) is exactly the no-cache design: double-spend / stale-
 * proof / missed-terminal cannot hide in a body this set never stores.
 *
 * Entries are removed when a quote reaches a terminal state (so the set stays bounded to in-flight
 * work) and cleared on `destroy()`.
 *
 * @module
 */

/** A single tracked in-flight quote/swap: the protocol-id keys that map back to its agicash id. */
type TrackedEntry = {
  /** The agicash quote/swap id (the DB primary key the orchestrator reads state by). */
  agicashId: string;
  /** The mint URL the quote's mint WS subscription / source wallet uses (cashu only). */
  mintUrl?: string;
};

/**
 * A bounded index of the quotes/swaps a running orchestrator is actively driving, keyed by the
 * protocol id carried on external signals. NOT a domain cache (holds no entity bodies).
 */
export class OrchestratorWorkingSet {
  /** protocol-quote-id (mint melt/mint quote id, or spark transfer/payment id) → tracked entry. */
  private readonly byProtocolId = new Map<string, TrackedEntry>();
  /** agicash-id → the protocol id it was registered under (so terminal removal can clean both). */
  private readonly protocolIdByAgicashId = new Map<string, string>();

  /**
   * Register an in-flight quote/swap. Idempotent — re-registering the same pair refreshes it.
   *
   * @param params.protocolId - the id external signals carry (mint quote id / spark id).
   * @param params.agicashId - the agicash quote/swap id to read DB state by.
   * @param params.mintUrl - the mint URL (cashu) for the WS subscription / source wallet.
   */
  track(params: {
    protocolId: string;
    agicashId: string;
    mintUrl?: string;
  }): void {
    const { protocolId, agicashId, mintUrl } = params;
    this.byProtocolId.set(protocolId, { agicashId, mintUrl });
    this.protocolIdByAgicashId.set(agicashId, protocolId);
  }

  /** Resolve the agicash id (+ mint URL) for a protocol id, or undefined if not tracked. */
  getByProtocolId(protocolId: string): TrackedEntry | undefined {
    return this.byProtocolId.get(protocolId);
  }

  /** Whether an agicash quote/swap is currently being driven. */
  hasAgicashId(agicashId: string): boolean {
    return this.protocolIdByAgicashId.has(agicashId);
  }

  /**
   * Stop tracking a quote/swap by its agicash id (called when it reaches a terminal state).
   * No-op if not tracked.
   */
  untrackByAgicashId(agicashId: string): void {
    const protocolId = this.protocolIdByAgicashId.get(agicashId);
    if (protocolId !== undefined) {
      this.byProtocolId.delete(protocolId);
      this.protocolIdByAgicashId.delete(agicashId);
    }
  }

  /** Drop everything (called on `Sdk.destroy()`). */
  clear(): void {
    this.byProtocolId.clear();
    this.protocolIdByAgicashId.clear();
  }
}
