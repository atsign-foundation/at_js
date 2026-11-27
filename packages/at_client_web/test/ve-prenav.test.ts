import { describe, expect, it } from 'vitest';
import { prenavigateEnabled } from '../e2e/ve/prenav.js';

describe('ve pre-navigation switch', () => {
  it('is off by default and on for 1, true and on', () => {
    expect(prenavigateEnabled({})).toBe(false);
    expect(prenavigateEnabled({ VE_PRENAVIGATE: '' })).toBe(false);
    expect(prenavigateEnabled({ VE_PRENAVIGATE: '0' })).toBe(false);
    for (const on of ['1', 'true', 'ON']) {
      expect(prenavigateEnabled({ VE_PRENAVIGATE: on })).toBe(true);
    }
  });
});
