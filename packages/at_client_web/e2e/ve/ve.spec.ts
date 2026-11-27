/**
 * The keyless end-to-end suite against the local atServer virtual environment.
 *
 * It runs only with `AT_VE=1` (`npm run e2e:ve`), where `global-setup.ts` has
 * started the VE and the demo keys for `@alice🛠` and `@bob🛠` exist; without
 * it every test is skipped and the reason is printed once. Key text enters a
 * page only through `setInputFiles` with a buffer: it never crosses a
 * Playwright protocol argument by value into a recording, and is never logged.
 *
 * Each run is a `test.describe.serial` group repeated `VE_RUNS` times (five by
 * default). Context A carries alice and context B bob. Before the first
 * `create` of a context, `warm` optionally pre-navigates that atServer's origin
 * (off by default; `VE_PRENAVIGATE=1`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, type Page } from '@playwright/test';
import { expect, installNetworkGuard, test, type NetworkGuard } from '../guard.js';
import { vePolicy } from '../guard-policy.js';
import { scanForSecrets } from '../redact.mjs';
import { VE_HOST, VE_ROOT_PORT } from './env.mjs';
import { defaultKeysDir, keysFileName, plainKeysDocument } from './mint.mjs';
import { warm } from './prenav.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gated = process.env.AT_VE !== '1';
const namespace = process.env.AT_VE_NAMESPACE ?? 'atjs_ve';
const configuredRuns = Number(process.env.VE_RUNS ?? 5);
// At least one run, so a bogus VE_RUNS cannot produce a zero-run pass.
const runs = Number.isFinite(configuredRuns) ? Math.max(1, Math.trunc(configuredRuns)) : 5;
const keysDir = process.env.AT_VE_KEYS_DIR ?? defaultKeysDir();
const rootDomain = `${VE_HOST}:${VE_ROOT_PORT}`;
const base = process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.E2E_PORT ?? 4173)}`;
const alice = '@alice🛠';
const bob = '@bob🛠';
const absent = '@nosuchve🛠';
const collectionOptions = { type: 'atjs_ve_item', eventSource: 'data' as const };

const manifest = JSON.parse(readFileSync(join(PKG, 'bridge-manifest.json'), 'utf8')) as {
  surface: { BridgeSession: string[]; BridgeCollection: string[] };
};

if (gated) console.log('ve: skipped (AT_VE is not 1)');
test.skip(gated, 've: skipped (AT_VE is not 1)');

interface LiveSurface {
  names: string[];
  types: string[];
}
interface LiveItem {
  id: string;
  owner: string;
  data: Record<string, unknown>;
}
interface LiveListing {
  ids: string[];
  items: Array<{ id: string; owner: string }>;
  unreadable: number;
}
interface LiveEvent {
  from: string;
  key: { key: string; sharedBy?: string };
  value?: string;
}
type Attempt = { ok: true; value: unknown } | { ok: false; code: string; message: string };

const keysPath = (atSign: string): string => join(keysDir, keysFileName(atSign));

/** The CA file the global setup recorded for node-side lookups. */
function caBytes(): Buffer {
  const file = process.env.AT_VE_CA_FILE;
  if (file === undefined || file === '') throw new Error('AT_VE_CA_FILE is not set');
  return readFileSync(file);
}

/** Calls `window.live.<method>(...args)`; no key text is ever an argument. */
function live<R>(page: Page, method: string, ...args: unknown[]): Promise<R> {
  return page.evaluate(
    ([name, params]) => (window as any).live[name](...params),
    [method, args] as [string, unknown[]],
  ) as Promise<R>;
}

/** Like `live`, but a rejection comes back as `{ ok: false, code }`. */
function attempt(page: Page, method: string, ...args: unknown[]): Promise<Attempt> {
  return live<Attempt>(page, 'tryCall', method, ...args);
}

function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    });
  } catch {
    return [];
  }
}

function isName(value: string): boolean {
  return /^[A-Za-z0-9_:.-]{1,64}$/.test(value);
}

function expectSurface(surface: LiveSurface, expected: string[], label: string): void {
  if (surface.names.length > 0) {
    expect([...surface.names].sort(), `${label} function members`).toEqual([...expected].sort());
  } else {
    test.info().annotations.push({
      type: 'surface',
      description: `${label} enumeration is opaque; checked member by member`,
    });
    expect(surface.types, `${label} members`).toEqual(expected.map(() => 'function'));
  }
}

test.describe('ve', () => {
  for (let index = 0; index < runs; index += 1) describeRun(index);
});

function describeRun(index: number): void {
  // The group title must be identical in the runner and in each worker, so the
  // run id, which carries the clock, is assigned when the group starts.
  test.describe.serial(`ve run ${index}`, () => {
    let runId = '';
    let startedAt = 0;
    test.beforeAll(() => {
      startedAt = Date.now();
      runId = `r${startedAt}${index}`;
    });
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    let pageA: Page | undefined;
    let pageB: Page | undefined;
    const guards: NetworkGuard[] = [];
    const consoleLines: string[] = [];
    const statuses = new Set<string>();
    const flags = new Set<string>();
    let consoleErrors = 0;
    let wsEvents = 0;

    function pages(): { a: Page; b: Page } {
      if (pageA === undefined || pageB === undefined) throw new Error('the ve pages were not created');
      return { a: pageA, b: pageB };
    }

    /** Guards, captures and opens a live page in [context], and loads [atSign]'s keys. */
    async function openLivePage(context: BrowserContext, atSign: string): Promise<Page> {
      const page = await context.newPage();
      guards.push(await installNetworkGuard(page, vePolicy()));
      page.on('console', (message) => {
        consoleLines.push(message.text());
        if (message.type() === 'error') consoleErrors += 1;
      });
      page.on('pageerror', (error) => {
        consoleLines.push(error.message);
        consoleErrors += 1;
      });
      page.on('websocket', () => {
        wsEvents += 1;
      });
      await page.goto('/live');
      await page.waitForFunction(() => (window as any).live?.ready === true);
      await page.setInputFiles('#keys', {
        name: 'keys.atKeys',
        mimeType: 'application/json',
        buffer: Buffer.from(plainKeysDocument(readFileSync(keysPath(atSign), 'utf8'))),
      });
      await page.waitForFunction(() => (window as any).live?.keysLoaded === true);
      return page;
    }

    async function recordStatuses(): Promise<void> {
      const { a, b } = pages();
      for (const page of [a, b]) {
        for (const status of await live<string[]>(page, 'statuses')) statuses.add(status);
      }
    }

    async function connect(page: Page): Promise<void> {
      await expect
        .poll(() => live<string>(page, 'status'), { timeout: 35_000, intervals: [500] })
        .toBe('connected');
    }

    test.afterAll(async () => {
      let hits: string[] = [];
      if (!gated) {
        const texts = [...consoleLines];
        for (const file of filesUnder(join(PKG, 'test-results'))) texts.push(readFileSync(file, 'utf8'));
        for (const atSign of [alice, bob]) {
          const keysDoc = JSON.parse(readFileSync(keysPath(atSign), 'utf8')) as unknown;
          hits = hits.concat(scanForSecrets(keysDoc, texts));
        }
      }
      await contextA?.close();
      await contextB?.close();
      if (hits.length > 0) {
        throw new Error(`key fields found in artefacts or console: ${hits.join(', ')}`);
      }
      const refused = guards.flatMap((guard) => [...guard.blocked, ...guard.sockets]);
      expect(refused, 'requests and sockets outside the VE policy').toEqual([]);
    });

    test('ve: both atSigns connect and only the environment host is contacted', async ({ browser }) => {
      contextA = await browser.newContext();
      contextB = await browser.newContext();
      [pageA, pageB] = await Promise.all([openLivePage(contextA, alice), openLivePage(contextB, bob)]);
      const { a, b } = pages();
      const ca = caBytes();
      await Promise.all([warm(contextA, alice, ca), warm(contextB, bob, ca)]);
      await Promise.all([
        live(a, 'create', alice, namespace, rootDomain),
        live(b, 'create', bob, namespace, rootDomain),
      ]);
      await connect(a);
      await connect(b);
      await recordStatuses();
      for (const guard of guards) {
        expect(guard.blocked).toEqual([]);
        expect(guard.sockets).toEqual([]);
      }
    });

    test('ve: the session and collection surface equals the bridge manifest', async () => {
      const { a } = pages();
      const surface = await live<{ session: LiveSurface; collection: LiveSurface }>(
        a,
        'surface',
        `surface${runId}`,
        collectionOptions.type,
        manifest.surface.BridgeSession,
        manifest.surface.BridgeCollection,
      );
      expectSurface(surface.session, manifest.surface.BridgeSession, 'session');
      expectSurface(surface.collection, manifest.surface.BridgeCollection, 'collection');
    });

    test('ve: a notification from alice reaches bob with its sender and value', async () => {
      const { a, b } = pages();
      await live(b, 'subscribe', `\\.${runId}`);
      const key = `ve.${runId}.0`;
      const value = `ve-value-${runId}-0`;
      expect(await live<boolean>(a, 'notify', { key, sharedWith: bob }, value)).toBe(true);
      await expect
        .poll(async () => (await live<LiveEvent[]>(b, 'received')).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      const first = (await live<LiveEvent[]>(b, 'received'))[0];
      expect(first?.from).toBe(alice);
      expect(first?.key.sharedBy).toBe(first?.from);
      expect(first?.key.key).toBe(key);
      expect(first?.value).toBe(value);
    });

    test('ve: collection create, get, list, query, update and remove all resolve in order with watch events', async () => {
      const { a } = pages();
      const name = `ve${runId}`;
      await live(a, 'openCollection', name, collectionOptions);
      await live(a, 'startWatch');
      const data = { label: 've', n: 1 };
      const created = await live<LiveItem>(a, 'createItem', data);
      expect(created.id).not.toBe('');
      expect(created.owner).toBe(alice);
      expect(created.data).toEqual(data);
      expect((await live<LiveItem | null>(a, 'getItem', created.id))?.data).toEqual(data);
      expect((await live<LiveListing>(a, 'listItems')).ids).toContain(created.id);
      expect(
        (await live<LiveListing>(a, 'queryItems', [{ path: 'label', op: '==', value: 've' }])).ids,
      ).toContain(created.id);
      const updated = await live<LiveItem>(a, 'updateItem', created.id, { label: 've', n: 2 });
      expect(updated.data).toEqual({ label: 've', n: 2 });
      await live(a, 'removeItem', created.id);
      expect(await live<LiveItem | null>(a, 'getItem', created.id)).toBeNull();
      await expect
        .poll(
          async () => {
            const events = await live<Array<{ type: string; id: string }>>(a, 'watchEvents');
            return events.filter((event) => event.id === created.id).map((event) => event.type);
          },
          { timeout: 30_000, intervals: [250] },
        )
        .toEqual(['updated', 'updated', 'deleted']);
    });

    test('ve: an item shared with bob is listed by bob and bob cannot remove it', async () => {
      const { a, b } = pages();
      const name = `ve${runId}`;
      await live(b, 'openCollection', name, collectionOptions);
      const shared = await live<LiveItem>(a, 'createItem', { label: 'shared' }, { sharedWith: [bob] });
      await expect
        .poll(
          async () =>
            (await live<LiveListing>(b, 'listItems')).items.find((entry) => entry.id === shared.id)?.owner,
          { timeout: 30_000, intervals: [500] },
        )
        .toBe(alice);
      const refused = await attempt(b, 'removeItem', { id: shared.id, owner: alice });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('COLLECTION_ITEM_NOT_OWNER');
    });

    test('ve: a notify without a recipient or with a foreign sender is refused locally', async () => {
      const { a, b } = pages();
      const key = `ve.${runId}.refused`;
      const before = (await live<LiveEvent[]>(b, 'received')).length;
      const noRecipient = await attempt(a, 'notify', { key }, 'x');
      expect(noRecipient.ok).toBe(false);
      if (!noRecipient.ok) {
        expect(noRecipient.code).toBe('invalid_argument');
        expect(noRecipient.message).toContain('sharedWith');
      }
      const foreign = await attempt(a, 'notify', { key, sharedWith: bob }, 'x', { sharedBy: bob });
      expect(foreign.ok).toBe(false);
      if (!foreign.ok) {
        expect(foreign.code).toBe('invalid_argument');
        expect(foreign.message).toContain('sharedBy');
      }
      await new Promise((settle) => setTimeout(settle, 3_000));
      const events = await live<LiveEvent[]>(b, 'received');
      expect(events.slice(before).filter((event) => event.key.key === key)).toEqual([]);
    });

    test('ve: a create for an atSign absent from the environment records its code', async () => {
      const context = contextA;
      if (context === undefined) throw new Error('the ve contexts were not created');
      const page = await openLivePage(context, alice);
      const result = await attempt(page, 'create', absent, namespace, rootDomain);
      let code = 'connected';
      if (!result.ok) code = result.code;
      test.info().annotations.push({ type: 've-absent-atsign-code', description: code });
      console.log(`ve: absent atSign create -> ${code}`);
      if (result.ok) await attempt(page, 'close');
      await page.close();
    });

    test('ve: close is idempotent and later calls reject closed', async () => {
      const { a, b } = pages();
      const leftovers = await live<number>(a, 'cleanup', `ve${runId}`, collectionOptions);
      test.info().annotations.push({
        type: 'cleanup',
        description: `removed ${leftovers} leftover item(s)`,
      });
      await live(a, 'close');
      await live(a, 'close');
      await live(b, 'close');
      expect(await live(a, 'afterClose', bob)).toEqual({ notify: 'closed', subscribe: 'closed' });
      await recordStatuses().catch(() => undefined);
      const finishedAt = Date.now();
      const response = await fetch(new URL('/runs', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId,
          suite: 've',
          iteration: index,
          ok: true,
          startedAt,
          finishedAt,
          ms: finishedAt - startedAt,
          statuses: [...statuses].filter(isName),
          flags: [...flags].filter(isName),
          consoleErrors,
          wsEvents,
        }),
      });
      expect(response.status, 'the run record must be accepted').toBe(204);
    });
  });
}
