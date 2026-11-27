// A plain TCP pass-through to one atServer, for `proxy:` roots in the VE probe
// and suite. TLS is never touched: bytes go both ways as they are, so the
// browser still checks the atServer's own certificate.
//
// `dropFirst: n` closes the first n accepted connections before any byte is
// forwarded, so a client's open-with-retry path can be exercised.
import { createConnection, createServer } from 'node:net';

/**
 * Starts the pass-through on 127.0.0.1 and resolves once it listens.
 *
 * @param {{ targetHost?: string, targetPort: number, port?: number, dropFirst?: number }} options
 * @returns {Promise<{ port: number, accepted: () => number, dropped: () => number, close: () => Promise<void> }>}
 */
export function startFlakyProxy({ targetHost = '127.0.0.1', targetPort, port = 0, dropFirst = 0 }) {
  let accepted = 0;
  let dropped = 0;
  const sockets = new Set();
  const server = createServer((client) => {
    accepted += 1;
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    if (dropped < dropFirst) {
      dropped += 1;
      client.destroy();
      return;
    }
    const upstream = createConnection({ host: targetHost, port: targetPort });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', end);
    upstream.on('error', end);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : port,
        accepted: () => accepted,
        dropped: () => dropped,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
