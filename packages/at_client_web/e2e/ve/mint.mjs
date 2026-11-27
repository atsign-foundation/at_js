// Mints the virtual environment's demo `.atKeys` (`@alice🛠 @bob🛠 @colin🛠
// @eve🛠`, public fixtures from at_demo_data) into a keys directory.
//
// The SDK's tests/at_end2end_test/test/local_setup.dart wipes and writes a
// cwd-relative atKeys/ and config/, so it runs from a throwaway copy of that
// directory, never from the SDK tree. The copy drops `resolution: workspace`
// (and any pubspec_overrides.yaml) so its dependencies resolve from pub.dev.
// No key text is ever printed.
import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VE_ATSIGNS = ["@alice🛠", "@bob🛠", "@colin🛠", "@eve🛠"];

// The legacy `.atKeys` fields the demo fixtures carry self-encrypted: base64 of
// AES-CTR ciphertext under the base64 `selfEncryptionKey` beside them.
const SELF_ENCRYPTED_FIELDS = [
  "aesPkamPublicKey",
  "aesPkamPrivateKey",
  "aesEncryptPublicKey",
  "aesEncryptPrivateKey",
];
const CIPHERS = new Map([
  [16, "aes-128-ctr"],
  [24, "aes-192-ctr"],
  [32, "aes-256-ctr"],
]);
const ZERO_IV = Buffer.alloc(16);

const SKIPPED = new Set([
  ".dart_tool",
  "atKeys",
  "config",
  "pubspec_overrides.yaml",
]);

/** The default keys directory: `AT_VE_KEYS_DIR`, else `$TMPDIR/ve-keys`. */
export function defaultKeysDir() {
  return resolve(process.env.AT_VE_KEYS_DIR ?? join(tmpdir(), "ve-keys"));
}

/** The keys file name the mint writes for [atSign]. */
export function keysFileName(atSign) {
  return `${atSign}_key.atKeys`;
}

/**
 * Which of the four demo keys files in [keysDir] are missing or do not parse
 * as a JSON object; empty when all four are usable.
 */
export function unusableKeys(keysDir) {
  return VE_ATSIGNS.filter((atSign) => {
    const file = join(keysDir, keysFileName(atSign));
    if (!existsSync(file)) return true;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return (
        parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
      );
    } catch {
      return true;
    }
  });
}

/**
 * [bytes] without the PKCS#7 padding the SDK adds before it encrypts: a last
 * byte `n` (1..16) repeated `n` times. Anything else is returned whole.
 */
function withoutPadding(bytes) {
  const n = bytes.at(-1);
  if (n === undefined || n < 1 || n > 16 || n > bytes.length) return bytes;
  for (let i = bytes.length - n; i < bytes.length; i += 1)
    if (bytes[i] !== n) return bytes;
  return bytes.subarray(0, bytes.length - n);
}

/**
 * Returns the `.atKeys` document in [text] as JSON text with the legacy
 * self-encrypted fields (the ones present) replaced by their plaintext.
 *
 * The demo fixtures are self-encrypted: the four AES fields hold base64 of
 * AES-CTR ciphertext under the base64 `selfEncryptionKey` that sits beside them
 * in the clear. The browser bridge takes the plain document (its key parse does
 * not self-decrypt), so the suite decrypts the fields before the page sees the
 * keys. The cipher follows the decoded key length (16, 24 or 32 bytes) and the
 * IV is 16 zero bytes. The SDK PKCS#7-pads the text before encrypting, so the
 * padding is stripped after decrypting.
 * Without a `selfEncryptionKey`, or without any of the four fields, [text] is
 * returned unchanged. Key material never enters an error message.
 */
export function plainKeysDocument(text) {
  const document = JSON.parse(text);
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    return text;
  const selfEncryptionKey = document.selfEncryptionKey;
  if (typeof selfEncryptionKey !== "string") return text;
  const fields = SELF_ENCRYPTED_FIELDS.filter(
    (field) => typeof document[field] === "string",
  );
  if (fields.length === 0) return text;

  const key = Buffer.from(selfEncryptionKey, "base64");
  const cipher = CIPHERS.get(key.length);
  if (cipher === undefined) {
    throw new Error(
      `selfEncryptionKey decodes to ${key.length} bytes: expected a 16, 24 or 32 byte key`,
    );
  }
  for (const field of fields) {
    const decipher = createDecipheriv(cipher, key, ZERO_IV);
    const ciphertext = Buffer.from(document[field], "base64");
    const padded = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    document[field] = withoutPadding(padded).toString("utf8");
  }
  return JSON.stringify(document);
}

/**
 * Mints the four keys files into [keysDir], unless they are already there and
 * parse (pass `force` to mint anyway). Returns what it did.
 */
export function mintKeys({
  keysDir = defaultKeysDir(),
  sdkTestDir = process.env.AT_VE_SDK_TEST_DIR,
  mintDir = join(tmpdir(), "ve-mint"),
  dart = process.env.AT_VE_DART ?? "dart",
  force = false,
} = {}) {
  if (!force && unusableKeys(keysDir).length === 0)
    return { minted: false, keysDir };
  if (sdkTestDir === undefined || sdkTestDir === "") {
    throw new Error(
      "AT_VE_SDK_TEST_DIR is not set: point it at an at_client_sdk checkout's tests/at_end2end_test",
    );
  }
  sdkTestDir = resolve(sdkTestDir);

  rmSync(mintDir, { recursive: true, force: true });
  cpSync(sdkTestDir, mintDir, {
    recursive: true,
    filter: (source) =>
      !SKIPPED.has(source.slice(sdkTestDir.length + 1).split("/")[0]),
  });
  const pubspec = join(mintDir, "pubspec.yaml");
  const lines = readFileSync(pubspec, "utf8").split("\n");
  writeFileSync(
    pubspec,
    lines.filter((line) => line.trim() !== "resolution: workspace").join("\n"),
  );

  const run = (args) =>
    execFileSync(dart, args, {
      cwd: mintDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
  run(["pub", "get"]);
  run(["run", "test/local_setup.dart"]);

  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  for (const atSign of VE_ATSIGNS) {
    const name = keysFileName(atSign);
    cpSync(join(mintDir, "atKeys", name), join(keysDir, name));
  }
  const missing = unusableKeys(keysDir);
  if (missing.length > 0)
    throw new Error(`mint left unusable keys for ${missing.join(", ")}`);
  return { minted: true, keysDir, files: readdirSync(keysDir).length };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = mintKeys({ force: process.argv.includes("--force") });
  console.log(
    result.minted
      ? `minted demo keys into ${result.keysDir}`
      : `demo keys already in ${result.keysDir}`,
  );
}
