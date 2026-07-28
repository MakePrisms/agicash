import type { AuthUser } from '.';
import { DisposedError, SessionEndedError } from '../../lib/error';
import type { Account } from '../accounts/account';
import type { User } from '../user/user';

type UserProvisionerDeps = {
  /** Provisions the settled identity; returns the user and their accounts. */
  provision: () => Promise<{ user: User; accounts: Account[] }>;
  /** Emits the `auth.session-started` payload to the host. */
  emit: (payload: { user: User; accounts: Account[] }) => void;
};

/**
 * Provisions the settled user once per identity and emits `auth.session-started`.
 * Fingerprint-guarded in memory (userId + email + emailVerified) so it fires only
 * when the identity changes; a terminal provision failure propagates to the caller
 * (so the host surfaces its error boundary), while a session-lifecycle abort is
 * swallowed (moot for a session that is ending or gone). `reset` clears the guard
 * on session end so a same-user re-login after a sign-out — which cleared the host
 * caches — re-provisions and re-emits rather than being skipped as unchanged.
 */
export const createUserProvisioner = (
  deps: UserProvisionerDeps,
): {
  provision: (authUser: AuthUser) => Promise<void>;
  reset: () => void;
} => {
  let lastProvisionedFingerprint: string | undefined;
  return {
    provision: async (authUser: AuthUser): Promise<void> => {
      const fingerprint = `${authUser.id} ${authUser.email ?? ''} ${authUser.email_verified}`;
      if (fingerprint === lastProvisionedFingerprint) {
        return;
      }
      try {
        const { user, accounts } = await deps.provision();
        lastProvisionedFingerprint = fingerprint;
        deps.emit({ user, accounts });
      } catch (error) {
        if (
          error instanceof SessionEndedError ||
          error instanceof DisposedError
        ) {
          return;
        }
        throw error;
      }
    },
    reset: (): void => {
      lastProvisionedFingerprint = undefined;
    },
  };
};
