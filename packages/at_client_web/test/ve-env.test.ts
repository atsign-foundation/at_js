/**
 * The VE browser flags.
 *
 * A project's `use.launchOptions` replaces the top-level one, so the VE
 * project must carry a complete flag list itself: one host-resolver rule that
 * maps both the e2e server name and the VE host, and the optional SPKI trust
 * entry.
 */
import { describe, expect, it } from 'vitest';
import { veBrowserArgs } from '../e2e/ve/env.mjs';

const resolverFlags = (args: string[]): string[] =>
  args.filter((arg) => arg.startsWith('--host-resolver-rules='));
const spkiFlags = (args: string[]): string[] =>
  args.filter((arg) => arg.startsWith('--ignore-certificate-errors-spki-list='));

describe('veBrowserArgs', () => {
  it('has one host-resolver rule with both mappings and no SPKI flag by default', () => {
    const args = veBrowserArgs();
    const resolver = resolverFlags(args);
    expect(resolver).toHaveLength(1);
    expect(resolver[0]).toContain('MAP insecure.test 127.0.0.1');
    expect(resolver[0]).toContain('MAP vip.ve.atsign.zone 127.0.0.1');
    // One flag only: Chromium honours a single --host-resolver-rules value.
    expect(resolver[0]).toContain('MAP insecure.test 127.0.0.1,MAP vip.ve.atsign.zone 127.0.0.1');
    expect(spkiFlags(args)).toEqual([]);
  });

  it('adds exactly one SPKI flag when one is given', () => {
    const args = veBrowserArgs('abc123=');
    expect(spkiFlags(args)).toEqual(['--ignore-certificate-errors-spki-list=abc123=']);
    expect(resolverFlags(args)).toHaveLength(1);
  });
});
