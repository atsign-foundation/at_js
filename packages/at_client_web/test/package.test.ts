import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { publishGuard, sha256Hex, verifyDist } from '../scripts/bridge-lib.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = 'at_client_web-bridge-0123456789ab';
const RAW = 'bundle\n//# sourceMappingURL=at_client_web.js.map\n';
const STRIPPED = 'bundle\n';
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'package-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A package root with the fetched bridge and a bridge.ref pinning its sha256. */
function pkg(source = RAW, pinned = source): string {
  const root = tmp();
  mkdirSync(join(root, '.bridge'));
  writeFileSync(join(root, '.bridge', 'at_client_web.js'), source);
  writeFileSync(join(root, 'bridge.ref'), JSON.stringify({ tag, sha256: sha256Hex(Buffer.from(pinned)) }));
  return root;
}

function writeDist(root: string, bundle = STRIPPED): void {
  mkdirSync(join(root, 'dist', 'dart'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.js'), 'export {};\n');
  writeFileSync(join(root, 'dist', 'index.d.ts'), 'export {};\n');
  writeFileSync(join(root, 'dist', 'dart', 'at_client.js'), bundle);
}

describe('verifyDist', () => {
  it('verify-dist refuses to publish when AT_CLIENT_WEB_BUNDLE is set', () => {
    const root = pkg();
    expect(() =>
      publishGuard({ root, env: { AT_CLIENT_WEB_BUNDLE: '/some/local.js' }, exists: existsSync }),
    ).toThrow(/AT_CLIENT_WEB_BUNDLE/);
  });

  it('verify-dist refuses a dist missing index.js, index.d.ts or dart/at_client.js', () => {
    for (const rel of ['dist/index.js', 'dist/index.d.ts', 'dist/dart/at_client.js']) {
      const root = pkg();
      writeDist(root);
      rmSync(join(root, rel));
      expect(() => verifyDist({ root, env: {}, exists: existsSync })).toThrow(rel);
    }
  });

  it('verify-dist refuses a dist bundle that is not the stripped verified bridge', () => {
    const root = pkg();
    writeDist(root, RAW);
    expect(() => verifyDist({ root, env: {}, exists: existsSync })).toThrow(/not the stripped verified bridge/);
    writeDist(root, STRIPPED);
    expect(() => verifyDist({ root, env: {}, exists: existsSync })).not.toThrow();
  });
});

describe('publishGuard', () => {
  it('the publish guard names ci:prepare when .bridge is missing or its sha differs from bridge.ref', () => {
    const missing = pkg();
    rmSync(join(missing, '.bridge'), { recursive: true });
    expect(() => publishGuard({ root: missing, env: {}, exists: existsSync })).toThrow(/npm run ci:prepare/);

    const tampered = pkg('tampered', 'bundle');
    expect(() => publishGuard({ root: tampered, env: {}, exists: existsSync })).toThrow(/npm run ci:prepare/);
  });

  it('the publish guard passes on a tree with no dist', () => {
    const root = pkg();
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(() => publishGuard({ root, env: {}, exists: existsSync })).not.toThrow();
  });
});

describe('package manifest', () => {
  const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    engines?: unknown;
    exports: Record<string, unknown>;
  };

  it('package.json runs build and verify-dist on prepack and the publish guard on prepublishOnly', () => {
    expect(manifest.scripts.prepack).toContain('npm run build');
    expect(manifest.scripts.prepack).toContain('node scripts/verify-dist.mjs');
    expect(manifest.scripts.prepack).not.toContain('--publish-guard');
    expect(manifest.scripts.prepublishOnly).toBe('node scripts/verify-dist.mjs --publish-guard');
  });

  it('the package declares no engines', () => {
    expect('engines' in manifest).toBe(false);
    expect(manifest.engines).toBeUndefined();
  });

  it('the package exports its package.json', () => {
    expect(manifest.exports['./package.json']).toBe('./package.json');

    const consumer = tmp();
    mkdirSync(join(consumer, 'node_modules', '@atsign'), { recursive: true });
    symlinkSync(PKG, join(consumer, 'node_modules', '@atsign', 'at_client_web'), 'dir');
    const resolved = createRequire(join(consumer, 'consumer.cjs')).resolve('@atsign/at_client_web/package.json');
    expect(resolved.endsWith('/package.json')).toBe(true);
    expect(JSON.parse(readFileSync(resolved, 'utf8')).name).toBe('@atsign/at_client_web');
  });
});

describe('playwright config', () => {
  it('live project records no trace, video or screenshot and uses no HTML reporter', async () => {
    const config = (await import('../playwright.config.js')).default;
    const live = (config.projects ?? []).find((project) => project.name === 'live');
    expect(live, 'the config must define a live project').toBeDefined();
    expect(live?.use).toMatchObject({ trace: 'off', video: 'off', screenshot: 'off' });
    const declared = (live as { reporter?: unknown } | undefined)?.reporter ?? config.reporter;
    const reporters = declared === undefined ? [] : Array.isArray(declared) ? declared : [declared];
    const names = reporters.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    expect(names).not.toContain('html');
  });
});

describe('bridge bump workflow', () => {
  const workflow = readFileSync(
    resolve(PKG, '..', '..', '.github', 'workflows', 'at_client_web_bridge_bump.yaml'),
    'utf8',
  ).split(/\r?\n/u);

  function lineContaining(fragment: string): number {
    return workflow.findIndex((line) => line.includes(fragment));
  }

  it('the bump workflow writes bridge-manifest.json beside bridge.ref', () => {
    expect(workflow.some((line) => /gh release download .*--pattern bridge-manifest\.json/.test(line))).toBe(true);
    expect(lineContaining('$RUNNER_TEMP/next-bridge-manifest.json')).toBeGreaterThanOrEqual(0);
    expect(workflow.some((line) => line.includes('jq -e .schemaVersion'))).toBe(true);

    const get = lineContaining(
      'gh api "repos/$REPO/contents/packages/at_client_web/bridge-manifest.json?ref=$branch" --jq .sha',
    );
    const put = lineContaining('-X PUT "repos/$REPO/contents/packages/at_client_web/bridge-manifest.json"');
    expect(get).toBeGreaterThanOrEqual(0);
    expect(put).toBeGreaterThanOrEqual(0);

    const trapSet = workflow.findIndex((line) => /trap '.*' EXIT/.test(line));
    const trapClear = workflow.findIndex((line) => /^\s*trap - EXIT\s*$/u.test(line));
    const pullRequest = workflow.findIndex((line) => line.includes('gh pr create'));
    expect(trapSet).toBeGreaterThanOrEqual(0);
    expect(trapClear).toBeGreaterThan(trapSet);
    expect(pullRequest).toBeGreaterThan(trapSet);
    for (const index of [get, put]) {
      expect(index).toBeGreaterThan(trapSet);
      expect(index).toBeLessThan(trapClear);
      expect(index).toBeLessThan(pullRequest);
    }
  });
});
