import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { decide, sendFile } from '../src/handle.js';

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ci_smoke-handle-'));
  mkdirSync(join(root, 'e2e/page'), { recursive: true });
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'e2e/page/index.html'), '<!doctype html>');
});

test('a malformed request target gets 400', () => {
  expect(decide(root, 'http://a:99999/')).toEqual({ status: 400 });
  expect(decide(root, '//')).toEqual({ status: 400 });
  expect(decide(root, 'http://[/')).toEqual({ status: 400 });
});

test('a well-formed request target is answered from the served trees', () => {
  expect(decide(root, '/')).toEqual({
    status: 200,
    file: join(root, 'e2e/page/index.html'),
    type: 'text/html; charset=utf-8',
  });
  expect(decide(root, '/?q=1')).toMatchObject({ status: 200 });
  expect(decide(root, '/dist/missing.js')).toEqual({ status: 404 });
  expect(decide(root, undefined)).toMatchObject({ status: 200 });
});

async function fetchVia(file: string): Promise<{ status?: number; aborted: boolean }> {
  const server = createServer((_request, response) => sendFile(file, 'text/html', response));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((done) => {
      const req = httpRequest({ host: '127.0.0.1', port }, (res) => {
        res.resume();
        res.on('end', () => done({ status: res.statusCode, aborted: false }));
        res.on('error', () => done({ status: res.statusCode, aborted: true }));
        res.on('aborted', () => done({ status: res.statusCode, aborted: true }));
      });
      req.on('error', () => done({ aborted: true }));
      req.end();
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test('a file that cannot be opened gets 500', async () => {
  expect(await fetchVia(join(root, 'gone.html'))).toEqual({ status: 500, aborted: false });
});

test('a file that fails while streaming ends the response early', async () => {
  const result = await fetchVia(join(root, 'dist'));
  expect(result.aborted).toBe(true);
});

test('a readable file is streamed with 200', async () => {
  expect(await fetchVia(join(root, 'e2e/page/index.html'))).toEqual({ status: 200, aborted: false });
});
