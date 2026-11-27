/**
 * Pre-navigates an atServer origin so Chromium caches its client-certificate
 * decision before the bridge opens a WebSocket to it.
 *
 * The VE atServer sends a CertificateRequest on its TLS handshake; with no
 * cached decision Chromium cancels the WebSocket upgrade. A top-level
 * navigation to the origin, in the same browser context, records the decision.
 * The navigation is made on a second page, so the live page is not navigated
 * away, and its rejection is ignored: only the cached decision matters.
 *
 * This is the one place the construction lives. `VE_PRENAVIGATE=0` (or
 * `false`, `off`) turns it off, so a bridge-side pre-flight can be tried
 * without it; the default is on.
 */
import type { BrowserContext } from '@playwright/test';
import { lookUp } from './env.mjs';

const warmed = new WeakMap<BrowserContext, Set<string>>();

/** Whether the pre-navigation is enabled (default on). */
export function prenavigateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['0', 'false', 'off'].includes((env.VE_PRENAVIGATE ?? '').toLowerCase());
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
