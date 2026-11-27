/**
 * The network guard policies.
 *
 * The default policy keeps a test on loopback; the VE policy additionally
 * admits the VE root and atServer ports, and only the atServer's `/ws` socket.
 */
import { describe, expect, it } from 'vitest';
import { loopbackPolicy, vePolicy } from '../e2e/guard-policy.js';

describe('loopbackPolicy', () => {
  it('allows the loopback hosts the e2e server answers on', () => {
    expect(loopbackPolicy.allowRequest(new URL('http://127.0.0.1:4173/x'))).toBe(true);
    expect(loopbackPolicy.allowRequest(new URL('http://insecure.test:4173/'))).toBe(true);
    expect(loopbackPolicy.allowRequest(new URL('http://localhost:1/'))).toBe(true);
  });

  it('refuses everything else and every socket', () => {
    expect(loopbackPolicy.allowRequest(new URL('https://example.com/'))).toBe(false);
    expect(loopbackPolicy.allowSocket(new URL('wss://vip.ve.atsign.zone:26301/ws'))).toBe(false);
  });
});

describe('vePolicy', () => {
  const policy = vePolicy();

  it('allows requests to the VE root and atServer ports', () => {
    expect(policy.allowRequest(new URL('https://vip.ve.atsign.zone:26300/@x'))).toBe(true);
    expect(policy.allowRequest(new URL('https://vip.ve.atsign.zone:26399/'))).toBe(true);
  });

  it('allows only the atServer /ws socket', () => {
    expect(policy.allowSocket(new URL('wss://vip.ve.atsign.zone:26301/ws'))).toBe(true);
  });

  it('refuses ports outside the range, a default port, a look-alike host and other schemes', () => {
    expect(policy.allowRequest(new URL('https://vip.ve.atsign.zone:26400/'))).toBe(false);
    expect(policy.allowRequest(new URL('https://vip.ve.atsign.zone/'))).toBe(false);
    expect(policy.allowRequest(new URL('https://vip.ve.atsign.zone.evil.test:26301/'))).toBe(false);
    expect(policy.allowRequest(new URL('https://example.com/'))).toBe(false);
  });

  it('refuses plain ws, another path and a loopback socket', () => {
    expect(policy.allowSocket(new URL('ws://vip.ve.atsign.zone:26301/ws'))).toBe(false);
    expect(policy.allowSocket(new URL('wss://vip.ve.atsign.zone:26301/other'))).toBe(false);
    expect(policy.allowSocket(new URL('wss://127.0.0.1:26301/ws'))).toBe(false);
  });
});
