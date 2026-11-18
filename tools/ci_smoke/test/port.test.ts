import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, e2ePort } from '../src/port.js';

describe('e2ePort', () => {
  it('defaults to 4174 when unset or empty', () => {
    expect(DEFAULT_PORT).toBe(4174);
    expect(e2ePort({})).toBe(4174);
    expect(e2ePort({ E2E_PORT: '' })).toBe(4174);
  });

  it('accepts an integer in 1-65535', () => {
    expect(e2ePort({ E2E_PORT: '5000' })).toBe(5000);
    expect(e2ePort({ E2E_PORT: '1' })).toBe(1);
    expect(e2ePort({ E2E_PORT: '65535' })).toBe(65535);
  });

  it.each(['abc', '0', '70000', '1.5'])('rejects %s', (raw) => {
    expect(() => e2ePort({ E2E_PORT: raw })).toThrow(`E2E_PORT: must be 1-65535, got ${raw}`);
  });
});
