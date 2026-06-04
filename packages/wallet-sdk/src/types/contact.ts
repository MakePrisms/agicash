// Contact types — master verbatim (app/features/contacts/)

export type Contact = {
  id: string;
  createdAt: string; // ISO string (master z.string(), verbatim)
  ownerId: string;
  username: string;
  /**
   * Materialized by the repository as `${username}@${domain}` at parse time.
   * The DB row stores only `username`; `domain` comes from SdkConfig.domain.
   */
  lud16: string;
};
