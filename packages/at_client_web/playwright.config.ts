import { defineConfig, type Project } from '@playwright/test';
import { vePolicy } from './e2e/guard-policy.js';
import { veBrowserArgs, veSpki } from './e2e/ve/env.mjs';

const port = Number(process.env.E2E_PORT ?? 4173);
// Set on the owner's Mac: it reaches the server on the VPS through an SSH
// tunnel, so there is no web server to start here.
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${port}`;

// The SPKI trust entry is computed only for the VE, and only when its certs
// are configured, so a missing cert directory never breaks the other projects.
const veSpkiValue =
  process.env.AT_VE === '1' && process.env.AT_VE_CERTS_DIR !== undefined && process.env.AT_VE_CERTS_DIR !== ''
    ? veSpki(process.env.AT_VE_CERTS_DIR)
    : undefined;

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

// The keyless VE suite is skipped unless AT_VE=1. A project's `use`
// `launchOptions` replaces the top-level one, so the complete flag list is
// repeated here: one host-resolver rule for both names, plus the SPKI entry.
const veProject: Project = {
  name: 've',
  testDir: 'e2e',
  testMatch: ['ve/*.spec.ts'],
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    baseURL,
    guardPolicy: vePolicy(),
    launchOptions: { args: veBrowserArgs(veSpkiValue) },
  },
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Both return before docker unless AT_VE=1, so the bridge and live suites
  // are unaffected.
  globalSetup: './e2e/ve/global-setup.ts',
  globalTeardown: './e2e/ve/global-teardown.ts',
  use: {
    browserName: 'chromium',
    headless: true,
    baseURL,
    // Maps a name to the loopback server that Chromium, unlike localhost, treats as insecure over http.
    launchOptions: { args: ['--host-resolver-rules=MAP insecure.test 127.0.0.1'] },
  },
  // The keyless real-bridge suite, and the only one `npm run e2e` runs (the
  // script selects `--project=bridge`). The gated `live` and `ve` suites add
  // their own projects.
  projects: [bridgeProject, liveProject, veProject],
  webServer:
    externalBaseURL === undefined
      ? {
          command: 'node e2e/server.mjs',
          url: `http://127.0.0.1:${port}/`,
          reuseExistingServer: false,
        }
      : undefined,
});
