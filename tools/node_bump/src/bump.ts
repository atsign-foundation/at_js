export const COOLDOWN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Triple = readonly [number, number, number];

function triple(match: RegExpExecArray): Triple {
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Returns undefined for entries outside `major` (the index also lists odd pre-release tags of other majors). */
function parseEntry(entry: unknown, major: number): { version: Triple; releasedAt: number } | undefined {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`malformed index entry: ${JSON.stringify(entry)}`);
  }
  const { version, date } = entry as Record<string, unknown>;
  if (typeof version === 'string' && !version.startsWith(`v${major}.`)) return undefined;
  const match = typeof version === 'string' ? RELEASE.exec(version) : null;
  const releasedAt = typeof date === 'string' && DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (match === null || Number.isNaN(releasedAt)) {
    throw new Error(`malformed index entry: ${JSON.stringify(entry)}`);
  }
  return { version: triple(match), releasedAt };
}

/**
 * Returns the newest same-major release at least COOLDOWN_DAYS old, or null when
 * `current` already is it. Throws on any malformed or non-greater input.
 */
export function nextNodeVersion(current: string, index: unknown, now: Date): string | null {
  const match = CURRENT.exec(current);
  if (match === null) throw new Error(`invalid current version: ${JSON.stringify(current)}`);
  const pinned = triple(match);
  if (!Array.isArray(index)) throw new Error('release index is not an array');

  const cutoff = now.getTime() - COOLDOWN_DAYS * DAY_MS;
  let best: Triple | undefined;
  for (const entry of index) {
    const parsed = parseEntry(entry, pinned[0]);
    if (parsed === undefined || parsed.releasedAt > cutoff) continue;
    const { version } = parsed;
    if (best === undefined || compare(version, best) > 0) best = version;
  }

  if (best === undefined) throw new Error(`no eligible release of major ${pinned[0]}`);
  const order = compare(best, pinned);
  if (order === 0) return null;
  if (order < 0) throw new Error(`newest eligible release ${best.join('.')} is older than ${current}`);
  return best.join('.');
}
