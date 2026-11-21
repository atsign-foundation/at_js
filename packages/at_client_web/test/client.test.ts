import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtClient, AtError } from '../src/index.js';
import { MAX_BUFFERED_EVENTS } from '../src/subscription.js';
import { setBridgeLoader, type Bridge, type BridgeOptions, type BridgeSession } from '../src/loader.js';

type Listener = (payload: unknown) => void;

function fakeCollection() {
  const watchers: Array<{ onEvent: Listener; onError: Listener }> = [];
  const stop = vi.fn();
  const item = { id: 'i1', owner: '@alice', type: 'task', data: { n: 1 }, sharedWith: [], createdAt: 1, expiresAt: 2, availableAt: null };
  const listing = { items: [item], unreadable: [{ id: 'u1', owner: '@bob', code: 'COLLECTION_ITEM_UNREADABLE' }] };
  const collection = {
    create: vi.fn(async () => item),
    get: vi.fn(async () => item as typeof item | null),
    list: vi.fn(async () => listing),
    query: vi.fn(async () => listing),
    update: vi.fn(async () => item),
    share: vi.fn(async () => item),
    remove: vi.fn(async () => null),
    watch: vi.fn((onEvent: Listener, onError: Listener) => {
      watchers.push({ onEvent, onError });
      return stop as () => void;
    }),
  };
  return { collection, watchers, stop, item, listing };
}

function fakeSession() {
  const listeners: Listener[] = [];
  const errorSinks: Listener[] = [];
  const statusListeners: Array<(status: string) => void> = [];
  const unsubscribe = vi.fn();
  const stopStatus = vi.fn();
  const col = fakeCollection();
  const session = {
    notify: vi.fn(async () => true),
    subscribe: vi.fn((_regex: string, listener: Listener, onError?: Listener) => {
      listeners.push(listener);
      if (onError) errorSinks.push(onError);
      return unsubscribe;
    }),
    status: vi.fn(() => 'connecting'),
    onStatus: vi.fn((listener: (status: string) => void) => {
      statusListeners.push(listener);
      return stopStatus;
    }),
    collection: vi.fn(async () => col.collection),
    otp: vi.fn(async () => '123456'),
    pendingEnrollments: vi.fn(async () => []),
    approve: vi.fn(async () => null),
    deny: vi.fn(async () => null),
    close: vi.fn(async () => null),
  };
  return { session, listeners, errorSinks, statusListeners, unsubscribe, stopStatus, col };
}

function fakeBridge(session: BridgeSession) {
  return {
    create: vi.fn(async (_options: BridgeOptions) => session),
  };
}

function browser(overrides: { isSecureContext?: boolean } = {}) {
  vi.stubGlobal('window', { isSecureContext: overrides.isSecureContext ?? true });
}

const keys = '{"@alice":{}}';
const opts = { atSign: '@alice', namespace: 'tally', keys };

let fake: ReturnType<typeof fakeSession>;
let bridge: ReturnType<typeof fakeBridge>;
let loader: ReturnType<typeof vi.fn<() => Promise<Bridge>>>;

beforeEach(() => {
  fake = fakeSession();
  bridge = fakeBridge(fake.session as unknown as BridgeSession);
  loader = vi.fn(async () => bridge as unknown as Bridge);
  setBridgeLoader(loader);
  browser();
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

describe('create', () => {
  it('passes the atSign, namespace and keys to the bridge', async () => {
    await AtClient.create(opts);
    expect(bridge.create).toHaveBeenCalledWith({ atSign: '@alice', namespace: 'tally', keys });
  });

  it('passes keys given as an object through', async () => {
    const document = { '@alice': { k: 'v' } };
    await AtClient.create({ ...opts, keys: document });
    expect(bridge.create.mock.calls[0]![0].keys).toBe(document);
  });

  it('passes any rootDomain through', async () => {
    await AtClient.create({ ...opts, rootDomain: 'root.example.org:9002' });
    expect(bridge.create).toHaveBeenCalledWith({
      atSign: '@alice',
      namespace: 'tally',
      keys,
      rootDomain: 'root.example.org:9002',
    });
  });

  it('a missing namespace rejects bad_key before loading the bridge', async () => {
    const error = await rejection(AtClient.create({ atSign: '@alice', keys }));
    expect(error.code).toBe('bad_key');
    expect(loader).not.toHaveBeenCalled();
  });

  it('missing keys reject bad_key before loading the bridge', async () => {
    const error = await rejection(AtClient.create({ atSign: '@alice', namespace: 'tally' } as never));
    expect(error.code).toBe('bad_key');
    expect(loader).not.toHaveBeenCalled();
  });

  it('no window rejects unsupported', async () => {
    vi.unstubAllGlobals();
    expect((await rejection(AtClient.create(opts))).code).toBe('unsupported');
    expect(loader).not.toHaveBeenCalled();
  });

  it('a non-secure context rejects unsupported', async () => {
    browser({ isSecureContext: false });
    expect((await rejection(AtClient.create(opts))).code).toBe('unsupported');
    expect(loader).not.toHaveBeenCalled();
  });

  it('has no passkey entry points', () => {
    for (const name of ['onboard', 'enroll', 'prfSupported']) {
      expect(name in AtClient).toBe(false);
    }
  });
});

describe('error mapping', () => {
  it('maps a {code, message} rejection to an AtError', async () => {
    bridge.create.mockRejectedValueOnce({ code: 'pkam_refused', message: 'refused' });
    const error = await rejection(AtClient.create(opts));
    expect(error).toMatchObject({ name: 'AtError', message: 'refused', code: 'pkam_refused' });
    expect(error).toBeInstanceOf(Error);
  });

  it('maps every code through unchanged', async () => {
    for (const code of [
      'pkam_refused', 'offline', 'onboarding_incomplete', 'enrollment_denied',
      'enrollment_conveyance_failed', 'closed', 'unsupported', 'internal', 'bad_key',
      'COLLECTION_INVALID_ARGUMENT', 'COLLECTION_ITEM_NOT_FOUND', 'COLLECTION_ITEM_NOT_OWNER',
      'COLLECTION_ITEM_ALREADY_EXISTS', 'COLLECTION_ITEM_HAS_SUB_ITEMS', 'COLLECTION_ITEM_UNREADABLE',
      'COLLECTION_ITEM_TOO_DEEP', 'COLLECTION_TYPE_MISMATCH', 'COLLECTION_ITEM_WRONG_TYPE',
      'COLLECTION_PARTIAL_FAILURE', 'COLLECTION_FAILED',
    ]) {
      bridge.create.mockRejectedValueOnce({ code, message: code });
      expect((await rejection(AtClient.create(opts))).code).toBe(code);
    }
  });

  it('maps an unknown code or a thrown Error to internal', async () => {
    bridge.create.mockRejectedValueOnce({ code: 'brand_new', message: 'm' });
    expect((await rejection(AtClient.create(opts))).code).toBe('internal');
    bridge.create.mockRejectedValueOnce(new TypeError('boom'));
    expect(await rejection(AtClient.create(opts))).toMatchObject({ code: 'internal', message: 'boom' });
  });

  it('maps session call rejections too', async () => {
    const client = await AtClient.create(opts);
    fake.session.notify.mockRejectedValueOnce({ code: 'offline', message: 'down' });
    expect((await rejection(client.notify({ key: 'k', sharedWith: '@bob' }, 'v'))).code).toBe('offline');
    fake.session.otp.mockRejectedValueOnce({ code: 'closed', message: 'gone' });
    expect((await rejection(client.otp())).code).toBe('closed');
  });

  it('keeps AtError a subclass of Error with the given code', () => {
    const error = new AtError('m', 'offline');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('offline');
    expect(error.name).toBe('AtError');
  });
});

describe('session calls', () => {
  it('notify resolves what the bridge reports', async () => {
    const client = await AtClient.create(opts);
    expect(await client.notify({ key: 'rpc.req.1', sharedWith: '@alice' }, 'ping')).toBe(true);
    expect(fake.session.notify).toHaveBeenCalledWith(
      { key: 'rpc.req.1', namespace: 'tally', sharedWith: '@alice' },
      'ping',
    );
    fake.session.notify.mockResolvedValueOnce(false);
    expect(await client.notify({ key: 'x', sharedWith: '@alice' }, 'ping')).toBe(false);
  });
});

describe('pairing', () => {
  it('otp, pendingEnrollments, approve and deny reach the bridge', async () => {
    const client = await AtClient.create(opts);
    expect(await client.otp()).toBe('123456');
    const pending = [{ id: 'e1', appName: 'app', deviceName: 'phone', namespaces: { tally: 'rw' } }];
    fake.session.pendingEnrollments.mockResolvedValueOnce(pending as never);
    expect(await client.pendingEnrollments()).toEqual(pending);
    await client.approve('e1');
    await client.deny('e2');
    expect(fake.session.approve).toHaveBeenCalledWith('e1');
    expect(fake.session.deny).toHaveBeenCalledWith('e2');
  });

  it('maps an unsupported rejection', async () => {
    const client = await AtClient.create(opts);
    fake.session.otp.mockRejectedValueOnce({ code: 'unsupported', message: 'no __manage' });
    expect((await rejection(client.otp())).code).toBe('unsupported');
  });
});

describe('subscribe', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    from: '@alice',
    key: '@alice:rpc.req.1.tally@alice',
    value: 'ping',
    epochMillis: 1,
    operation: 'update',
    ...over,
  });

  it('a failed subscribe surfaces its code as an AtError', async () => {
    const client = await AtClient.create(opts);
    fake.session.subscribe.mockReturnValueOnce({ code: 'closed', message: 'the session is closed' } as never);
    expect(() => client.subscribe()).toThrow(expect.objectContaining({ name: 'AtError', code: 'closed' }));
  });

  it('throws the AtError of a {code, message} the bridge throws', async () => {
    const client = await AtClient.create(opts);
    fake.session.subscribe.mockImplementationOnce(() => {
      throw { code: 'closed', message: 'the session is closed' };
    });
    expect(() => client.subscribe()).toThrow(expect.objectContaining({ code: 'closed' }));
  });

  it('registers on the bridge at call time, not at the first next()', async () => {
    const client = await AtClient.create(opts);
    client.subscribe('rpc');
    expect(fake.session.subscribe).toHaveBeenCalledTimes(1);
    expect(fake.session.subscribe.mock.calls[0]![0]).toBe('rpc');
  });

  it('defaults the regex to the namespace', async () => {
    const client = await AtClient.create({ ...opts, namespace: 'tally.v1' });
    client.subscribe();
    expect(fake.session.subscribe.mock.calls[0]![0]).toBe('\\.tally\\.v1@');
  });

  it('buffers events and maps them to AtEvents', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe()[Symbol.asyncIterator]();
    fake.listeners[0]!(payload());
    fake.listeners[0]!(payload({ operation: 'delete', value: null, key: 'note.tally@bob' }));
    expect(await events.next()).toEqual({
      done: false,
      value: {
        operation: 'update',
        from: '@alice',
        key: { key: 'rpc.req.1', namespace: 'tally', sharedWith: '@alice', sharedBy: '@alice' },
        value: 'ping',
      },
    });
    const second = await events.next();
    expect(second.value).toEqual({
      operation: 'delete',
      from: '@alice',
      key: { key: 'note', namespace: 'tally', sharedBy: '@bob' },
    });
    expect('value' in second.value).toBe(false);
  });

  it('carries the sending atSign from the bridge', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe()[Symbol.asyncIterator]();
    fake.listeners[0]!(payload({ from: '@bob', key: 'note.tally@bob' }));
    expect((await events.next()).value.from).toBe('@bob');
  });

  it('a subscription that buffers past the cap unsubscribes and rejects with overflow', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe()[Symbol.asyncIterator]();
    for (let i = 0; i <= MAX_BUFFERED_EVENTS; i++) fake.listeners[0]!(payload());
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    await expect(events.next()).rejects.toMatchObject({ code: 'overflow' });
    expect(await events.next()).toEqual({ done: true, value: undefined });
  });

  it('break unsubscribes once', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe();
    fake.listeners[0]!(payload());
    for await (const event of events) {
      expect(event.operation).toBe('update');
      break;
    }
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    fake.listeners[0]!(payload());
    expect(await events[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
  });

  it('close ends every open iterator, unsubscribes each and closes the bridge session', async () => {
    const client = await AtClient.create(opts);
    const a = client.subscribe()[Symbol.asyncIterator]();
    const b = client.subscribe('x')[Symbol.asyncIterator]();
    const waiting = a.next();
    await client.close();
    expect(await waiting).toEqual({ done: true, value: undefined });
    expect(await b.next()).toEqual({ done: true, value: undefined });
    expect(fake.unsubscribe).toHaveBeenCalledTimes(2);
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it('close twice closes the bridge session once', async () => {
    const client = await AtClient.create(opts);
    await client.close();
    await client.close();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it('subscribe after close throws closed without touching the bridge', async () => {
    const client = await AtClient.create(opts);
    await client.close();
    let thrown: unknown;
    try {
      client.subscribe();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AtError);
    expect((thrown as AtError).code).toBe('closed');
    expect(fake.session.subscribe).not.toHaveBeenCalled();
  });

  it('maps a synchronous throw from the bridge subscribe', async () => {
    const client = await AtClient.create(opts);
    fake.session.subscribe.mockImplementationOnce(() => {
      throw { code: 'closed', message: 'gone' };
    });
    expect(() => client.subscribe()).toThrowError(expect.objectContaining({ code: 'closed' }));
  });
});

describe('subscribe errors', () => {
  it('an error on the stream rejects one next() and the stream carries on', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe()[Symbol.asyncIterator]();
    fake.errorSinks[0]!({ code: 'internal', message: 'internal error' });
    await expect(events.next()).rejects.toMatchObject({ name: 'AtError', code: 'internal' });
    fake.listeners[0]!({ id: 'n', from: '@a', key: 'k.tally@a', value: 'v', epochMillis: 1, operation: 'update' });
    expect((await events.next()).done).toBe(false);
  });

  it('an error while a reader waits rejects that read', async () => {
    const client = await AtClient.create(opts);
    const events = client.subscribe()[Symbol.asyncIterator]();
    const waiting = events.next();
    fake.errorSinks[0]!({ code: 'closed', message: 'gone' });
    await expect(waiting).rejects.toMatchObject({ code: 'closed' });
  });
});

describe('status', () => {
  it('reads the bridge status', async () => {
    const client = await AtClient.create(opts);
    expect(client.status).toBe('connecting');
    fake.session.status.mockReturnValue('waiting:network');
    expect(client.status).toBe('waiting:network');
  });

  it('onStatus delivers changes and returns an off function', async () => {
    const client = await AtClient.create(opts);
    const seen: string[] = [];
    const off = client.onStatus((s) => seen.push(s));
    fake.statusListeners[0]!('connected');
    fake.statusListeners[0]!('waiting:server');
    off();
    expect(seen).toEqual(['connected', 'waiting:server']);
    expect(fake.stopStatus).toHaveBeenCalledTimes(1);
  });

  it('onStatus surfaces a bridge failure as an AtError', async () => {
    const client = await AtClient.create(opts);
    fake.session.onStatus.mockReturnValueOnce({ code: 'closed', message: 'gone' } as never);
    expect(() => client.onStatus(() => {})).toThrow(expect.objectContaining({ name: 'AtError', code: 'closed' }));
  });

  it('onStatus after close throws closed without touching the bridge', async () => {
    const client = await AtClient.create(opts);
    await client.close();
    expect(() => client.onStatus(() => {})).toThrow(expect.objectContaining({ code: 'closed' }));
    expect(() => client.onStatus(null as never)).toThrow(expect.objectContaining({ code: 'closed' }));
    expect(fake.session.onStatus).not.toHaveBeenCalled();
  });

  it('onStatus rejects non-function listeners before touching the bridge', async () => {
    const client = await AtClient.create(opts);
    expect(() => client.onStatus(null as never)).toThrow(expect.objectContaining({ code: 'internal' }));
    expect(fake.session.onStatus).not.toHaveBeenCalled();
  });

  it('create(null) rejects with bad_key', async () => {
    expect((await rejection(AtClient.create(null as never))).code).toBe('bad_key');
  });

  it('session async methods reject with closed after close()', async () => {
    const client = await AtClient.create(opts);
    await client.close();
    expect((await rejection(client.notify({ key: 'k', sharedWith: '@bob' }, 'v'))).code).toBe('closed');
    expect((await rejection(client.otp())).code).toBe('closed');
    expect((await rejection(client.pendingEnrollments())).code).toBe('closed');
    expect((await rejection(client.approve('id'))).code).toBe('closed');
    expect((await rejection(client.deny('id'))).code).toBe('closed');
  });

  it('subscribe lowercases namespace in the default regex', async () => {
    const client = await AtClient.create({ ...opts, namespace: 'Tally' });
    client.subscribe();
    expect(fake.session.subscribe).toHaveBeenCalledWith(
      '\\.tally@',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('subscribe turns malformed notification keys into bad_key errors without crashing the listener', async () => {
    const client = await AtClient.create(opts);
    const iter = client.subscribe()[Symbol.asyncIterator]();
    fake.listeners[0]!({ operation: 'update', from: '@bob', key: '@bob.tally', value: null });
    await expect(iter.next()).rejects.toMatchObject({ code: 'bad_key' });
    fake.listeners[0]!({ operation: 'update', from: '@bob', key: 'ok.tally@bob', value: 'v' });
    expect((await iter.next()).value).toMatchObject({ from: '@bob', key: { key: 'ok', namespace: 'tally', sharedBy: '@bob' }, value: 'v' });
  });

  it('has no retry', async () => {
    const client = await AtClient.create(opts);
    expect('retry' in client).toBe(false);
  });
});

describe('collection', () => {
  async function open() {
    const client = await AtClient.create(opts);
    const tasks = await client.collection<{ n: number }>('tasks', { type: 'task', eventSource: 'both', expiration: 5000 });
    return { client, tasks };
  }

  it('passes name and options to the bridge', async () => {
    await open();
    expect(fake.session.collection).toHaveBeenCalledWith('tasks', {
      type: 'task',
      eventSource: 'both',
      expiration: 5000,
    });
  });

  it('create passes data and options and resolves the item', async () => {
    const { tasks } = await open();
    const created = await tasks.create({ n: 1 }, { id: 'i1', sharedWith: ['@bob'] });
    expect(fake.col.collection.create).toHaveBeenCalledWith({ n: 1 }, { id: 'i1', sharedWith: ['@bob'] });
    expect(created).toBe(fake.col.item);
  });

  it('get takes an id string or an address and resolves null for none', async () => {
    const { tasks } = await open();
    await tasks.get('i1');
    await tasks.get({ id: 'i2', owner: '@bob' });
    expect(fake.col.collection.get.mock.calls).toEqual([[{ id: 'i1' }], [{ id: 'i2', owner: '@bob' }]]);
    fake.col.collection.get.mockResolvedValueOnce(null);
    expect(await tasks.get('gone')).toBeNull();
  });

  it('list and query resolve items and unreadable', async () => {
    const { tasks } = await open();
    const where = [{ path: 'n', op: '>=' as const, value: 1 }];
    expect(await tasks.list()).toEqual(fake.col.listing);
    expect(await tasks.query(where)).toEqual(fake.col.listing);
    expect(fake.col.collection.query).toHaveBeenCalledWith(where);
  });

  it('update, share and remove pass the address', async () => {
    const { tasks } = await open();
    await tasks.update('i1', { n: 2 });
    await tasks.share({ id: 'i1', owner: '@alice' }, ['@bob']);
    await tasks.remove('i1', { cascade: true });
    expect(fake.col.collection.update).toHaveBeenCalledWith({ id: 'i1' }, { n: 2 });
    expect(fake.col.collection.share).toHaveBeenCalledWith({ id: 'i1', owner: '@alice' }, ['@bob']);
    expect(fake.col.collection.remove).toHaveBeenCalledWith({ id: 'i1' }, { cascade: true });
  });

  it('a collection failure rejects with its code and details', async () => {
    const { tasks } = await open();
    fake.col.collection.share.mockRejectedValueOnce({
      code: 'COLLECTION_PARTIAL_FAILURE',
      message: 'some writes failed',
      id: 'i1',
      owner: '@alice',
      kind: 'AtKeyException',
      failures: [{ op: 'update', recipient: '@bob', kind: 'Unknown' }],
    });
    const error = await rejection(tasks.share('i1', ['@bob']));
    expect(error).toMatchObject({
      code: 'COLLECTION_PARTIAL_FAILURE',
      message: 'some writes failed',
      id: 'i1',
      owner: '@alice',
      kind: 'AtKeyException',
      failures: [{ op: 'update', recipient: '@bob', kind: 'Unknown' }],
    });
  });

  it('a failed open rejects with the bridge code', async () => {
    const client = await AtClient.create(opts);
    fake.session.collection.mockRejectedValueOnce({ code: 'COLLECTION_INVALID_ARGUMENT', message: 'bad' });
    expect((await rejection(client.collection('x', { type: 't' }))).code).toBe('COLLECTION_INVALID_ARGUMENT');
  });

  it('item data keeps a prototype-less object as it arrives', async () => {
    const { tasks } = await open();
    const data = Object.create(null) as Record<string, unknown>;
    data['__proto__'] = 'p';
    fake.col.collection.get.mockResolvedValueOnce({ ...fake.col.item, data } as never);
    const found = await tasks.get('i1');
    expect(Object.getPrototypeOf(found!.data)).toBeNull();
    expect(Object.keys(found!.data)).toEqual(['__proto__']);
  });

  it('watch delivers events, including unknown ones (T6.5, T6.8)', async () => {
    const { tasks } = await open();
    const events = tasks.watch()[Symbol.asyncIterator]();
    fake.col.watchers[0]!.onEvent({ type: 'updated', id: 'i1', owner: '@alice' });
    fake.col.watchers[0]!.onEvent({ type: 'unknown', id: 'i2', owner: '@bob' });
    expect((await events.next()).value).toEqual({ type: 'updated', id: 'i1', owner: '@alice' });
    expect((await events.next()).value).toEqual({ type: 'unknown', id: 'i2', owner: '@bob' });
  });

  it('watch errors reject one next() and the stream carries on', async () => {
    const { tasks } = await open();
    const events = tasks.watch()[Symbol.asyncIterator]();
    fake.col.watchers[0]!.onError({ code: 'COLLECTION_FAILED', message: 'boom' });
    await expect(events.next()).rejects.toMatchObject({ code: 'COLLECTION_FAILED' });
    fake.col.watchers[0]!.onEvent({ type: 'updated', id: 'i1', owner: '@alice' });
    expect((await events.next()).done).toBe(false);
  });

  it('breaking out of watch stops it once', async () => {
    const { tasks } = await open();
    const events = tasks.watch();
    fake.col.watchers[0]!.onEvent({ type: 'updated', id: 'i1', owner: '@alice' });
    for await (const _ of events) break;
    expect(fake.col.stop).toHaveBeenCalledTimes(1);
  });

  it('a watch the bridge cannot start throws its AtError', async () => {
    const { tasks } = await open();
    fake.col.collection.watch.mockReturnValueOnce({ code: 'closed', message: 'gone' } as never);
    expect(() => tasks.watch()).toThrow(expect.objectContaining({ name: 'AtError', code: 'closed' }));
  });

  it('close ends open watches', async () => {
    const { client, tasks } = await open();
    const events = tasks.watch()[Symbol.asyncIterator]();
    const waiting = events.next();
    await client.close();
    expect(await waiting).toEqual({ done: true, value: undefined });
    expect(fake.col.stop).toHaveBeenCalledTimes(1);
  });

  it('every operation rejects closed after close, without touching the bridge', async () => {
    const { client, tasks } = await open();
    await client.close();
    for (const call of [
      () => tasks.create({ n: 1 }),
      () => tasks.get('i1'),
      () => tasks.list(),
      () => tasks.query([]),
      () => tasks.update('i1', { n: 2 }),
      () => tasks.share('i1', ['@bob']),
      () => tasks.remove('i1'),
    ]) {
      expect((await rejection(call())).code).toBe('closed');
    }
    expect(() => tasks.watch()).toThrow(expect.objectContaining({ code: 'closed' }));
    expect((await rejection(client.collection('x', { type: 't' }))).code).toBe('closed');
    expect(fake.col.collection.create).not.toHaveBeenCalled();
  });
});
