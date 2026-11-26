// Pure helpers shared by fetch-bridge.mjs and copy-bundle.mjs.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export const BRIDGE_REPO = 'atsign-foundation/at_client_sdk';
export const BRIDGE_ASSET = 'at_client_web.js';
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
