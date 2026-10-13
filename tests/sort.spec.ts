import { test, expect } from '@playwright/test';

const order = (n: number) => ({ id: 'o' + n, number: '#' + n, placed: 'Oct 5, 2026', commercial: 'processing', refundReview: false, items: [{ id: 'i' + n, name: 'PlayCase', variant: 'Phone model: iPhone 16 Pro', quantity: 1, recipe: [], phone: 'iPhone 16 Pro', colorway: 'Red' }], assembled: false, packed: false, shipped: false, tracking: '', note: '' });
const machine = (id: string, name: string, state: string, remaining = '0 min') => ({ id, name, state, rawState: state === 'Printing' ? 'RUNNING' : 'IDLE', job: '', progress: state === 'Printing' ? 50 : 0, remaining, material: '', seen: new Date().toISOString(), stale: false, connected: true });
const plate = (minutes: number, grams: number) => ({ index: 1, minutes, grams, filaments: [], coverage: [] });

test('lists can be sorted, and each list remembers its sort', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const state = { revision: 1, orders: [order(10181), order(10190), order(10185)], jobs: [], spools: [], lastSync: new Date().toISOString(), syncError: null,
    machines: [machine('a', 'Membrane', 'Ready'), machine('b', 'AMS 2', 'Printing', '1h 5m'), machine('c', 'Desk', 'Printing', '12 min')] };
  const library = [
    { id: 'b', name: 'Bravo', size: 1, created: '2026-10-01T00:00:00Z', plates: [plate(30, 50)] },
    { id: 'a', name: 'Alpha', size: 1, created: '2026-09-01T00:00:00Z', plates: [plate(90, 10)] },
    { id: 'c', name: 'Charlie', size: 1, created: '2026-10-10T00:00:00Z', plates: [plate(60, 30)] },
  ];
  const inventory = { colors: ['Black', 'Red'], updated: null, items: [
    { kind: 'case', id: 'c1', name: 'iPhone 13', counts: { Black: 1 } },
    { kind: 'case', id: 'c2', name: 'iPhone 16', counts: { Black: 5, Red: 2 } },
    { kind: 'case', id: 'c3', name: 'Pixel 9', counts: {} },
  ] };
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: state });
    if (url.pathname === '/api/library') return route.fulfill({ json: library });
    if (url.pathname === '/api/inventory' && route.request().method() === 'PUT') {
      const b = route.request().postDataJSON();
      inventory.items = inventory.items.map((i) => (i.id === b.id ? { ...i, counts: { ...i.counts, [b.color]: b.count } } : i));
    }
    if (url.pathname === '/api/inventory') return route.fulfill({ json: inventory });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: false, watches: [], recent: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: ['/api/assets', '/api/categories'].includes(url.pathname) ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.route('https://playcase.gg/**', (route) => route.fulfill({ status: 404, body: '' }));

  // Sliced prints: name by default, then longest print first, kept after a reload.
  await page.goto('https://spoolside.shelbyklein.com/library/sliced');
  const names = page.locator('.sliced-body > strong');
  await expect(names).toHaveText(['Alpha', 'Bravo', 'Charlie']);
  await page.getByLabel('Sort prints').selectOption({ label: 'Longest print' });
  await expect(names).toHaveText(['Alpha', 'Charlie', 'Bravo']);
  await page.getByLabel('Sort prints').selectOption({ label: 'Newest first' });
  await expect(names).toHaveText(['Charlie', 'Bravo', 'Alpha']);
  await page.screenshot({ path: 'handoff/spoolside-sort-sliced.png' });
  await page.reload();
  await expect(page.getByLabel('Sort prints')).toHaveValue('newest');
  await expect(names).toHaveText(['Charlie', 'Bravo', 'Alpha']);

  // Orders: oldest first by default, newest on request.
  await page.goto('https://spoolside.shelbyklein.com/orders');
  const orders = page.locator('.orders-list article[aria-label^="Order #"]');
  await expect(orders).toHaveCount(3);
  await expect(orders.first()).toHaveAttribute('aria-label', 'Order #10181');
  await page.getByLabel('Sort orders').selectOption({ label: 'Newest first' });
  await expect(orders.first()).toHaveAttribute('aria-label', 'Order #10190');
  await expect(orders.last()).toHaveAttribute('aria-label', 'Order #10181');

  // Inventory: most on hand first.
  await page.goto('https://spoolside.shelbyklein.com/inventory');
  const rows = page.locator('.inventory tbody tr:not(.inventory-group) th');
  await expect(rows).toHaveText(['iPhone 13', 'iPhone 16', 'Pixel 9']);
  await page.getByLabel('Sort inventory').selectOption({ label: 'Most on hand' });
  await expect(rows).toHaveText(['iPhone 16', 'iPhone 13', 'Pixel 9']);
  // Typing a count doesn't move rows under your fingers.
  await page.getByLabel('Pixel 9 Black').fill('9');
  await page.getByLabel('Pixel 9 Black').press('Enter');
  await expect(page.locator('.inventory tbody tr', { hasText: 'Pixel 9' }).locator('.inventory-total')).toHaveText('9');
  await expect(rows).toHaveText(['iPhone 16', 'iPhone 13', 'Pixel 9']);
  await page.reload();
  await expect(rows).toHaveText(['Pixel 9', 'iPhone 16', 'iPhone 13']);

  // Printers: by name, or finishing soonest.
  await page.goto('https://spoolside.shelbyklein.com/printers');
  const cards = page.getByRole('region', { name: 'Printers' }).locator('.printer-card strong');
  await page.getByLabel('Sort printers').selectOption({ label: 'Name (A–Z)' });
  await expect(cards).toHaveText(['AMS 2', 'Desk', 'Membrane']);
  await page.getByLabel('Sort printers').selectOption({ label: 'Finishing soonest' });
  await expect(cards).toHaveText(['Desk', 'AMS 2', 'Membrane']);
  await page.locator('.fleet-heading').screenshot({ path: 'handoff/spoolside-sort-printers.png' });

  // Phones: the orders sort is a compact icon beside search and filter, with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://spoolside.shelbyklein.com/orders');
  await expect(page.getByLabel('Sort orders')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.locator('.orders-toolbar').screenshot({ path: 'handoff/spoolside-sort-orders-mobile.png' });
  await page.goto('https://spoolside.shelbyklein.com/library/sliced');
  await expect(page.getByLabel('Sort prints')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.locator('.sliced-filters').screenshot({ path: 'handoff/spoolside-sort-sliced-mobile.png' });
  await page.goto('https://spoolside.shelbyklein.com/library');
  await expect(page.getByLabel('Sort assets')).toBeVisible();
  await page.goto('https://spoolside.shelbyklein.com/inventory');
  await page.locator('.inventory-toolbar').screenshot({ path: 'handoff/spoolside-sort-inventory-mobile.png' });
  await context.close();
});
