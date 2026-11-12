import { test, expect, type Page } from '@playwright/test';
import { mockFarm } from './mock-farm';

const NOW = Date.parse('2026-11-11T15:00:00-05:00');
async function setup(browser: any, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
  const page: Page = await context.newPage();
  const farm = await mockFarm(page, {}, { now: NOW });
  await page.goto('https://spoolside.shelbyklein.com/printers');
  return { page, ...farm };
}
const insideDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));

test('Tab straight after opening printer details keeps focus in the dialog', async ({ browser }) => {
  const { page } = await setup(browser);
  await expect(page.getByRole('button', { name: 'Dogwood, Ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Dogwood, Ready' }).click();
  // The control that took the first Tab is still the one with focus once the details have finished loading.
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => (document.activeElement as HTMLElement).outerHTML.slice(0, 120));
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).outerHTML.slice(0, 120))).toBe(first);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await insideDialog(page), `Tab ${i + 1}`).toBe(true);
  }
});

for (const [name, state] of [['Dogwood', 'Ready'], ['Alder', 'Printing']]) {
  test(`${name} details fit at 1440 x 900 with the sections closed`, async ({ browser }) => {
    const { page } = await setup(browser);
    await page.getByRole('button', { name: `${name}, ${state}` }).click();
    const dialog = page.getByRole('dialog', { name: `${name} details` });
    await expect(dialog.locator('.fold').first()).toBeVisible();
    await page.waitForTimeout(600); // let data arrive
    const m = await dialog.locator('.dialog-body').evaluate((el) => ({ s: el.scrollHeight, c: el.clientHeight }));
    expect(m.s, JSON.stringify(m)).toBeLessThanOrEqual(m.c);
    for (const t of await dialog.locator('.fold button[aria-expanded]').all()) await expect(t).toHaveAttribute('aria-expanded', 'false');
  });
}

test('printing details keep Pause and Stop visible with the sections closed', async ({ browser }) => {
  const { page } = await setup(browser);
  await page.getByRole('button', { name: /^Alder, / }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Alder details' });
  await expect(dialog.locator('.print-controls').getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(dialog.locator('.print-controls').getByRole('button', { name: 'Stop' })).toBeVisible();
});

test('Bed check and Start a print fold open with their content and a summary when closed', async ({ browser }) => {
  const { page, calls } = await setup(browser);
  await page.getByRole('button', { name: 'Dogwood, Ready' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dogwood details' });
  const bed = dialog.getByRole('button', { name: /^Bed check/ });
  const start = dialog.getByRole('button', { name: /^Start a print|^Print again/ });
  await expect(bed).toHaveAttribute('aria-expanded', 'false');
  await expect(start).toContainText('Ready');
  await bed.click();
  await expect(bed).toHaveAttribute('aria-expanded', 'true');
  const note = dialog.getByLabel(/fine on Dogwood/);
  await note.fill('Tape on the front edge');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => calls.some((c) => c.method === 'POST' && /bed-allow$/.test(c.path))).toBe(true);
  await start.click();
  await expect(start).toHaveAttribute('aria-expanded', 'true');
  await dialog.getByLabel('File').selectOption({ index: 2 });
  await expect(dialog.getByRole('button', { name: 'Start print' })).toBeVisible();
});
