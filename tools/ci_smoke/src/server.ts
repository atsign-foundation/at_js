// Serves the canary page at / and dist/ at /dist/, on 127.0.0.1.
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFile } from './resolve.js';
import { e2ePort } from './port.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = e2ePort();
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

createServer((request, response) => {
  const file = resolveFile(root, new URL(request.url ?? '/', 'http://localhost').pathname);
  if (file === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`serving at http://127.0.0.1:${port}/`));
