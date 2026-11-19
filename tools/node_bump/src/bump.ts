export const COOLDOWN_DAYS = 7;

export interface IndexEntry {
  version: string;
  date: string;
}

/**
 * Returns the newest same-major release at least COOLDOWN_DAYS old, or null when
 * `current` already is it. Throws on any malformed or non-greater input.
 */
export function nextNodeVersion(_current: string, _index: unknown, _now: Date): string | null {
  throw new Error('not implemented');
}
