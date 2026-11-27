/**
 * Key conformance pins: row by row, what this package does with each kind of
 * caller key on the way out (`notify`) and each kind of bridge key text on the
 * way in (`subscribe`), with the bridge rule each row guards cited above it.
 *
 * The bridge itself is faked, so these run offline; the citations are to the
 * Dart side the fake stands in for:
 * - `at_client_session.dart` `_atKey`: a key with no `sharedWith` is refused
 *   (`KeyRefusal.sharedWithMissing`, about :292-293), and a `sharedBy` that is
 *   not the session atSign is refused (`KeyRefusal.sharedByMismatch`, about
 *   :310-311, after `_canonical` folds both sides).
 * - `session_namespace.dart`: a namespace is one word, `^\w+$`
 *   (`Regexes.charsInNamespace`), folded to lower case after that check.
 * - `js/bridge.dart:435-436`: the subscribe envelope bounds `key` with
 *   `boundedRejectionText` (128 units), and leaves `from` unbounded.
 * - `log_text.dart` `truncateText`: a longer key is cut to 125 units plus
 *   `...`, giving 128, and never splits a surrogate pair.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AtClient, AtError } from '../src/index.js';
import { setBridgeLoader, type Bridge, type BridgeOptions, type BridgeSession } from '../src/loader.js';

type Listener = (payload: unknown) => void;

/** The smallest fake bridge these rows need: notify and subscribe. */
function fakeSession() {
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const session = {
    notify: vi.fn(async (_key: string, _value: string) => true),
    subscribe: vi.fn((_regex: string, listener: Listener) => {
      listeners.push(listener);
      return unsubscribe;
    }),
  };
  return { session, listeners, unsubscribe };
}

function fakeBridge(session: BridgeSession) {
  return { create: vi.fn(async (_options: BridgeOptions) => session) };
}

const keys = '{"@alice":{}}';

let fake: ReturnType<typeof fakeSession>;
let loader: ReturnType<typeof vi.fn<() => Promise<Bridge>>>;

beforeEach(() => {
  fake = fakeSession();
  const bridge = fakeBridge(fake.session as unknown as BridgeSession);
  loader = vi.fn(async () => bridge as unknown as Bridge);
  setBridgeLoader(loader);
  vi.stubGlobal('window', { isSecureContext: true });
});

afterEach(() => {
  setBridgeLoader();
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<AtError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AtError);
    return e as AtError;
  }
  throw new Error('expected a rejection');
}

interface OutboundCase {
  /** The caller's key. */
  input: Record<string, unknown>;
  /** The exact atKey text the bridge must receive, or absent when refused. */
  sends?: string;
  /** The `NotifyKey.<field>` the refusal must name, or absent when sent. */
  refuses?: string;
}

interface OutboundRow {
  /** The row's name, as the `notify key conformance:` title continues. */
  row: string;
  /** The session to open; `@alice` in namespace `tally` when left out. */
  session?: { atSign: `@${string}`; namespace: string };
  /** The row's cases; each is the same kind of caller key, so all behave alike. */
  cases: OutboundCase[];
}

const alice = { atSign: '@alice' as const, namespace: 'tally' };

const outbound: OutboundRow[] = [
  // `_atKey` accepts this: `sharedWith` is present (:292-293 passes), the
  // sharedBy is the session atSign (:310-311 passes), and the text is
  // `[@recipient:]name[.namespace]@owner`, which `AtKey.fromString` parses.
  {
    row: 'plain shared key',
    cases: [{ input: { key: 'k', sharedWith: '@bob' }, sends: '@bob:k.tally@alice' }],
  },
  // The namespace in the text is the one `_atKey` later validates as one
  // segment and folds to lower case (`session_namespace.dart`, `^\w+$`).
  {
    row: 'own namespace',
    cases: [{ input: { key: 'k', namespace: 'Wavi', sharedWith: '@bob' }, sends: '@bob:k.wavi@alice' }],
  },
  // `_atKey` checks `parts.last.split('@').first` as a key segment; with no
  // namespace the text is `key@owner`, which passes.
  {
    row: 'noNamespace',
    cases: [{ input: { key: 'k', sharedWith: '@bob', noNamespace: true }, sends: '@bob:k@alice' }],
  },
  // `AtKey.fromString` splits the owner on `@`, so `@bob.smith` is one owner;
  // `_atKey` compares the canonical sharedBy with the session's.
  {
    row: 'dotted session owner',
    session: { atSign: '@bob.smith', namespace: 'ns' },
    cases: [{ input: { key: 'x', namespace: 'ns', sharedWith: '@carol' }, sends: '@carol:x.ns@bob.smith' }],
  },
  // `_atKey` refuses a key with no recipient (`KeyRefusal.sharedWithMissing`,
  // about :292-293), so nothing may reach the bridge.
  {
    row: 'missing sharedWith',
    cases: [{ input: { key: 'k' }, refuses: 'NotifyKey.sharedWith' }],
  },
  // `_atKey` refuses a sharedBy other than the session atSign
  // (`KeyRefusal.sharedByMismatch`, about :310-311).
  {
    row: 'foreign sharedBy',
    cases: [{ input: { key: 'k', sharedWith: '@bob', sharedBy: '@carol' }, refuses: 'NotifyKey.sharedBy' }],
  },
  // `_atKey` canonicalises before comparing, so any case of the session's own
  // atSign is the same owner; the text carries the session's spelling.
  {
    row: 'same-owner sharedBy any case',
    cases: [{ input: { key: 'k', sharedWith: '@bob', sharedBy: '@ALICE' }, sends: '@bob:k.tally@alice' }],
  },
  // `session_namespace.dart` admits one word, `^\w+$`, so a dotted namespace
  // could never pass `_atKey`'s segment check.
  {
    row: 'dotted namespace',
    cases: [{ input: { key: 'k', sharedWith: '@bob', namespace: 'a.b' }, refuses: 'NotifyKey.namespace' }],
  },
  // `_atKey` refuses these as `KeyRefusal.atKey`: a name with `@` or `:`
  // breaks `AtKey.fromString`, and a leading `.` leaves an empty segment.
  {
    row: 'delimiter in name',
    cases: [
      { input: { key: 'a@b', sharedWith: '@bob' }, refuses: 'NotifyKey.key' },
      { input: { key: 'a:b', sharedWith: '@bob' }, refuses: 'NotifyKey.key' },
      { input: { key: '.k', sharedWith: '@bob' }, refuses: 'NotifyKey.key' },
    ],
  },
  // `_atKey` refuses `public:` and `cached:` key text outright
  // (`KeyRefusal.publicKey` / `KeyRefusal.cachedKey`), so the client must
  // refuse the flags before composing any text.
  {
    row: 'public / cached',
    cases: [
      { input: { key: 'k', sharedWith: '@bob', public: true }, refuses: 'NotifyKey.public' },
      { input: { key: 'k', sharedWith: '@bob', cached: 1 }, refuses: 'NotifyKey.cached' },
    ],
  },
];

for (const row of outbound) {
  it(`notify key conformance: ${row.row}`, async () => {
    const client = await AtClient.create({ ...(row.session ?? alice), keys });
    for (const { input, sends, refuses } of row.cases) {
      if (refuses !== undefined) {
        const error = await rejection(client.notify(input as never, 'v'));
        expect(error.code).toBe('invalid_argument');
        expect(error.message).toContain(refuses);
        continue;
      }
      await client.notify(input as never, 'v');
      expect(fake.session.notify).toHaveBeenLastCalledWith(sends, 'v');
    }
    if (row.cases.every(({ refuses }) => refuses !== undefined)) {
      expect(fake.session.notify).not.toHaveBeenCalled();
    } else {
      expect(fake.session.notify).toHaveBeenCalledTimes(row.cases.length);
    }
  });
}

interface InboundRow {
  /** The row's name, as the `subscribe key conformance:` title continues. */
  row: string;
  /** The key text the bridge envelope carries (already bounded, per `bridge.dart`). */
  key: string;
  /** The notification's `from`, as the bridge's verified sender. */
  from: unknown;
  /** The `AtKey` the event must carry; absent when the notification is skipped. */
  carries?: Record<string, unknown>;
  /** The unit count `bridge.dart:435-436` bounds the key text to, on a cut row. */
  bounds?: number;
}

const cut = `${'k'.repeat(125)}...`;

const inbound: InboundRow[] = [
  // `AtKey.fromString` reads the recipient, name, namespace and owner; the
  // event then takes its owner from the verified `from` (`bridge.dart:435-436`
  // passes `from` through unbounded).
  {
    row: 'plain key',
    from: '@bob',
    key: '@alice:k.tally@bob',
    carries: { key: 'k', namespace: 'tally', sharedWith: '@alice', sharedBy: '@bob' },
  },
  // The key text's `@bob.smith` is split by `AtKey.fromString` on the last
  // `@`, but the envelope's authenticated `from` is the authority for the
  // owner, so the event's sharedBy is `@bobsmith`.
  {
    row: 'dotted owner',
    from: '@bobsmith',
    key: '@alice:k.tally@bob.smith',
    carries: { key: 'k', namespace: 'tally', sharedWith: '@alice', sharedBy: '@bobsmith' },
  },
  // `bridge.dart:435-436` bounds `key` with `boundedRejectionText`; a 130-unit
  // text arrives as `log_text.dart`'s `truncateText` leaves it, 125 units plus
  // `...` (128), and is not parsed.
  {
    row: '130-char key cut to 128',
    from: '@bob',
    key: cut,
    bounds: 128,
    carries: { key: cut, sharedBy: '@bob', truncated: true },
  },
  // A `from` that is not one `@atSign` is no verified sender (`bridge.dart`
  // passes it unchanged), so the notification is skipped.
  {
    row: 'no verified sender',
    from: 'bob',
    key: '@alice:k.tally@bob',
  },
];

for (const row of inbound) {
  it(`subscribe key conformance: ${row.row}`, async () => {
    const client = await AtClient.create({ ...alice, keys });
    const events = client.subscribe()[Symbol.asyncIterator]();
    if (row.bounds !== undefined) expect(row.key).toHaveLength(row.bounds);
    fake.listeners[0]!({
      id: 'n1',
      value: 'v',
      epochMillis: 1,
      operation: 'update',
      from: row.from,
      key: row.key,
    });
    if (row.carries === undefined) {
      // The skipped notification must not surface: the next event is the one
      // after it.
      fake.listeners[0]!({
        id: 'n2',
        value: 'v',
        epochMillis: 2,
        operation: 'update',
        from: '@bob',
        key: 'sentinel.tally@bob',
      });
      expect((await events.next()).value.key).toMatchObject({
        key: 'sentinel',
        namespace: 'tally',
        sharedBy: '@bob',
      });
      return;
    }
    expect((await events.next()).value.key).toEqual(row.carries);
  });
}
