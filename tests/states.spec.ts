import { test, expect, type Browser, type Page } from '@playwright/test';
import { mockFarm, reply, LIVE, type Overrides } from './mock-farm';

const EMPTY_TEXTS = ['No orders found', 'No order prints waiting', 'No printers are connected yet', 'No printers in this state', 'Waiting for store sync', 'No open orders'];
const ZEROS = /0 of 0 orders|0 pieces · 0 orders/;

async function open(browser: Browser, width: number, path: string, overrides: Overrides = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 900 : 926 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const { farm } = await mockFarm(page, overrides);
  await page.goto(LIVE + path);
  return { context, page, farm };
}
const noEmptyMessages = async (page: Page) => {
  for (const t of EMPTY_TEXTS) await expect(page.getByText(t, { exact: false })).toHaveCount(0);
  await expect(page.getByText(ZEROS)).toHaveCount(0);
};

test('a delayed load shows placeholders, never empty messages or zero counts, then real data', async ({ browser }) => {
  for (const path of ['/orders', '/overview', '/printers']) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { context, page, farm } = await open(browser, 1440, path, { 'GET /api/workspace': async () => { await gate; return undefined; } });
    await expect(page.locator('[data-skeleton]').first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toHaveCount(1);
    await noEmptyMessages(page);
    // No count in the Queue tab badge while loading.
    await expect(page.locator('.nav-item', { hasText: 'Queue' }).locator('small')).toHaveCount(0);
    await page.waitForTimeout(300);
    await noEmptyMessages(page);
    release();
    await expect(page.locator('[data-skeleton]')).toHaveCount(0);
    if (path !== '/printers') await expect(page.getByText(farm.workspace.orders[0].number).first()).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Alder, Printing' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await context.close();
  }
});

test('the phone home shows a dash, not a zero, while loading', async ({ browser }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { context, page } = await open(browser, 428, '/', { 'GET /api/workspace': async () => { await gate; return undefined; } });
  await expect(page.getByRole('button', { name: 'Orders, loading' })).toBeVisible();
  await expect(page.getByText('No printers are connected yet')).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: /^Orders, \d+ open/ })).toBeVisible();
  await context.close();
});

test('a failed refresh after a good load keeps the data under a banner, and Retry brings it back', async ({ browser }) => {
  let failing = false;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage();
  await page.clock.install();
  const { farm } = await mockFarm(page, { 'GET /api/workspace': () => (failing ? reply({ status: 500, json: { error: 'down' } }) : undefined) });
  await page.goto(LIVE + '/orders');
  const number = farm.workspace.orders[0].number;
  await expect(page.getByText(number).first()).toBeVisible();
  const count = await page.locator('.orders-toolbar > span').textContent();
  const banner = page.getByRole('alert').filter({ hasText: "Can't reach Spoolside." });
  await expect(banner).toHaveCount(0);
  // The next poll fails: the clock jumps past the 10 s interval instead of waiting for it.
  failing = true;
  await page.clock.fastForward(11000);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Showing what loaded at \d{1,2}:\d{2}/);
  await expect(page.getByText(number).first()).toBeVisible();
  await expect(page.locator('.orders-toolbar > span')).toHaveText(count!);
  await expect(page.getByText('No orders found')).toHaveCount(0);
  // Dimmed, and nothing in it answers a click.
  await expect(page.locator('.main-content.stale')).toHaveCount(1);
  failing = false;
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.main-content.stale')).toHaveCount(0);
  await expect(page.getByText(number).first()).toBeVisible();
  await context.close();
});

test('a failed first load shows the banner and nothing that looks live', async ({ browser }) => {
  for (const [width, path] of [[1440, '/overview'], [1440, '/orders'], [428, '/']] as const) {
    let failing = true;
    const { context, page } = await open(browser, width, path, { 'GET /api/workspace': () => (failing ? reply({ status: 500, json: { error: 'down' } }) : undefined) });
    const banner = page.getByRole('alert').filter({ hasText: "Can't reach Spoolside." });
    await expect(banner).toBeVisible();
    await expect(banner).not.toContainText('Showing what loaded');
    await noEmptyMessages(page);
    await expect(page.getByText('0 pieces')).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Auto-print next in queue' })).toHaveCount(0);
    failing = false;
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toHaveCount(0);
    await context.close();
  }
});

test('with no printers at all, Printers and the phone home say so', async ({ browser }) => {
  const none: Overrides = { 'GET /api/workspace': ({ farm }) => ({ ...farm.workspace, machines: [] }) };
  const a = await open(browser, 1440, '/printers', none);
  await expect(a.page.getByText('No printers are connected yet.')).toBeVisible();
  await expect(a.page.getByText('No printers in this state.')).toHaveCount(0);
  const text = a.page.locator('.printer-cards .empty p'), card = a.page.locator('.printer-cards');
  const [t, c] = await Promise.all([text.boundingBox(), card.boundingBox()]);
  expect(Math.abs(t!.x + t!.width / 2 - (c!.x + c!.width / 2))).toBeLessThan(4);
  await a.context.close();
  const b = await open(browser, 428, '/', none);
  await expect(b.page.locator('.home-empty')).toHaveText('No printers are connected yet.');
  await b.context.close();
  const c2 = await open(browser, 1440, '/overview', none);
  await expect(c2.page.getByText('No printers are connected yet.')).toBeVisible();
  await c2.context.close();
});

test('a filter that matches no printer keeps its own message', async ({ browser }) => {
  const { context, page } = await open(browser, 1440, '/printers');
  await page.getByLabel('Filter printers').selectOption('Offline');
  await expect(page.getByText('No printers in this state.')).toBeVisible();
  await context.close();
});
