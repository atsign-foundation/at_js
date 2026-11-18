// Serves the canary page at / and dist/ at /dist/, on 127.0.0.1.
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, sendFile } from './handle.js';
import { e2ePort } from './port.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = e2ePort();

createServer((request, response) => {
  const decision = decide(root, request.url);
  if (decision.status === 200) sendFile(decision.file, decision.type, response);
  else response.writeHead(decision.status).end();
}).listen(port, '127.0.0.1', () => console.log(`serving at http://127.0.0.1:${port}/`));
