import { statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** The file a request path names under `root`, or undefined when it is outside the served trees. */
export function resolveFile(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const file = decoded === '/' ? join(root, 'e2e/page/index.html')
    : decoded.startsWith('/dist/') ? join(root, decoded)
    : undefined;
  if (file === undefined) return undefined;
  const served = [join(root, 'e2e/page') + sep, join(root, 'dist') + sep];
  if (!served.some((dir) => file.startsWith(dir))) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}
