import { AtError } from './error.js';
import type { AtKey } from './index.js';

/** [value] when it is a non-empty string; throws `invalid_argument` naming [field] otherwise. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new AtError(`AtKey.${field}: must be a non-empty string`, 'invalid_argument');
  }
  return value;
}

/**
 * The atKey text `notify` takes for [key]:
 * `[@recipient:]name[.namespace]@owner`.
 *
 * The namespace is [key.namespace] (lowercased), else [namespace]; it is left
 * off when [key.noNamespace] is true, and a namespace given beside that flag
 * is ignored. The owner is [key.sharedBy], else [atSign]. A `public` or
 * `cached` key cannot be sent as a notification, and throws `AtError`
 * `invalid_argument` naming the flag; a key part that is empty or not a
 * string — the name, `sharedWith`, `sharedBy` or a used `namespace` — throws
 * it naming the field.
 */
export function toKeyText(key: AtKey, namespace: string, atSign: string): string {
  if (key.public === true) {
    throw new AtError('AtKey.public: cannot be sent in a notification', 'invalid_argument');
  }
  if (key.cached === true) {
    throw new AtError('AtKey.cached: cannot be sent in a notification', 'invalid_argument');
  }
  const name = text(key.key, 'key');
  const sharedWith = key.sharedWith === undefined ? undefined : text(key.sharedWith, 'sharedWith');
  const sharedBy = key.sharedBy === undefined ? undefined : text(key.sharedBy, 'sharedBy');
  const recipient = sharedWith === undefined ? '' : `${sharedWith}:`;
  const qualified =
    key.noNamespace === true
      ? name
      : `${name}.${(key.namespace === undefined ? namespace : text(key.namespace, 'namespace')).toLowerCase()}`;
  return `${recipient}${qualified}${sharedBy ?? atSign}`;
}

/**
 * The `AtKey` a key string names: `[cached:][public:|@with:]key.namespace[@by]`.
 * The namespace is [namespace] when the key ends in it, else the last
 * dot-separated segment; a key with no dot has none and is marked
 * `noNamespace`. A key ending in a dot has no namespace either: it is marked
 * `noNamespace` and the dot stays in the key. The `public:` and `cached:`
 * prefixes are kept as flags, so the result names the same record when passed
 * back to the client.
 *
 * The atSigns and the namespace in the result are lowercase. A malformed
 * recipient, owner or key name throws `AtError` `bad_key`, its message naming
 * the expected shape.
 */
export function parseKey(text: string, namespace?: string): AtKey {
  let rest = text;
  const key: Partial<AtKey> = {};

  if (rest.startsWith('cached:')) {
    key.cached = true;
    rest = rest.slice('cached:'.length);
  }

  if (rest.startsWith('public:')) {
    key.public = true;
    rest = rest.slice('public:'.length);
  } else if (rest.startsWith('@')) {
    const colon = rest.indexOf(':');
    if (colon <= 1) throw new AtError('key recipient: must be @atSign: before the key', 'bad_key');
    key.sharedWith = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }

  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    const owner = rest.slice(at).toLowerCase();
    if (owner.length <= 1) throw new AtError('key owner: must be @atSign after the key', 'bad_key');
    key.sharedBy = owner;
    rest = rest.slice(0, at);
  }
  if (rest.includes('@') || rest.length === 0) {
    throw new AtError('key name: must be non-empty with at most one @atSign suffix', 'bad_key');
  }

  const normalizedNamespace = namespace?.toLowerCase();
  const suffix = normalizedNamespace === undefined ? undefined : `.${normalizedNamespace}`;
  const dot = rest.lastIndexOf('.');
  if (suffix !== undefined && rest.toLowerCase().endsWith(suffix) && rest.length > suffix.length) {
    key.key = rest.slice(0, -suffix.length);
    key.namespace = normalizedNamespace;
  } else if (dot > 0 && dot < rest.length - 1) {
    key.key = rest.slice(0, dot);
    key.namespace = rest.slice(dot + 1).toLowerCase();
  } else {
    key.key = rest;
    key.noNamespace = true;
  }

  const ordered: AtKey = { key: key.key! };
  if (key.namespace !== undefined) ordered.namespace = key.namespace;
  if (key.sharedWith !== undefined) ordered.sharedWith = key.sharedWith;
  if (key.sharedBy !== undefined) ordered.sharedBy = key.sharedBy;
  if (key.public) ordered.public = true;
  if (key.cached) ordered.cached = true;
  if (key.noNamespace) ordered.noNamespace = true;
  return ordered;
}
