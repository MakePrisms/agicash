import { DomainError } from '../../errors';
import type { SdkCoreEventMap } from '../../events';
import type { ChangeFeedChange } from './change-feed-router';

export type LifecycleEmit =
  | { type: 'send:completed'; payload: SdkCoreEventMap['send:completed'] }
  | { type: 'send:failed'; payload: SdkCoreEventMap['send:failed'] }
  | { type: 'receive:completed'; payload: SdkCoreEventMap['receive:completed'] }
  | { type: 'receive:failed'; payload: SdkCoreEventMap['receive:failed'] }
  | { type: 'receive:expired'; payload: SdkCoreEventMap['receive:expired'] };

/** Derives the at-most-one core lifecycle event for a converted quote/swap change,
 *  on a TERMINAL transition only, fire-once. Mutates `emittedTerminalIds`: adds the
 *  entity's dedup key when it emits; returns undefined if not terminal or already emitted.
 *  Pure w.r.t. I/O. */
export function deriveLifecycleEvent(
  change: ChangeFeedChange,
  emittedTerminalIds: Set<string>,
): LifecycleEmit | undefined {
  switch (change.kind) {
    case 'cashu-send-quote': {
      const entity = change.entity;
      const dedupKey = `cashu-send-quote:${entity.id}`;

      switch (entity.state) {
        case 'PAID': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:completed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              amount: entity.amountReceived,
            },
          };
        }
        case 'EXPIRED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              error: new DomainError('Send quote expired'),
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        default:
          // UNPAID, PENDING — non-terminal
          return undefined;
      }
    }

    case 'cashu-send-swap': {
      const entity = change.entity;
      const dedupKey = `cashu-send-swap:${entity.id}`;

      switch (entity.state) {
        case 'COMPLETED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:completed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              amount: entity.amountReceived,
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        case 'REVERSED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              error: new DomainError('Send swap reversed'),
            },
          };
        }
        default:
          // DRAFT, PENDING — non-terminal
          return undefined;
      }
    }

    case 'cashu-receive-quote': {
      const entity = change.entity;
      const dedupKey = `cashu-receive-quote:${entity.id}`;

      switch (entity.state) {
        case 'COMPLETED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:completed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              amount: entity.amount,
            },
          };
        }
        case 'EXPIRED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:expired',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.id,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        default:
          // UNPAID, PAID — PAID is non-terminal (COMPLETED fires later)
          return undefined;
      }
    }

    case 'cashu-receive-swap': {
      const entity = change.entity;
      // cashu-receive-swap has no `id`; tokenHash is the dedup identifier
      const dedupKey = `cashu-receive-swap:${entity.tokenHash}`;

      switch (entity.state) {
        case 'COMPLETED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:completed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.tokenHash,
              transactionId: entity.transactionId,
              amount: entity.amountReceived,
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:failed',
            payload: {
              protocol: 'cashu',
              quoteId: entity.tokenHash,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        default:
          // PENDING — non-terminal
          return undefined;
      }
    }

    case 'spark-send-quote': {
      const entity = change.entity;
      const dedupKey = `spark-send-quote:${entity.id}`;

      switch (entity.state) {
        case 'COMPLETED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:completed',
            payload: {
              protocol: 'spark',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              amount: entity.amount,
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'send:failed',
            payload: {
              protocol: 'spark',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        default:
          // UNPAID, PENDING — non-terminal
          return undefined;
      }
    }

    case 'spark-receive-quote': {
      const entity = change.entity;
      const dedupKey = `spark-receive-quote:${entity.id}`;

      switch (entity.state) {
        case 'PAID': {
          // For spark-receive-quote, PAID IS terminal (unlike cashu-receive-quote)
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:completed',
            payload: {
              protocol: 'spark',
              quoteId: entity.id,
              transactionId: entity.transactionId,
              amount: entity.amount,
            },
          };
        }
        case 'EXPIRED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:expired',
            payload: {
              protocol: 'spark',
              quoteId: entity.id,
            },
          };
        }
        case 'FAILED': {
          if (emittedTerminalIds.has(dedupKey)) return undefined;
          emittedTerminalIds.add(dedupKey);
          return {
            type: 'receive:failed',
            payload: {
              protocol: 'spark',
              quoteId: entity.id,
              error: new DomainError(entity.failureReason),
            },
          };
        }
        default:
          // UNPAID — non-terminal
          return undefined;
      }
    }

    default:
      // All other change kinds (user, account, transaction, contact, contact-deleted)
      // do not produce lifecycle events
      return undefined;
  }
}
