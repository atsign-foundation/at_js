import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextNodeVersion } from './bump.ts';

const INDEX_URL = process.env.NODE_BUMP_INDEX_URL ?? 'https://nodejs.org/dist/index.json';
const FETCH_TIMEOUT_MS = 30_000;

async function run(): Promise<string | null> {
  const file = process.argv[2] ?? resolve(import.meta.dirname, '../../../.node-version');
  const current = readFileSync(file, 'utf8').trim();
  const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`fetch ${INDEX_URL}: HTTP ${response.status}`);
  return nextNodeVersion(current, await response.json(), new Date());
}

try {
  const next = await run();
  if (next !== null) process.stdout.write(`${next}\n`);
} catch (error) {
  process.stderr.write(`node_bump: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
