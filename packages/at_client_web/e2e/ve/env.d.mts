/**
 * The shared VE helpers: docker compose, certificate and browser flags, the
 * root lookup, and demo-key minting.
 */
export const VE_HOST: string;
export const VE_ROOT_PORT: number;
export const VE_TOP_PORT: number;

export function docker(args: string[]): string;
export function composeUp(): void;
export function composeDown(): void;
export function loadPkamKeys(timeoutMs?: number): Promise<void>;

export function spkiHash(certPem: Buffer | string): string;
export function veBrowserArgs(spki?: string): string[];
export function veLaunchArgs(spki?: string): string[];

export function veCaBytes(certsDir: string): Buffer;
export function veSpki(certsDir: string): string;

export function lookUp(
  atSign: string,
  ca: Buffer | string,
  port?: number,
): Promise<{ status: number | undefined; body: string }>;

export function ensureKeys(keysDir?: string): { minted: boolean; keysDir: string };
