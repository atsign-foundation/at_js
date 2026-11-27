/**
 * The live end-to-end suite: real flows against a production atServer.
 *
 * It runs only on the owner's machine, where `AT_KEYS_FILE` names the
 * account's `.atKeys` file and `AT_SIGN` names the atSign; without both, every
 * test is skipped and the reason is printed once, so a zero-run is never read
 * as a pass. Key text enters a page only through `setInputFiles` on the live
 * page's file input: it never crosses a Playwright protocol argument, never
 * reaches a recording, and is never stored or logged by the page.
 *
 * The run is a `test.describe.serial` group repeated `LIVE_RUNS` times (three
 * by default), one group per run id `r<epoch>`. Two browser contexts on the
 * same atSign carry A and B: A notifies its own atSign and B receives, because
 * a session drops the echo of its own sends.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { scanForSecrets } from '../redact.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keysPath = process.env.AT_KEYS_FILE;
const atSign = process.env.AT_SIGN;
const namespace = process.env.AT_NAMESPACE ?? 'atjs_e2e';
const configuredRuns = Number(process.env.LIVE_RUNS ?? 3);
// At least one run, so an empty or bogus LIVE_RUNS cannot produce a zero-run pass.
const runs = Number.isFinite(configuredRuns) ? Math.max(1, Math.trunc(configuredRuns)) : 3;
const gated = (keysPath ?? '') === '' || (atSign ?? '') === '';
const base = process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.E2E_PORT ?? 4173)}`;
const collectionOptions = { type: 'atjs_e2e_item', eventSource: 'data' as const };

const manifest = JSON.parse(readFileSync(join(PKG, 'bridge-manifest.json'), 'utf8')) as {
  surface: { BridgeSession: string[]; BridgeCollection: string[] };
};

if (gated) console.log('live: skipped (no AT_KEYS_FILE/AT_SIGN)');
test.skip(gated, 'live: skipped (no AT_KEYS_FILE/AT_SIGN)');

/** The shapes the live page hands back; every value is plain JSON. */
interface LiveSurface {
  names: string[];
  types: string[];
}
interface LiveItem {
  id: string;
  owner: string;
  type: string;
  data: Record<string, unknown>;
  sharedWith: string[];
}
interface LiveListing {
  ids: string[];
  unreadable: number;
}
interface LiveEvent {
  operation: string;
  from: string;
  key: { key: string; sharedBy?: string; namespace?: string };
  value?: string;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/**
 * An atSign in canonical form: lowercase, one leading `@`, and no `.`
 * characters after it. `AtClient.create` lowercases the atSign, so assertions
 * compare canonical forms while raw values still go to `create` and `notify`.
 */
function canonicalAtSign(value: string): string {
  const sign = value.startsWith('@') ? value : `@${value}`;
  return sign.toLowerCase().replace(/\./g, '');
}

/** Calls `window.live.<method>(...args)`; no key text is ever an argument. */
function live<R>(page: Page, method: string, ...args: unknown[]): Promise<R> {
  return page.evaluate(
    ([name, params]) => (window as any).live[name](...params),
    [method, args] as [string, unknown[]],
  ) as Promise<R>;
}

/** Whether a status or flag is safe to send as a run record name. */
function isName(value: string): boolean {
  return /^[A-Za-z0-9_:.-]{1,64}$/.test(value);
}

/** Every file under `dir`, or none when it does not exist. */
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

/** Compares the enumerated surface, falling back to a per-member check. */
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

test.describe('live', () => {
  const epoch = Date.now();
  for (let index = 0; index < runs; index += 1) {
    describeRun(`r${epoch}${index}`, index);
  }
});

function describeRun(runId: string, index: number): void {
  test.describe.serial(`live ${runId}`, () => {
    const startedAt = Date.now();
    let contextA: BrowserContext | undefined;
    let contextB: BrowserContext | undefined;
    let pageA: Page | undefined;
    let pageB: Page | undefined;
    const consoleLines: string[] = [];
    const statuses = new Set<string>();
    const flags = new Set<string>();
    let consoleErrors = 0;
    let wsEvents = 0;

    function pages(): { a: Page; b: Page } {
      if (pageA === undefined || pageB === undefined) {
        throw new Error('the live pages were not created');
      }
      return { a: pageA, b: pageB };
    }

    function contexts(): { a: BrowserContext; b: BrowserContext } {
      if (contextA === undefined || contextB === undefined) {
        throw new Error('the live contexts were not created');
      }
      return { a: contextA, b: contextB };
    }

    /** Captures the console and counts the WebSocket events and console errors. */
    function capture(page: Page): void {
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
    }

    /** Opens the live page and loads the keys file into its closure-held input. */
    async function openLivePage(context: BrowserContext): Promise<Page> {
      const page = await context.newPage();
      capture(page);
      await page.goto('/live');
      await page.waitForFunction(() => (window as any).live?.ready === true);
      // The only route the key text takes into a page: Chromium reads the file.
      await page.setInputFiles('#keys', required(keysPath, 'AT_KEYS_FILE'));
      await page.waitForFunction(() => (window as any).live?.keysLoaded === true);
      return page;
    }

    /** Adds every status the pages reported to the run's recorded set. */
    async function recordStatuses(): Promise<void> {
      const { a, b } = pages();
      for (const page of [a, b]) {
        for (const status of await live<string[]>(page, 'statuses')) statuses.add(status);
      }
    }

    test.afterAll(async () => {
      // The scan runs here, before the contexts close, so it also runs when an
      // earlier serial test failed. A skipped suite has no keys to scan.
      let hits: string[] = [];
      if (!gated) {
        const keysDoc = JSON.parse(readFileSync(required(keysPath, 'AT_KEYS_FILE'), 'utf8')) as unknown;
        const texts = [...consoleLines];
        for (const file of filesUnder(join(PKG, 'test-results'))) {
          texts.push(readFileSync(file, 'utf8'));
        }
        hits = scanForSecrets(keysDoc, texts);
      }
      await contextA?.close();
      await contextB?.close();
      // Field names only: a hit is reported without any value.
      if (hits.length > 0) {
        throw new Error(`key fields found in artefacts or console: ${hits.join(', ')}`);
      }
    });

    test('live: create A and B through the keys file input', async ({ browser }) => {
      const sign = required(atSign, 'AT_SIGN');
      contextA = await browser.newContext();
      contextB = await browser.newContext();
      [pageA, pageB] = await Promise.all([openLivePage(contextA), openLivePage(contextB)]);
      const start = Date.now();
      const created = await Promise.all([
        live(pageA, 'create', sign, namespace),
        live(pageB, 'create', sign, namespace),
      ]);
      expect(created).toHaveLength(2);
      for (const page of [pageA, pageB]) {
        const budget = Math.max(1, 30_000 - (Date.now() - start));
        await expect
          .poll(() => live<string>(page, 'status'), { timeout: budget, intervals: [500] })
          .toBe('connected');
      }
      await recordStatuses();
    });

    test('live: the session and a collection expose the bridge surface', async () => {
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

    test('live: A notifies its own atSign and B receives it', async () => {
      const { a, b } = pages();
      const sign = required(atSign, 'AT_SIGN');
      const pattern = `\\.${runId}`;
      await live(b, 'subscribe', pattern);
      // A subscribes to the same pattern to show its own send is not echoed to it.
      await live(a, 'subscribe', pattern);
      const key = `live.${runId}.0`;
      const value = `live-value-${runId}-0`;
      expect(await live<boolean>(a, 'notify', { key, sharedWith: sign }, value)).toBe(true);
      await expect
        .poll(async () => (await live<LiveEvent[]>(b, 'received')).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      const events = await live<LiveEvent[]>(b, 'received');
      const first = events[0];
      expect(first).toBeDefined();
      expect(first?.from).toBe(canonicalAtSign(sign));
      expect(first?.key.sharedBy).toBe(first?.from);
      expect(first?.key.key).toBe(key);
      expect(first?.value).toBe(value);
      // Nothing is a hard wait: give an echo time to show up before refusing it.
      await new Promise((settle) => setTimeout(settle, 500));
      expect(await live<LiveEvent[]>(a, 'received')).toEqual([]);
    });

    test('live: a collection round-trips create, get, list, query, update and remove', async () => {
      const { a } = pages();
      const name = `live${runId}`;
      await live(a, 'openCollection', name, collectionOptions);
      // Clear anything an earlier failed run left under this name before watching.
      const leftovers = await live<number>(a, 'cleanup', name, collectionOptions);
      test.info().annotations.push({
        type: 'cleanup',
        description: `removed ${leftovers} leftover item(s)`,
      });
      await live(a, 'startWatch');

      const data = { label: 'live', n: 1 };
      const created = await live<LiveItem>(a, 'createItem', data);
      expect(created.id).not.toBe('');
      expect(created.owner).toBe(canonicalAtSign(required(atSign, 'AT_SIGN')));
      expect(created.data).toEqual(data);

      const got = await live<LiveItem | null>(a, 'getItem', created.id);
      expect(got?.data).toEqual(data);

      const listed = await live<LiveListing>(a, 'listItems');
      expect(listed.ids).toContain(created.id);

      const queried = await live<LiveListing>(a, 'queryItems', [
        { path: 'label', op: '==', value: 'live' },
      ]);
      expect(queried.ids).toContain(created.id);

      const updated = await live<LiveItem>(a, 'updateItem', created.id, { label: 'live', n: 2 });
      expect(updated.data).toEqual({ label: 'live', n: 2 });

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

    test('live: the statuses seen while offline are recorded, never asserted', async () => {
      const { a } = pages();
      const { a: context } = contexts();
      await context.setOffline(true);
      const observed = new Set<string>();
      for (let tick = 0; tick < 10; tick += 1) {
        await new Promise((settle) => setTimeout(settle, 1000));
        observed.add(await live<string>(a, 'status'));
      }
      await recordStatuses();
      for (const status of observed) statuses.add(status);
      const expected = new Set(['connected', 'waiting:network']);
      for (const status of statuses) {
        if (!expected.has(status)) flags.add(`status:${status}`);
      }
      test.info().annotations.push({
        type: 'offline',
        description: `recorded statuses: ${[...statuses].join(', ') || 'none'}`,
      });
    });

    test('live: coming back online reconnects within 60 s and notifies again', async () => {
      const { a, b } = pages();
      const { a: context } = contexts();
      await context.setOffline(false);
      await expect
        .poll(() => live<string>(a, 'status'), { timeout: 60_000, intervals: [500] })
        .toBe('connected');
      const sign = required(atSign, 'AT_SIGN');
      const before = (await live<LiveEvent[]>(b, 'received')).length;
      const key = `live.${runId}.1`;
      const value = `live-value-${runId}-1`;
      expect(await live<boolean>(a, 'notify', { key, sharedWith: sign }, value)).toBe(true);
      await expect
        .poll(async () => (await live<LiveEvent[]>(b, 'received')).length, { timeout: 30_000 })
        .toBeGreaterThan(before);
      const events = await live<LiveEvent[]>(b, 'received');
      expect(events[events.length - 1]?.value).toBe(value);
      await recordStatuses();
    });

    test('live: close is idempotent and later calls reject closed', async () => {
      const { a, b } = pages();
      const sign = required(atSign, 'AT_SIGN');
      // Best effort: cleanup needs an open session, so it runs before the close.
      const leftovers = await live<number>(a, 'cleanup', `live${runId}`, collectionOptions);
      test.info().annotations.push({
        type: 'cleanup',
        description: `removed ${leftovers} leftover item(s)`,
      });
      await live(a, 'close');
      await live(a, 'close');
      await live(b, 'close');
      expect(await live(a, 'afterClose', sign)).toEqual({ notify: 'closed', subscribe: 'closed' });
    });

    test('live: the run is recorded', async () => {
      const finishedAt = Date.now();
      const record = {
        runId,
        suite: 'live',
        iteration: index,
        ok: true,
        startedAt,
        finishedAt,
        ms: finishedAt - startedAt,
        statuses: [...statuses].filter(isName),
        flags: [...flags].filter(isName),
        consoleErrors,
        wsEvents,
      };
      const response = await fetch(new URL('/runs', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      });
      expect(response.status, 'the run record must be accepted').toBe(204);
    });
  });
}
