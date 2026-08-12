import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, ContactsApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { ContactRepository } from './contact-repository';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** lud16 domain the repository stamps onto contacts. */
  lightningAddressDomain: string;
  /** Test seam; defaults to building the repository from db + domain. */
  createRepository?: () => ContactRepository;
};

export function createContactsApi(deps: Deps): ContactsApi {
  const repository =
    deps.createRepository?.() ??
    new ContactRepository(deps.db, deps.lightningAddressDomain);

  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const requireLiveSignal = (): AbortSignal => {
    const signal = deps.keys.sessionSignal();
    if (signal.aborted) {
      throw new SessionEndedError();
    }
    return signal;
  };

  return {
    get: async (id) => {
      const signal = requireLiveSignal();
      const contact = await repository.get(id, { abortSignal: signal });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return contact;
    },
    list: async () => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const contacts = await repository.getAll(userId, {
        abortSignal: signal,
      });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return contacts;
    },
    create: async (params) => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const contact = await repository.create(
        { ownerId: userId, username: params.username },
        { abortSignal: signal },
      );
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return contact;
    },
    delete: async (id) => {
      const signal = requireLiveSignal();
      await repository.delete(id, { abortSignal: signal });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
    },
    findContactCandidates: async (query) => {
      const userId = requireUserId();
      const signal = requireLiveSignal();
      const candidates = await repository.findContactCandidates(query, userId, {
        abortSignal: signal,
      });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return candidates;
    },
  };
}
