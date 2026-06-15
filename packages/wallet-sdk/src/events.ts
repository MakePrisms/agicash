import type { Money } from '@agicash/money';
import type { SdkError } from './errors';
import type { User } from './domains/user-types';

export type BackgroundState =
  | 'stopped'
  | 'starting'
  | 'follower'
  | 'leader'
  | 'stopping';

/** Core events present in BOTH variants. Lifecycle events fire once, on a
 * terminal transition, on every instance. (Lifecycle + connection + background
 * emission is implemented in later plans; auth:* is implemented here.) */
export type SdkCoreEventMap = {
  'send:completed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId: string;
    amount: Money;
  };
  'send:failed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId?: string;
    error: SdkError;
  };
  'receive:completed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId: string;
    amount: Money;
  };
  'receive:failed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    error: SdkError;
  };
  'receive:expired': { protocol: 'cashu' | 'spark'; quoteId: string };
  'auth:signed-in': { user: User };
  'auth:signed-out': Record<string, never>;
  'auth:session-expired': Record<string, never>;
  'connection:state': { state: 'connected' | 'disconnected' };
  'background:state': { state: BackgroundState };
};
