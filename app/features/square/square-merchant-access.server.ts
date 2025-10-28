import { agicashDbMints } from '~/features/agicash-db/database.server';
import { generateRandomPassword } from '../../lib/password-generator';
import { SquareMerchantRepository } from './square-merchant-repository.server';

/**
 * Creates remote database access for a merchant.
 * Idempotent: if remote access already exists, returns null without error.
 * On first call, creates role and access mapping, then returns credentials.
 * On subsequent calls, returns null (credentials already exist in logs).
 */
export async function createMerchantRemoteAccess(merchantId: string): Promise<{
  roleName: string;
  password: string;
  merchantId: string;
  connectionString: string;
} | null> {
  const postgresHost = process.env.POSTGRES_HOST ?? '';
  if (!postgresHost) {
    throw new Error('Missing environment variables for square merchant access');
  }

  const repository = new SquareMerchantRepository(agicashDbMints);
  const roleName = SquareMerchantRepository.generateRoleName(merchantId);

  const remoteAccessExists =
    await repository.checkRemoteAccessExists(merchantId);
  if (remoteAccessExists) {
    return null;
  }

  const password = await generateRandomPassword(32, {
    letters: true,
    numbers: false,
    special: false,
  });

  const roleExists = await repository.checkRoleExists(roleName);

  let isNewRole = false;

  if (!roleExists) {
    try {
      await repository.createMerchantRole(roleName, password);
      isNewRole = true;
    } catch (error) {
      throw new Error(
        `Failed to create role: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  try {
    await repository.upsertRemoteAccessMapping(roleName, merchantId);
  } catch (error) {
    // Rollback: drop the role if we just created it
    if (isNewRole) {
      await repository.dropMerchantRole(roleName);
    }
    throw new Error(
      `Failed to create access mapping: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  const sslMode =
    postgresHost.includes('localhost') || postgresHost.includes('127.0.0.1')
      ? 'disable'
      : 'require';
  const connectionString = `postgresql://${roleName}:${password}@${postgresHost}/postgres?sslmode=${sslMode}`;

  const credentials = {
    roleName,
    password,
    merchantId,
    connectionString,
  };

  await repository.logRemoteAccessCredentials(credentials);

  return credentials;
}
