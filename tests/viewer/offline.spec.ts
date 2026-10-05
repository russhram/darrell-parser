import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server.js';
import { config } from '../../src/config.js';
import { sample } from '../fixtures/sample.js';
import { exportBook } from '../../src/exporters.js';
import { Store } from '../../src/persistence.js';
test('offline viewer switches all material, retains answers, searches and works on mobile/print', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'darrell-e2e-'));
  const c = config('view', {
    APP_USERNAME: 'fixture',
    APP_PASSWORD: 'fixture-pass',
    OUTPUT_DIR: join(dir, 'output'),
    DATA_DIR: join(dir, 'data'),
  });
  const { job, book } = sample();
  const store = new Store(c.dataDir);
  store.save(job);
  store.close();
  await exportBook(book, join(c.outputDir, job.id));
  const app = await createApp(c);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const external: string[] = [];
  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(origin)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  try {
    await page.goto(origin + '/');
    await page.getByLabel('Username').fill('fixture');
    await page.getByLabel('Password').fill('fixture-pass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Open viewer' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-language', 'nl');
    await expect(page.getByText('Een rivier stroomt naar de zee.', { exact: true })).toBeVisible();
    await page.locator('details.answer summary').click();
    await page.locator('#language').selectOption('en');
    await expect(page.getByText('A river flows to the sea.', { exact: true })).toBeVisible();
    await expect(page.getByText('Een rivier stroomt naar de zee.', { exact: true })).toBeHidden();
    await expect(page.getByText('To the sea', { exact: true })).toBeVisible();
    await expect(page.getByText('The sea', { exact: true })).toBeVisible();
    await page.locator('#search').fill('no-such-material');
    await expect(page.locator('.study-section')).toBeHidden();
    await page.locator('#search').fill('Q1.1.1');
    await expect(page.locator('.study-section')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.answer')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await page.locator('#print-answers').check();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.answer')).toBeVisible();
    expect(external).toEqual([]);
  } finally {
    await app.close();
  }
});
test('portable file viewer stays bilingual with JavaScript disabled', async ({ browser }) => {
  const dir = await mkdtemp(join(tmpdir(), 'darrell-file-'));
  await exportBook(sample().book, dir);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('file://' + join(dir, 'viewer/index.html'));
    await expect(page.getByText('Een rivier stroomt naar de zee.', { exact: true })).toBeVisible();
    await expect(page.getByText('A river flows to the sea.', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
