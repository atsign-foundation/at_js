import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../scripts/bridge-lib.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '..', '..');
const BUNDLE = 'bundle\n//# sourceMappingURL=x.map\n';
const TIMEOUT = 120_000;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A clean copy of the package: manifest, sources, scripts, tsconfigs and the
 * docs, with node_modules linked to the at_js root and a fixture bridge pin so
 * the lifecycle never touches the gitignored real .bridge/.
 */
function cleanCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  dirs.push(dir);
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE']) {
    cpSync(join(PKG, name), join(dir, name));
  }
  cpSync(join(PKG, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(PKG, 'scripts'), join(dir, 'scripts'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir');
  mkdirSync(join(dir, '.bridge'));
  writeFileSync(join(dir, '.bridge', 'at_client_web.js'), BUNDLE);
  writeFileSync(
    join(dir, 'bridge.ref'),
    JSON.stringify({ tag: 'at_client_web-bridge-0123456789ab', sha256: sha256Hex(Buffer.from(BUNDLE)) }),
  );
  return dir;
}

function publish(dir: string, env: NodeJS.ProcessEnv) {
  return spawnSync(
    'npm',
    ['publish', '--dry-run', '--foreground-scripts', '--registry', 'http://127.0.0.1:9'],
    { cwd: dir, env, encoding: 'utf8', timeout: TIMEOUT - 10_000 },
  );
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AT_CLIENT_WEB_BUNDLE;
  return env;
}

describe('npm publish lifecycle', () => {
  it(
    'npm publish --dry-run on a clean copy runs the guard, then builds and verifies dist',
    () => {
      const dir = cleanCopy();
      const result = publish(dir, cleanEnv());
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      const guardAt = output.indexOf('publish guard passed');
      const buildAt = output.indexOf('dist built');
      const verifyAt = output.indexOf('dist verified');
      expect(guardAt, output).toBeGreaterThanOrEqual(0);
      expect(buildAt, output).toBeGreaterThan(guardAt);
      expect(verifyAt, output).toBeGreaterThan(buildAt);
      expect(existsSync(join(dir, 'dist', 'dart', 'at_client.js'))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'npm publish --dry-run refuses in prepublishOnly, before any build, when AT_CLIENT_WEB_BUNDLE is set',
    () => {
      const dir = cleanCopy();
      const override = join(dir, 'local-bundle.js');
      writeFileSync(override, 'local\n');
      const env = cleanEnv();
      env.AT_CLIENT_WEB_BUNDLE = override;
      const result = publish(dir, env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).not.toBe(0);
      expect(output).toContain('AT_CLIENT_WEB_BUNDLE');
      expect(existsSync(join(dir, 'dist'))).toBe(false);
    },
    TIMEOUT,
  );
});
