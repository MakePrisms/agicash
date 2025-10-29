import type { AgicashMintsDb } from '../agicash-db/database.server';

type MerchantRoleResult = {
  success: boolean;
  message?: string;
};

type RemoteAccessCredentials = {
  roleName: string;
  password: string;
  merchantId: string;
  connectionString: string;
};

type Options = {
  abortSignal?: AbortSignal;
};

export type MerchantCredentials = {
  merchantId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

/**
 * Repository for Square merchant database operations.
 * Handles merchant credentials, remote access, and role management.
 */
export class SquareMerchantRepository {
  constructor(private readonly db: AgicashMintsDb) {}

  /**
   * Checks if remote access already exists for a merchant.
   */
  async checkRemoteAccessExists(
    merchantId: string,
    options?: Options,
  ): Promise<boolean> {
    const query = this.db
      .from('square_remote_app_access')
      .select('merchant_id')
      .eq('merchant_id', merchantId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to check remote access', { cause: error });
    }

    return data !== null;
  }

  async checkRoleExists(roleName: string, options?: Options): Promise<boolean> {
    const query = this.db.rpc('check_role_exists', {
      p_role_name: roleName,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to check role exists', { cause: error });
    }

    return data ?? false;
  }

  async createMerchantRole(
    roleName: string,
    password: string,
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('create_merchant_role', {
      p_role_name: roleName,
      p_password: password,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create merchant role', { cause: error });
    }

    const result = data as MerchantRoleResult | null;
    if (!result?.success) {
      throw new Error(
        `Failed to create role: ${result?.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Drops a database role for a merchant.
   */
  async dropMerchantRole(roleName: string, options?: Options): Promise<void> {
    const query = this.db.rpc('drop_merchant_role', {
      p_role_name: roleName,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to drop merchant role', { cause: error });
    }
  }

  /**
   * Creates or updates the remote access mapping for a merchant.
   */
  async upsertRemoteAccessMapping(
    roleName: string,
    merchantId: string,
    options?: Options,
  ): Promise<void> {
    const query = this.db
      .from('square_remote_app_access')
      .upsert(
        {
          role_name: roleName,
          merchant_id: merchantId,
        },
        {
          onConflict: 'role_name',
        },
      )
      .select();

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query.single();

    if (error) {
      throw new Error('Failed to upsert access mapping', { cause: error });
    }
  }

  /**
   * Creates or updates merchant OAuth credentials.
   */
  async upsertMerchantCredentials(
    credentials: {
      merchantId: string;
      email: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: string;
    },
    options?: Options,
  ): Promise<void> {
    const query = this.db.from('square_merchant_credentials').upsert(
      {
        merchant_id: credentials.merchantId,
        email: credentials.email,
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expires_at: credentials.expiresAt,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'merchant_id',
      },
    );

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to upsert merchant credentials', {
        cause: error,
      });
    }
  }

  /**
   * Logs remote access credentials for admin reference.
   * Stores the connection string in an admin-only accessible table.
   */
  async logRemoteAccessCredentials(
    credentials: RemoteAccessCredentials,
    options?: Options,
  ): Promise<void> {
    const query = this.db.from('merchant_remote_access_log').insert({
      merchant_id: credentials.merchantId,
      role_name: credentials.roleName,
      connection_string: credentials.connectionString,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to log remote access credentials', {
        cause: error,
      });
    }
  }

  /**
   * Fetches all merchant credentials.
   * Requires service_role permissions.
   */
  async getAllMerchantCredentials(
    options?: Options,
  ): Promise<MerchantCredentials[]> {
    const query = this.db
      .from('square_merchant_credentials')
      .select('merchant_id, email, access_token, refresh_token, expires_at');

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch merchant credentials', { cause: error });
    }

    return (data || []).map((row) => ({
      merchantId: row.merchant_id,
      email: row.email,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
    }));
  }

  /**
   * Generates a sanitized role name from a merchant ID.
   */
  static generateRoleName(merchantId: string): string {
    const sanitized = merchantId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `square_remote_${sanitized}`;
  }
}
