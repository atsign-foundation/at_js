# @atsign/at_client_web

> **Alpha (`0.1.0-alpha.1`).** Not yet published to npm. The API may change between alphas.

atPlatform client for browsers. Open a session from an atSign's `.atKeys` document, work with collections, send and receive notifications, and follow the connection status.

## Install

The package is not yet published to npm. Build it from this repository (see [Development](#development)).

The package is ESM and ships its own types. Its dart2js bundle sits at `dist/dart/at_client.js` and is injected as a script the first time a call needs it, so `dist/` must be served from your own origin.

## Quickstart

```ts
import { AtClient } from '@atsign/at_client_web';

const client = await AtClient.create({
  atSign: '@alice',
  namespace: 'myapp',
  keys: atKeysDocument, // the .atKeys JSON, as a string or a parsed object
});

client.onStatus((status) => console.log(status));

for await (const event of client.subscribe()) {
  console.log(event.operation, event.key);
  break; // leaving the loop unsubscribes
}

await client.close();
```

| Option | Meaning |
|---|---|
| `atSign` | The atSign the keys belong to. Must start with `@`, with no whitespace or `:`; passed to the bridge unchanged, not normalised by JS |
| `namespace` | Required. The one grant name: it scopes every key and is the namespace the session asks the atServer for. The client lowercases it for its own keys and subscriptions; the session is asked for it as given |
| `keys` | The `.atKeys` document. Required unless `passkey` is `true` |
| `passkey` | Optional `true`. Signs in with a platform passkey instead of a `.atKeys` document; requires `rpId` and `rpName`, and cannot be combined with `keys` |
| `rpId` | Required with `passkey`: the relying party id the passkey is scoped to |
| `rpName` | Required with `passkey`: the relying party name the browser shows when it asks for the passkey |
| `rootDomain` | Optional `host[:port]` of the root server. Passed through unchanged; default `root.atsign.org` |

```ts
const client = await AtClient.create({
  atSign: '@alice',
  namespace: 'myapp',
  passkey: true,
  rpId: 'myapp.example.com',
  rpName: 'My App',
});
```

Send another atSign a notification with `client.notify({ key: 'greeting', sharedWith: '@bob' }, 'hi')`.

`notify` takes a `NotifyKey` and sends it as atKey text — `[@recipient:]name[.namespace]@owner` — built from the session's namespace and atSign. `sharedWith` is required; the namespace is the key's own, or the session's unless `noNamespace` is set; the owner is always the session's atSign. A malformed field, a `sharedBy` that is not the session atSign, or a `public` or `cached` flag rejects locally with `invalid_argument` naming `NotifyKey.<field>`. `AtKey` stays the type `subscribe` events carry.

`subscribe(regex?)` registers when called, buffers up to 4096 events, and ends when you leave the loop or call `close()`. On overflow the subscription ends, buffered events are discarded, and `next()` rejects with `AtError('overflow')`; subscribe again to resume. Events and stream errors arrive from `next()` in arrival order, so an error can follow or precede buffered events; each rejects one `next()` and the stream carries on. A notification whose key is malformed rejects one `next()` with `bad_key` the same way. Each event's key owner (`sharedBy`) is the verified sender (`event.from`), not the owner spelled in the key text; a notification whose `from` is not an `@atSign` is skipped. The bridge bounds key text to 128 UTF-16 units: a key cut at that bound arrives as `{ key: <bounded text>, sharedBy: from, truncated: true }` and is not parsed, while an uncut key carries no `truncated` field. The `key` of each event has its atSign and namespace in lowercase. Without `regex` it matches the client's namespace.

**Notifications sent while the tab is closed or reloading are never delivered.** A session only receives what is sent while it is connected.

## Collections

```ts
type Task = { title: string; done: boolean };

const tasks = await client.collection<Task>('tasks', { type: 'task', eventSource: 'both' });

const item = await tasks.create({ title: 'ship', done: false }, { sharedWith: ['@bob'] });
await tasks.get(item.id);
await tasks.list();
await tasks.query([{ path: 'done', op: '==', value: false }]);
await tasks.update(item.id, { title: 'ship', done: true });
await tasks.share(item.id, ['@carol']);
await tasks.remove(item.id);

for await (const event of tasks.watch()) {
  console.log(event.type, event.id, event.owner); // 'unknown' covers event kinds this version does not know
}
```

| Call | Resolves |
|---|---|
| `create(data, opts?)` | the created `Item<T>` |
| `get(idOrAddress)` | the `Item<T>`, or `null` |
| `list()` / `query(where)` | `{ items, unreadable }`; items that cannot be read are listed in `unreadable` instead of failing the call |
| `update(idOrAddress, data)` / `share(idOrAddress, atSigns)` | the updated `Item<T>` |
| `remove(idOrAddress, opts?)` | nothing |
| `watch()` | an `AsyncIterable<CollectionEvent<T>>`; the `updated` event carries the type, id and owner only, so `get` the item to read it |

Item `data` is a plain object with no prototype. Items expire 7 days after creation unless the `expiration` option (milliseconds) says otherwise.

## Connection status

`client.status` is the latest state; `client.onStatus(cb)` reports each change and returns an `off` function. A listener that is not a function throws `AtError('invalid_argument')` synchronously and registers nothing.

| State | Meaning |
|---|---|
| `connecting` | Opening the connection |
| `connected` | Online |
| `waiting:network` | The browser is offline |
| `waiting:server` | The atServer cannot be reached |
| `waiting:auth` | The atServer refused the login |

The client reconnects by itself; there is no `retry()`.

## Pairing

On a session whose enrollment holds `__manage` (rw): `otp()`, `pendingEnrollments()`, `approve(id)`, `deny(id)`. They reject `unsupported` otherwise; an id that is not pending rejects `enrollment_denied`.

## Errors

Every call rejects with an `AtError`. Branch on `error.code`, never on the message. Collection failures may also carry `id`, `owner`, `kind` and `failures`.

| `code` | Meaning |
|---|---|
| `pkam_refused` | The atServer refused this enrollment's login |
| `offline` | The client did not come online, or a `notify` could not reach the atServer |
| `timeout` | A transport or atServer wait expired |
| `notify_failed` | `notify` did not send the notification: its recipient was unreachable, its key was refused, or the atServer rejected it |
| `onboarding_incomplete` | The enrollment started but did not finish |
| `enrollment_denied` | The enrollment was denied, or an `approve`/`deny` id was unknown |
| `enrollment_in_flight` | `approve` or `deny` named an id whose decision is already in flight; nothing was sent |
| `enrollment_conveyance_failed` | Approval or denial succeeded on the atServer, but delivering the response failed |
| `closed` | The client is closed; the message is `the session is closed` |
| `unsupported` | Not a browser, not a secure context, or a pairing call without `__manage` |
| `bad_key` | The keys are not valid JSON or not a usable `.atKeys` document; notify key text the bridge refuses (no recipient, a mismatched owner, malformed key or namespace); also a `subscribe` notification whose key is malformed (rejects one `next()`; the stream carries on) |
| `invalid_argument` | A caller mistake: a malformed argument, `create`'s options being `null` or not an object, a missing or invalid `namespace`, missing or mistyped `keys` (unless `passkey` is `true`), `passkey: true` without `rpId`/`rpName` or together with `keys`, an invalid regex or `address.owner`, a malformed `notify` key (`NotifyKey.<field>`, including a `sharedBy` other than the session atSign or a `public`/`cached` flag), or `data`/`opts` that are not plain objects. The message names the parameter or field, never its value |
| `overflow` | A subscription buffered more than 4096 events; it ended and its buffer was discarded |
| `internal` | Anything else, including a bundle that failed to load |
| `COLLECTION_*` | Collection failures: `INVALID_ARGUMENT`, `ITEM_NOT_FOUND`, `ITEM_NOT_OWNER`, `ITEM_ALREADY_EXISTS`, `ITEM_HAS_SUB_ITEMS`, `ITEM_UNREADABLE`, `ITEM_TOO_DEEP`, `TYPE_MISMATCH`, `ITEM_WRONG_TYPE`, `PARTIAL_FAILURE`, `FAILED` |

**Bounded text.** The pinned Dart bridge (see [Development](#development)) bounds ids, owners, names, recipients, namespace keys, event and ancestry fields, and an item's stored type to one line of at most 128 characters; this package does not enforce that bound. It does mark a `subscribe` event key the bridge cut as `truncated`, and never parses that bounded text. Payloads are delivered as received: a notification's `value` and an item's `data` get no length or newline check.

`subscribe`, `onStatus` and `watch` after `close` throw `AtError('closed')` synchronously; the other calls reject.

## Requirements

- **A secure context.** HTTPS (or `localhost`). `create` outside one rejects `unsupported`, as does any non-browser runtime.
- **A strict CSP works.** The bundle is plain JavaScript (compiled with dart2js): it needs no `'wasm-unsafe-eval'` and no `'unsafe-eval'`. `script-src 'self'` serves the bundle from your origin; `connect-src` must allow `https:` and `wss:` because the atServer's host comes from a root lookup at run time.
- **One bridge per page.** The package installs a single bridge on the page's global object and reuses it for every client, so any script running in the same origin can reach it. Do not run untrusted script from that origin.
- **The bundle loads relative to the module URL.** `dist/dart/at_client.js` is injected by a `<script>` whose URL is resolved from `import.meta.url`, so it must stay beside `dist/index.js`. Vite pre-bundles dependencies and would move the module away from it; exclude the package:

  ```ts
  // vite.config.ts
  export default defineConfig({
    optimizeDeps: { exclude: ['@atsign/at_client_web'] },
  });
  ```

## Limits in this alpha

- Keys come from a `.atKeys` document: the plaintext JSON, or the flat shape of the key fields. Documents whose key fields are self-encrypted are not decrypted in the browser.
- The connection status is classified when the connection changes state; a browser online/offline event alone does not emit one.
- No onboarding or enrollment of new browsers; passkey sign-in is only the `passkey` option of `create`.
- Browser only; there is no Node runtime.

## API reference

The reference is generated from the doc comments in `src/index.ts`:

```sh
npm run docs:api   # writes docs/api/
```

`docs/api/` is not committed; run the script to produce it.

## Development

The package ships a dart2js bundle (the bridge) built from [`packages/at_client_wasm`](https://github.com/atsign-foundation/at_client_sdk/tree/trunk/packages/at_client_wasm) in `atsign-foundation/at_client_sdk`. This repository pins one released bridge in `bridge.ref` (a release tag and the bundle's sha256); the bundle is not committed. The copy step strips the bundle's trailing `sourceMappingURL` comment because the release ships no map and the file is renamed to `at_client.js`.

```sh
npm ci                 # from the repository root; the package is an npm workspace
cd packages/at_client_web
npm run ci:prepare     # needs the GitHub CLI (gh); downloads and verifies the pinned bundle into .bridge/
npm run typecheck && npm run lint && npm test
npm run build          # copies the bundle to dist/dart/at_client.js
npx playwright install chromium && npm run e2e
```

To use a bundle you built yourself, set `AT_CLIENT_WEB_BUNDLE=/path/to/at_client_web.js` instead of running `ci:prepare`. A scheduled workflow opens a pin bump pull request when a newer bridge release exists; CI then runs the full check against it.
