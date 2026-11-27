// Downloads the pinned bridge bundle, checks its sha256 against bridge.ref and
// its build attestation, and leaves it in .bridge/at_client_web.js. It also
// downloads the release's bridge-manifest.json, attests it, and refuses it
// unless it is byte-equal to the committed copy.
//
// The body is fetchBridge({ run, root }) so tests can drive it offline with an
// injected runner; the CLI below runs only when this file is the entry point.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BRIDGE_ASSET,
  BRIDGE_MANIFEST,
  BRIDGE_REPO,
  assertManifestMatches,
  attestationArgs,
  checkGh,
  parseBridgeRef,
  verifyDownload,
} from './bridge-lib.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function isProbe(args) {
  return args[0] === '--version' || (args[0] === 'attestation' && args[1] === 'verify' && args[2] === '--help');
}

/**
 * The default runner: the capability probes capture their output, while the
 * download and the attestation check inherit stdio so gh can report progress.
 */
function defaultRun(command, args) {
  if (isProbe(args)) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return { status: result.status, stdout: '', stderr: '' };
}

function requireGhSuccess(args, result) {
  if (result === null || typeof result !== 'object' || result.status !== 0) {
    const status = result?.status;
    throw new Error(`gh ${args.join(' ')} failed${status === null || status === undefined ? '' : ` with status ${status}`}`);
  }
}

/**
 * Checks that gh can attest, downloads the release pinned in `root`/bridge.ref,
 * verifies the bundle's sha256 and its attestation, then attests the release's
 * manifest and requires it to be byte-equal to the committed copy. Returns the
 * bundle's path. A failure anywhere deletes the partial bundle and the
 * downloaded manifest before it is rethrown.
 */
export function fetchBridge({ run, root }) {
  const outDir = resolve(root, '.bridge');
  const file = resolve(outDir, BRIDGE_ASSET);
  let manifestDir;
  try {
    checkGh(run);
    const ref = parseBridgeRef(readFileSync(resolve(root, 'bridge.ref'), 'utf8'));
    rmSync(file, { force: true });
    mkdirSync(outDir, { recursive: true });
    const download = ['release', 'download', ref.tag, '-R', BRIDGE_REPO, '-p', BRIDGE_ASSET, '-D', outDir];
    requireGhSuccess(download, run('gh', download));
    verifyDownload(file, ref.sha256);
    const attest = attestationArgs(file);
    requireGhSuccess(attest, run('gh', attest));
    manifestDir = mkdtempSync(join(tmpdir(), 'bridge-manifest-'));
    const manifestDownload = [
      'release',
      'download',
      ref.tag,
      '-R',
      BRIDGE_REPO,
      '-p',
      BRIDGE_MANIFEST,
      '-D',
      manifestDir,
    ];
    requireGhSuccess(manifestDownload, run('gh', manifestDownload));
    const manifest = join(manifestDir, BRIDGE_MANIFEST);
    const manifestAttest = attestationArgs(manifest);
    requireGhSuccess(manifestAttest, run('gh', manifestAttest));
    assertManifestMatches(manifest, resolve(root, BRIDGE_MANIFEST), ref.tag);
    return file;
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  } finally {
    if (manifestDir !== undefined) rmSync(manifestDir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = fetchBridge({ run: defaultRun, root: PACKAGE_ROOT });
    console.error(`bridge verified: ${file}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
