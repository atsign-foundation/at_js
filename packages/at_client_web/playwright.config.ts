import { defineConfig, type Project } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
// Set on the owner's Mac: it reaches the server on the VPS through an SSH
// tunnel, so there is no web server to start here.
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${port}`;

const bridgeProject: Project = { name: 'bridge', testMatch: ['bridge.spec.ts'] };

// The live suite runs real flows against a production atServer and is skipped
// unless AT_KEYS_FILE and AT_SIGN are set. Its recordings are off so no key
// text can reach an artefact, and it keeps the list reporter only.
const liveProject: Project = {
  name: 'live',
  testDir: 'e2e',
  testMatch: ['live/**'],
  use: { trace: 'off', video: 'off', screenshot: 'off', baseURL },
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL,
    // Maps a name to the loopback server that Chromium, unlike localhost, treats as insecure over http.
    launchOptions: { args: ['--host-resolver-rules=MAP insecure.test 127.0.0.1'] },
  },
  // The keyless real-bridge suite, and the only one `npm run e2e` runs. The
  // gated `live` suite adds its own project.
  projects: [bridgeProject, liveProject],
  webServer:
    externalBaseURL === undefined
      ? {
          command: 'node e2e/server.mjs',
          url: `http://127.0.0.1:${port}/`,
          reuseExistingServer: false,
        }
      : undefined,
});
