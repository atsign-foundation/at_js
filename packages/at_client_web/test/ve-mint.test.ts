/**
 * The demo keys reach the page as a plain document.
 *
 * The at_demo_data fixtures are legacy self-encrypted: four AES fields hold
 * AES-CTR ciphertext under the base64 `selfEncryptionKey` beside them. The
 * bridge takes the plain document, so `plainKeysDocument` decrypts those fields
 * (and only those, and only when there is a key to decrypt them with).
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { plainKeysDocument } from "../e2e/ve/mint.mjs";

const FIELDS = [
  "aesPkamPublicKey",
  "aesPkamPrivateKey",
  "aesEncryptPublicKey",
  "aesEncryptPrivateKey",
] as const;

/** Base64 AES-CTR ciphertext of the PKCS#7-padded [plaintext] under [key], as the fixtures hold it. */
function encrypt(key: Buffer, plaintext: string): string {
  const cipher = createCipheriv(
    `aes-${key.length * 8}-ctr`,
    key,
    Buffer.alloc(16),
  );
  const text = Buffer.from(plaintext, "utf8");
  const pad = 8 - (text.length % 8);
  const padded = Buffer.concat([text, Buffer.alloc(pad, pad)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    "base64",
  );
}

function documentOf(key: Buffer): Record<string, string> {
  return {
    selfEncryptionKey: key.toString("base64"),
    aesPkamPublicKey: encrypt(key, "pkam public key"),
    aesPkamPrivateKey: encrypt(key, "pkam private key"),
    aesEncryptPublicKey: encrypt(key, "encrypt public key"),
    aesEncryptPrivateKey: encrypt(key, "encrypt private key"),
    apkamSymmetricKey: "left alone",
  };
}

describe("plainKeysDocument", () => {
  it("decrypts the four fields for 16, 24 and 32 byte keys and keeps the rest", () => {
    for (const length of [16, 24, 32]) {
      const key = randomBytes(length);
      const plain = JSON.parse(
        plainKeysDocument(JSON.stringify(documentOf(key))),
      ) as Record<string, string>;
      expect(plain.aesPkamPublicKey).toBe("pkam public key");
      expect(plain.aesPkamPrivateKey).toBe("pkam private key");
      expect(plain.aesEncryptPublicKey).toBe("encrypt public key");
      expect(plain.aesEncryptPrivateKey).toBe("encrypt private key");
      expect(plain.apkamSymmetricKey).toBe("left alone");
      // The key itself is carried through in the clear; only the fields change.
      expect(plain.selfEncryptionKey).toBe(key.toString("base64"));
    }
  });

  it("leaves a document without a selfEncryptionKey unchanged", () => {
    const text = JSON.stringify({ aesPkamPublicKey: "abc", other: "x" });
    expect(plainKeysDocument(text)).toBe(text);
  });

  it("leaves a document with none of the four fields unchanged", () => {
    const text = JSON.stringify({
      selfEncryptionKey: Buffer.alloc(16, 1).toString("base64"),
    });
    expect(plainKeysDocument(text)).toBe(text);
  });

  it("decrypts only the fields that are present", () => {
    const key = randomBytes(32);
    const text = JSON.stringify({
      selfEncryptionKey: key.toString("base64"),
      aesPkamPrivateKey: encrypt(key, "only me"),
    });
    const plain = JSON.parse(plainKeysDocument(text)) as Record<string, string>;
    expect(plain.aesPkamPrivateKey).toBe("only me");
    expect(plain).not.toHaveProperty("aesPkamPublicKey");
  });

  it("names selfEncryptionKey, without its text, for an unusable key length", () => {
    const selfEncryptionKey = Buffer.alloc(7, 2).toString("base64");
    const text = JSON.stringify({
      selfEncryptionKey,
      aesPkamPublicKey: "AAAA",
    });
    let message = "";
    try {
      plainKeysDocument(text);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("selfEncryptionKey");
    expect(message).not.toContain(selfEncryptionKey);
  });
});
