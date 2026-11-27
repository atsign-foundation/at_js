// Pure helpers shared by fetch-bridge.mjs and copy-bundle.mjs.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export const BRIDGE_REPO = 'atsign-foundation/at_client_sdk';
export const BRIDGE_ASSET = 'at_client_web.js';
export const BRIDGE_MANIFEST = 'bridge-manifest.json';
export const BRIDGE_SIGNER_WORKFLOW =
  'atsign-foundation/at_client_sdk/.github/workflows/at_client_web_bridge_release.yaml';
export const BRIDGE_SOURCE_REF = 'refs/heads/trunk';
export const BRIDGE_TAG_PATTERN = /^at_client_web-bridge-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Parses bridge.ref text into `{ tag, sha256 }`, or throws naming what is wrong. */
export function parseBridgeRef(text) {
  let ref;
  try {
    ref = JSON.parse(text);
  } catch {
    throw new Error('bridge.ref is not valid JSON');
  }
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new Error('bridge.ref must be a JSON object with "tag" and "sha256"');
  }
  if (ref.tag === 'unset') {
    throw new Error('bridge.ref is not set: no bridge release is pinned yet; set "tag" and "sha256" in bridge.ref');
  }
  if (typeof ref.tag !== 'string' || !BRIDGE_TAG_PATTERN.test(ref.tag)) {
    throw new Error('bridge.ref "tag" must match at_client_web-bridge-<12 lowercase hex>');
  }
  if (typeof ref.sha256 !== 'string' || !SHA256_PATTERN.test(ref.sha256)) {
    throw new Error('bridge.ref "sha256" must be 64 lowercase hex characters');
  }
  return { tag: ref.tag, sha256: ref.sha256 };
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Throws, after deleting the file, when its sha256 is not `expected`. */
export function verifyDownload(file, expected) {
  const actual = sha256Hex(readFileSync(file));
  if (actual !== expected) {
    rmSync(file, { force: true });
    throw new Error(`checksum mismatch for ${BRIDGE_ASSET}: expected ${expected}, got ${actual}`);
  }
}

/** The bundle copy-bundle copies: AT_CLIENT_WEB_BUNDLE if set, else the fetched bridge. */
export function resolveBundleSource({ root, env, exists }) {
  const override = env.AT_CLIENT_WEB_BUNDLE;
  if (override) {
    if (!exists(override)) {
      throw new Error(`AT_CLIENT_WEB_BUNDLE points at ${override}, which does not exist`);
    }
    return override;
  }
  const fetched = resolve(root, '.bridge', BRIDGE_ASSET);
  if (!exists(fetched)) {
    throw new Error(`missing ${fetched}; run \`npm run ci:prepare\` (or set AT_CLIENT_WEB_BUNDLE)`);
  }
  return fetched;
}

/**
 * Throws unless the downloaded manifest is byte-equal to the committed copy:
 * a release whose codes or bridge surface changed must land as a reviewable
 * diff in the committed file, never as a silent change at fetch time.
 */
export function assertManifestMatches(downloaded, committed, tag) {
  let expected;
  try {
    expected = readFileSync(committed);
  } catch {
    throw new Error(`missing ${committed}; the pinned bridge manifest is committed with the package`);
  }
  if (!readFileSync(downloaded).equals(expected)) {
    throw new Error(`${BRIDGE_MANIFEST} from ${tag} differs from the committed copy`);
  }
}

/** The `gh` arguments that check `file`'s build attestation: trunk source, hosted runners, the release workflow. */
export function attestationArgs(file) {
  return [
    'attestation',
    'verify',
    file,
    '-R',
    BRIDGE_REPO,
    '--signer-workflow',
    BRIDGE_SIGNER_WORKFLOW,
    '--source-ref',
    BRIDGE_SOURCE_REF,
    '--deny-self-hosted-runners',
  ];
}

const GH_MIN_VERSION = '2.49.0';
const ATTESTATION_FLAGS = ['--source-ref', '--deny-self-hosted-runners'];
const GH_VERSION_LINE = /^gh version (\S+)/;

function ghVersionOf(stdout) {
  const line = String(stdout ?? '').split(/\r?\n/u)[0].trim();
  const match = GH_VERSION_LINE.exec(line);
  return match === null ? line || 'unknown' : match[1];
}

/**
 * Fails before any download unless `run` can reach a gh that knows the
 * `attestation verify` command and every flag we pass it. Probes capability
 * rather than comparing a version number, so a later gh that adds flags still
 * passes. Returns the gh version string.
 */
export function checkGh(run) {
  let version;
  try {
    const result = run('gh', ['--version']);
    if (result === null || typeof result !== 'object' || result.status !== 0) {
      throw new Error('gh --version did not succeed');
    }
    version = ghVersionOf(result.stdout);
  } catch {
    throw new Error(`cannot run gh: install gh ${GH_MIN_VERSION} or later (https://cli.github.com)`);
  }
  let help;
  try {
    const result = run('gh', ['attestation', 'verify', '--help']);
    if (result === null || typeof result !== 'object' || result.status !== 0) {
      throw new Error('gh attestation verify --help did not succeed');
    }
    help = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  } catch {
    throw new Error(`gh ${version} has no \`attestation\` command; upgrade to ${GH_MIN_VERSION} or later`);
  }
  const missing = ATTESTATION_FLAGS.filter((flag) => !help.includes(flag));
  if (missing.length > 0) {
    throw new Error(
      `gh ${version} attestation verify is missing ${missing.join(', ')}; upgrade to ${GH_MIN_VERSION} or later`,
    );
  }
  return version;
}

/**
 * The bundle to copy, checked against bridge.ref's sha256 unless
 * AT_CLIENT_WEB_BUNDLE names it (the caller then owns what it points at).
 */
export function verifiedBundleSource({ root, env, exists }) {
  const source = resolveBundleSource({ root, env, exists });
  if (!env.AT_CLIENT_WEB_BUNDLE) {
    const ref = parseBridgeRef(readFileSync(resolve(root, 'bridge.ref'), 'utf8'));
    verifyDownload(source, ref.sha256);
  }
  return source;
}

const TRAILING_SOURCE_MAP_COMMENT =
  /(?:^|\r?\n)[ \t]*\/\/#[ \t]*sourceMappingURL=[^\r\n]*(?:\r?\n)*[ \t]*$/u;

/**
 * Drops a trailing `//# sourceMappingURL=...` line and returns the rest with
 * exactly one trailing newline. The release ships no map and copy-bundle
 * renames the file, so the comment would only point at a missing map. Text
 * whose last non-empty line is not such a comment is returned unchanged.
 */
export function stripSourceMapComment(text) {
  const match = TRAILING_SOURCE_MAP_COMMENT.exec(text);
  if (match === null) return text;
  const body = text.slice(0, match.index);
  return body === '' ? '' : `${body}\n`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The text of the fetched bridge, after checking its sha256 against bridge.ref.
 * Never deletes the file: unlike a download, a build must not destroy its input.
 */
function verifiedBridgeText({ root, exists }) {
  let ref;
  try {
    ref = parseBridgeRef(readFileSync(resolve(root, 'bridge.ref'), 'utf8'));
  } catch (error) {
    throw new Error(`${messageOf(error)}; run \`npm run ci:prepare\``);
  }
  const fetched = resolve(root, '.bridge', BRIDGE_ASSET);
  if (!exists(fetched)) {
    throw new Error(`missing ${fetched}; run \`npm run ci:prepare\``);
  }
  const bytes = readFileSync(fetched);
  const actual = sha256Hex(bytes);
  if (actual !== ref.sha256) {
    throw new Error(`checksum mismatch for ${BRIDGE_ASSET}: expected ${ref.sha256}, got ${actual}; run \`npm run ci:prepare\``);
  }
  return bytes.toString('utf8');
}

const DIST_FILES = ['dist/index.js', 'dist/index.d.ts', 'dist/dart/at_client.js'];

/**
 * The check `prepublishOnly` runs, before any build: refuse the local-bundle
 * override, and require bridge.ref to parse and the fetched bundle to match its
 * sha256. Looks only at bridge.ref and .bridge/, never at dist/.
 */
export function publishGuard({ root, env, exists }) {
  const override = env.AT_CLIENT_WEB_BUNDLE;
  if (override) {
    throw new Error(`refusing to publish: AT_CLIENT_WEB_BUNDLE is set (${override}); publish from the bridge pinned in bridge.ref`);
  }
  verifiedBridgeText({ root, exists });
}

/**
 * The check `prepack` runs after the build: require dist's three entry files and
 * a dist/dart/at_client.js byte-equal to the stripped, sha-verified bridge.
 */
export function verifyDist({ root, env, exists }) {
  const override = env.AT_CLIENT_WEB_BUNDLE;
  if (override) {
    throw new Error(`refusing to verify a dist built from AT_CLIENT_WEB_BUNDLE (${override}); build from the bridge pinned in bridge.ref`);
  }
  for (const rel of DIST_FILES) {
    if (!exists(resolve(root, rel))) {
      throw new Error(`missing ${rel}; run \`npm run build\``);
    }
  }
  const expected = stripSourceMapComment(verifiedBridgeText({ root, exists }));
  const actual = readFileSync(resolve(root, 'dist', 'dart', 'at_client.js'), 'utf8');
  if (actual !== expected) {
    throw new Error('dist/dart/at_client.js is not the stripped verified bridge; rebuild with `npm run build`');
  }
}
