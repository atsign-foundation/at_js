/**
 * Starts the VE for the `ve` Playwright project.
 *
 * Registered top-level in `playwright.config.ts`, so it runs for the bridge
 * and live suites too: it returns immediately unless `AT_VE === '1'`, which is
 * what keeps those suites off docker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeDown,
  composeUp,
  ensureKeys,
  lookUp,
  loadPkamKeys,
} from "./env.mjs";

const READY_MS = 180_000;
const POLL_MS = 1_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((settle) => setTimeout(settle, ms));
const isCertificateError = (error: unknown): boolean =>
  /certificate|issuer|verify/i.test(String(error));

export default async function globalSetup(): Promise<void> {
  if (process.env.AT_VE !== "1") return;
  const certsDir = process.env.AT_VE_CERTS_DIR;
  if (certsDir === undefined || certsDir === "")
    throw new Error("AT_VE_CERTS_DIR is not set");

  // A container left over from an earlier run may come from another compose file.
  composeDown();
  composeUp();

  // Poll the root's HTTPS lookup, falling back from fullchain.pem to
  // cacert.pem once when the former does not verify, as `probe.mjs` does.
  let caFile = join(certsDir, "fullchain.pem");
  let ca = readFileSync(caFile);
  let fellBack = false;
  let ready = false;
  let last = "no answer yet";
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    try {
      const { status, body } = await lookUp("@alice🛠", ca);
      const port = Number(/:(\d+)$/.exec(body)?.[1]);
      if (status === 200 && port > 0) {
        ready = true;
        break;
      }
      last = `root answered ${status}`;
    } catch (error) {
      if (isCertificateError(error)) {
        if (fellBack) throw error;
        caFile = join(certsDir, "cacert.pem");
        ca = readFileSync(caFile);
        fellBack = true;
        continue;
      }
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_MS);
  }
  if (!ready)
    throw new Error(`the VE was not ready within ${READY_MS} ms: ${last}`);

  // The image ships its demo PKAM keys unloaded; without them every PKAM is refused.
  await loadPkamKeys();

  // The spec reads the chosen CA from a path; bytes never enter the environment.
  process.env.AT_VE_CA_FILE = caFile;

  // Mint the demo fixtures when missing or unusable; their text is never printed.
  ensureKeys();
}
