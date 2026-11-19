import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = new URL('../src/main.ts', import.meta.url).pathname;

describe('main', () => {
  it('a fetch or JSON error fails the run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'node_bump-'));
    const file = join(dir, '.node-version');
    writeFileSync(file, '26.13.1\n');
    // Port 1 refuses connections, so the fetch fails without touching the network.
    const run = spawnSync(process.execPath, [MAIN, file], {
      encoding: 'utf8',
      env: { ...process.env, NODE_BUMP_INDEX_URL: 'http://127.0.0.1:1/index.json' },
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toBe('');
  });
});
