// Copies the dart2js bundle into dist/dart/, where the loader finds it.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBridgeRef, resolveBundleSource, verifyDownload } from './bridge-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'dist/dart/at_client.js');

try {
  const source = resolveBundleSource({ root, env: process.env, exists: existsSync });
  if (!process.env.AT_CLIENT_WEB_BUNDLE) {
    const ref = parseBridgeRef(readFileSync(resolve(root, 'bridge.ref'), 'utf8'));
    verifyDownload(source, ref.sha256);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
