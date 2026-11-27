/**
 * The network guard policies, free of Playwright so they can be unit tested.
 *
 * The loopback policy keeps a test on the e2e server; the VE policy
 * additionally admits the VE root and atServer ports, and only the atServer's
 * `/ws` socket.
 */
import { VE_HOST, VE_ROOT_PORT, VE_TOP_PORT } from './ve/env.mjs';

export interface GuardPolicy {
  /** True when a request to this URL may continue. */
  allowRequest(url: URL): boolean;
  /** True when a WebSocket to this URL is allowed; false records it as a violation. */
  allowSocket(url: URL): boolean;
}

/** The host names the e2e server answers on. */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', 'insecure.test']);

/** True when [port] is an atServer or the root port of the VE. */
function vePort(port: string): boolean {
  if (port === '') return false;
  const value = Number(port);
  return Number.isFinite(value) && value >= VE_ROOT_PORT && value <= VE_TOP_PORT;
}

/** Allows the loopback hosts and no socket at all. */
export const loopbackPolicy: GuardPolicy = {
  allowRequest: (url) => loopbackHosts.has(url.hostname),
  allowSocket: () => false,
};

/** Allows the loopback hosts, the VE's http(s) ports, and only its `wss://…/ws`. */
export function vePolicy(): GuardPolicy {
  return {
    allowRequest(url) {
      if (loopbackHosts.has(url.hostname)) return true;
      if (url.hostname !== VE_HOST) return false;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return vePort(url.port);
    },
    allowSocket(url) {
      if (url.protocol !== 'wss:') return false;
      if (url.hostname !== VE_HOST) return false;
      if (url.pathname !== '/ws') return false;
      return vePort(url.port);
    },
  };
}
