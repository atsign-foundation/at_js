import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextNodeVersion } from './bump.ts';

const INDEX_URL = 'https://nodejs.org/dist/index.json';
const FETCH_TIMEOUT_MS = 30_000;

interface Sink {
  write(chunk: string): unknown;
}

export interface MainOptions {
  file: string;
  indexUrl: string;
  stdout: Sink;
  stderr: Sink;
}

/** Prints the new version (or nothing) to stdout; returns the process exit code. */
export async function main({ file, indexUrl, stdout, stderr }: MainOptions): Promise<number> {
  try {
    const current = readFileSync(file, 'utf8').trim();
    const response = await fetch(indexUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`fetch ${indexUrl}: HTTP ${response.status}`);
    const next = nextNodeVersion(current, await response.json(), new Date());
    if (next !== null) stdout.write(`${next}\n`);
    return 0;
  } catch (error) {
    stderr.write(`node_bump: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main({
    file: process.argv[2] ?? resolve(import.meta.dirname, '../../../.node-version'),
    indexUrl: INDEX_URL,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
