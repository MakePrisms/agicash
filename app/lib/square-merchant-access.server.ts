import { agicashDbMints } from '~/features/agicash-db/database.server';
import { generateRandomPassword } from './password-generator';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

type MerchantRoleResult = {
  success: boolean;
  message?: string;
};

function generateRoleName(merchantId: string): string {
  const sanitized = merchantId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `square_remote_${sanitized}`;
}

export type RemoteAccessCredentials = {
  roleName: string;
  password: string;
  merchantId: string;
  connectionString: string;
  host: string;
  port: number;
  database: string;
};

export async function createMerchantRemoteAccess(
  merchantId: string,
): Promise<RemoteAccessCredentials> {
  const roleName = generateRoleName(merchantId);
  const password = await generateRandomPassword(32, {
    letters: true,
    numbers: false,
    special: false,
  });

  const { data: roleExists } = await agicashDbMints.rpc('check_role_exists', {
    p_role_name: roleName,
  });

  let isNewRole = false;

  if (!roleExists) {
    const { data: createResult, error: createError } = await agicashDbMints.rpc(
      'create_merchant_role',
      {
        p_role_name: roleName,
        p_password: await password,
      },
    );

    if (createError) {
      throw new Error(`Failed to create role: ${createError.message}`);
    }

    const result = createResult as MerchantRoleResult | null;
    if (!result?.success) {
      throw new Error(
        `Failed to create role: ${result?.message || 'Unknown error'}`,
      );
    }

    isNewRole = true;
  }

  const { error: mappingError } = await agicashDbMints
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
    .select()
    .single();

  if (mappingError) {
    // Rollback: drop the role if we just created it
    if (isNewRole) {
      await agicashDbMints.rpc('drop_merchant_role', {
        p_role_name: roleName,
      });
    }
    throw new Error(`Failed to create access mapping: ${mappingError.message}`);
  }

  const url = new URL(supabaseUrl as string);
  const isLocal =
    url.hostname.includes('localhost') || url.hostname.includes('127.0.0.1');

  const dbHost = isLocal ? '127.0.0.1' : url.hostname.replace(/^[^.]+/, 'db');
  const port = isLocal ? 54322 : 5432;
  const sslMode = isLocal ? 'disable' : 'require';

  const encodedPassword = encodeURIComponent(password);
  const connectionString = `postgresql://${roleName}:${encodedPassword}@${dbHost}:${port}/postgres?sslmode=${sslMode}`;

  // Store connection string in admin-only accessible table
  const { error: logError } = await agicashDbMints
    .from('merchant_remote_access_log')
    .insert({
      merchant_id: merchantId,
      role_name: roleName,
      connection_string: connectionString,
      host: dbHost,
      port,
      database: 'postgres',
    });

  if (logError) {
    throw new Error(
      `Failed to log remote access credentials: ${logError.message}`,
    );
  }

  return {
    roleName,
    password,
    merchantId,
    connectionString,
    host: dbHost,
    port,
    database: 'postgres',
  };
}
