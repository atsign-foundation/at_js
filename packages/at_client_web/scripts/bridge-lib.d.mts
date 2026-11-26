export const BRIDGE_REPO: string;
export const BRIDGE_ASSET: string;
export const BRIDGE_SIGNER_WORKFLOW: string;
export const BRIDGE_SOURCE_REF: string;
export const BRIDGE_TAG_PATTERN: RegExp;
export function parseBridgeRef(text: string): { tag: string; sha256: string };
export function sha256Hex(bytes: Uint8Array): string;
export function verifyDownload(file: string, expected: string): void;
export function resolveBundleSource(options: {
  root: string;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
}): string;
export function attestationArgs(file: string): string[];
export function verifiedBundleSource(options: {
  root: string;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
}): string;
export function stripSourceMapComment(text: string): string;
