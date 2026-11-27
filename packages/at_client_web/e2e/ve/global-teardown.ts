/**
 * Stops the VE started by `global-setup.ts`.
 *
 * Like the setup, it does nothing unless `AT_VE === '1'`, so the bridge and
 * live suites never touch docker.
 */
import { composeDown } from './env.mjs';

export default async function globalTeardown(): Promise<void> {
  if (process.env.AT_VE !== '1') return;
  try {
    composeDown();
  } catch (error) {
    console.error(`ve teardown: ${error instanceof Error ? error.message : String(error)}`);
  }
}
