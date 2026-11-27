/**
 * Conformance with the pinned bridge release's `bridge-manifest.json`.
 *
 * The manifest is a byte copy of the release asset, so these tests compare the
 * package's own codes and bridge member names with it. They read it as JSON
 * text, not as a module: tsconfig has no `resolveJsonModule`, and the copy must
 * stay byte-equal for `fetch-bridge` to accept a release.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toAtError } from '../src/error.js';
import {
  allCodes,
  bridgeMembers,
  collectionCodes,
  collectionMembers,
  sessionMembers,
} from './surface-lists.js';

interface Manifest {
  schemaVersion: number;
  errorCodes: string[];
  collectionErrorCodes: string[];
  surface: {
    BridgeEntry: string[];
    BridgeSession: string[];
    BridgeCollection: string[];
  };
}

const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge-manifest.json'), 'utf8'),
) as Manifest;

/**
 * Only schemaVersion 1 is handled; a newer manifest must not slip past these
 * checks, so fail loudly until the checks below are extended for it.
 */
function requireV1(): void {
  const version = manifest.schemaVersion;
  if (version !== 1) throw new Error('update manifest.test.ts for schemaVersion ' + version);
}

function noDuplicates(codes: readonly string[]): boolean {
  return new Set(codes).size === codes.length;
}

describe('bridge manifest', () => {
  it('error codes equal the pinned bridge manifest', () => {
    requireV1();
    expect(noDuplicates(allCodes)).toBe(true);
    expect(noDuplicates(collectionCodes)).toBe(true);
    const collection = new Set<string>(collectionCodes);
    const clientCodes = allCodes.filter((code) => code !== 'overflow' && !collection.has(code));
    expect(new Set(clientCodes)).toEqual(new Set(manifest.errorCodes));
    expect(new Set(collectionCodes)).toEqual(new Set(manifest.collectionErrorCodes));
  });

  it('toAtError keeps every manifest code and maps an unknown one to internal', () => {
    requireV1();
    for (const code of [...manifest.errorCodes, ...manifest.collectionErrorCodes]) {
      expect(toAtError({ code, message: 'm' }).code).toBe(code);
    }
    expect(toAtError({ code: 'no_such_code', message: 'm' }).code).toBe('internal');
  });

  it('bridge interfaces equal the manifest surface', () => {
    requireV1();
    expect([...bridgeMembers].sort()).toEqual([...manifest.surface.BridgeEntry].sort());
    expect([...sessionMembers].sort()).toEqual([...manifest.surface.BridgeSession].sort());
    expect([...collectionMembers].sort()).toEqual([...manifest.surface.BridgeCollection].sort());
  });
});
