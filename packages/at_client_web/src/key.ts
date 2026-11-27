import { AtError } from './error.js';
import type { AtKey, NotifyKey } from './index.js';

/** [value] when it is a non-empty string; throws `invalid_argument` naming [field] otherwise. */
function part(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new AtError(`NotifyKey.${field}: must be a non-empty string`, 'invalid_argument');
  }
  return value;
}

/** [value] when it is a key name with no delimiter and no leading or trailing dot. */
function name(value: unknown): string {
  const key = part(value, 'key');
  if (/[@:\s\x00-\x1f\x7f]/.test(key) || key.startsWith('.') || key.endsWith('.')) {
    throw new AtError(
      "NotifyKey.key: must have no '@', ':' or whitespace and no leading or trailing '.'",
      'invalid_argument',
    );
  }
  return key;
}

/** [value] when it is one `@atSign`, with no further `@`, `:` or whitespace. */
function recipient(value: unknown): string {
  const sharedWith = part(value, 'sharedWith');
  if (!/^@[^@:\s]+$/.test(sharedWith)) {
    throw new AtError(
      "NotifyKey.sharedWith: must be one @atSign with no ':' or whitespace",
      'invalid_argument',
    );
  }
  return sharedWith;
}

/** [value] when it is one namespace segment. */
function segment(value: unknown): string {
  const namespace = part(value, 'namespace');
  if (!/^\w+$/.test(namespace)) {
    throw new AtError("NotifyKey.namespace: must be one word of letters, digits or '_'", 'invalid_argument');
  }
  return namespace;
}

/**
 * The atKey text `notify` takes for [key]:
 * `[@recipient:]name[.namespace]@owner`.
 *
 * `sharedWith` is required. The namespace is [key.namespace] (lowercased),
 * else [namespace]; it is left off when [key.noNamespace] is true, and a
 * namespace given beside that flag is ignored and not validated. The owner is
 * always [atSign], the session atSign. A field mistake throws `AtError`
 * `invalid_argument` naming `NotifyKey.<field>`: a name with `@`, `:` or
 * whitespace, or a leading or trailing dot; a `sharedWith` that is not one
 * `@atSign`; a `namespace` that is not one segment; a `sharedBy` that is not
 * the session atSign; or a truthy `public` or `cached` flag. A [key] that is
 * not an object throws it naming `NotifyKey`.
 */
export function toKeyText(key: NotifyKey, namespace: string, atSign: string): string {
  if (typeof key !== 'object' || key === null || Array.isArray(key)) {
    throw new AtError('NotifyKey: must be an object', 'invalid_argument');
  }
  const input = key as NotifyKey & { sharedBy?: unknown; public?: unknown; cached?: unknown };
  if (input.public) {
    throw new AtError('NotifyKey.public: cannot be sent in a notification', 'invalid_argument');
  }
  if (input.cached) {
    throw new AtError('NotifyKey.cached: cannot be sent in a notification', 'invalid_argument');
  }
  const keyName = name(input.key);
  const sharedWith = recipient(input.sharedWith);
  if (input.sharedBy !== undefined && part(input.sharedBy, 'sharedBy').toLowerCase() !== atSign.toLowerCase()) {
    throw new AtError('NotifyKey.sharedBy: must be the session atSign', 'invalid_argument');
  }
  const qualified =
    input.noNamespace === true
      ? keyName
      : `${keyName}.${(input.namespace === undefined ? namespace : segment(input.namespace)).toLowerCase()}`;
  return `${sharedWith}:${qualified}${atSign}`;
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
