// Phone tab bar (C1) and tablet Overview (C2) from the UI/UX pass.
import { test, expect, type Browser } from '@playwright/test';
import { mockFarm, makeFarm, LIVE } from './mock-farm';

const NOW = Date.parse('2026-11-11T15:00:00-05:00');
async function open(browser: Browser, width: number, height: number) {
  const phone = width <= 760;
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  await mockFarm(page, {}, { now: NOW });
  return { context, page };
}

test('phones get five readable tabs; Personal, Supplies and Settings open from More', async ({ browser }) => {
  const { context, page } = await open(browser, 428, 926);
  await page.goto(LIVE + '/printers');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const tabs = nav.getByRole('button');
  await expect(tabs).toHaveCount(5);
  const sizes = await tabs.evaluateAll((els) => els.map((el) => ({ label: el.querySelector('span')!.textContent, font: parseFloat(getComputedStyle(el.querySelector('span')!).fontSize), height: el.getBoundingClientRect().height })));
  expect(sizes.map((s) => s.label)).toEqual(['Home', 'Printers', 'PlayCase', 'Queue', 'More']);
  for (const s of sizes) {
    expect(s.font, s.label!).toBeGreaterThanOrEqual(12);
    expect(s.height, s.label!).toBeGreaterThanOrEqual(44);
  }
  // Queue carries its count; Printers is the current page.
  await expect(nav.getByRole('button', { name: /^Queue/ }).locator('small')).toHaveText(String(makeFarm(NOW).workspace.printQueue.length));
  await expect(nav.getByRole('button', { name: 'Printers', exact: true })).toHaveAttribute('aria-current', 'page');
  const more = nav.getByRole('button', { name: 'More', exact: true });
  await expect(more).not.toHaveAttribute('aria-current');

  // The sheet lists the three pages; Escape closes it and puts focus back on More.
  await more.click();
  const sheet = page.getByRole('dialog', { name: 'More' });
  for (const name of ['Personal', 'Supplies', 'Settings']) {
    const row = sheet.getByRole('button', { name, exact: true });
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(page).toHaveURL(/\/printers$/);

  // Choosing Settings goes there, closes the sheet and marks More selected.
  await more.click();
  await sheet.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(more).toHaveAttribute('aria-current', 'true');
  await expect(more).toHaveClass(/selected/);
  await expect(nav.locator('[aria-current]')).toHaveCount(1);
  // In the sheet, the current page is marked too.
  await more.click();
  await expect(sheet.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');

  // Opening a More page directly marks More selected as well.
  await page.goto(LIVE + '/supplies');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Supplies');
  await expect(more).toHaveAttribute('aria-current', 'true');

  // Home is the Overview.
  await nav.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('region', { name: 'Spoolside home' })).toBeVisible();

  // Wide screens keep the whole sidebar, with no More.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(tabs).toHaveText(['Overview', /^Printers/, 'PlayCase', 'Orders', 'Library', 'Personal', /^Queue/, 'Supplies', 'Settings']);
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await context.close();
});

test('the demo workspace reaches its More pages on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/printers');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button')).toHaveCount(5);
  await nav.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: 'Supplies', exact: true }).click();
  await expect(page).toHaveURL(/\/supplies$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Supplies');
  await context.close();
});

test('a tablet Overview shows every printer on the first screen', async ({ browser }) => {
  const { context, page } = await open(browser, 820, 1180);
  await page.goto(LIVE + '/');
  const printers = page.getByRole('region', { name: 'Printers' });
  await expect(printers).toHaveCount(1);
  for (const m of makeFarm(NOW).machines) await expect(printers.getByRole('button', { name: new RegExp(`^${m.name}, `) })).toBeVisible();
  expect((await printers.boundingBox())!.y).toBeLessThan(900);
  // Short states and tap targets.
  await expect(printers.getByRole('button', { name: /^Alder, / })).toContainText('Printing 46% · 1h 12m');
  await expect(printers.getByRole('button', { name: /^Cedar, / })).toContainText('Held by Spoolside');
  await expect(printers.getByRole('button', { name: /^Dogwood, / })).toContainText('Ready');
  for (const box of await printers.getByRole('button', { name: /, / }).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
  // A tile opens that printer's details.
  await printers.getByRole('button', { name: /^Birch, / }).click();
  await expect(page.getByRole('dialog', { name: 'Birch details' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Desktop keeps its two columns: the printer list beside Needs you, and no strip.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(printers).toHaveCount(1);
  await expect(page.locator('.printer-strip-section')).toHaveCount(0);
  await expect(printers.locator('.printer-row')).toHaveCount(5);
  const [main, fleet] = await Promise.all([page.locator('.overview-main').boundingBox(), page.locator('.overview-fleet').boundingBox()]);
  expect(fleet!.x).toBeGreaterThan(main!.x + main!.width);
  expect(Math.abs(fleet!.y - main!.y)).toBeLessThan(2);

  // Phones keep the water home, with no strip.
  await page.setViewportSize({ width: 428, height: 926 });
  await expect(page.getByRole('region', { name: 'Spoolside home' })).toBeVisible();
  await expect(page.locator('.printer-strip-section')).toHaveCount(0);
  await context.close();
});
