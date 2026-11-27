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

/** The fields every `AtClient.create` takes to name the atSign and its scope. */
interface AtClientSharedOptions {
  /**
   * The atSign to open, such as `@alice`. Must start with `@`, have more than
   * that one character, and contain no whitespace or `:`; anything else is
   * rejected with `invalid_argument` naming `AtClientOptions.atSign`. Passed
   * to the bridge unchanged, not normalised here.
   */
  atSign: `@${string}`;
  /**
   * Required at runtime: it scopes every key this client reads and writes, and
   * names the enrollment's app; `bridgeOptions` rejects a missing or empty one
   * with `invalid_argument`. Optional in the type only so callers get that
   * named error instead of a type error.
   */
  namespace?: string;
  /** The atDirectory to look atSigns up at, `host` or `host:port` (port 64 by default); `root.atsign.org` when left out. */
  rootDomain?: string;
}

/**
 * What `AtClient.create` takes to name the atSign, its keys and its scope:
 * a `.atKeys` document, or a platform passkey — exactly one of the two.
 */
export type AtClientOptions = AtClientSharedOptions &
  (
    | {
        /**
         * The atSign's `.atKeys` document, as its JSON text or as an object. It
         * must be the plain document: a keys file whose fields are encrypted
         * with the atSign's self-encryption key is not readable in a browser.
         */
        keys: string | Record<string, unknown>;
        /** Cannot be combined with a `.atKeys` document. */
        passkey?: never;
      }
    | {
        /** Sign in with a platform passkey instead of a `.atKeys` document; requires `rpId` and `rpName`. */
        passkey: true;
        /** The relying party id the passkey is scoped to. */
        rpId: string;
        /** The relying party name the browser shows when it asks for the passkey. */
        rpName: string;
        /** Cannot be combined with `passkey: true`. */
        keys?: never;
      }
  );

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
  /**
   * Only on a `subscribe` event's key: the bridge bounded the key text at its
   * 128-unit display limit and cut it short. The value is the bounded text
   * itself, its owner is the verified sender, and none of it was parsed.
   */
  truncated?: true;
}

/**
 * What `notify` sends: a `sharedWith` atSign and the key to send it, with no
 * `sharedBy`, `public` or `cached` field. The owner is always the session
 * atSign; `AtKey` is what a `subscribe` event carries.
 */
export interface NotifyKey {
  /** The key's name: no `@`, `:` or whitespace, and no leading or trailing `.`. */
  key: string;
  /** The atSign to notify: one `@atSign`, with no `:` or whitespace. Required. */
  sharedWith: `@${string}`;
  /** The namespace that qualifies the key; the client's when left out. One segment. */
  namespace?: string;
  /** Send the key with no namespace; a `namespace` beside it is ignored. */
  noNamespace?: true;
}

/** One notification delivered to a `subscribe` iterator. */
export interface AtEvent {
  /** What happened to the key. */
  operation: 'update' | 'delete';
  /**
   * The verified sender, in `@name` form; the authority for the key's owner.
   * It is set from the authenticated sender, not from the key text.
   */
  from: string;
  /**
   * The key that changed. The bridge bounds its text to 128 UTF-16 units; a
   * key cut at that bound is marked `truncated` and its text is not parsed.
   */
  key: AtKey;
  /**
   * The new value; absent when the notification carries none. It is a string:
   * these are the values the pinned bridge emits.
   */
  value?: string;
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

/** [value] when it is a non-empty string; throws `invalid_argument` with [message] otherwise. */
function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value === '') throw new AtError(message, 'invalid_argument');
  return value;
}

/** The bridge's options for [opts]. */
function bridgeOptions(opts: AtClientOptions): BridgeOptions {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new AtError('AtClientOptions: must be an object', 'invalid_argument');
  }
  const atSign = requireString(opts.atSign, 'AtClientOptions.atSign: must be a non-empty string');
  if (!atSign.startsWith('@') || atSign.length < 2 || /[\s:]/.test(atSign)) {
    throw new AtError(
      "AtClientOptions.atSign: must start with @ and contain no whitespace or ':'",
      'invalid_argument',
    );
  }
  const namespace = requireString(
    opts.namespace,
    'AtClientOptions.namespace: must be a non-empty string',
  );
  const options: BridgeOptions = { atSign, namespace };
  if (opts.passkey !== undefined && opts.passkey !== true) {
    throw new AtError('AtClientOptions.passkey: must be true when given', 'invalid_argument');
  }
  if (opts.passkey === true) {
    if (opts.keys !== undefined) {
      throw new AtError('AtClientOptions.keys: cannot be combined with passkey: true', 'invalid_argument');
    }
    options.passkey = true;
    options.rpId = requireString(
      opts.rpId,
      'AtClientOptions.rpId: must be a non-empty string when passkey is true',
    );
    options.rpName = requireString(
      opts.rpName,
      'AtClientOptions.rpName: must be a non-empty string when passkey is true',
    );
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
  private closing?: Promise<void>;

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
    return this.bridgedOpen(async () => {
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
   * `sharedWith` is required; the namespace is the key's own or the session's
   * unless `noNamespace` is set; the owner is always the session's atSign.
   * Any malformed field — a name with a delimiter, a `sharedWith` that is not
   * one `@atSign`, a `namespace` that is not one segment, a `sharedBy` that is
   * not the session atSign, or a truthy `public` or `cached` flag — rejects
   * `invalid_argument` naming `NotifyKey.<field>` before anything is sent.
   */
  notify(key: NotifyKey, value: string): Promise<boolean> {
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
   * A notification without a verified `@atSign` sender is not delivered.
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
            const event = this.event(notification);
            if (event !== undefined) queue.push(event);
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

  /**
   * Closes the session and ends every open `subscribe` iterator once; returns
   * the same promise to every call, so a failed close keeps rejecting.
   */
  close(): Promise<void> {
    if (this.closing === undefined) {
      this.closed = true;
      for (const stream of [...this.streams]) stream.end();
      this.closing = bridged(async () => {
        await this.session.close();
      });
    }
    return this.closing;
  }

  private event(notification: BridgeNotification): AtEvent | undefined {
    const from = notification.from;
    if (typeof from !== 'string' || from.length <= 1 || !from.startsWith('@')) return undefined;
    const text = notification.key;
    const key: AtKey =
      text.length >= 127 && text.endsWith('...')
        ? { key: text, sharedBy: from, truncated: true }
        : { ...parseKey(text, this.namespace), sharedBy: from };
    const event: AtEvent = {
      operation: notification.operation,
      from,
      key,
    };
    if (notification.value !== null && notification.value !== undefined) {
      event.value = notification.value;
    }
    return event;
  }
}
