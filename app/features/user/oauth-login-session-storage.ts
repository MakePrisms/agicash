const oauthLoginSessionStorageKeyPrefix = 'oauthLoginSession_';

type OauthLoginSession = {
  sessionId: string;
  search: string;
  hash: string;
  createdAt: string;
};

export const oauthLoginSessionStorage = {
  get: (sessionId: string): OauthLoginSession | null => {
    const session = sessionStorage.getItem(
      `${oauthLoginSessionStorageKeyPrefix}_${sessionId}`,
    );
    return session ? (JSON.parse(session) as OauthLoginSession) : null;
  },
  create: (
    session: Omit<OauthLoginSession, 'sessionId' | 'createdAt'>,
  ): OauthLoginSession => {
    const sessionId = crypto.randomUUID();
    const sessionToStore = {
      ...session,
      sessionId,
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem(
      `${oauthLoginSessionStorageKeyPrefix}_${sessionId}`,
      JSON.stringify(sessionToStore),
    );
    return sessionToStore;
  },
  remove: (sessionId: string) => {
    sessionStorage.removeItem(
      `${oauthLoginSessionStorageKeyPrefix}_${sessionId}`,
    );
  },
};
