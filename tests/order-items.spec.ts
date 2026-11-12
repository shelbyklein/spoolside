import { test, expect } from '@playwright/test';
import { mockFarm, LIVE } from './mock-farm';

// Every line item on an order is visible: no "+1 more". Order #5107 has a 2× PlayCase and a replacement-parts line.
for (const [w, h, phone] of [[1440, 900, false], [428, 926, true]] as const) {
  test(`every item on an order is shown at ${w}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await mockFarm(page);
    await page.goto(LIVE + '/orders');
    if (phone) await page.getByRole('button', { name: 'Open order #5107' }).click();
    const row = page.locator('.order-contents').filter({ hasText: 'Replacement Parts - Classic' });
    await expect(row).toContainText('iPhone 16 Pro Max · Teal');
    await expect(row).toContainText('×2');
    await expect(row).not.toContainText('more');
    await expect(row).not.toContainText('No variant details');
    await expect(page.getByText(/^\+\d+ more$/)).toHaveCount(0);
    // The one-line summaries (phone Orders headers, the Overview) name every item too.
    if (phone) await expect(page.getByRole('button', { name: 'Close order #5107' })).toContainText('iPhone 16 Pro Max · Teal ×2 + Replacement Parts - Classic');
    else {
      await page.goto(LIVE + '/overview');
      await expect(page.getByRole('region', { name: 'PlayCase orders overview' })).toContainText('iPhone 16 Pro Max · Teal ×2 + Replacement Parts - Classic');
    }
    await context.close();
  });
}
