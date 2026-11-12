// UI/UX pass, tasks C3 and C4: one-line orders on the Overview, collapsed order rows on the phone, and the phone
// Library toolbar. On the made-up farm in mock-farm.ts.
import { test, expect, type Page } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

const open = async (page: Page, width: number, height: number, path: string) => {
  await page.setViewportSize({ width, height });
  await mockFarm(page);
  await page.goto(LIVE + path);
};
// The height of the page's scrolling content (the phone scrolls inside <main>).
const contentHeight = (page: Page) => page.evaluate(() => (document.querySelector('main') as HTMLElement).scrollHeight);

test('C3: the Overview lists orders on one line each, with no checkboxes, and each row opens its order', async ({ page }) => {
  await open(page, 1440, 900, '/overview');
  const region = page.getByRole('region', { name: 'PlayCase orders overview' });
  const rows = region.getByRole('article');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(region.getByRole('checkbox')).toHaveCount(0);
  await expect(region.getByRole('button', { name: /^Print/ })).toHaveCount(0);
  for (const row of await rows.all()) {
    await expect(row.getByRole('link', { name: /#\d+/ }).first()).toHaveAttribute('href', '/orders');
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThan(80);
  }
  await expect(region).toContainText(/\d of \d printed|All printed/);
  // A row opens that order on the Orders page.
  const number = (await rows.first().locator('.order-line-number').textContent())!;
  await rows.first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('article', { name: `Order ${number}`, exact: true })).toBeVisible();
});

test('C3: phone Orders rows start closed, open on tap, and an order opened from elsewhere starts open', async ({ page }) => {
  await open(page, 428, 926, '/orders');
  await page.getByLabel('Filter orders').selectOption('All orders');
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(8);
  expect(await contentHeight(page)).toBeLessThan(1400);
  await expect(page.locator('.orders-list').getByRole('button', { name: /^Print/ })).toHaveCount(0);
  const first = page.getByRole('button', { name: /^Open order/ }).first();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Tapping a row shows its checklist and Print buttons; several can be open at once.
  await first.click();
  const second = page.getByRole('button', { name: /^Open order/ }).first();
  await second.click();
  await expect(page.getByRole('button', { name: /^Close order/ })).toHaveCount(2);
  await expect(page.locator('.orders-list').getByRole('button', { name: /^Print/ }).first()).toBeVisible();
  // Closing puts it away again.
  await page.getByRole('button', { name: /^Close order/ }).first().click();
  await expect(page.getByRole('button', { name: /^Close order/ })).toHaveCount(1);

  // An order opened from the Overview (or Home) is open and in view.
  await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('region', { name: 'Spoolside home' }).locator('.pool-case').first().dispatchEvent('click');
  await expect(page.getByRole('button', { name: /^Close order/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Close order/ })).toBeInViewport();
});

test('C4: the phone Library toolbar is one row, the type chips scroll sideways, and the Filter sheet filters and sorts', async ({ page }) => {
  await open(page, 428, 926, '/library');
  await expect(page.locator('.asset-pill').first()).toBeVisible();
  // One row: search, Filter, add.
  const search = (await page.getByLabel('Search assets').boundingBox())!;
  const filter = (await page.getByRole('button', { name: 'Filter', exact: true }).boundingBox())!;
  const add = (await page.getByRole('button', { name: 'Upload', exact: true }).boundingBox())!;
  expect(Math.abs(filter.y + filter.height / 2 - (search.y + search.height / 2))).toBeLessThan(6);
  expect(add.x).toBeGreaterThan(filter.x);
  expect(filter.height).toBeGreaterThanOrEqual(44);
  expect(add.width).toBeGreaterThanOrEqual(44);
  // The first asset group starts near the top of the page content.
  const top = await page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement;
    const g = document.querySelector('.asset-section, .part-card-section')!;
    return g.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop;
  });
  expect(top).toBeLessThan(430);
  // The chips scroll inside their own row without widening the page.
  const chips = page.getByRole('tablist', { name: 'Asset type' });
  const scroll = await chips.evaluate((el) => ({ scrollable: el.scrollWidth > el.clientWidth, width: el.clientWidth }));
  expect(scroll.scrollable).toBe(true);
  expect(scroll.width).toBeLessThanOrEqual(428);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && (document.querySelector('main') as HTMLElement).scrollWidth <= innerWidth)).toBe(true);
  await expect(chips.getByRole('tab')).toHaveText(['All', 'Cases', 'Faceplates', 'Sleeves', 'Parts', 'Bought parts', 'Phones', 'Cut templates']);
  await chips.getByRole('tab', { name: 'Cut templates' }).click();
  await expect(chips.getByRole('tab', { name: 'Cut templates' })).toHaveAttribute('aria-selected', 'true');
  await chips.getByRole('tab', { name: 'All' }).click();

  // The Filter sheet holds status, sort, view and Categories, and counts what's changed.
  const everything = await page.locator('.asset-pill, .part-card').count();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Filter assets' });
  await expect(sheet.getByLabel('Filter status')).toBeVisible();
  await expect(sheet.getByLabel('Sort assets')).toBeVisible();
  await expect(sheet.getByRole('radio', { name: 'List view' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Categories' })).toBeVisible();
  await sheet.getByLabel('Filter status').selectOption('Stale');
  await sheet.getByLabel('Sort assets').selectOption({ label: 'Name (Z–A)' });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter · 2' })).toBeVisible();
  const filtered = await page.locator('.asset-pill, .part-card').count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(everything);
  await expect(page.locator('.asset-pill.stale, .asset-pill:has(.status-icon.stale), .part-card:has(.status-icon.stale)').first()).toBeAttached();
  // Wide screens keep the full toolbar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: /^Filter/ })).toHaveCount(0);
  await expect(page.getByLabel('Filter status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Categories' })).toBeVisible();
});
