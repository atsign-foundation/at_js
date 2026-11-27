// Checks that the local atServer virtual environment (docker) is usable from
// Chromium before any VE test runs, and writes seven pass/fail checks to
// e2e/ve/probe.json. Exits non-zero when any check fails.
//
//   AT_VE_CERTS_DIR   at_server a158b700's .../secondary/base/certs (required)
//   AT_VE_KEYS_DIR    the demo keys (default $TMPDIR/ve-keys; minted when missing,
//                     which needs AT_VE_SDK_TEST_DIR and Dart, see mint.mjs)
//   E2E_PORT          the e2e server's port (default 4173)
//
// The demo keys are public fixtures; none of their text reaches probe.json or
// the console.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startFlakyProxy } from './flaky-proxy.mjs';
import {
  VE_HOST,
  VE_ROOT_PORT,
  composeDown,
  composeUp,
  docker,
  lookUp,
  spkiHash,
  veLaunchArgs,
} from './env.mjs';
import { defaultKeysDir, keysFileName, mintKeys, unusableKeys } from './mint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const COMPOSE = join(HERE, 'docker-compose.yaml');
const PROJECT = 'at_client_web_ve';
const IMAGE = readFileSync(join(HERE, 'image.lock'), 'utf8').trim();
const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
const READY_MS = 180_000;

function tcpOpen(port) {
  return new Promise((settle) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      settle(true);
    });
    socket.on('error', () => settle(false));
    socket.setTimeout(3_000, () => {
      socket.destroy();
      settle(false);
    });
  });
}

/** Whether the TLS server on [port] sends a CertificateRequest (asks the client for a certificate). */
function requestsClientCertificate(port) {
  try {
    const out = execFileSync(
      'openssl',
      ['s_client', '-connect', `127.0.0.1:${port}`, '-servername', VE_HOST, '-alpn', 'http/1.1'],
      { input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 },
    );
    return /Requested Signature Algorithms/.test(out) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

const isCertificateError = (error) => /certificate|issuer|verify/i.test(String(error));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls until the root answers for @alice🛠 and its atServer port accepts, or the deadline passes. */
async function waitReady(ca) {
  const deadline = Date.now() + READY_MS;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    try {
      const { status, body } = await lookUp('@alice🛠', ca);
      const port = Number(/:(\d+)$/.exec(body)?.[1]);
      if (status === 200 && port > 0 && (await tcpOpen(port))) return { port, waitedMs: READY_MS - (deadline - Date.now()) };
      last = `root answered ${status}`;
    } catch (error) {
      if (isCertificateError(error)) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`the VE was not ready within ${READY_MS} ms: ${last}`);
}

function startServer() {
  const child = spawn(process.execPath, [join(PKG, 'e2e/server.mjs')], {
    cwd: PKG,
    env: { ...process.env, E2E_PORT: String(E2E_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((settle, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`e2e server exited with ${code}`)));
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('serving at')) settle(child);
    });
  });
}

/** Opens a WebSocket to [url] in a page; resolves 'open' or 'error'. */
function openSocket(page, url) {
  return page.evaluate(
    (target) =>
      new Promise((settle) => {
        const socket = new WebSocket(target);
        const timer = setTimeout(() => settle('timeout'), 15_000);
        socket.onopen = () => {
          clearTimeout(timer);
          socket.close();
          settle('open');
        };
        socket.onerror = () => {
          clearTimeout(timer);
          settle('error');
        };
      }),
    url,
  );
}

/** Creates a client in the e2e page and waits for `connected`; resolves the status it ended on. Never logs [keys]. */
async function createAndConnect(page, keys, rootDomain) {
  return page.evaluate(
    async ({ text, root }) => {
      const code = (error) => (typeof error?.code === 'string' ? error.code : String(error?.name ?? 'error'));
      let client;
      try {
        client = await window.AtClient.create({ atSign: '@alice🛠', namespace: 'atjs_ve', keys: text, rootDomain: root });
      } catch (error) {
        return { status: 'create-failed', code: code(error) };
      }
      const deadline = Date.now() + 35_000;
      while (client.status !== 'connected' && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 250));
      }
      const status = client.status;
      await client.close().catch(() => undefined);
      return { status };
    },
    { text: keys, root: rootDomain },
  );
}

async function main() {
  const certsDir = process.env.AT_VE_CERTS_DIR;
  if (certsDir === undefined || certsDir === '') throw new Error('AT_VE_CERTS_DIR is not set');
  const keysDir = defaultKeysDir();
  const fullchain = readFileSync(join(certsDir, 'fullchain.pem'));
  const spki = spkiHash(fullchain);
  const checks = [];
  const record = (n, name, ok, detail) => {
    checks.push({ n, name, ok, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${name}: ${detail}`);
  };
  const cleanups = [];
  let atServerPort;
  let lookupCa = fullchain;

  try {
    // A container left over from an earlier run may come from another compose file.
    composeDown();
    composeUp();
    cleanups.push(() => composeDown());

    // 1. container up on the range, root answering and an atServer port open.
    try {
      const state = docker(['compose', '-p', PROJECT, '-f', COMPOSE, 'ps', '--format', '{{.State}} {{.Image}}']).trim();
      const range = docker(['port', `${PROJECT}-virtualenv-1`, String(VE_ROOT_PORT)]).trim();
      let ready;
      try {
        ready = await waitReady(lookupCa);
      } catch (error) {
        if (!isCertificateError(error)) throw error;
        lookupCa = readFileSync(join(certsDir, 'cacert.pem'));
        ready = await waitReady(lookupCa);
      }
      atServerPort = ready.port;
      const ok = state.startsWith('running') && state.includes(IMAGE.split('@')[1]) && range.includes(`127.0.0.1:${VE_ROOT_PORT}`);
      record(1, 'container up on 26300-26399', ok, `${state}; root ${range}; ready after ${ready.waitedMs} ms`);
    } catch (error) {
      record(1, 'container up on 26300-26399', false, String(error));
    }

    // 2. the image's fullchain.pem is the one at_server a158b700 ships.
    try {
      const scratch = mkdtempSync(join(tmpdir(), 've-probe-'));
      cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
      const copied = join(scratch, 'fullchain.pem');
      docker(['cp', `${PROJECT}-virtualenv-1:/atsign/secondary/base/certs/fullchain.pem`, copied]);
      const ok = Buffer.compare(readFileSync(copied), fullchain) === 0;
      record(2, 'image cert equals a158b700', ok, ok ? 'byte-equal' : 'differs');
    } catch (error) {
      record(2, 'image cert equals a158b700', false, String(error));
    }

    // 3. the root answers the bridge's HTTPS lookup.
    try {
      const { status, body } = await lookUp('@alice🛠', lookupCa);
      const ok = status === 200 && /^vip\.ve\.atsign\.zone:263\d\d$/.test(body);
      const ca = lookupCa === fullchain ? 'fullchain.pem' : 'cacert.pem (fullchain.pem did not verify)';
      record(3, 'root HTTPS lookup', ok, `${status} ${body}; ca ${ca}`);
    } catch (error) {
      record(3, 'root HTTPS lookup', false, String(error));
    }

    const server = await startServer();
    cleanups.push(() => server.kill());
    const base = `http://localhost:${E2E_PORT}/`;

    // 4. Chromium opens the atServer's wss:// with the SPKI flag; a control launch without it is recorded.
    const browser = await chromium.launch({ args: veLaunchArgs(spki) });
    cleanups.push(() => browser.close());
    const page = await browser.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.e2eReady === true);
    try {
      const url = `wss://${VE_HOST}:${atServerPort}/ws`;
      const withFlag = await openSocket(page, url);
      const control = await chromium.launch({ args: veLaunchArgs(undefined) });
      let withoutFlag;
      let trustedWithoutFlag;
      try {
        const controlPage = await control.newPage();
        await controlPage.goto(base);
        withoutFlag = await openSocket(controlPage, url);
        trustedWithoutFlag = await controlPage.evaluate(
          (target) => fetch(target).then((response) => response.ok, () => false),
          `https://${VE_HOST}:${VE_ROOT_PORT}/@${encodeURIComponent('alice🛠')}`,
        );
      } finally {
        await control.close();
      }
      // Diagnostics only; they never change the verdict.
      const asksClientCert = requestsClientCertificate(atServerPort);
      const warmPage = await browser.newPage();
      const warmed = await warmPage
        .goto(`https://${VE_HOST}:${atServerPort}/`)
        .then(() => openSocket(warmPage, url), (error) => `navigation failed: ${String(error).split('\n')[0]}`);
      await warmPage.close();
      const honoured =
        trustedWithoutFlag ? 'not determinable (Chromium trusts the cert without it)'
        : withoutFlag === 'open' ? 'not determinable'
        : withFlag === 'open' ? 'yes' : 'no';
      record(
        4,
        'Chromium opens wss://…/ws',
        withFlag === 'open',
        `${url}: ${withFlag}; without the SPKI flag: ${withoutFlag}; HTTPS fetch to the root without the flag: ${trustedWithoutFlag ? 'ok' : 'failed'}; ` +
          `SPKI flag honoured: ${honoured}; atServer requests a TLS client certificate: ${asksClientCert}; ` +
          `same socket after a top-level navigation to the atServer origin (diagnostic): ${warmed}`,
      );
    } catch (error) {
      record(4, 'Chromium opens wss://…/ws', false, String(error));
    }

    // 7 first: 5 and 6 need the keys.
    let keys;
    let keysDetail;
    try {
      const minted = mintKeys({ keysDir });
      const missing = unusableKeys(keysDir);
      keysDetail = missing.length === 0 ? `4 files parse${minted.minted ? ' (minted now)' : ''}` : `unusable: ${missing.join(', ')}`;
      if (missing.length === 0) keys = readFileSync(join(keysDir, keysFileName('@alice🛠')), 'utf8');
    } catch (error) {
      keysDetail = error instanceof Error ? error.message.split('\n')[0] : 'mint failed';
    }

    // 5. a proxy: root reaches the atServer through a plain TCP pass-through.
    if (keys === undefined || atServerPort === undefined) {
      record(5, 'proxy: root through a TCP pass-through', false, 'no keys or atServer port');
    } else {
      const proxy = await startFlakyProxy({ targetPort: atServerPort });
      cleanups.push(() => proxy.close());
      try {
        const result = await createAndConnect(page, keys, `proxy:${VE_HOST}:${proxy.port}`);
        const ok = result.status === 'connected' && proxy.accepted() > 0;
        record(5, 'proxy: root through a TCP pass-through', ok, `status ${result.status}${result.code ? ` (${result.code})` : ''}; proxy accepted ${proxy.accepted()}`);
      } catch (error) {
        record(5, 'proxy: root through a TCP pass-through', false, String(error));
      }
    }

    // 6. a direct create against the VE root reaches connected.
    if (keys === undefined) {
      record(6, 'create reaches connected', false, 'no keys');
    } else {
      try {
        const result = await createAndConnect(page, keys, `${VE_HOST}:${VE_ROOT_PORT}`);
        record(6, 'create reaches connected', result.status === 'connected', `status ${result.status}${result.code ? ` (${result.code})` : ''}`);
      } catch (error) {
        record(6, 'create reaches connected', false, String(error));
      }
    }

    record(7, 'four demo keys files parse', keys !== undefined, keysDetail);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        console.error(`cleanup: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  checks.sort((a, b) => a.n - b.n);
  const report = { ranAt: new Date().toISOString(), image: IMAGE, checks };
  writeFileSync(join(HERE, 'probe.json'), `${JSON.stringify(report, null, 2)}\n`);
  const failed = checks.filter((check) => !check.ok).map((check) => check.n);
  const missing = [1, 2, 3, 4, 5, 6, 7].filter((n) => !checks.some((check) => check.n === n));
  console.log(failed.length === 0 && missing.length === 0 ? 'PROBE: PASS' : `PROBE: FAIL (checks ${[...failed, ...missing].join(', ')})`);
  return failed.length === 0 && missing.length === 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (ok) => process.exit(ok ? 0 : 1),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
