// Compiled by `npm run typecheck` against dist/index.d.ts; it has no runtime.
// It pins the exported surface so a signature change shows up here.
import type * as impl from '../../dist/index.js';
import type { NotifyKey } from '../../dist/index.js';
import { AtClient } from '../../dist/index.js';
// The bridge interfaces are internal (not exported from the package entry), so
// the surface checks below read them from the source that declares them.
import type { Bridge, BridgeCollection, BridgeSession } from '../../src/loader.js';

declare const client: impl.AtClient;

export const create: (opts: impl.AtClientOptions) => Promise<impl.AtClient> = AtClient.create;
export const passkeyCreate: Promise<impl.AtClient> = AtClient.create({
  atSign: '@alice',
  namespace: 'tally',
  passkey: true,
  rpId: 'example.com',
  rpName: 'Tally',
});
export const keysCreate: Promise<impl.AtClient> = AtClient.create({
  atSign: '@alice',
  namespace: 'tally',
  keys: '{"@alice":{}}',
});
// @ts-expect-error a .atKeys document or a passkey is required
void AtClient.create({ atSign: '@alice', namespace: 'tally' });
// @ts-expect-error passkey is true when given, never false
void AtClient.create({ atSign: '@alice', namespace: 'tally', passkey: false });
// @ts-expect-error atSign must start with @
void AtClient.create({ atSign: 'alice', namespace: 'tally', keys: '{}' });
// @ts-expect-error keys cannot be combined with passkey: true
void AtClient.create({ atSign: '@alice', namespace: 'tally', keys: '{}', passkey: true, rpId: 'example.com', rpName: 'Tally' });
export const status: impl.ConnectionStatus = client.status;
export const off: () => void = client.onStatus((next: impl.ConnectionStatus) => void next);

export const tasks: Promise<impl.Collection<{ n: number }>> = client.collection<{ n: number }>('tasks', {
  type: 'task',
  eventSource: 'both',
});
declare const collection: impl.Collection<{ n: number }>;
export const created: Promise<impl.Item<{ n: number }>> = collection.create({ n: 1 }, { sharedWith: ['@b'] });
export const fetched: Promise<impl.Item<{ n: number }> | null> = collection.get('id');
export const listed: Promise<impl.Listing<{ n: number }>> = collection.list();
export const queried: Promise<impl.Listing<{ n: number }>> = collection.query([{ path: 'n', op: '>=', value: 1 }]);
export const updated: Promise<impl.Item<{ n: number }>> = collection.update('id', { n: 2 });
export const shared: Promise<impl.Item<{ n: number }>> = collection.share('id', ['@b']);
export const removed: Promise<void> = collection.remove('id');
export const watched: AsyncIterable<impl.CollectionEvent<{ n: number }>> = collection.watch();
export const ancestor: impl.Ancestor = { id: 'p1', subName: 'comments', owner: null };

// @ts-expect-error data must be an object
void client.collection<string>('x', { type: 't' });

export const notified: Promise<boolean> = client.notify({ key: 'k', sharedWith: '@b' }, 'v');
export const notifyKey: NotifyKey = { key: 'k', sharedWith: '@b' };
// @ts-expect-error sharedWith is required
void client.notify({ key: 'k' }, 'v');
// @ts-expect-error sharedBy is not a notify key field
void client.notify({ key: 'k', sharedWith: '@b', sharedBy: '@a' }, 'v');
// @ts-expect-error public is not a notify key field
void client.notify({ key: 'k', sharedWith: '@b', public: true }, 'v');
// @ts-expect-error cached is not a notify key field
void client.notify({ key: 'k', sharedWith: '@b', cached: true }, 'v');
// @ts-expect-error sharedWith must start with @
void client.notify({ key: 'k', sharedWith: 'b' }, 'v');
export const publicKey: impl.AtKey = { key: 'k', sharedWith: '@b', public: true };
export const cachedKey: impl.AtKey = { key: 'k', sharedWith: '@b', cached: true };
export const events: AsyncIterable<impl.AtEvent> = client.subscribe('regex');
export const closed: Promise<void> = client.close();

export const otp: Promise<string> = client.otp();
export const pending: Promise<impl.PendingEnrollment[]> = client.pendingEnrollments();
export const approved: Promise<void> = client.approve('id');
export const denied: Promise<void> = client.deny('id');

export const errorOut: Error & { code: string } = {} as impl.AtError;
export const code: impl.AtErrorCode = 'bad_key';
export const invalidArgument: impl.AtErrorCode = 'invalid_argument';
export const inFlight: impl.AtErrorCode = 'enrollment_in_flight';
export const notifyFailed: impl.AtErrorCode = 'notify_failed';
export const timedOut: impl.AtErrorCode = 'timeout';

// The flat data plane and the passkey entry points are not part of the surface.
// @ts-expect-error no get
void client.get;
// @ts-expect-error no put
void client.put;
// @ts-expect-error no delete
void client.delete;
// @ts-expect-error no keys
void client.keys;
// @ts-expect-error no retry
void client.retry;
// @ts-expect-error no passkey onboarding
void AtClient.onboard;
// @ts-expect-error no passkey enrollment
void AtClient.enroll;
// @ts-expect-error no prf probe
void AtClient.prfSupported;

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const eventKinds: Equals<
  impl.CollectionEvent<unknown>['type'],
  'updated' | 'deleted' | 'readReceipt' | 'subItemUpdated' | 'subItemDeleted' | 'unknown'
> = true;
export const eventValue: Equals<impl.AtEvent['value'], string | undefined> = true;
// @ts-expect-error available is not a kind the pinned bridge emits
export const availableEvent: impl.CollectionEvent<unknown> = { type: 'available', id: 'i', owner: '@a', availableAt: 1 };
// @ts-expect-error a notification value is a string
export const binaryValue: impl.AtEvent = { operation: 'update', from: '@a', key: { key: 'k' }, value: new Uint8Array() };

// Each interface must have no member beyond the list the manifest declares;
// together with the `satisfies` lists in ../surface-lists.ts, which reject a
// listed name the interface lacks, this pins the surface both ways.
export const noExtraBridgeMembers: Exclude<keyof Bridge, 'create'> extends never ? true : false = true;
export const noExtraSessionMembers: Exclude<
  keyof BridgeSession,
  | 'approve'
  | 'close'
  | 'collection'
  | 'deny'
  | 'notify'
  | 'onStatus'
  | 'otp'
  | 'pendingEnrollments'
  | 'status'
  | 'subscribe'
> extends never
  ? true
  : false = true;
export const noExtraCollectionMembers: Exclude<
  keyof BridgeCollection,
  'create' | 'get' | 'list' | 'query' | 'remove' | 'share' | 'update' | 'watch'
> extends never
  ? true
  : false = true;
