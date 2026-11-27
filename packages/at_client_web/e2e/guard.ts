/**
 * A shared Playwright fixture that keeps every test off the network.
 *
 * The fixture is automatic: every test that imports `test` from this module is
 * guarded, whether or not it names `guard`. Every request is routed: one a
 * policy allows continues, any other is aborted and its URL recorded. The
 * policy also decides which WebSockets are allowed; a refused one is recorded.
 * The route is installed before the test body runs, so it is in place before
 * the first `goto`. The fixture's teardown fails the test if either list is
 * non-empty, so a case that dials out cannot pass by accident.
 *
 * The default policy is `loopbackPolicy`: the e2e server's hosts and no
 * socket. The `ve` project overrides the `guardPolicy` option with `vePolicy()`.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { loopbackPolicy, type GuardPolicy } from './guard-policy.js';

export interface NetworkGuard {
  /** URLs of the requests the guard aborted, in order. */
  readonly blocked: string[];
  /** URLs of the WebSockets the policy refused, in order. */
  readonly sockets: string[];
  /** Forgets the recorded requests and sockets, so a later check sees empty lists. */
  drain(): void;
}

/**
 * Routes every request of [page] through [policy] and records its refused
 * WebSockets. It awaits the route install, so the guard is in place before the
 * caller's first `goto`.
 */
export async function installNetworkGuard(
  page: Page,
  policy: GuardPolicy = loopbackPolicy,
): Promise<NetworkGuard> {
  const blocked: string[] = [];
  const sockets: string[] = [];
  await page.route('**', (route) => {
    const url = new URL(route.request().url());
    if (policy.allowRequest(url)) return route.continue();
    blocked.push(url.href);
    return route.abort();
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (!policy.allowSocket(url)) sockets.push(socket.url());
  });
  return {
    blocked,
    sockets,
    drain() {
      blocked.length = 0;
      sockets.length = 0;
    },
  };
}

export const test = base.extend<{ guard: NetworkGuard; guardPolicy: GuardPolicy }>({
  guardPolicy: [loopbackPolicy, { option: true }],
  guard: [
    async ({ page, guardPolicy }, use) => {
      const guard = await installNetworkGuard(page, guardPolicy);
      await use(guard);
      expect(guard.blocked, 'requests outside the guard policy must be refused').toEqual([]);
      expect(guard.sockets, 'sockets outside the guard policy must be refused').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
