import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    // Maps a name to the loopback server that Chromium, unlike localhost, treats as insecure over http.
    launchOptions: { args: ['--host-resolver-rules=MAP insecure.test 127.0.0.1'] },
  },
  // The keyless real-bridge suite, and the only one `npm run e2e` runs. The
  // gated `live` and `ve` suites add their own projects.
  projects: [{ name: 'bridge', testMatch: ['bridge.spec.ts'] }],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
