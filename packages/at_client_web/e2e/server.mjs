// Serves dist/ at /dist/ and the e2e page at /, on 127.0.0.1.
// Also appends allow-listed run records to e2e/runs/<YYYY-MM-DD>.jsonl.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.E2E_PORT ?? 4173);
const runsDir = resolve(process.env.E2E_RUNS_DIR ?? join(root, 'e2e', 'runs'));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const MAX_BODY = 64 * 1024;
const TEXT = /^[A-Za-z0-9_:.-]{1,64}$/;
const TEXT_FIELDS = ['runId', 'suite', 'step', 'code'];
const NUMBER_FIELDS = ['iteration', 'ms', 'startedAt', 'finishedAt', 'consoleErrors', 'wsEvents'];
const ARRAY_FIELDS = ['statuses', 'flags'];
const ALLOWED_FIELDS = new Set([...TEXT_FIELDS, ...NUMBER_FIELDS, ...ARRAY_FIELDS, 'ok']);

/** The file a request path names, or undefined when it is outside the served trees. */
function resolveFile(urlPath) {
  const path = normalize(decodeURIComponent(urlPath));
  const file = path === '/' ? join(root, 'e2e/page/index.html')
    : path.startsWith('/dist/') ? join(root, path)
    : undefined;
  if (file === undefined || !file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    return undefined;
  }
  return file;
}

/** Only a loopback Host (and, when present, a loopback Origin) may post runs. */
function isLoopbackRequest(request, listeningPort) {
  const host = request.headers.host;
  const origin = request.headers.origin;
  const hosts = new Set([`127.0.0.1:${listeningPort}`, `localhost:${listeningPort}`]);
  const origins = new Set([`http://127.0.0.1:${listeningPort}`, `http://localhost:${listeningPort}`]);
  return hosts.has(host) && (origin === undefined || origins.has(origin));
}

/** True when every present field has its allow-listed shape. */
function isAllowedRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) return false;
  }
  for (const key of TEXT_FIELDS) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'string' || !TEXT.test(value))) return false;
  }
  for (const key of NUMBER_FIELDS) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  }
  for (const key of ARRAY_FIELDS) {
    const value = record[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return false;
    if (!value.every((item) => typeof item === 'string' && TEXT.test(item))) return false;
  }
  const ok = record.ok;
  return ok === undefined || typeof ok === 'boolean';
}

/** Reads a request body, answering 413 as soon as it passes the cap. */
function readBody(request, response) {
  return new Promise((settle) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        response.writeHead(413).end();
        settle(undefined);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) settle(Buffer.concat(chunks));
    });
    request.on('error', () => {
      if (!tooLarge && !response.writableEnded) response.writeHead(400).end();
      settle(undefined);
    });
  });
}

async function handleRun(request, response, listeningPort) {
  if (!isLoopbackRequest(request, listeningPort)) {
    response.writeHead(403).end();
    return;
  }
  const body = await readBody(request, response);
  if (body === undefined) return;
  if (response.writableEnded) return;

  let record;
  try {
    record = JSON.parse(body.toString('utf8'));
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (!isAllowedRecord(record)) {
    response.writeHead(400).end();
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  try {
    await mkdir(runsDir, { recursive: true });
    await appendFile(join(runsDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`);
  } catch {
    response.writeHead(500).end();
    return;
  }
  response.writeHead(204).end();
}

let listeningPort = port;

const server = createServer((request, response) => {
  const urlPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'POST' && urlPath === '/runs') {
    void handleRun(request, response, listeningPort);
    return;
  }
  const file = resolveFile(urlPath);
  if (file === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (typeof address === 'object' && address !== null) listeningPort = address.port;
  console.log(`serving at http://127.0.0.1:${listeningPort}/`);
});
