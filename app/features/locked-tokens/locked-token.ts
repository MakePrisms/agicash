import type { Token } from '@cashu/cashu-ts';

export type LockedToken = {
  /** Hash of the locked token that is used as the primary key */
  tokenHash: string;
  /** The locked token */
  token: Token;
  /** Date and time the token was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the token was updated in ISO 8601 format. */
  updatedAt: string;
};
