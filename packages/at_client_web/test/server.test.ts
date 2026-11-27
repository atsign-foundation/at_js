/**
 * The e2e server's run-record endpoint.
 *
 * Each test spawns `e2e/server.mjs` on a free loopback port and gives it a
 * throwaway runs directory, so the real `e2e/runs/` is never touched. The
 * node:http client is used rather than fetch because these tests must control
 * the `Host` header.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RunningServer {
  port: number;
  runs: string;
  child: ChildProcess;
}

let running: RunningServer | undefined;

/** A loopback port that was free a moment ago. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

/** Starts the server and waits for its listen line. */
async function start(): Promise<RunningServer> {
  const port = await freePort();
  const runs = mkdtempSync(join(tmpdir(), 'runs-'));
  const child = spawn(process.execPath, [join(PKG, 'e2e', 'server.mjs')], {
    env: { ...process.env, E2E_PORT: String(port), E2E_RUNS_DIR: runs },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ready, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('serving at')) {
        clearTimeout(timer);
        ready();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with ${String(code)}`));
    });
  });
  running = { port, runs, child };
  return running;
}

interface PostOptions {
  body?: string | Buffer;
  headers?: Record<string, string>;
}

/** POSTs to /runs, returning the status and response text. */
function post(
  server: RunningServer,
  options: PostOptions = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePost, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path: '/runs',
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolvePost({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(options.body ?? '');
  });
}

/** Every file under the runs directory, or none when it was never created. */
function runFiles(server: RunningServer): string[] {
  try {
    return readdirSync(server.runs);
  } catch {
    return [];
  }
}

afterEach(() => {
  if (running !== undefined) {
    running.child.kill('SIGKILL');
    rmSync(running.runs, { recursive: true, force: true });
    running = undefined;
  }
});

describe('POST /runs', () => {
  it('POST /runs refuses a Host or Origin that is not localhost or 127.0.0.1', async () => {
    const server = await start();

    const badHost = await post(server, { headers: { host: 'evil.test' } });
    expect(badHost.status).toBe(403);

    const badOrigin = await post(server, { headers: { origin: 'http://evil.test' } });
    expect(badOrigin.status).toBe(403);

    expect(runFiles(server)).toEqual([]);
  });

  it('POST /runs refuses a body over 64 KiB with 413 and writes nothing', async () => {
    const server = await start();
    const oversized = 'x'.repeat(64 * 1024 + 1);

    const response = await post(server, { body: oversized });
    expect(response.status).toBe(413);
    expect(runFiles(server)).toEqual([]);
  });

  it('POST /runs refuses a field outside the allow-list and appends an allowed record as one JSONL line', async () => {
    const server = await start();

    const unknownField = await post(server, { body: JSON.stringify({ runId: 'r1', extra: 1 }) });
    expect(unknownField.status).toBe(400);

    const freeText = await post(server, {
      body: JSON.stringify({ runId: 'r1', code: 'has spaces and a secret' }),
    });
    expect(freeText.status).toBe(400);
    expect(runFiles(server)).toEqual([]);

    const first = await post(server, {
      body: JSON.stringify({
        runId: 'run-1',
        suite: 'live',
        ok: true,
        ms: 12,
        statuses: ['ok'],
        flags: [],
        consoleErrors: 0,
        wsEvents: 1,
      }),
    });
    expect(first.status).toBe(204);

    const second = await post(server, {
      body: JSON.stringify({ runId: 'run-2', step: 'notify', code: 'refused', iteration: 2 }),
    });
    expect(second.status).toBe(204);

    const files = runFiles(server);
    expect(files).toHaveLength(1);
    const name = files[0];
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    const lines = readFileSync(join(server.runs, name as string), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
