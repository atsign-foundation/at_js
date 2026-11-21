import { toAtError } from './error.js';
import type { BridgeCollection, BridgeEvent, BridgeItem, BridgeListing } from './loader.js';
import { EventQueue } from './subscription.js';

/** One stored item. */
export interface Item<T> {
  /** The item's id, unique per owner. */
  id: string;
  /** The atSign that owns the item. */
  owner: string;
  /** The collection's type tag. */
  type: string;
  /**
   * The item's data. It is an object with no prototype, so a field named
   * `__proto__` or `toString` is data; copy it with `{ ...item.data }` to
   * get a plain object.
   */
  data: T;
  /** The atSigns the item is shared with. */
  sharedWith: string[];
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** Milliseconds since the epoch; null when the item is available now. */
  availableAt: number | null;
}

/** Names an item: its id and owner, which defaults to the client's own atSign. */
export interface ItemAddress {
  id: string;
  owner?: string;
}

/** A record this device cannot read. */
export interface UnreadableItem {
  id: string;
  owner: string;
  code: 'COLLECTION_ITEM_UNREADABLE' | 'COLLECTION_ITEM_TOO_DEEP';
}

/** What `list` and `query` resolve with. */
export interface Listing<T> {
  /** The readable items, in the order the atServer returns them. */
  items: Item<T>[];
  /** One entry per record that could not be read; they never fail the listing. */
  unreadable: UnreadableItem[];
}

/** The operators of a `query` clause. */
export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'isNull' | 'isNotNull';

/** One `query` clause: a dotted path into the item's data, an operator and a value. */
export interface Where {
  path: string;
  op: WhereOp;
  /** Not used by `isNull` and `isNotNull`. */
  value?: unknown;
}

/** One link of the chain from a sub-item up to the item that changed. */
export interface Ancestor {
  id: string;
  subName: string;
  owner: string | null;
}

/** One event `watch` delivers; every kind names the item's `id` and `owner`. */
export type CollectionEvent<T> =
  | { type: 'updated'; id: string; owner: string }
  | { type: 'deleted'; id: string; owner: string; wasExpired: boolean }
  | { type: 'available'; id: string; owner: string; availableAt: number }
  | { type: 'expiringSoon'; id: string; owner: string; expiresAt: number; leadTimeMs: number }
  | { type: 'readReceipt'; id: string; owner: string; from: string; readAt: number }
  | { type: 'subItemUpdated'; id: string; owner: string; ancestry: Ancestor[] }
  | { type: 'subItemDeleted'; id: string; owner: string; ancestry: Ancestor[] }
  /** An event kind this package does not know; the fields the bridge sent are kept. */
  | { type: 'unknown'; id: string; owner: string; [field: string]: unknown };

/** A set of items of one type under one namespace; `T` is the shape of an item's data. */
export interface Collection<T> {
  /** Creates an item owned by this atSign; rejects with `COLLECTION_ITEM_ALREADY_EXISTS` when `id` exists. */
  create(data: T, options?: { id?: string; sharedWith?: string[] }): Promise<Item<T>>;
  /** The item at `address`, or null. A string is an id owned by this atSign. */
  get(address: string | ItemAddress): Promise<Item<T> | null>;
  /** Every readable item. */
  list(): Promise<Listing<T>>;
  /** The readable items matching every clause. */
  query(where: Where[]): Promise<Listing<T>>;
  /** Replaces the item's data, keeping its recipients and times. */
  update(address: string | ItemAddress, data: T): Promise<Item<T>>;
  /** Adds `atSigns` to the item's recipients; never removes one. */
  share(address: string | ItemAddress, atSigns: string[]): Promise<Item<T>>;
  /** Deletes the item; with `cascade` its sub-items too. */
  remove(address: string | ItemAddress, options?: { cascade?: boolean }): Promise<void>;
  /**
   * Events of the collection as an `AsyncIterable`. It registers when
   * called, buffers up to 4096 events and stops when the loop ends or the
   * client closes. An error on the stream rejects one `next()` with an
   * `AtError` and the stream carries on; overflow ends it as for
   * `AtClient.subscribe`. Throws `AtError('closed')` after `AtClient.close()`.
   */
  watch(): AsyncIterable<CollectionEvent<T>>;
}

const address = (value: string | ItemAddress): { id: string; owner?: string } =>
  typeof value === 'string' ? { id: value } : value;

const item = <T>(raw: BridgeItem): Item<T> => raw as unknown as Item<T>;

const listing = <T>(raw: BridgeListing): Listing<T> => ({
  items: raw.items.map((i) => item<T>(i)),
  unreadable: raw.unreadable as UnreadableItem[],
});

/** What a collection needs of the client that opened it. */
export interface CollectionHost {
  /** Rejects with `AtError('closed')` after `close()`. */
  assertOpen(): void;
  /** Maps a failed bridge call to an `AtError`. */
  bridged<R>(call: () => Promise<R>): Promise<R>;
  streams: Set<{ end(): void }>;
}

/** The `Collection` over the bridge's [collection]. */
export function openCollection<T>(collection: BridgeCollection, host: CollectionHost): Collection<T> {
  const call = <R>(run: () => Promise<R>): Promise<R> => {
    try {
      host.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    return host.bridged(run);
  };
  return {
    create: (data, options) => call(async () => item<T>(await collection.create(data as Record<string, unknown>, options))),
    get: (a) =>
      call(async () => {
        const found = await collection.get(address(a));
        return found === null ? null : item<T>(found);
      }),
    list: () => call(async () => listing<T>(await collection.list())),
    query: (where) => call(async () => listing<T>(await collection.query(where))),
    update: (a, data) =>
      call(async () => item<T>(await collection.update(address(a), data as Record<string, unknown>))),
    share: (a, atSigns) => call(async () => item<T>(await collection.share(address(a), atSigns))),
    remove: (a, options) =>
      call(async () => {
        await collection.remove(address(a), options);
      }),
    watch: () => {
      host.assertOpen();
      let stop: (() => void) | undefined;
      const queue: EventQueue<CollectionEvent<T>> = new EventQueue(() => {
        host.streams.delete(queue);
        stop?.();
      });
      try {
        const started = collection.watch(
          (event: BridgeEvent) => queue.push(event as unknown as CollectionEvent<T>),
          (error) => queue.fail(toAtError(error)),
        );
        if (typeof started !== 'function') throw started;
        stop = started;
      } catch (error) {
        throw toAtError(error);
      }
      host.streams.add(queue);
      return queue;
    },
  };
}
