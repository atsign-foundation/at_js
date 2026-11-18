import { defineConfig } from '@playwright/test';
import { e2ePort } from './src/port.js';

const port = e2ePort();

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
  webServer: {
    command: 'npm run build && node dist/server.js',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
