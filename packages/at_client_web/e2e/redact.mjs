// Reports leaked key material by field name only, never by value.

const MIN_VALUE_LENGTH = 16;
const MARKERS = ['PrivateKey', 'SelfEncryptionKey', 'apkamSymmetricKey'];

/**
 * Finds the field names whose long string values appear in any of `texts`,
 * plus a marker hit for each sensitive field-name marker a text contains.
 *
 * Returns sorted, unique names (for example `aesPkamPrivateKey` or
 * `marker:SelfEncryptionKey`). Values shorter than 16 characters are ignored,
 * and a value is never included in the result or in an error message.
 */
export function scanForSecrets(keysDoc, texts) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
    throw new TypeError('texts must be an array of strings');
  }

  // Value -> the JSON field names that held it. A Map keeps the value out of
  // any output: only the names travel back to the caller.
  const byValue = new Map();
  const visit = (node, fieldName) => {
    if (typeof node === 'string') {
      if (fieldName !== undefined && node.length >= MIN_VALUE_LENGTH) {
        const names = byValue.get(node) ?? new Set();
        names.add(fieldName);
        byValue.set(node, names);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, fieldName);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) visit(value, key);
    }
  };
  visit(keysDoc, undefined);

  const hits = new Set();
  for (const [value, names] of byValue) {
    if (texts.some((text) => text.includes(value))) {
      for (const name of names) hits.add(name);
    }
  }
  for (const text of texts) {
    for (const marker of MARKERS) {
      if (text.includes(marker)) hits.add(`marker:${marker}`);
    }
  }
  return [...hits].sort();
}
