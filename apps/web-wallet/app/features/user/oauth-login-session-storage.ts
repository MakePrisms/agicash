import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

const oauthLoginSessionStorageKeyPrefix = 'oauthLoginSession_';

type OauthLoginSession = {
  search: string;
  hash: string;
  createdAt: string;
};

const storageKey = (state: string) =>
  `${oauthLoginSessionStorageKeyPrefix}_${bytesToHex(sha256(new TextEncoder().encode(state)))}`;

export const oauthLoginSessionStorage = {
  get: (state: string): OauthLoginSession | null => {
    const session = sessionStorage.getItem(storageKey(state));
    return session ? (JSON.parse(session) as OauthLoginSession) : null;
  },
  create: (
    state: string,
    location: Omit<OauthLoginSession, 'createdAt'>,
  ): OauthLoginSession => {
    const sessionToStore = {
      ...location,
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem(storageKey(state), JSON.stringify(sessionToStore));
    return sessionToStore;
  },
  remove: (state: string) => {
    sessionStorage.removeItem(storageKey(state));
  },
};
