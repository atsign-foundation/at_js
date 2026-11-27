/**
 * The VE global setup and teardown return before docker unless `AT_VE=1`.
 *
 * They are registered top-level in `playwright.config.ts`, so they run for the
 * bridge and live suites too; the early return is what keeps those suites off
 * docker. A certs directory that does not exist proves it returned first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import globalSetup from '../e2e/ve/global-setup.js';
import globalTeardown from '../e2e/ve/global-teardown.js';

const savedVe = process.env.AT_VE;
const savedCerts = process.env.AT_VE_CERTS_DIR;

afterEach(() => {
  if (savedVe === undefined) delete process.env.AT_VE;
  else process.env.AT_VE = savedVe;
  if (savedCerts === undefined) delete process.env.AT_VE_CERTS_DIR;
  else process.env.AT_VE_CERTS_DIR = savedCerts;
});

describe('ve global setup and teardown', () => {
  for (const value of [undefined, '0'] as const) {
    const label = value === undefined ? 'unset' : `'${value}'`;
    it(`returns before docker when AT_VE is ${label}`, async () => {
      if (value === undefined) delete process.env.AT_VE;
      else process.env.AT_VE = value;
      process.env.AT_VE_CERTS_DIR = '/nonexistent/ve-certs';
      await expect(globalSetup()).resolves.toBeUndefined();
      await expect(globalTeardown()).resolves.toBeUndefined();
    });
  }
});
