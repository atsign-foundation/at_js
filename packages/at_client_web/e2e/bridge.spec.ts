/**
 * The real dart2js bridge in Chromium, keyless and off the network.
 *
 * The page is this package's own build (`dist/index.js` plus
 * `dist/dart/at_client.js`); the guard in `guard.ts` fails any test that makes
 * a non-loopback request or opens a WebSocket. Every input here is one the
 * bridge refuses inside its option checks, before it dials out: `not json` and
 * `{"version":99}`. The one `{}` is on the non-secure page, where the package
 * refuses before the bridge is loaded, so it never reaches Dart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './guard.js';
import { sha256Hex, stripSourceMapComment } from '../scripts/bridge-lib.mjs';

const port = Number(process.env.E2E_PORT ?? 4173);
const base = `http://localhost:${port}`;
const insecureBase = `http://insecure.test:${port}`;
const bundlePath = '/dist/dart/at_client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleSha = sha256Hex(
  Buffer.from(stripSourceMapComment(readFileSync(join(root, '.bridge', 'at_client_web.js'), 'utf8')), 'utf8'),
);
const manifest = JSON.parse(readFileSync(join(root, 'bridge-manifest.json'), 'utf8')) as {
  surface: { BridgeEntry: string[] };
};

/** What `AtClient.create` rejected with, as the page saw it. */
interface Rejection {
  isAtError: boolean;
  name?: string;
  code?: string;
  message?: string;
}

/** Opens the e2e page on loopback, where it is a secure context. */
async function openSecure(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${base}/`);
  await page.waitForFunction(() => (window as any).e2eReady === true);
}

/** Calls `AtClient.create([options])` in the page and reports its rejection. */
async function createFailure(
  page: import('@playwright/test').Page,
  options: unknown,
): Promise<Rejection> {
  return page.evaluate(async (opts) => {
    try {
      await (window as any).AtClient.create(opts);
      return { isAtError: false };
    } catch (error) {
      const failure = error as { name?: string; code?: string; message?: string };
      return {
        isAtError: error instanceof (window as any).AtError,
        name: failure.name,
        code: failure.code,
        message: failure.message,
      };
    }
  }, options);
}

test('the network guard aborts and records a non-loopback request', async ({ page, guard }) => {
  await openSecure(page);
  const rejected = await page.evaluate(async () => {
    try {
      await fetch('http://example.invalid/');
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  expect(guard.blocked).toEqual(['http://example.invalid/']);
  // Drain, so the guard's own end-of-test emptiness check still holds.
  guard.drain();
});

test('the real bridge bundle loads and installs its global', async ({ page }) => {
  const served = page.waitForResponse(
    (response) => new URL(response.url()).pathname === bundlePath,
  );
  await openSecure(page);
  const failure = await createFailure(page, { atSign: '@alice', namespace: 'e2e', keys: 'not json' });
  expect(failure.code).toBe('bad_key');
  const response = await served;
  expect(response.status()).toBe(200);
  expect(sha256Hex(await response.body())).toBe(bundleSha);
  expect(await page.evaluate(() => typeof (window as any).__atsignAtClientWeb?.create)).toBe(
    'function',
  );
});

test('the bridge entry surface equals the manifest', async ({ page }) => {
  await openSecure(page);
  // Any bridge-rejected create loads the real bundle and installs its global.
  await createFailure(page, { atSign: '@alice', namespace: 'e2e', keys: 'not json' });
  const expected = manifest.surface.BridgeEntry;
  const enumerated = await page.evaluate(() => {
    const bridge = (window as any).__atsignAtClientWeb;
    const names: string[] = Object.keys(bridge ?? {});
    return { names, functions: names.filter((name) => typeof bridge[name] === 'function') };
  });
  if (enumerated.names.length > 0) {
    test.info().annotations.push({
      type: 'surface',
      description: `enumerated ${enumerated.names.join(', ')}`,
    });
    expect([...enumerated.functions].sort()).toEqual([...expected].sort());
  } else {
    // dart2js wrappers may not enumerate: fall back to checking each member.
    test.info().annotations.push({ type: 'surface', description: 'enumeration opaque; per-member' });
    const types = await page.evaluate(
      (names) => names.map((name) => typeof (window as any).__atsignAtClientWeb?.[name]),
      expected,
    );
    expect(types.every((type) => type === 'function')).toBe(true);
  }
});

test('keys that are not JSON reject bad_key', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, { atSign: '@alice', namespace: 'e2e', keys: 'not json' });
  expect(failure.isAtError).toBe(true);
  expect(failure.code).toBe('bad_key');
  expect(failure.message).toContain('keys is not valid JSON');
});

test('a keys document the parser refuses rejects bad_key', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: '@alice',
    namespace: 'e2e',
    keys: '{"version":99}',
  });
  expect(failure.code).toBe('bad_key');
  expect(failure.message).toContain('keys is not a usable .atKeys document');
});

test('keys JSON that is not an object rejects invalid_argument', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, { atSign: '@alice', namespace: 'e2e', keys: '[]' });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('keys must be an .atKeys JSON object or its text');
});

test('an atSign with two @ rejects invalid_argument naming atSign', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: '@a@b',
    namespace: 'e2e',
    keys: '{"version":99}',
  });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('atSign must be a valid atSign');
});

test('a bare atSign is refused before the bundle loads', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: 'alice',
    namespace: 'e2e',
    keys: '{"version":99}',
  });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('AtClientOptions.atSign');
  expect(requests.filter((url) => new URL(url).pathname === bundlePath)).toEqual([]);
});

test('a dotted namespace rejects invalid_argument naming namespace', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: '@alice',
    namespace: 'a.b',
    keys: '{"version":99}',
  });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('namespace must be a non-empty namespace segment');
});

test('a bad rootDomain rejects invalid_argument naming rootDomain', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: '@alice',
    namespace: 'e2e',
    rootDomain: 'bad host!',
    keys: '{"version":99}',
  });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('rootDomain must be host or host:port');
});

test('a blank rpId with passkey rejects invalid_argument naming rpId', async ({ page }) => {
  await openSecure(page);
  const failure = await createFailure(page, {
    atSign: '@alice',
    namespace: 'e2e',
    passkey: true,
    rpId: '  ',
    rpName: 'x',
  });
  expect(failure.code).toBe('invalid_argument');
  expect(failure.message).toContain('rpId must be a non-empty string');
});

test('the bridge checks keys JSON shape, then atSign, namespace and the keys document in that order', async ({
  page,
}) => {
  await openSecure(page);
  const shape = await createFailure(page, {
    atSign: '@a@b',
    namespace: 'a.b',
    keys: 'not json',
  });
  expect(shape.code).toBe('bad_key');
  expect(shape.message).toContain('keys is not valid JSON');
  const atSign = await createFailure(page, {
    atSign: '@a@b',
    namespace: 'a.b',
    keys: '{"version":99}',
  });
  expect(atSign.code).toBe('invalid_argument');
  expect(atSign.message).toContain('atSign must be a valid atSign');
  const namespace = await createFailure(page, {
    atSign: '@alice',
    namespace: 'a.b',
    keys: '{"version":99}',
  });
  expect(namespace.code).toBe('invalid_argument');
  expect(namespace.message).toContain('namespace must be a non-empty namespace segment');
});

test('create on a non-secure page rejects with unsupported', async ({ page }) => {
  await page.goto(`${insecureBase}/`);
  await page.waitForFunction(() => (window as any).e2eReady === true);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  const failure = await page.evaluate(async () => {
    try {
      await (window as any).AtClient.create({ atSign: '@alice', namespace: 'e2e', keys: '{}' });
      return null;
    } catch (error) {
      const e = error as { name: string; code: string };
      return { isAtError: error instanceof (window as any).AtError, name: e.name, code: e.code };
    }
  });
  expect(failure).toEqual({ isAtError: true, name: 'AtError', code: 'unsupported' });
});

test('the bridge itself refuses a non-secure page with unsupported', async ({ page }) => {
  await page.goto(`${insecureBase}/`);
  await page.waitForFunction(() => (window as any).e2eReady === true);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  const outcome = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/dist/dart/at_client.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('the bridge bundle did not load'));
      document.head.appendChild(script);
    });
    const bridge = (window as any).__atsignAtClientWeb;
    if (bridge === undefined || typeof bridge.create !== 'function') {
      return { installed: false, rejected: false, code: null, message: null };
    }
    try {
      await bridge.create({ atSign: '@alice', namespace: 'e2e', keys: 'not json' });
      return { installed: true, rejected: false, code: null, message: null };
    } catch (error) {
      const e = error as { code?: unknown; message?: unknown };
      return {
        installed: true,
        rejected: true,
        code: typeof e?.code === 'string' ? e.code : null,
        message: typeof e?.message === 'string' ? e.message : String(error),
      };
    }
  });
  expect(outcome.installed).toBe(true);
  expect(outcome.rejected).toBe(true);
  expect(outcome.code).toBe('unsupported');
  expect(String(outcome.message)).toContain('a secure context (HTTPS) is required');
});

test('the bundle loads and exposes no passkey entry points', async ({ page }) => {
  await openSecure(page);
  // Load the real bundle first: this create is refused inside the bridge.
  await createFailure(page, { atSign: '@alice', namespace: 'e2e', keys: 'not json' });
  expect(await page.evaluate(() => typeof (window as any).__atsignAtClientWeb?.create)).toBe(
    'function',
  );
  const surface = await page.evaluate(() => {
    const client = (window as any).AtClient;
    return {
      create: typeof client.create,
      passkey: ['onboard', 'enroll', 'prfSupported'].filter((name) => name in client),
    };
  });
  expect(surface).toEqual({ create: 'function', passkey: [] });
});
