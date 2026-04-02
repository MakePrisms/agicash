import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReleaseEnvironment } from './runtime-config';

type SourcePackageJson = {
  name: string;
  version: string;
  description?: string;
};

type ReleasePackageJson = {
  name: string;
  version: string;
  description?: string;
  type: 'module';
  bin: { agicash: './bin/agicash' };
  files: string[];
  publishConfig: { access: 'public' };
  repository: {
    type: 'git';
    url: string;
    directory: string;
  };
  bugs: { url: string };
  homepage: string;
  keywords: string[];
  engines: { bun: string };
};

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(packageDir, 'dist', 'npm');
const releaseBinPath = join(distDir, 'bin', 'agicash');

const requiredReleaseEnvVars = [
  'AGICASH_RELEASE_OPENSECRET_CLIENT_ID',
  'AGICASH_RELEASE_OPENSECRET_API_URL',
  'AGICASH_RELEASE_SUPABASE_URL',
  'AGICASH_RELEASE_SUPABASE_ANON_KEY',
] as const;

function assertReleaseEnv(): void {
  const missing = requiredReleaseEnvVars.filter((key) => {
    const value = process.env[key];
    return value == null || value.trim().length === 0;
  });

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Missing release env vars: ${missing.join(', ')}.\nThese are public client-side values that will be baked into the published CLI package.`,
  );
}

function readSourcePackage(): SourcePackageJson {
  return JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  ) as SourcePackageJson;
}

function buildReleaseBundle(): void {
  const result = spawnSync(
    process.execPath,
    [
      'build',
      join(packageDir, 'src', 'main.ts'),
      '--target=bun',
      '--outfile',
      releaseBinPath,
      '--env',
      'AGICASH_RELEASE_*',
      '--minify',
    ],
    {
      cwd: packageDir,
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function normalizeReleaseBundle(): void {
  const source = readFileSync(releaseBinPath, 'utf8');
  const lines = source.split('\n');
  const normalizedLines = [
    '#!/usr/bin/env bun',
    ...lines.filter(
      (line, index) => line !== '#!/usr/bin/env bun' || index === 0,
    ),
  ];

  if (normalizedLines[1] === '#!/usr/bin/env bun') {
    normalizedLines.splice(1, 1);
  }

  writeFileSync(releaseBinPath, normalizedLines.join('\n'));
}

function writeReleasePackage(sourcePackage: SourcePackageJson): void {
  const releasePackage: ReleasePackageJson = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    description: sourcePackage.description,
    type: 'module',
    bin: { agicash: './bin/agicash' },
    files: ['bin', 'README.md', '.env.example'],
    publishConfig: { access: 'public' },
    repository: {
      type: 'git',
      url: 'git+https://github.com/MakePrisms/agicash.git',
      directory: 'packages/cli',
    },
    bugs: {
      url: 'https://github.com/MakePrisms/agicash/issues',
    },
    homepage: 'https://github.com/MakePrisms/agicash/tree/master/packages/cli',
    keywords: ['agicash', 'bitcoin', 'cashu', 'lightning', 'wallet', 'cli'],
    engines: {
      bun: '>=1.3.8',
    },
  };

  writeFileSync(
    join(distDir, 'package.json'),
    `${JSON.stringify(releasePackage, null, 2)}\n`,
  );
}

function main(): void {
  assertReleaseEnv();

  const sourcePackage = readSourcePackage();

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(join(distDir, 'bin'), { recursive: true });

  buildReleaseBundle();
  normalizeReleaseBundle();
  chmodSync(releaseBinPath, 0o755);

  copyFileSync(join(packageDir, 'README.md'), join(distDir, 'README.md'));
  copyFileSync(join(packageDir, '.env.example'), join(distDir, '.env.example'));

  writeReleasePackage(sourcePackage);

  console.log(`Release package written to ${distDir}`);
  console.log(`Release environment: ${getReleaseEnvironment()}`);
}

main();
