import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.ts';

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    stdout: { write: (s: string) => ((out.stdout += s), true) },
    stderr: { write: (s: string) => ((out.stderr += s), true) },
  };
}

function pinFile(version: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'node_bump-')), '.node-version');
  writeFileSync(file, `${version}\n`);
  return file;
}

describe('main', () => {
  it('a fetch or JSON error fails the run', async () => {
    const { out, stdout, stderr } = capture();
    // Port 1 refuses connections, so the fetch fails without touching the network.
    const code = await main({ file: pinFile('26.13.1'), indexUrl: 'http://127.0.0.1:1/index.json', stdout, stderr });
    expect(code).not.toBe(0);
    expect(out.stdout).toBe('');
    expect(out.stderr).not.toBe('');
  });

  it('prints the new version for a fixture index served locally', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ version: 'v26.13.2', date: '2020-01-01' }, { version: 'v26.13.1', date: '2019-01-01' }]));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const { out, stdout, stderr } = capture();
      const code = await main({ file: pinFile('26.13.1'), indexUrl: `http://127.0.0.1:${port}/index.json`, stdout, stderr });
      expect(code).toBe(0);
      expect(out).toEqual({ stdout: '26.13.2\n', stderr: '' });
    } finally {
      server.close();
    }
  });
});
