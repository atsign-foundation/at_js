// The single owner of the E2E port: server, Playwright config and specs all read it here.
export const DEFAULT_PORT = 4174;

export function e2ePort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.E2E_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`E2E_PORT: must be 1-65535, got ${raw}`);
  }
  return port;
}
