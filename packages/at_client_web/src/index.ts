import { AtError, toAtError, type AtErrorCode } from './error.js';
import { parseKey, toKeyText } from './key.js';
import { openCollection, type Collection } from './collection.js';
import {
  loadBridge,
  type BridgeEnrollment,
  type BridgeNotification,
  type BridgeOptions,
  type BridgeSession,
} from './loader.js';
import { EventQueue } from './subscription.js';

export { AtError };
export type { AtErrorCode, AtErrorDetails, AtErrorFailure, CollectionErrorCode } from './error.js';
export type {
  Ancestor,
  Collection,
  CollectionEvent,
  Item,
  ItemAddress,
  Listing,
  UnreadableItem,
  Where,
  WhereOp,
} from './collection.js';

/** What `AtClient.create` takes to name the atSign, its keys and its scope. */
export interface AtClientOptions {
  /** The atSign to open, with its leading `@`. */
  atSign: string;
  /** Required: it scopes every key this client reads and writes, and names the enrollment's app. */
  namespace?: string;
  /**
   * The atSign's `.atKeys` document, as its JSON text or as an object. It
   * must be the plain document: a keys file whose fields are encrypted
   * with the atSign's self-encryption key is not readable in a browser.
   * Required unless `passkey` is `true`.
   */
  keys?: string | Record<string, unknown>;
  /** Sign in with a platform passkey instead of a `.atKeys` document; requires `rpId` and `rpName`. */
  passkey?: true;
  /** The relying party id the passkey is scoped to; required with `passkey: true`. */
  rpId?: string;
  /** The relying party name the browser shows when it asks for the passkey; required with `passkey: true`. */
  rpName?: string;
  /** The atDirectory to look atSigns up at, `host` or `host:port` (port 64 by default); `root.atsign.org` when left out. */
  rootDomain?: string;
}

/** A key's parts; the client composes and parses the wire form (`@with:key.namespace@by`). */
export interface AtKey {
  /** The key's name, without namespace or atSigns. */
  key: string;
  /** The atSign that owns the key; left out for the client's own atSign. */
  sharedBy?: string;
  /** The atSign the key is shared with; left out for a key kept to oneself. */
  sharedWith?: string;
  /** Defaults to the client's `namespace`. */
  namespace?: string;
  /** A public key (`public:`); set on the keys a `subscribe` event carries and refused by `notify`. */
  public?: boolean;
  /** A key cached from another atSign (`cached:`); set on the keys a `subscribe` event carries and refused by `notify`. */
  cached?: boolean;
  /** The key has no namespace; set on the keys a `subscribe` event carries, and honored by `notify`. */
  noNamespace?: boolean;
}

/** One notification delivered to a `subscribe` iterator. */
export interface AtEvent {
  /** What happened to the key. */
  operation: 'update' | 'delete';
  /** The atSign that sent the notification, in `@name` form; it is the key's owner. */
  from: string;
  /** The key that changed. */
  key: AtKey;
  /** The new value; absent when the notification carries none. */
  value?: string | Uint8Array;
}

/** An enrollment request awaiting `approve` or `deny`. */
export interface PendingEnrollment {
  /** The id to pass to `approve` or `deny`. */
  id: string;
  /** The app the requesting device enrolls for. */
  appName: string;
  /** The name the requesting device gave itself. */
  deviceName: string;
  /** Each requested namespace with its access, `r` or `rw`. */
  namespaces: Record<string, string>;
}

/** Maps a rejected or thrown bridge failure to an `AtError`. */
async function bridged<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toAtError(error);
  }
}

type Page = { isSecureContext?: boolean };

function page(): Page | undefined {
  return (globalThis as { window?: Page }).window;
}

/** Refuses anything but a secure browser page. */
function requireSecureBrowser(): void {
  const current = page();
  if (current === undefined) throw new AtError('AtClient runs in browsers only', 'unsupported');
  if (current.isSecureContext !== true) {
    throw new AtError('AtClient needs a secure context (HTTPS)', 'unsupported');
  }
}

/** The bridge's options for [opts]. */
function bridgeOptions(opts: AtClientOptions): BridgeOptions {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new AtError('AtClientOptions: must be an object', 'invalid_argument');
  }
  if (typeof opts.namespace !== 'string' || opts.namespace === '') {
    throw new AtError('AtClientOptions.namespace: must be a non-empty string', 'invalid_argument');
  }
  const options: BridgeOptions = { atSign: opts.atSign, namespace: opts.namespace };
  if (opts.passkey !== undefined && opts.passkey !== true) {
    throw new AtError('AtClientOptions.passkey: must be true when given', 'invalid_argument');
  }
  if (opts.passkey === true) {
    if (opts.keys !== undefined) {
      throw new AtError('AtClientOptions.keys: cannot be combined with passkey: true', 'invalid_argument');
    }
    if (typeof opts.rpId !== 'string' || opts.rpId === '') {
      throw new AtError(
        'AtClientOptions.rpId: must be a non-empty string when passkey is true',
        'invalid_argument',
      );
    }
    if (typeof opts.rpName !== 'string' || opts.rpName === '') {
      throw new AtError(
        'AtClientOptions.rpName: must be a non-empty string when passkey is true',
        'invalid_argument',
      );
    }
    options.passkey = true;
    options.rpId = opts.rpId;
    options.rpName = opts.rpName;
  } else {
    const { keys } = opts;
    if (typeof keys === 'string') options.keys = keys;
    else if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
      options.keys = keys as Record<string, unknown>;
    } else {
      throw new AtError('AtClientOptions.keys: must be an .atKeys JSON object or its text', 'invalid_argument');
    }
  }
  if (opts.rootDomain !== undefined) options.rootDomain = opts.rootDomain;
  return options;
}

/** Where the client's connection to its atServer is. */
export type ConnectionStatus =
  /** Not connected yet. */
  | 'connecting'
  | 'connected'
  /** The browser is offline. */
  | 'waiting:network'
  /** The browser is online and the atServer is not reachable. */
  | 'waiting:server'
  /** The atServer refused this client's keys. */
  | 'waiting:auth';

/**
 * An open session on one atSign. Obtain one from `create`; every failure
 * rejects with an `AtError`.
 *
 * Notifications sent while this page is closed or reloading are never
 * delivered to it.
 */
export class AtClient {
  private readonly streams = new Set<{ end(): void }>();
  private closed = false;

  private constructor(
    private readonly session: BridgeSession,
    private readonly namespace: string,
    private readonly atSign: string,
  ) {}

  /** Opens the session for [opts]: the atSign and namespace, from its `.atKeys` document or a passkey. */
  static async create(opts: AtClientOptions): Promise<AtClient> {
    requireSecureBrowser();
    const options = bridgeOptions(opts);
    const session = await bridged(async () => (await loadBridge()).create(options));
    return new AtClient(session, options.namespace.toLowerCase(), options.atSign.toLowerCase());
  }

  /**
   * Opens the collection `name` (qualified with the client's namespace
   * unless it already ends in it) of items typed `options.type`. `T` is
   * the shape of an item's data. `eventSource` picks what `watch` follows:
   * `data`, `notifs` or `both`; `expiration` is how long items live, in
   * milliseconds (seven days by default).
   */
  collection<T extends object = Record<string, unknown>>(
    name: string,
    options: { type: string; eventSource?: 'data' | 'notifs' | 'both'; expiration?: number },
  ): Promise<Collection<T>> {
    return bridged(async () => {
      this.assertOpen();
      const opened = await this.session.collection(name, options);
      return openCollection<T>(opened, {
        assertOpen: () => this.assertOpen(),
        bridged,
        streams: this.streams,
      });
    });
  }

  /** The connection status now; the latest change wins. */
  get status(): ConnectionStatus {
    return this.session.status() as ConnectionStatus;
  }

  /** Calls [listener] with each later change of `status`; returns the function that stops it. Throws `AtError('closed')` after `close()`. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.assertOpen();
    if (typeof listener !== 'function') {
      throw new AtError('onStatus listener must be a function', 'invalid_argument');
    }
    try {
      const off = this.session.onStatus((status) => listener(status as ConnectionStatus));
      if (typeof off !== 'function') throw off;
      return off;
    } catch (error) {
      throw toAtError(error);
    }
  }

  /**
   * Sends `value` to the key's `sharedWith` atSign as a notification,
   * resolving true once it was delivered.
   *
   * The key is sent as atKey text, `[@recipient:]name[.namespace]@owner`:
   * the namespace is the key's own or the session's unless `noNamespace` is
   * set, and the owner is the key's `sharedBy` or the session's atSign. A
   * `public` or `cached` key cannot be sent and rejects `invalid_argument`
   * naming the flag.
   */
  notify(key: AtKey, value: string): Promise<boolean> {
    return this.bridgedOpen(() =>
      this.session.notify(toKeyText(key, this.namespace, this.atSign), value),
    );
  }

  /**
   * Real-time notification subscription via AsyncIterable.
   * Registers when called, buffers up to 4096 events and unsubscribes when
   * the loop ends (`break`/`return()`) or the client closes. On overflow the
   * subscription ends, buffered events are discarded, and `next()` rejects
   * with `AtError('overflow')`; subscribe again. An error on the
   * notification stream rejects one `next()` and the stream carries on.
   * Without `regex` it matches the client's namespace. Throws
   * `AtError('closed')` after `close()`.
   */
  subscribe(regex?: string): AsyncIterable<AtEvent> {
    this.assertOpen();
    let unsubscribe: (() => void) | undefined;
    const queue: EventQueue<AtEvent> = new EventQueue(() => {
      this.streams.delete(queue);
      unsubscribe?.();
    });
    try {
      const subscribed = this.session.subscribe(
        regex ?? `\\.${this.namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`,
        (notification) => {
          try {
            queue.push(this.event(notification));
          } catch (error) {
            queue.fail(toAtError(error));
          }
        },
        (error) => queue.fail(toAtError(error)),
      );
      if (typeof subscribed !== 'function') throw subscribed;
      unsubscribe = subscribed;
    } catch (error) {
      throw toAtError(error);
    }
    this.streams.add(queue);
    return queue;
  }

  private assertOpen(): void {
    if (this.closed) throw new AtError('the session is closed', 'closed');
  }

  /** `bridged`, rejecting with `closed` first when the client is closed. */
  private bridgedOpen<R>(call: () => Promise<R>): Promise<R> {
    return bridged(() => {
      this.assertOpen();
      return call();
    });
  }

  /** A one-time code a new device quotes to ask for enrollment. Needs `__manage`. */
  otp(): Promise<string> {
    return this.bridgedOpen(() => this.session.otp());
  }

  /** The enrollment requests awaiting a decision. Needs `__manage`. */
  pendingEnrollments(): Promise<PendingEnrollment[]> {
    return this.bridgedOpen(async () =>
      (await this.session.pendingEnrollments()).map((e: BridgeEnrollment) => ({ ...e })),
    );
  }

  /** Approves the pending request [id] for what it asked for. Needs `__manage`. */
  async approve(id: string): Promise<void> {
    await this.bridgedOpen(() => this.session.approve(id));
  }

  /** Denies the pending request [id]. Needs `__manage`. */
  async deny(id: string): Promise<void> {
    await this.bridgedOpen(() => this.session.deny(id));
  }

  /** Closes the session and ends every open `subscribe` iterator; closing twice is a no-op. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const stream of [...this.streams]) stream.end();
    await bridged(() => this.session.close());
  }

  private event(notification: BridgeNotification): AtEvent {
    const event: AtEvent = {
      operation: notification.operation,
      from: notification.from,
      key: parseKey(notification.key, this.namespace),
    };
    if (notification.value !== null && notification.value !== undefined) {
      event.value = notification.value;
    }
    return event;
  }
}
