// Verifies the package bundle. With --publish-guard it checks only what exists
// before a build (bridge.ref and .bridge/); otherwise it checks the built dist/.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishGuard, verifyDist } from './bridge-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  if (process.argv.includes('--publish-guard')) {
    publishGuard({ root, env: process.env, exists: existsSync });
    console.log('publish guard passed');
  } else {
    verifyDist({ root, env: process.env, exists: existsSync });
    console.log('dist verified');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
