import { describe, expect, it } from 'vitest';
import { nextNodeVersion } from '../src/bump.ts';

const NOW = new Date('2026-11-19T00:00:00Z');

const index = [
  { version: 'v27.0.0', date: '2026-10-01' },
  { version: 'v26.14.0', date: '2026-11-17' },
  { version: 'v26.13.2', date: '2026-11-10' },
  { version: 'v26.13.1', date: '2026-11-01' },
  { version: 'v26.12.0', date: '2026-10-01' },
];

describe('nextNodeVersion', () => {
  it('the newest same-major patch past the cooldown is picked', () => {
    expect(nextNodeVersion('26.12.0', index, NOW)).toBe('26.13.2');
  });

  it('a newer major is ignored', () => {
    expect(nextNodeVersion('26.13.2', index, NOW)).toBeNull();
    expect(nextNodeVersion('26.12.0', index, NOW)).not.toMatch(/^27\./);
  });

  it('a release younger than 7 days is ignored', () => {
    expect(nextNodeVersion('26.13.1', index, NOW)).toBe('26.13.2');
    expect(nextNodeVersion('26.13.1', index, new Date('2026-11-24T00:00:00Z'))).toBe('26.14.0');
  });

  it('nothing is output when the pin is already the newest eligible patch', () => {
    expect(nextNodeVersion('26.13.2', index, NOW)).toBeNull();
  });

  it('a malformed .node-version is rejected', () => {
    for (const raw of ['', 'v26.13.1', '26.13', '26.13.1\n', '26.x.1', '26.13.1-rc.1']) {
      expect(() => nextNodeVersion(raw, index, NOW)).toThrow(`invalid current version: ${JSON.stringify(raw)}`);
    }
  });

  it('a malformed or non-greater candidate is rejected', () => {
    expect(nextNodeVersion('26.13.1', index, NOW)).toBe('26.13.2');
    const bad = [
      { version: 'v26.13.9x', date: '2026-10-01' },
      { version: 'v26.13.9-rc.1', date: '2026-10-01' },
      { version: 'v26.13.9', date: 'yesterday' },
      { version: 26, date: '2026-10-01' },
      null,
    ];
    // other majors' odd tags do not matter
    expect(nextNodeVersion('26.13.1', [...index, { version: 'v27.0.0-alpha.0.1', date: '2026-10-01' }], NOW)).toBe('26.13.2');
    for (const entry of bad) {
      expect(() => nextNodeVersion('26.13.1', [...index, entry], NOW)).toThrow();
    }
    expect(() => nextNodeVersion('26.13.1', 'not an array', NOW)).toThrow();
    // pin is newer than every eligible release
    expect(() => nextNodeVersion('26.13.3', index, NOW)).toThrow();
    // no release of the pinned major at all
    expect(() => nextNodeVersion('25.0.0', index, NOW)).toThrow();
  });
});
