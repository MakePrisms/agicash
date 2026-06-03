/**
 * SDK error classes — §12 of the contract.
 *
 * `SdkError` (base + `readonly code`) is NET-NEW (master's errors have no shared
 * base / no `code`). `ConcurrencyError` / `DomainError` / `NotFoundError` are
 * re-parented onto `SdkError` (master forms live in `app/features/shared/error.ts`).
 * PR1 ships the class SHAPES only — empty bodies, no logic.
 */

export class SdkError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** transient/stale; caller (or orchestrator) refetches + retries. */
export class ConcurrencyError extends SdkError {}

/** user-facing message; never retry. */
export class DomainError extends SdkError {}

/** entity not found. */
export class NotFoundError extends SdkError {}
