import { test, expect } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

// B1: on the phone home the Upload menu is a sheet above the printer pills, with readable items.
test('phone home Upload menu opens above the pills with readable items', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, serviceWorkers: 'block' }), page = await context.newPage();
  await mockFarm(page);
  await page.goto(LIVE + '/');
  await expect(page.locator('.home-pill').first()).toBeVisible();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload' });
  await expect(sheet).toBeVisible();
  for (const name of ['Sliced print (.3mf)', 'Upload asset']) {
    const item = sheet.getByRole('button', { name, exact: true });
    await expect(item).toBeVisible();
    const r = await item.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      // Contrast of the item's text against the first opaque background behind it.
      const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      let bg = [255, 255, 255];
      for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.9) { bg = c; break; } }
      const fg = parse(getComputedStyle(el).color);
      const [a, b] = [lum(fg), lum(bg)];
      return { hitOk: !!hit && (el === hit || el.contains(hit)), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), height: box.height };
    });
    expect(r.hitOk, `${name} is what you tap`).toBe(true);
    expect(r.contrast, `${name} contrast`).toBeGreaterThanOrEqual(4.5);
    expect(r.height).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: 'Upload asset', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Upload library item' })).toBeVisible();
  await context.close();
});

test('desktop Upload dropdown closes on outside click and Escape', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage();
  await mockFarm(page);
  await page.goto(LIVE + '/overview');
  const item = page.getByRole('button', { name: 'Upload asset', exact: true });
  await page.locator('summary', { hasText: 'Upload' }).click();
  await expect(item).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();
  await page.locator('summary', { hasText: 'Upload' }).click();
  await expect(item).toBeVisible();
  await page.locator('h1').click();
  await expect(item).toBeHidden();
  await context.close();
});
