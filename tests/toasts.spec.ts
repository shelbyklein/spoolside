// Toasts and the in-app confirm (src/Toast.tsx, src/Confirm.tsx): a failure looks like one and stays until it's
// dismissed, a success clears itself, toasts sit above the phone tab bar, and Stop print asks first in the app's own
// dialog, from inside printer details.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mockFarm, reply, LIVE, type Overrides } from './mock-farm';

async function open(browser: Browser, width: number, height: number, overrides: Overrides = {}) {
  const phone = width <= 760;
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  // Nothing should reach the browser's own dialogs any more.
  const browserDialogs: string[] = [];
  page.on('dialog', (d) => { browserDialogs.push(d.message()); d.dismiss(); });
  const mock = await mockFarm(page, overrides);
  return { context, page, browserDialogs, ...mock };
}

// Alder is printing; its details have Pause and Stop (and a repeat card with its own Stop, so go by the controls).
async function stopButton(page: Page) {
  await page.goto(LIVE + '/printers');
  await page.getByRole('button', { name: /^Alder, / }).first().click();
  const details = page.getByRole('dialog', { name: 'Alder details' });
  const stop = details.locator('.print-controls').getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  return { details, stop };
}
const stops = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/printers/mock-alder/stop').length;

test('Stop print asks in the app: Cancel sends nothing, confirming stops it, and the success toast clears itself', async ({ browser }) => {
  const { context, page, calls, browserDialogs } = await open(browser, 1440, 900);
  const { details, stop } = await stopButton(page);

  await stop.click();
  const confirm = page.getByRole('dialog', { name: 'Stop the print on Alder?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("This can't be undone.");
  // Cancel is the safe default; the action is named and red.
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(confirm.getByRole('button', { name: 'Stop print' })).toHaveClass(/danger/);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(details).toBeVisible();
  await expect(stop).toBeFocused();
  await page.waitForTimeout(300);
  expect(stops(calls)).toBe(0);

  // Escape is a Cancel too, and closes only the confirm.
  await stop.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(details).toBeVisible();
  expect(stops(calls)).toBe(0);

  await stop.click();
  await confirm.getByRole('button', { name: 'Stop print' }).click();
  await expect.poll(() => stops(calls)).toBe(1);
  const toast = page.getByRole('status').filter({ hasText: 'Alder: print stopped.' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveClass(/toast-success/);
  await expect(toast).toHaveCount(0, { timeout: 7000 });
  expect(browserDialogs).toEqual([]);
  await context.close();
});

test('a failure shows an alert toast that stays until dismissed, with Retry', async ({ browser }) => {
  const { context, page, calls } = await open(browser, 1440, 900, {
    'POST /api/printers/:id/stop': () => reply({ status: 500, json: { error: "Alder didn't answer. Check it's on the network." } }),
  });
  const { stop } = await stopButton(page);
  await stop.click();
  await page.getByRole('dialog', { name: 'Stop the print on Alder?' }).getByRole('button', { name: 'Stop print' }).click();

  const toast = page.getByRole('alert').filter({ hasText: "Alder didn't answer." });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveClass(/toast-error/);
  // The alert colours from the tokens, not the success navy.
  const colours = await toast.evaluate((el) => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--alert-bg)';
    probe.style.color = 'var(--alert-text)';
    document.body.append(probe);
    const want = { bg: getComputedStyle(probe).backgroundColor, text: getComputedStyle(probe).color };
    probe.remove();
    return { want, bg: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color };
  });
  expect(colours.bg).toBe(colours.want.bg);
  expect(colours.text).toBe(colours.want.text);
  await expect(toast.getByRole('button', { name: 'Retry' })).toBeVisible();

  // Still there well after a success would have gone.
  await page.waitForTimeout(6000);
  await expect(toast).toBeVisible();

  // Retry asks again (it's a stop), and the same failure replaces the toast rather than adding a second.
  await toast.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('dialog', { name: 'Stop the print on Alder?' }).getByRole('button', { name: 'Stop print' }).click();
  await expect.poll(() => stops(calls)).toBe(2);
  await expect(page.getByRole('alert').filter({ hasText: "Alder didn't answer." })).toHaveCount(1);

  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
  await context.close();
});

test('on a phone, toasts sit above the tab bar', async ({ browser }) => {
  const { context, page } = await open(browser, 428, 926, {
    'DELETE /api/dispatch/:printer/bed-warning': () => reply({ status: 409, json: { error: "That warning changed. Refresh and try again." } }),
  });
  await page.goto(LIVE + '/printers');
  await page.getByRole('article', { name: "Check Alder's bed" }).getByRole('button', { name: 'It was clear' }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'That warning changed.' });
  await expect(toast).toBeVisible();
  const tabBar = await page.locator('aside.sidebar').boundingBox();
  const box = await toast.boundingBox();
  expect(tabBar && box).toBeTruthy();
  expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(428);
  // What's at the toast's centre is the toast, not the page or the tab bar.
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.toast'), { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(hit).toBe(true);

  // With a sheet open over the page, toasts move to the top, clear of the sheet's text and actions.
  await page.getByRole('article', { name: "Check Alder's bed" }).getByRole('button', { name: 'Stop print' }).click();
  const confirm = page.getByRole('dialog', { name: 'Stop the print on Alder?' });
  await expect(confirm).toBeVisible();
  const over = (await toast.boundingBox())!;
  for (const part of [confirm.locator('.dialog-foot'), confirm.getByText("This can't be undone.")]) {
    const b = (await part.boundingBox())!;
    expect(over.y + over.height <= b.y || over.y >= b.y + b.height, 'the toast covers the confirm').toBe(true);
  }
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await context.close();
});
