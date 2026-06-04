/**
 * SDK error classes — §12 of the contract.
 *
 * `SdkError` (base + `readonly code`) is NET-NEW (master's errors have no shared
 * base / no `code`). `ConcurrencyError` / `DomainError` / `NotFoundError` are
 * re-parented onto `SdkError` (master forms live in `app/features/shared/error.ts`).
 * These are the REAL runtime classes (consumed by `classify()` + the domain stubs).
 */

/**
 * Base class for every error the SDK throws. Net-new in the SDK (master's errors
 * have no shared base / no `code`). Carries a machine-readable `code` alongside
 * the human `message`, and sets `name` to the concrete subclass name so
 * `instanceof` and logged names agree. Subclasses signal how the caller should
 * react (retry vs surface vs treat-as-missing); the `executeQuote` orchestrator
 * and web hooks both map a `classify()` verdict onto these subtypes.
 */
export class SdkError extends Error {
  /** Stable, machine-readable error code (e.g. a cashu/protocol code). */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Transient/stale state (e.g. an optimistic-lock conflict); the caller (or orchestrator) refetches + retries. */
export class ConcurrencyError extends SdkError {}

/** A definitive, user-facing failure; the message is safe to show and the caller must never retry. */
export class DomainError extends SdkError {}

/** The requested entity does not exist. */
export class NotFoundError extends SdkError {}

/**
 * A method that exists on the contract but whose implementation has not landed yet
 * (a later build slice fills it in). Thrown by the domain stubs the `Sdk` shell wires
 * in PR2 so calling an unimplemented method fails loudly + identifiably rather than
 * returning `undefined`. NOT a runtime error model the orchestrator recovers from.
 */
export class NotImplementedError extends SdkError {
  constructor(method: string) {
    super(
      `${method} is not implemented yet (wired by a later @agicash/wallet-sdk build slice)`,
      'NOT_IMPLEMENTED',
    );
  }
}
