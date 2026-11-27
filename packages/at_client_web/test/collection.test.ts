import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtClient, type Collection, type CollectionEvent } from '../src/index.js';
import { setBridgeLoader, type Bridge, type BridgeOptions, type BridgeSession } from '../src/loader.js';

type Listener = (payload: unknown) => void;

function fakeCollection() {
  const watchers: Listener[] = [];
  const collection = {
    watch: vi.fn((onEvent: Listener) => {
      watchers.push(onEvent);
      return vi.fn();
    }),
  };
  return { collection, watchers };
}

function fakeSession() {
  const col = fakeCollection();
  const session = {
    collection: vi.fn(async () => col.collection),
    close: vi.fn(async () => null),
  };
  return { session, col };
}

function fakeBridge(session: BridgeSession) {
  return {
    create: vi.fn(async (_options: BridgeOptions) => session),
  };
}

function browser() {
  vi.stubGlobal('window', { isSecureContext: true });
}

const keys = '{"@alice":{}}';

let fake: ReturnType<typeof fakeSession>;
let bridge: ReturnType<typeof fakeBridge>;

beforeEach(() => {
  fake = fakeSession();
  bridge = fakeBridge(fake.session as unknown as BridgeSession);
  setBridgeLoader(vi.fn(async () => bridge as unknown as Bridge));
  browser();
});

afterEach(() => {
  setBridgeLoader();
  vi.unstubAllGlobals();
});

async function open(): Promise<Collection<{ n: number }>> {
  const client = await AtClient.create({ atSign: '@alice', namespace: 'tally', keys });
  return client.collection<{ n: number }>('tasks', { type: 'task', eventSource: 'both' });
}

describe('watch event kinds', () => {
  it('a watch event of a kind the package does not know arrives as unknown with its fields', async () => {
    const tasks = await open();
    const events = tasks.watch()[Symbol.asyncIterator]();
    fake.col.watchers[0]!({ type: 'available', id: 'i1', owner: '@alice', availableAt: 1 });
    const event = (await events.next()).value;
    expect(event).toEqual({ type: 'unknown', id: 'i1', owner: '@alice', availableAt: 1 });
    expect(event).not.toHaveProperty('type', 'available');
  });

  it('a watch event of a known kind arrives unchanged', async () => {
    const tasks = await open();
    const events = tasks.watch()[Symbol.asyncIterator]();
    const ancestry = [{ id: 'p1', subName: 'comments', owner: null }];
    const known: Array<CollectionEvent<{ n: number }>> = [
      { type: 'updated', id: 'i1', owner: '@alice' },
      { type: 'deleted', id: 'i2', owner: '@alice', wasExpired: true },
      { type: 'readReceipt', id: 'i3', owner: '@alice', from: '@bob', readAt: 2 },
      { type: 'subItemUpdated', id: 'i4', owner: '@alice', ancestry },
      { type: 'subItemDeleted', id: 'i5', owner: '@alice', ancestry },
      { type: 'unknown', id: 'i6', owner: '@alice', extra: 1 },
    ];
    const delivered: Array<CollectionEvent<{ n: number }>> = [];
    for (const event of known) {
      fake.col.watchers[0]!(event);
      delivered.push((await events.next()).value as CollectionEvent<{ n: number }>);
    }
    expect(delivered).toEqual(known);
    expect((delivered[3] as { ancestry: unknown }).ancestry).toBe(ancestry);
    expect((delivered[4] as { ancestry: unknown }).ancestry).toBe(ancestry);
  });
});
