#!/usr/bin/env node
/**
 * Vercel post-build: copies apps/web/.vercel/react-router-build-result.json to
 * the project root .vercel/ directory, rewriting server bundle paths to be
 * relative to the project root (prepending "apps/web/" where needed).
 *
 * Required because react-router build (run inside apps/web/) writes paths
 * relative to apps/web/, but Vercel's deployer reads the file from project root
 * and resolves paths relative to outputDirectory ("apps/web/build").
 * The server bundle "file" paths need the apps/web/build/ prefix so Vercel
 * can locate them from root.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = join('apps/web', '.vercel', 'react-router-build-result.json');
const dest = join('.vercel', 'react-router-build-result.json');

if (!existsSync(src)) {
  console.log(`${src} not found — skipping (not a Vercel build)`);
  process.exit(0);
}

const raw = readFileSync(src, 'utf8');
const data = JSON.parse(raw);

// Rewrite all "file" paths in serverBundles: "build/server/..." → "apps/web/build/server/..."
if (data.buildManifest?.serverBundles) {
  for (const bundle of Object.values(data.buildManifest.serverBundles)) {
    if (bundle.file?.startsWith('build/')) {
      bundle.file = `apps/web/${bundle.file}`;
    }
  }
}

mkdirSync('.vercel', { recursive: true });
writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Copied and patched ${src} → ${dest}`);
