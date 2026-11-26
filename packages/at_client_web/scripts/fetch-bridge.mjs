// Downloads the pinned bridge bundle, checks its sha256 against bridge.ref and
// its build attestation, and leaves it in .bridge/at_client_web.js.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_ASSET,
  BRIDGE_REPO,
  attestationArgs,
  parseBridgeRef,
  verifyDownload,
} from './bridge-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.bridge');
const file = resolve(outDir, BRIDGE_ASSET);

function gh(...args) {
  execFileSync('gh', args, { stdio: 'inherit' });
}

function download(tag) {
  rmSync(file, { force: true });
  mkdirSync(outDir, { recursive: true });
  gh('release', 'download', tag, '-R', BRIDGE_REPO, '-p', BRIDGE_ASSET, '-D', outDir);
}

function attest() {
  gh(...attestationArgs(file));
}

try {
  const ref = parseBridgeRef(readFileSync(resolve(root, 'bridge.ref'), 'utf8'));
  download(ref.tag);
  verifyDownload(file, ref.sha256);
  attest();
  console.error(`bridge ${ref.tag} verified: ${file}`);
} catch (error) {
  rmSync(file, { force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
