// The VE helpers shared by the probe, the Playwright config, the global
// setup/teardown and the VE spec: docker compose, certificate and browser
// helpers, the root lookup, and demo-key minting.
//
// The demo keys are public fixtures; no helper here ever prints their text.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultKeysDir, mintKeys, unusableKeys } from "./mint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE = join(HERE, "docker-compose.yaml");
const PROJECT = "at_client_web_ve";

export const VE_HOST = "vip.ve.atsign.zone";
export const VE_ROOT_PORT = 26300;
export const VE_TOP_PORT = 26399;

/** Runs `docker <args>` through `sg docker`, as the VPS requires. */
export function docker(args) {
  const quoted = args
    .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
    .join(" ");
  return execFileSync("sg", ["docker", "-c", `docker ${quoted}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function composeUp() {
  docker(["compose", "-p", PROJECT, "-f", COMPOSE, "up", "-d", "--wait"]);
}

/** `supervisorctl <args>` inside the VE container. */
function supervisorctl(args) {
  try {
    return docker([
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE,
      "exec",
      "-T",
      "virtualenv",
      "supervisorctl",
      ...args,
    ]);
  } catch (error) {
    // supervisorctl exits non-zero whenever a program is not RUNNING; its text is the answer.
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

/** The demo atSigns the suite signs in as: their keys must be installed before any PKAM. */
const PKAM_ATSIGNS = ["@alice🛠", "@bob🛠"];

/**
 * Loads the demo PKAM public keys into the atServers. The image leaves its
 * `pkamLoad` program stopped (`autostart = false`), and until it has run every
 * atServer refuses the demo atSigns' PKAM. The program installs the keys and
 * then sleeps forever, so it never exits: this starts it and waits for its log
 * to report each of [PKAM_ATSIGNS] installed.
 */
export async function loadPkamKeys(timeoutMs = 120_000) {
  supervisorctl(["start", "pkamLoad"]);
  const deadline = Date.now() + timeoutMs;
  let log = "";
  while (Date.now() < deadline) {
    try {
      log = docker([
        "compose",
        "-p",
        PROJECT,
        "-f",
        COMPOSE,
        "exec",
        "-T",
        "virtualenv",
        "cat",
        "/apps/logs/pkam.log",
      ]);
    } catch {
      log = "";
    }
    if (
      PKAM_ATSIGNS.every((atSign) =>
        log.includes(`cramAndPkamAuth successful for ${atSign}`),
      )
    )
      return;
    await new Promise((settle) => setTimeout(settle, 1_000));
  }
  throw new Error(
    `pkamLoad did not install the keys for ${PKAM_ATSIGNS.join(", ")} in ${timeoutMs} ms`,
  );
}

export function composeDown() {
  docker(["compose", "-p", PROJECT, "-f", COMPOSE, "down"]);
}

/** The base64 SHA-256 of a PEM certificate's SubjectPublicKeyInfo, for Chromium's SPKI allow-list. */
export function spkiHash(certPem) {
  const pub = execFileSync("openssl", ["x509", "-pubkey", "-noout"], {
    input: certPem,
  });
  const der = execFileSync("openssl", ["pkey", "-pubin", "-outform", "der"], {
    input: pub,
  });
  return execFileSync("openssl", ["dgst", "-sha256", "-binary"], {
    input: der,
  }).toString("base64");
}

/**
 * The Chromium flags a VE context needs: one host-resolver rule mapping both
 * the e2e server name and the VE host to loopback, plus the optional SPKI
 * trust entry. Chromium honours a single `--host-resolver-rules` value.
 */
export function veBrowserArgs(spki) {
  const args = [
    `--host-resolver-rules=MAP insecure.test 127.0.0.1,MAP ${VE_HOST} 127.0.0.1`,
  ];
  if (spki !== undefined)
    args.push(`--ignore-certificate-errors-spki-list=${spki}`);
  return args;
}

/** The probe's flags: only the VE host is mapped, as before the shared module. */
export function veLaunchArgs(spki) {
  const args = [`--host-resolver-rules=MAP ${VE_HOST} 127.0.0.1`];
  if (spki !== undefined)
    args.push(`--ignore-certificate-errors-spki-list=${spki}`);
  return args;
}

/** The bytes of `fullchain.pem` in [certsDir]; the SPKI is computed from them. */
export function veCaBytes(certsDir) {
  return readFileSync(join(certsDir, "fullchain.pem"));
}

/** The SPKI allow-list value for [certsDir]'s `fullchain.pem`. */
export function veSpki(certsDir) {
  return spkiHash(readFileSync(join(certsDir, "fullchain.pem")));
}

/** Asks the VE root for [atSign] the way the bridge does: GET https://<root>/<atSign>. */
export function lookUp(atSign, ca, port = VE_ROOT_PORT) {
  const path = `/@${encodeURIComponent(atSign.replace(/^@/, ""))}`;
  return new Promise((settle, fail) => {
    const req = request(
      {
        host: VE_HOST,
        port,
        path,
        servername: VE_HOST,
        ca,
        // The root serves HTTPS only to a client that offers ALPN, as browsers
        // do; without it the port speaks the atProtocol.
        ALPNProtocols: ["http/1.1"],
        lookup: (_host, options, callback) =>
          options?.all
            ? callback(null, [{ address: "127.0.0.1", family: 4 }])
            : callback(null, "127.0.0.1", 4),
        timeout: 5_000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          settle({ status: response.statusCode, body: body.trim() }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", fail);
    req.end();
  });
}

/** Mints the demo keys into [keysDir] when any is missing or unusable; never prints them. */
export function ensureKeys(keysDir = defaultKeysDir()) {
  const minted = mintKeys({ keysDir });
  const missing = unusableKeys(keysDir);
  if (missing.length > 0)
    throw new Error(`unusable keys for ${missing.join(", ")} in ${keysDir}`);
  return { minted: minted.minted === true, keysDir };
}
