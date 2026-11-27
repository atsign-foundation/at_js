// Mints the virtual environment's demo `.atKeys` (`@alice🛠 @bob🛠 @colin🛠
// @eve🛠`, public fixtures from at_demo_data) into a keys directory.
//
// The SDK's tests/at_end2end_test/test/local_setup.dart wipes and writes a
// cwd-relative atKeys/ and config/, so it runs from a throwaway copy of that
// directory, never from the SDK tree. The copy drops `resolution: workspace`
// (and any pubspec_overrides.yaml) so its dependencies resolve from pub.dev.
// No key text is ever printed.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VE_ATSIGNS = ['@alice🛠', '@bob🛠', '@colin🛠', '@eve🛠'];

const SKIPPED = new Set(['.dart_tool', 'atKeys', 'config', 'pubspec_overrides.yaml']);

/** The default keys directory: `AT_VE_KEYS_DIR`, else `$TMPDIR/ve-keys`. */
export function defaultKeysDir() {
  return resolve(process.env.AT_VE_KEYS_DIR ?? join(tmpdir(), 've-keys'));
}

/** The keys file name the mint writes for [atSign]. */
export function keysFileName(atSign) {
  return `${atSign}_key.atKeys`;
}

/**
 * Which of the four demo keys files in [keysDir] are missing or do not parse
 * as a JSON object; empty when all four are usable.
 */
export function unusableKeys(keysDir) {
  return VE_ATSIGNS.filter((atSign) => {
    const file = join(keysDir, keysFileName(atSign));
    if (!existsSync(file)) return true;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed);
    } catch {
      return true;
    }
  });
}

/**
 * Mints the four keys files into [keysDir], unless they are already there and
 * parse (pass `force` to mint anyway). Returns what it did.
 */
export function mintKeys({
  keysDir = defaultKeysDir(),
  sdkTestDir = process.env.AT_VE_SDK_TEST_DIR,
  mintDir = join(tmpdir(), 've-mint'),
  dart = process.env.AT_VE_DART ?? 'dart',
  force = false,
} = {}) {
  if (!force && unusableKeys(keysDir).length === 0) return { minted: false, keysDir };
  if (sdkTestDir === undefined || sdkTestDir === '') {
    throw new Error("AT_VE_SDK_TEST_DIR is not set: point it at an at_client_sdk checkout's tests/at_end2end_test");
  }
  sdkTestDir = resolve(sdkTestDir);

  rmSync(mintDir, { recursive: true, force: true });
  cpSync(sdkTestDir, mintDir, {
    recursive: true,
    filter: (source) => !SKIPPED.has(source.slice(sdkTestDir.length + 1).split('/')[0]),
  });
  const pubspec = join(mintDir, 'pubspec.yaml');
  const lines = readFileSync(pubspec, 'utf8').split('\n');
  writeFileSync(pubspec, lines.filter((line) => line.trim() !== 'resolution: workspace').join('\n'));

  const run = (args) => execFileSync(dart, args, { cwd: mintDir, stdio: ['ignore', 'pipe', 'pipe'] });
  run(['pub', 'get']);
  run(['run', 'test/local_setup.dart']);

  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  for (const atSign of VE_ATSIGNS) {
    const name = keysFileName(atSign);
    cpSync(join(mintDir, 'atKeys', name), join(keysDir, name));
  }
  const missing = unusableKeys(keysDir);
  if (missing.length > 0) throw new Error(`mint left unusable keys for ${missing.join(', ')}`);
  return { minted: true, keysDir, files: readdirSync(keysDir).length };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = mintKeys({ force: process.argv.includes('--force') });
  console.log(result.minted ? `minted demo keys into ${result.keysDir}` : `demo keys already in ${result.keysDir}`);
}
