import { type Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts';
import type {
  AgicashDb,
  AgicashDbLockedToken,
} from '~/features/agicash-db/database';
import { agicashDb, anonAgicashDb } from '~/features/agicash-db/database';
import { computeSHA256 } from '~/lib/sha256';
import type { LockedToken } from './locked-token';

type CreateLockedTokenParams = {
  /** The unique hash identifier for the token */
  tokenHash: string;
  /** The locked token to store */
  token: Token;
  /** Optional access code to protect the token. If not provided, token will be public */
  accessCode?: string;
  /** The user ID who owns this token */
  userId: string;
};

export class LockedTokenRepository {
  constructor(private readonly db: AgicashDb) {}

  /**
   * Creates a new locked token in the database.
   * This method is idempotent - if a token with the same hash already exists, it will return the existing one.
   * @returns The created or existing locked token.
   */
  async createLockedToken({
    tokenHash,
    token,
    accessCode,
    userId,
  }: CreateLockedTokenParams): Promise<LockedToken> {
    const existing = await this.getExistingTokenByHash(tokenHash);
    if (existing) {
      return existing;
    }

    const accessCodeHash = accessCode ? await computeSHA256(accessCode) : null;

    const query = this.db
      .from('locked_tokens')
      .insert({
        token_hash: tokenHash,
        token: getEncodedToken(token),
        access_code_hash: accessCodeHash,
        user_id: userId,
      })
      .select()
      .single();

    const { data, error } = await query;

    if (error) {
      console.error('Failed to create locked token', {
        cause: error,
        tokenHash,
        userId,
      });
      throw new Error('Failed to create locked token', { cause: error });
    }

    if (!data) {
      throw new Error('No data returned from create locked token');
    }

    return this.toLockedToken(data);
  }

  /**
   * Private method to check if a token exists by hash.
   * This bypasses access code verification and is only used internally.
   * This method can only be called by the user that owns the token.
   */
  private async getExistingTokenByHash(
    tokenHash: string,
  ): Promise<LockedToken | null> {
    const { data, error } = await this.db
      .from('locked_tokens')
      .select()
      .eq('token_hash', tokenHash)
      .single();

    if (error || !data) {
      return null;
    }

    return this.toLockedToken(data);
  }

  async toLockedToken(data: AgicashDbLockedToken): Promise<LockedToken> {
    return {
      tokenHash: data.token_hash,
      token: getDecodedToken(data.token),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

/**
 * Repository for getting locked tokens that can be accessed by anyone.
 */
export class AnonLockedTokenRepository {
  constructor(private readonly db: AgicashDb) {}

  /**
   * Retrieves a locked token by hash and optional access code.
   * @returns The locked token data if access code is correct or token is public.
   */
  async getLockedToken({
    tokenHash,
    accessCode,
  }: {
    /** The hash of the token to retrieve */
    tokenHash: string;
    /** Optional access code to verify access. Not needed for public tokens. */
    accessCode?: string;
  }): Promise<LockedToken | null> {
    const accessCodeHash = accessCode ? await computeSHA256(accessCode) : null;

    const { data, error } = await this.db.rpc('get_locked_token', {
      p_token_hash: tokenHash,
      p_access_code_hash: accessCodeHash ?? undefined,
    });

    if (error) {
      throw new Error('Failed to get locked token', { cause: error });
    }

    console.log('getLockedToken data', data);

    // TODO: make this return null instead of null values on each column
    if (!data || !data.token_hash) {
      return null;
    }

    return {
      tokenHash: data.token_hash,
      token: getDecodedToken(data.token),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export function useLockedTokenRepository() {
  return new LockedTokenRepository(agicashDb);
}

export function useAnonLockedTokenRepository() {
  return new AnonLockedTokenRepository(anonAgicashDb);
}
