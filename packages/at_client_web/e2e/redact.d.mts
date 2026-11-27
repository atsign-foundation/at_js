/**
 * Reports leaked key material by JSON field name only.
 *
 * Every string value of 16 or more characters anywhere in `keysDoc` is kept
 * with the last key on its path. The result lists the sorted unique field
 * names whose value appears in any of `texts`, plus `marker:<name>` for each
 * of `PrivateKey`, `SelfEncryptionKey` and `apkamSymmetricKey` found in a text.
 */
export function scanForSecrets(keysDoc: unknown, texts: string[]): string[];
