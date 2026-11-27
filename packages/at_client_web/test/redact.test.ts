/**
 * The redaction scan reports a leaked key value by field name only.
 *
 * The value itself must never appear in the result, so a failure message can
 * be attached to a report without copying key material into it.
 */
import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../e2e/redact.mjs';

describe('scanForSecrets', () => {
  it('the redaction scan reports a leaked key value by field name only', () => {
    const secret = 'A'.repeat(40);
    const keysDoc = { aesPkamPrivateKey: secret, short: 'abc' };

    const hits = scanForSecrets(keysDoc, [`x ${secret} y`]);
    expect(hits).toEqual(['aesPkamPrivateKey']);
    expect(JSON.stringify(hits)).not.toContain(secret);

    expect(scanForSecrets(keysDoc, ['console: SelfEncryptionKey'])).toContain(
      'marker:SelfEncryptionKey',
    );

    expect(scanForSecrets(keysDoc, ['nothing here'])).toEqual([]);
  });
});
