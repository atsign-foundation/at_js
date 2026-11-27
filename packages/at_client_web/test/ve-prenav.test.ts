import { describe, expect, it } from 'vitest';
import { prenavigateEnabled } from '../e2e/ve/prenav.js';

describe('ve pre-navigation switch', () => {
  it('is on by default and off for 0, false and off', () => {
    expect(prenavigateEnabled({})).toBe(true);
    expect(prenavigateEnabled({ VE_PRENAVIGATE: '1' })).toBe(true);
    for (const off of ['0', 'false', 'OFF']) {
      expect(prenavigateEnabled({ VE_PRENAVIGATE: off })).toBe(false);
    }
  });
});
