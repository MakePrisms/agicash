import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type EnvMap = Record<string, string | undefined>;

export type ReleaseEnvironment =
  | 'local'
  | 'production'
  | 'alpha'
  | 'next'
  | 'preview';

export type OpenSecretConfig = {
  clientId: string;
  apiUrl: string;
};

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export const CONFIG_LOCATION_HINT =
  '~/.agicash/.env, ./.env, or the shell environment';

const releaseEnvironments = new Set<ReleaseEnvironment>([
  'local',
  'production',
  'alpha',
  'next',
  'preview',
]);

function getEnvValue(env: EnvMap, key: string): string | undefined {
  const value = env[key];
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadEnvFile(
  envPath: string,
  env: EnvMap,
  shellDefinedKeys: ReadonlySet<string>,
): void {
  if (!existsSync(envPath)) {
    return;
  }

  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^"(.*)"$|^'(.*)'$/, '$1$2');

    if (shellDefinedKeys.has(key)) {
      continue;
    }

    env[key] = value;
  }
}

export function getCliEnvPaths(cwd: string = process.cwd()): string[] {
  return [join(homedir(), '.agicash', '.env'), join(cwd, '.env')];
}

export function loadCliEnvFiles(
  env: EnvMap = process.env as EnvMap,
  cwd: string = process.cwd(),
): void {
  const shellDefinedKeys = new Set(
    Object.entries(env)
      .filter(([, value]) => value != null)
      .map(([key]) => key),
  );

  for (const envPath of getCliEnvPaths(cwd)) {
    loadEnvFile(envPath, env, shellDefinedKeys);
  }
}

export function getOpenSecretConfig(
  env: EnvMap = process.env as EnvMap,
): OpenSecretConfig {
  return {
    clientId:
      getEnvValue(env, 'OPENSECRET_CLIENT_ID') ??
      getEnvValue(env, 'AGICASH_RELEASE_OPENSECRET_CLIENT_ID') ??
      '',
    apiUrl:
      getEnvValue(env, 'OPENSECRET_API_URL') ??
      getEnvValue(env, 'AGICASH_RELEASE_OPENSECRET_API_URL') ??
      'https://api.opensecret.cloud',
  };
}

export function getSupabaseConfig(
  env: EnvMap = process.env as EnvMap,
): SupabaseConfig {
  return {
    url:
      getEnvValue(env, 'SUPABASE_URL') ??
      getEnvValue(env, 'AGICASH_RELEASE_SUPABASE_URL') ??
      '',
    anonKey:
      getEnvValue(env, 'SUPABASE_ANON_KEY') ??
      getEnvValue(env, 'AGICASH_RELEASE_SUPABASE_ANON_KEY') ??
      '',
  };
}

export function getReleaseEnvironment(
  env: EnvMap = process.env as EnvMap,
): ReleaseEnvironment {
  const configuredEnvironment = getEnvValue(env, 'AGICASH_RELEASE_ENVIRONMENT');

  if (
    configuredEnvironment &&
    releaseEnvironments.has(configuredEnvironment as ReleaseEnvironment)
  ) {
    return configuredEnvironment as ReleaseEnvironment;
  }

  return 'production';
}
