import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { ServerResponse } from 'node:http';
import { resolveFile } from './resolve.js';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

export type Decision = { status: 200; file: string; type: string } | { status: 400 | 404 };

/** The response for a request target: 400 when it is not a well-formed URL, 404 when it names no served file. */
export function decide(root: string, target: string | undefined): Decision {
  let pathname: string;
  try {
    pathname = new URL(target ?? '/', 'http://localhost').pathname;
  } catch {
    return { status: 400 };
  }
  const file = resolveFile(root, pathname);
  if (file === undefined) return { status: 404 };
  return { status: 200, file, type: types[extname(file)] ?? 'application/octet-stream' };
}

/** Streams `file`: 500 if it cannot be opened, and the response is closed if it fails mid-stream. */
export function sendFile(file: string, type: string, response: ServerResponse): void {
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(500).end();
  });
  stream.on('open', () => {
    response.writeHead(200, { 'content-type': type });
    stream.pipe(response);
  });
  response.on('close', () => stream.destroy());
}
