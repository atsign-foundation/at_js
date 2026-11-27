/**
 * Optionally pre-navigates an atServer origin so Chromium caches its
 * client-certificate decision before the bridge opens a WebSocket to it.
 *
 * The VE atServer sends a CertificateRequest on its TLS handshake; with no
 * cached decision Chromium cancels a cold WebSocket upgrade. The bridge now
 * wakes the listener itself with a `wss`-only fetch pre-flight, so the suite
 * runs without any navigation. A top-level navigation to the origin, in the
 * same browser context, records the same decision. The navigation is made on a
 * second page, so the live page is not navigated away, and its rejection is
 * ignored: only the cached decision matters.
 *
 * This is the one place the construction lives. It is off by default;
 * `VE_PRENAVIGATE=1` (or `true`, `on`) turns it on, for example to run
 * against a bridge that predates the pre-flight.
 */
import type { BrowserContext } from '@playwright/test';
import { lookUp } from './env.mjs';

const warmed = new WeakMap<BrowserContext, Set<string>>();

/** Whether the pre-navigation is enabled (default off). */
export function prenavigateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'on'].includes((env.VE_PRENAVIGATE ?? '').toLowerCase());
}

/**
 * Warms the atServer origin of [atSign] in [context], once per origin. Returns
 * the origin warmed, or `undefined` when disabled, unknown to the root, or
 * already warm.
 */
export async function warm(
  context: BrowserContext,
  atSign: string,
  ca: Buffer,
): Promise<string | undefined> {
  if (!prenavigateEnabled()) return undefined;
  const { status, body } = await lookUp(atSign, ca);
  if (status !== 200 || !/^[\w.-]+:\d+$/.test(body)) return undefined;
  const seen = warmed.get(context) ?? new Set<string>();
  warmed.set(context, seen);
  if (seen.has(body)) return undefined;
  seen.add(body);
  const page = await context.newPage();
  try {
    await page.goto(`https://${body}/`, { timeout: 15_000 });
  } catch {
    // The navigation may be refused or never complete; the cache is what counts.
  } finally {
    await page.close();
  }
  return body;
}
