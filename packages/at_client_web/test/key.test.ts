import { describe, expect, it } from 'vitest';
import { parseKey, toKeyText } from '../src/key.js';
import { AtError } from '../src/error.js';

describe('toKeyText', () => {
  const self = '@alice';

  it('composes the recipient, key, session namespace and session atSign', () => {
    expect(toKeyText({ key: 'note', sharedWith: '@bob' }, 'wavi', self)).toBe('@bob:note.wavi@alice');
  });

  it('notify with a sharedBy other than the session atSign rejects invalid_argument and sends nothing', () => {
    expect(
      refusal({ key: 'k', namespace: 'Other', sharedWith: '@bob', sharedBy: '@carol' } as never),
    ).toMatchObject({
      code: 'invalid_argument',
      message: 'NotifyKey.sharedBy: must be the session atSign',
    });
  });

  it('notify accepts a sharedBy equal to the session atSign in any case', () => {
    expect(
      toKeyText({ key: 'k', sharedWith: '@bob', sharedBy: '@ALICE' } as never, 'wavi', self),
    ).toBe('@bob:k.wavi@alice');
  });

  it('adds no namespace, and ignores a given one, when noNamespace is true', () => {
    expect(toKeyText({ key: 'k', sharedWith: '@bob', noNamespace: true }, 'wavi', self)).toBe('@bob:k@alice');
    expect(
      toKeyText({ key: 'k', namespace: 'other', sharedWith: '@bob', noNamespace: true }, 'wavi', self),
    ).toBe('@bob:k@alice');
  });

  it('refuses a public key, naming the flag', () => {
    expect(refusal({ key: 'k', sharedWith: '@bob', public: true } as never)).toMatchObject({
      code: 'invalid_argument',
      message: 'NotifyKey.public: cannot be sent in a notification',
    });
  });

  it('refuses a cached key, naming the flag', () => {
    expect(refusal({ key: 'k', sharedWith: '@bob', cached: true } as never)).toMatchObject({
      code: 'invalid_argument',
      message: 'NotifyKey.cached: cannot be sent in a notification',
    });
  });

  it('notify refuses a truthy public or cached flag', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ key: 'k', sharedWith: '@bob', public: true }, 'NotifyKey.public'],
      [{ key: 'k', sharedWith: '@bob', public: 1 }, 'NotifyKey.public'],
      [{ key: 'k', sharedWith: '@bob', public: 'yes' }, 'NotifyKey.public'],
      [{ key: 'k', sharedWith: '@bob', cached: true }, 'NotifyKey.cached'],
      [{ key: 'k', sharedWith: '@bob', cached: 1 }, 'NotifyKey.cached'],
      [{ key: 'k', sharedWith: '@bob', cached: 'yes' }, 'NotifyKey.cached'],
    ];
    for (const [key, field] of cases) {
      expect(refusal(key as never)).toMatchObject({
        code: 'invalid_argument',
        message: `${field}: cannot be sent in a notification`,
      });
    }
  });

  it('notify refuses delimiters in key parts with invalid_argument naming the field', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ key: 'k', sharedWith: '@bob', sharedBy: 'x@alice' }, 'NotifyKey.sharedBy'],
      [{ key: 'k', sharedWith: '@bob', namespace: 'a.b' }, 'NotifyKey.namespace'],
      [{ key: 'a@b', sharedWith: '@bob' }, 'NotifyKey.key'],
      [{ key: 'a:b', sharedWith: '@bob' }, 'NotifyKey.key'],
      [{ key: '.k', sharedWith: '@bob' }, 'NotifyKey.key'],
      [{ key: 'k.', sharedWith: '@bob' }, 'NotifyKey.key'],
      [{ key: 'a b', sharedWith: '@bob' }, 'NotifyKey.key'],
      [{ key: 'k', sharedWith: 'bob' }, 'NotifyKey.sharedWith'],
      [{ key: 'k', sharedWith: '@a@b' }, 'NotifyKey.sharedWith'],
      [{ key: 'k', sharedWith: '@a:b' }, 'NotifyKey.sharedWith'],
    ];
    for (const [key, field] of cases) {
      const error = refusal(key as never);
      expect(error.code).toBe('invalid_argument');
      expect(error.message.startsWith(`${field}:`)).toBe(true);
    }
  });

  function refusal(key: Parameters<typeof toKeyText>[0]): AtError {
    try {
      toKeyText(key, 'wavi', self);
    } catch (error) {
      expect(error).toBeInstanceOf(AtError);
      return error as AtError;
    }
    throw new Error('expected a refusal');
  }
});

describe('parseKey', () => {
  it('splits a self key into key, namespace and sharedBy', () => {
    expect(parseKey('@alice:note.wavi@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'wavi', sharedWith: '@alice', sharedBy: '@alice',
    });
  });

  it('reads a key with no recipient prefix', () => {
    expect(parseKey('note.wavi@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'wavi', sharedBy: '@alice',
    });
  });

  it('keeps dots in the key when the namespace is the default', () => {
    expect(parseKey('rpc.req.1.tally@alice', 'tally')).toEqual({
      key: 'rpc.req.1', namespace: 'tally', sharedBy: '@alice',
    });
  });

  it('takes the last segment as the namespace when it is not the default', () => {
    expect(parseKey('@bob:a.b.other@alice', 'wavi')).toEqual({
      key: 'a.b', namespace: 'other', sharedWith: '@bob', sharedBy: '@alice',
    });
  });

  it('carries the public and cached prefixes', () => {
    expect(parseKey('public:note.wavi@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'wavi', sharedBy: '@alice', public: true,
    });
    expect(parseKey('cached:@bob:note.wavi@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'wavi', sharedWith: '@bob', sharedBy: '@alice', cached: true,
    });
    expect(parseKey('cached:public:note.wavi@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'wavi', sharedBy: '@alice', public: true, cached: true,
    });
  });

  it('leaves the namespace out of a key that has none and says so', () => {
    expect(parseKey('@bob:shared_key@alice')).toEqual({
      key: 'shared_key', sharedWith: '@bob', sharedBy: '@alice', noNamespace: true,
    });
  });

  it('treats a trailing dot as no namespace', () => {
    expect(parseKey('note.')).toEqual({ key: 'note.', noNamespace: true });
    expect(parseKey('@bob:note.@alice')).toEqual({
      key: 'note.', sharedWith: '@bob', sharedBy: '@alice', noNamespace: true,
    });
  });

  it('accepts a string with no owner', () => {
    expect(parseKey('rpc.req.1.tally', 'tally')).toEqual({ key: 'rpc.req.1', namespace: 'tally' });
  });

  it('canonicalizes atSigns and namespaces to lowercase', () => {
    expect(parseKey('@Bob:note.WAVI@Alice', 'WAVI')).toEqual({
      key: 'note', namespace: 'wavi', sharedWith: '@bob', sharedBy: '@alice',
    });
    expect(parseKey('note.OTHER@alice', 'wavi')).toEqual({
      key: 'note', namespace: 'other', sharedBy: '@alice',
    });
  });

  it('rejects malformed keys', () => {
    expect(() => parseKey('@bob.wavi')).toThrow('key recipient: must be @atSign: before the key');
    expect(() => parseKey('note@')).toThrow('key owner: must be @atSign after the key');
    expect(() => parseKey('a@bob@alice')).toThrow('key name: must be non-empty with at most one @atSign suffix');
    expect(() => parseKey('@bob:@alice')).toThrow('key name: must be non-empty with at most one @atSign suffix');
  });

  it('names the expected shape without echoing the input', () => {
    const cases: Array<[string, string]> = [
      ['@secret.wavi', 'key recipient: must be @atSign: before the key'],
      ['secret@', 'key owner: must be @atSign after the key'],
      ['sec@ret@x', 'key name: must be non-empty with at most one @atSign suffix'],
    ];
    for (const [text, message] of cases) {
      const error = badKey(text);
      expect(error.code).toBe('bad_key');
      expect(error.message).toBe(message);
      expect(error.message).not.toContain(text);
    }
  });

  function badKey(text: string): AtError {
    try {
      parseKey(text);
    } catch (error) {
      expect(error).toBeInstanceOf(AtError);
      return error as AtError;
    }
    throw new Error('expected a refusal');
  }
});
