// UI/UX pass, task D1: Library › Sliced prints in folding sections. On the made-up farm in mock-farm.ts.
import { test, expect, type Page } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

const open = async (page: Page, width: number, height: number, overrides: Parameters<typeof mockFarm>[1] = {}, path = '/library/sliced') => {
  await page.setViewportSize({ width, height });
  await mockFarm(page, overrides);
  await page.goto(LIVE + path);
  if (path === '/library/sliced') await expect(page.locator('.sliced-card').first()).toBeVisible();
};
// The height of whatever scrolls: <main> on a phone, the document elsewhere (as the audit measures).
const pageHeight = (page: Page) => page.evaluate(() => {
  const main = document.querySelector('main') as HTMLElement;
  return getComputedStyle(main).overflowY === 'auto' && main.scrollHeight > main.clientHeight ? main.scrollHeight : document.documentElement.scrollHeight;
});
const head = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) });

// 55 prints: the farm's eleven PlayCase prints, then copies of them.
const manyPrints = { '/api/library': ({ farm, url }: any) => {
  const base = farm.library.filter((x: any) => x.scope === 'playcase');
  const copies = Array.from({ length: 55 - base.length }, (_, i) => ({ ...base[i % base.length], id: `f-copy-${i}`, name: `${base[i % base.length].name} copy ${i + 1}` }));
  return [...base, ...copies].filter((x: any) => !url.searchParams.get('scope') || x.scope === url.searchParams.get('scope'));
} };

test('D1: prints are grouped by part type, each print once, with a count on every header', async ({ page }) => {
  await open(page, 1440, 900);
  for (const [name, count] of [['Cases', 4], ['Faceplates', 4], ['Sleeves', 1], ['Parts', 2], ['Not linked', 1]] as const) {
    const button = head(page, name);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button.locator('small')).toHaveText(String(count));
  }
  await expect(page.locator('.sliced-card')).toHaveCount(12);
});

test('D1: folding a section hides its cards and is remembered across a reload; a search opens it without changing that', async ({ page }) => {
  await open(page, 1440, 900);
  const cases = head(page, 'Cases');
  await cases.click();
  await expect(cases).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sliced-card')).toHaveCount(8);
  expect(await page.evaluate(() => localStorage.getItem('spoolside-sliced-sections'))).toBe('["Case"]');
  await page.reload();
  await expect(head(page, 'Cases')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sliced-card')).toHaveCount(8);
  // A search shows matches inside folded sections, hides sections with none, and leaves the remembered folds alone.
  await page.getByRole('searchbox', { name: 'Search sliced prints' }).fill('iPhone 15');
  await expect(head(page, 'Cases')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.sliced-card')).toHaveCount(2);
  await expect(head(page, 'Faceplates')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('spoolside-sliced-sections'))).toBe('["Case"]');
  await page.getByRole('searchbox', { name: 'Search sliced prints' }).fill('');
  await expect(head(page, 'Cases')).toHaveAttribute('aria-expanded', 'false');
});

test('D1: at 820 px the page is under 6,000 px open, and under it with 55 prints and one section open; three or more columns', async ({ page }) => {
  await open(page, 820, 1180);
  expect(await pageHeight(page)).toBeLessThan(6000);
  const columns = await page.locator('.sliced-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBeGreaterThanOrEqual(3);

  const big = await page.context().newPage();
  await open(big, 820, 1180, manyPrints);
  await expect(big.locator('.sliced-card')).toHaveCount(55 + 0);
  // Collapse all but one section.
  for (const name of ['Faceplates', 'Sleeves', 'Parts', 'Not linked']) await head(big, name).click();
  await expect(head(big, 'Cases')).toHaveAttribute('aria-expanded', 'true');
  expect(await pageHeight(big)).toBeLessThan(6000);
});

test('D1: Print buttons in a row share one top edge, whatever the names and metadata', async ({ page }) => {
  for (const [width, height] of [[1440, 900], [820, 1180], [428, 926]]) {
    await open(page, width, height);
    const tops = await page.locator('.sliced-grid').evaluateAll((grids) => grids.map((g) => [...g.querySelectorAll('.sliced-card')].map((c) => {
      const card = c.getBoundingClientRect(), print = c.querySelector('.sliced-print')!.getBoundingClientRect(), link = c.querySelector('.sliced-link')?.getBoundingClientRect();
      return { row: Math.round(card.top), print: print.top, link: link?.top ?? print.top };
    })));
    for (const cards of tops) {
      const rows = new Map<number, { print: number[]; link: number[] }>();
      for (const c of cards) { const r = rows.get(c.row) || { print: [], link: [] }; r.print.push(c.print); r.link.push(c.link); rows.set(c.row, r); }
      for (const r of rows.values()) for (const values of [r.print, r.link]) expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  }
});

test('D1: at 428 px there are two columns, and Link asset is a labelled button that opens the asset editor', async ({ page }) => {
  await open(page, 428, 926);
  const columns = await page.locator('.sliced-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBeGreaterThanOrEqual(2);
  const link = page.locator('.sliced-card').first().getByRole('button', { name: 'Link asset' });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('D1: a personal project keeps a flat grid of plates, with the Print buttons pinned to the bottom', async ({ page }) => {
  await open(page, 1440, 900, {}, '/personal');
  await page.getByRole('button', { name: /Desk cable clips/ }).click();
  await expect(page.getByRole('heading', { name: 'Printable plates' })).toBeVisible();
  await expect(page.locator('.sliced-card')).toHaveCount(1);
  await expect(page.locator('.sliced-section')).toHaveCount(0);
  await expect(page.locator('.sliced-card .sliced-actions .sliced-print')).toBeVisible();
});
