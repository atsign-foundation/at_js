import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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

/** Runs main() against a loopback server answering `respond`, with a pin of 26.13.1. */
async function runAgainst(respond: ServerResponder) {
  const server = createServer(respond);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const { port } = server.address() as AddressInfo;
    const { out, stdout, stderr } = capture();
    const code = await main({ file: pinFile('26.13.1'), indexUrl: `http://127.0.0.1:${port}/index.json`, stdout, stderr });
    return { code, ...out };
  } finally {
    server.close();
  }
}

type ServerResponder = (req: IncomingMessage, res: ServerResponse) => void;

function expectFailure(run: { code: number; stdout: string; stderr: string }) {
  expect(run.code).not.toBe(0);
  expect(run.stdout).toBe('');
  expect(run.stderr).toMatch(/^node_bump: /);
}

describe('main', () => {
  it('a fetch error fails the run', async () => {
    const { out, stdout, stderr } = capture();
    // Port 1 refuses connections, so the fetch fails without touching the network.
    const code = await main({ file: pinFile('26.13.1'), indexUrl: 'http://127.0.0.1:1/index.json', stdout, stderr });
    expectFailure({ code, ...out });
    expectFailure(await runAgainst((_req, res) => res.writeHead(500).end('boom')));
  });

  it('an invalid JSON index fails the run', async () => {
    expectFailure(await runAgainst((_req, res) => res.writeHead(200).end('not json')));
  });

  it('the tool prints the new version', async () => {
    const run = await runAgainst((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ version: 'v26.13.2', date: '2020-01-01' }, { version: 'v26.13.1', date: '2019-01-01' }]));
    });
    expect(run).toEqual({ code: 0, stdout: '26.13.2\n', stderr: '' });
  });
});
