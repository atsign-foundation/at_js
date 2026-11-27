/**
 * A shared Playwright fixture that keeps a test off the network.
 *
 * Every request is routed: one to a loopback host (or the `insecure.test` name
 * that `playwright.config.ts` maps to 127.0.0.1) continues, any other is
 * aborted and its URL recorded. Every WebSocket opened by the page is recorded
 * too. The fixture's teardown fails the test if either list is non-empty, so a
 * case that dials out cannot pass by accident.
 */
import { test as base, expect, type Page } from '@playwright/test';

/** The host names the e2e server answers on. */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', 'insecure.test']);

export interface NetworkGuard {
  /** URLs of the requests the guard aborted, in order. */
  readonly blocked: string[];
  /** URLs of the WebSockets the page opened, in order. */
  readonly sockets: string[];
  /** Forgets the recorded requests, so a later check sees an empty list. */
  drain(): void;
}

/** Routes every request of [page] through the guard and records its WebSockets. */
export function installNetworkGuard(page: Page): NetworkGuard {
  const blocked: string[] = [];
  const sockets: string[] = [];
  void page.route('**', (route) => {
    const url = new URL(route.request().url());
    if (loopbackHosts.has(url.hostname)) return route.continue();
    blocked.push(url.href);
    return route.abort();
  });
  page.on('websocket', (socket) => {
    sockets.push(socket.url());
  });
  return {
    blocked,
    sockets,
    drain() {
      blocked.length = 0;
    },
  };
}

export const test = base.extend<{ guard: NetworkGuard }>({
  guard: async ({ page }, use) => {
    const guard = installNetworkGuard(page);
    await use(guard);
    expect(guard.blocked, 'non-loopback requests must be refused').toEqual([]);
    expect(guard.sockets, 'the page must open no WebSocket').toEqual([]);
  },
});

export { expect };
