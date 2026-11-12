// UI/UX pass, task D2: Supplies folds each printer's spools to a line and shows each filament's two best offers.
// On the made-up farm in mock-farm.ts.
import { test, expect, type Page } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

const open = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  await mockFarm(page);
  await page.goto(LIVE + '/supplies');
  await expect(page.locator('.material-offer').first()).toBeVisible();
  await expect(page.locator('.loaded-summary').first()).toBeVisible();
};
const height = (page: Page) => page.evaluate(() => {
  const main = document.querySelector('main') as HTMLElement;
  return getComputedStyle(main).overflowY === 'auto' && main.scrollHeight > main.clientHeight ? main.scrollHeight : document.documentElement.scrollHeight;
});

test('D2: on a phone the Filament tab is under 3,000 px, printers start folded, and expanding one shows its slots', async ({ page }) => {
  await open(page, 428, 926);
  expect(await height(page)).toBeLessThan(3000);
  const summary = page.locator('.loaded-summary').filter({ hasText: 'Dogwood' });
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect(summary).toContainText(/4 spools/);
  await expect(page.locator('.spool-list')).toHaveCount(0);
  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.loaded-printer').filter({ hasText: 'Dogwood' }).locator('.spool-list li')).toHaveCount(4);
  await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
});

test('D2: on a desktop the printers start open and can be folded', async ({ page }) => {
  await open(page, 1440, 900);
  const summary = page.locator('.loaded-summary').filter({ hasText: 'Dogwood' });
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.loaded-printer').filter({ hasText: 'Dogwood' }).locator('.spool-list li')).toHaveCount(4);
  await summary.click();
  await expect(page.locator('.loaded-printer').filter({ hasText: 'Dogwood' }).locator('.spool-list')).toHaveCount(0);
});

test('D2: a filament shows its two best offers, and Show all reveals the rest', async ({ page }) => {
  await open(page, 428, 926);
  const card = page.locator('.material-card').filter({ hasText: 'Bambu TPU for AMS' }).first();
  await expect(card.locator('.material-offer')).toHaveCount(2);
  await card.getByRole('button', { name: 'Show all 3 offers' }).click();
  await expect(card.locator('.material-offer')).toHaveCount(3);
  await card.getByRole('button', { name: 'Show fewer' }).click();
  await expect(card.locator('.material-offer')).toHaveCount(2);
  // A filament with two offers or fewer has nothing to expand.
  await expect(page.locator('.material-card').filter({ hasText: 'Recreus Conductive' }).getByRole('button', { name: /Show all/ })).toHaveCount(0);
});

test('D2: no text on Supplies is under 12 px', async ({ page }) => {
  for (const [w, h] of [[428, 926], [1440, 900]]) {
    await open(page, w, h);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.checkVisibility() && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.className || el.tagName));
    expect(tiny).toEqual([]);
  }
});
