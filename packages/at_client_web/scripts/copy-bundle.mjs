// Copies the dart2js bundle into dist/dart/, where the loader finds it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceMapComment, verifiedBundleSource } from './bridge-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'dist/dart/at_client.js');

try {
  const source = verifiedBundleSource({ root, env: process.env, exists: existsSync });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stripSourceMapComment(readFileSync(source, 'utf8')));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
