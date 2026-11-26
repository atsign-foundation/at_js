import { AtError } from './error.js';

/** A bridge notification as the Dart side delivers it. */
export interface BridgeNotification {
  id: string;
  from: string;
  key: string;
  value: string | null;
  epochMillis: number;
  operation: 'update' | 'delete';
}

export interface BridgeEnrollment {
  id: string;
  appName: string;
  deviceName: string;
  namespaces: Record<string, string>;
}

/** The options the bridge takes. */
export interface BridgeOptions {
  atSign: string;
  namespace: string;
  /** The `.atKeys` document, as its JSON text or as an object; absent with `passkey`. */
  keys?: string | Record<string, unknown>;
  /** Sign in with a platform passkey instead of a `.atKeys` document. */
  passkey?: true;
  /** The relying party id the passkey is scoped to; given with `passkey`. */
  rpId?: string;
  /** The relying party name the browser shows; given with `passkey`. */
  rpName?: string;
  rootDomain?: string;
}

/** A failure the bridge answers with in place of a throw, which would reach this side without a code. */
export interface BridgeFailure {
  code: string;
  message: string;
  [detail: string]: unknown;
}

/** An item as the bridge delivers it; `data` has no prototype. */
export interface BridgeItem {
  id: string;
  owner: string;
  type: string;
  data: Record<string, unknown>;
  sharedWith: string[];
  createdAt: number;
  expiresAt: number;
  availableAt: number | null;
}

export interface BridgeListing {
  items: BridgeItem[];
  unreadable: Array<{ id: string; owner: string; code: string }>;
}

/** A collection event as the bridge delivers it: its `type`, `id`, `owner` and the fields of that type. */
export interface BridgeEvent {
  type: string;
  id: string;
  owner: string;
  [field: string]: unknown;
}

/** One open collection on the Dart side. */
export interface BridgeCollection {
  create(
    data: Record<string, unknown>,
    options?: { id?: string; sharedWith?: string[] },
  ): Promise<BridgeItem>;
  get(address: { id: string; owner?: string }): Promise<BridgeItem | null>;
  list(): Promise<BridgeListing>;
  query(where: Array<{ path: string; op: string; value?: unknown }>): Promise<BridgeListing>;
  update(address: { id: string; owner?: string }, data: Record<string, unknown>): Promise<BridgeItem>;
  share(address: { id: string; owner?: string }, atSigns: string[]): Promise<BridgeItem>;
  remove(address: { id: string; owner?: string }, options?: { cascade?: boolean }): Promise<unknown>;
  /** The function that stops watching, or the failure when it cannot start. */
  watch(
    onEvent: (event: BridgeEvent) => void,
    onError?: (error: BridgeFailure) => void,
  ): (() => void) | BridgeFailure;
}

/** One open client on the Dart side. */
export interface BridgeSession {
  notify(key: string, value: string): Promise<boolean>;
  /** The function that unsubscribes, or the failure when it cannot subscribe. */
  subscribe(
    regex: string,
    listener: (notification: BridgeNotification) => void,
    onError?: (error: BridgeFailure) => void,
  ): (() => void) | BridgeFailure;
  /** The latest connection status. */
  status(): string;
  /** The function that stops `listener`, or the failure when it cannot start. */
  onStatus(listener: (status: string) => void): (() => void) | BridgeFailure;
  collection(
    name: string,
    options: { type: string; eventSource?: string; expiration?: number },
  ): Promise<BridgeCollection>;
  otp(): Promise<string>;
  pendingEnrollments(): Promise<BridgeEnrollment[]>;
  approve(id: string): Promise<unknown>;
  deny(id: string): Promise<unknown>;
  close(): Promise<unknown>;
}

/** The static the Dart bundle installs at `globalThis.__atsignAtClientWeb`. */
export interface Bridge {
  create(options: BridgeOptions): Promise<BridgeSession>;
}

export type BridgeLoader = () => Promise<Bridge>;

const bridgeGlobal = '__atsignAtClientWeb';
const installTimeoutMs = 5_000;
const installPollMs = 10;

function installed(): Bridge | undefined {
  return (globalThis as Record<string, unknown>)[bridgeGlobal] as Bridge | undefined;
}

/**
 * Injects the dart2js bundle that sits beside this module once and resolves
 * with the bridge it installs; a bridge that is already installed is reused.
 */
function injectBundle(): Promise<Bridge> {
  const existing = installed();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./dart/at_client.js', import.meta.url).href;
    script.async = true;
    const fail = (message: string) => {
      script.remove();
      reject(new AtError(message, 'internal'));
    };
    script.onerror = () => fail(`could not load ${script.src}`);
    script.onload = () => {
      const deadline = Date.now() + installTimeoutMs;
      const poll = () => {
        const bridge = installed();
        if (bridge) resolve(bridge);
        else if (Date.now() >= deadline) fail(`${script.src} did not install the bridge`);
        else setTimeout(poll, installPollMs);
      };
      poll();
    };
    document.head.appendChild(script);
  });
}

let loader: BridgeLoader = injectBundle;
let loading: Promise<Bridge> | undefined;

/** The bridge, loaded on the first call and shared by every later one. */
export function loadBridge(): Promise<Bridge> {
  if (loading) return loading;
  const attempt: Promise<Bridge> = loader().catch((error: unknown) => {
    // A loader set meanwhile owns `loading` now; only forget our own failure.
    if (loading === attempt) loading = undefined;
    throw error;
  });
  loading = attempt;
  return attempt;
}

/** Replaces how the bridge loads, or restores the default; forgets any loaded bridge. */
export function setBridgeLoader(replacement?: BridgeLoader): void {
  loader = replacement ?? injectBundle;
  loading = undefined;
}
