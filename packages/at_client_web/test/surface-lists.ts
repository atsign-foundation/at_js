/**
 * The pinned bridge's codes and named surface as typed, exhaustive lists.
 *
 * Each list is checked both ways at compile time: `satisfies` rejects a name
 * the type does not have, and the `Exhaustive` assertions below reject a type
 * member the list leaves out. `manifest.test.ts` compares the lists with
 * `bridge-manifest.json` at run time. This file is not a `.test.ts`, so vitest
 * does not run it; `npm run lint` compiles it.
 */
import type { AtErrorCode, CollectionErrorCode } from '../src/error.js';
import type { Bridge, BridgeCollection, BridgeSession } from '../src/loader.js';

/** Every `AtErrorCode`. `manifest.test.ts` drops `overflow` and the collection codes before comparing. */
export const allCodes = [
  'pkam_refused',
  'offline',
  'timeout',
  'notify_failed',
  'onboarding_incomplete',
  'enrollment_denied',
  'enrollment_in_flight',
  'enrollment_conveyance_failed',
  'closed',
  'unsupported',
  'internal',
  'bad_key',
  'invalid_argument',
  'overflow',
  'COLLECTION_INVALID_ARGUMENT',
  'COLLECTION_ITEM_NOT_FOUND',
  'COLLECTION_ITEM_NOT_OWNER',
  'COLLECTION_ITEM_ALREADY_EXISTS',
  'COLLECTION_ITEM_HAS_SUB_ITEMS',
  'COLLECTION_ITEM_UNREADABLE',
  'COLLECTION_ITEM_TOO_DEEP',
  'COLLECTION_TYPE_MISMATCH',
  'COLLECTION_ITEM_WRONG_TYPE',
  'COLLECTION_PARTIAL_FAILURE',
  'COLLECTION_FAILED',
] as const satisfies readonly AtErrorCode[];

/** Every collection code; compared with the manifest's `collectionErrorCodes`. */
export const collectionCodes = [
  'COLLECTION_INVALID_ARGUMENT',
  'COLLECTION_ITEM_NOT_FOUND',
  'COLLECTION_ITEM_NOT_OWNER',
  'COLLECTION_ITEM_ALREADY_EXISTS',
  'COLLECTION_ITEM_HAS_SUB_ITEMS',
  'COLLECTION_ITEM_UNREADABLE',
  'COLLECTION_ITEM_TOO_DEEP',
  'COLLECTION_TYPE_MISMATCH',
  'COLLECTION_ITEM_WRONG_TYPE',
  'COLLECTION_PARTIAL_FAILURE',
  'COLLECTION_FAILED',
] as const satisfies readonly CollectionErrorCode[];

/** Every member of `Bridge`; compared with the manifest's `BridgeEntry`. */
export const bridgeMembers = ['create'] as const satisfies readonly (keyof Bridge)[];

/** Every member of `BridgeSession`; compared with the manifest's `BridgeSession`. */
export const sessionMembers = [
  'notify',
  'subscribe',
  'status',
  'onStatus',
  'collection',
  'otp',
  'pendingEnrollments',
  'approve',
  'deny',
  'close',
] as const satisfies readonly (keyof BridgeSession)[];

/** Every member of `BridgeCollection`; compared with the manifest's `BridgeCollection`. */
export const collectionMembers = [
  'create',
  'get',
  'list',
  'query',
  'update',
  'share',
  'remove',
  'watch',
] as const satisfies readonly (keyof BridgeCollection)[];

/** True when `T` has no member that `L` leaves out; assigning `false` would fail to compile. */
type Exhaustive<T, L extends readonly T[]> = Exclude<T, L[number]> extends never ? true : false;

export const codesExhaustive: Exhaustive<AtErrorCode, typeof allCodes> = true;
export const collectionCodesExhaustive: Exhaustive<CollectionErrorCode, typeof collectionCodes> = true;
export const bridgeExhaustive: Exhaustive<keyof Bridge, typeof bridgeMembers> = true;
export const sessionExhaustive: Exhaustive<keyof BridgeSession, typeof sessionMembers> = true;
export const collectionExhaustive: Exhaustive<keyof BridgeCollection, typeof collectionMembers> = true;
