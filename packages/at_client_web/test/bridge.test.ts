import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIDGE_REPO,
  BRIDGE_SIGNER_WORKFLOW,
  BRIDGE_SOURCE_REF,
  attestationArgs,
  parseBridgeRef,
  resolveBundleSource,
  sha256Hex,
  stripSourceMapComment,
  verifiedBundleSource,
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

describe('verifiedBundleSource', () => {
  function pkg(bundle: string, pinned: string): string {
    const root = tmp();
    mkdirSync(join(root, '.bridge'));
    writeFileSync(join(root, '.bridge', 'at_client_web.js'), bundle);
    writeFileSync(join(root, 'bridge.ref'), JSON.stringify({ tag, sha256: sha256Hex(Buffer.from(pinned)) }));
    return root;
  }

  it('copy-bundle accepts a fetched bundle whose sha256 matches bridge.ref', () => {
    const root = pkg('bundle', 'bundle');
    expect(verifiedBundleSource({ root, env: {}, exists: existsSync })).toBe(join(root, '.bridge', 'at_client_web.js'));
  });

  it('copy-bundle rejects a fetched bundle whose sha256 differs from bridge.ref', () => {
    const root = pkg('tampered', 'bundle');
    expect(() => verifiedBundleSource({ root, env: {}, exists: existsSync })).toThrow(/checksum mismatch/);
    expect(existsSync(join(root, '.bridge', 'at_client_web.js'))).toBe(false);
  });

  it('copy-bundle skips the checksum when AT_CLIENT_WEB_BUNDLE is set', () => {
    const root = pkg('bundle', 'bundle');
    const override = join(root, 'local.js');
    writeFileSync(override, 'anything');
    expect(verifiedBundleSource({ root, env: { AT_CLIENT_WEB_BUNDLE: override }, exists: existsSync })).toBe(override);
    expect(existsSync(override)).toBe(true);
  });
});

describe('stripSourceMapComment', () => {
  it('removes a trailing sourceMappingURL comment and leaves exactly one newline', () => {
    expect(stripSourceMapComment('body\n//# sourceMappingURL=at_client_web.js.map\n')).toBe('body\n');
  });

  it('removes the comment when trailing blank lines follow it', () => {
    expect(stripSourceMapComment('body\n//# sourceMappingURL=x.map\n\n')).toBe('body\n');
  });

  it('returns an empty string for a comment-only file', () => {
    expect(stripSourceMapComment('//# sourceMappingURL=x.map\n')).toBe('');
  });

  it('normalises CRLF line endings after stripping the comment', () => {
    expect(stripSourceMapComment('body\r\n//# sourceMappingURL=x.map\r\n')).toBe('body\n');
  });

  it('leaves text without the comment unchanged', () => {
    expect(stripSourceMapComment('body\n')).toBe('body\n');
    expect(stripSourceMapComment('body')).toBe('body');
  });

  it('leaves a sourceMappingURL line that is not the last line untouched', () => {
    const text = '//# sourceMappingURL=at_client_web.js.map\nbody\n';
    expect(stripSourceMapComment(text)).toBe(text);
  });

  it('leaves an ordinary line mentioning sourceMappingURL untouched', () => {
    const text = '// the sourceMappingURL comment is stripped on copy\n';
    expect(stripSourceMapComment(text)).toBe(text);
  });
});

describe('copy-bundle script', () => {
  const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

  function pkg(bundle: string, pinned: string): string {
    const root = tmp();
    mkdirSync(join(root, 'scripts'));
    for (const name of ['copy-bundle.mjs', 'bridge-lib.mjs']) {
      copyFileSync(join(scriptsDir, name), join(root, 'scripts', name));
    }
    mkdirSync(join(root, '.bridge'));
    writeFileSync(join(root, '.bridge', 'at_client_web.js'), bundle);
    writeFileSync(join(root, 'bridge.ref'), JSON.stringify({ tag, sha256: sha256Hex(Buffer.from(pinned)) }));
    return root;
  }

  function run(root: string) {
    const env = { ...process.env };
    delete env.AT_CLIENT_WEB_BUNDLE;
    return spawnSync(process.execPath, [join(root, 'scripts', 'copy-bundle.mjs')], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
  }

  it('copy-bundle runs the checksum check and copies a fetched bundle whose sha256 matches bridge.ref', () => {
    const root = pkg('bundle', 'bundle');
    const result = run(root);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'dist', 'dart', 'at_client.js'), 'utf8')).toBe('bundle');
  });

  it('copy-bundle refuses a fetched bundle whose sha256 differs and copies nothing', () => {
    const root = pkg('tampered', 'bundle');
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum mismatch');
    expect(existsSync(join(root, 'dist', 'dart', 'at_client.js'))).toBe(false);
  });

  it('copy-bundle strips a trailing sourceMappingURL comment from the copied bundle', () => {
    const source = 'bundle\n//# sourceMappingURL=at_client_web.js.map\n';
    const root = pkg(source, source);
    const result = run(root);
    expect(result.status).toBe(0);
    const copied = readFileSync(join(root, 'dist', 'dart', 'at_client.js'), 'utf8');
    expect(copied).not.toContain('sourceMappingURL');
    expect(copied).toBe('bundle\n');
  });
});

describe('attestationArgs', () => {
  it('fetch-bridge pins the source ref and denies self-hosted runners', () => {
    const args = attestationArgs('/b/at_client_web.js');
    expect(args).toEqual([
      'attestation',
      'verify',
      '/b/at_client_web.js',
      '-R',
      BRIDGE_REPO,
      '--signer-workflow',
      BRIDGE_SIGNER_WORKFLOW,
      '--source-ref',
      BRIDGE_SOURCE_REF,
      '--deny-self-hosted-runners',
    ]);
    expect(BRIDGE_SOURCE_REF).toBe('refs/heads/trunk');
  });
});
