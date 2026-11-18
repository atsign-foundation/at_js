import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseBridgeRef,
  resolveBundleSource,
  sha256Hex,
  verifyDownload,
} from '../scripts/bridge-lib.mjs';

const tag = 'at_client_web-bridge-0123456789ab';
const sha = 'a'.repeat(64);
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseBridgeRef', () => {
  it('accepts a well-formed tag and checksum', () => {
    expect(parseBridgeRef(JSON.stringify({ tag, sha256: sha }))).toEqual({ tag, sha256: sha });
  });

  it('fails with a clear message while the pin is unset', () => {
    expect(() => parseBridgeRef(JSON.stringify({ tag: 'unset', sha256: 'unset' }))).toThrow(/not set/);
  });

  it.each([
    ['a tag without the prefix', { tag: 'v1', sha256: sha }],
    ['a tag with a short sha', { tag: 'at_client_web-bridge-0123456789a', sha256: sha }],
    ['a tag with uppercase hex', { tag: 'at_client_web-bridge-0123456789AB', sha256: sha }],
    ['a tag with trailing text', { tag: `${tag}x`, sha256: sha }],
    ['a checksum that is too short', { tag, sha256: 'a'.repeat(63) }],
    ['a checksum that is not hex', { tag, sha256: 'g'.repeat(64) }],
    ['a missing checksum', { tag }],
    ['a non-string tag', { tag: 1, sha256: sha }],
  ])('rejects %s', (_name, ref) => {
    expect(() => parseBridgeRef(JSON.stringify(ref))).toThrow(/bridge\.ref/);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseBridgeRef('nope')).toThrow(/bridge\.ref/);
  });
});

describe('verifyDownload', () => {
  it('keeps a file whose checksum matches', () => {
    const file = join(tmp(), 'at_client_web.js');
    writeFileSync(file, 'bundle');
    verifyDownload(file, sha256Hex(Buffer.from('bundle')));
    expect(existsSync(file)).toBe(true);
  });

  it('rejects a mismatch and deletes the file', () => {
    const file = join(tmp(), 'at_client_web.js');
    writeFileSync(file, 'tampered');
    expect(() => verifyDownload(file, sha256Hex(Buffer.from('bundle')))).toThrow(/checksum mismatch/);
    expect(existsSync(file)).toBe(false);
  });
});

describe('resolveBundleSource', () => {
  const root = '/pkg';

  it('prefers AT_CLIENT_WEB_BUNDLE when set', () => {
    expect(resolveBundleSource({ root, env: { AT_CLIENT_WEB_BUNDLE: '/x/b.js' }, exists: () => true })).toBe('/x/b.js');
  });

  it('falls back to the fetched bridge', () => {
    expect(resolveBundleSource({ root, env: {}, exists: () => true })).toBe('/pkg/.bridge/at_client_web.js');
  });

  it('ignores an empty AT_CLIENT_WEB_BUNDLE', () => {
    expect(resolveBundleSource({ root, env: { AT_CLIENT_WEB_BUNDLE: '' }, exists: () => true })).toBe(
      '/pkg/.bridge/at_client_web.js',
    );
  });

  it('points at ci:prepare when nothing is there', () => {
    expect(() => resolveBundleSource({ root, env: {}, exists: () => false })).toThrow(/npm run ci:prepare/);
  });

  it('names the override when it points at a missing file', () => {
    expect(() =>
      resolveBundleSource({ root, env: { AT_CLIENT_WEB_BUNDLE: '/x/b.js' }, exists: () => false }),
    ).toThrow(/AT_CLIENT_WEB_BUNDLE.*\/x\/b\.js/);
  });
});
