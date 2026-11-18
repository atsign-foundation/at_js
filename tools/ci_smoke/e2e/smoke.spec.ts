import { expect, test } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4174);

async function isSecureContext(host: string, page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`http://${host}:${port}/`);
  return page.evaluate(() => window.isSecureContext);
}

test('the page is a secure context on localhost', async ({ page }) => {
  expect(await isSecureContext('localhost', page)).toBe(true);
});

test('the page is not a secure context on a mapped plain-http name', async ({ page }) => {
  expect(await isSecureContext('insecure.test', page)).toBe(false);
});
