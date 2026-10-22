import { test, expect } from '@playwright/test';

test('reminder notes sit above the orders on the home page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const order = { id: 'wc-10199', number: '#10199', placed: 'Oct 19, 2026', commercial: 'processing', refundReview: false, items: [{ id: 'i1', name: 'PlayCase', variant: '', quantity: 1, recipe: [], phone: 'iPhone 13 Pro Max', colorway: 'Red' }], assembled: false, packed: false, shipped: false, tracking: '', note: '' };
  let notes: any[] = [], n = 0;
  const sent: any[] = [];
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url()), m = route.request().method();
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [order], printQueue: [], jobs: [], spools: [], machines: [], lastSync: new Date().toISOString(), syncError: null } });
    if (url.pathname.startsWith('/api/notes')) {
      const body = m === 'GET' || m === 'DELETE' ? null : route.request().postDataJSON();
      sent.push([m, url.pathname, body]);
      const id = url.pathname.split('/')[3];
      if (m === 'POST') notes.push({ id: 'n' + ++n, text: body.text, order: body.order ? '#' + body.order : null, created: Date.now(), updated: Date.now() });
      if (m === 'PATCH') notes = notes.map((x) => (x.id === id ? { ...x, text: body.text, order: body.order ? '#' + body.order : null } : x));
      if (m === 'DELETE') notes = notes.filter((x) => x.id !== id);
      return route.fulfill({ json: notes });
    }
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [], recent: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: ['/api/library', '/api/repeats'].includes(url.pathname) ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.route('https://playcase.gg/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('https://spoolside.shelbyklein.com/overview');
  const reminders = page.getByRole('region', { name: 'Reminders' });
  // At the top of the first column, above the queue and orders.
  await expect(reminders.getByRole('button', { name: 'Add note' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'PlayCase orders overview' })).toBeVisible();
  const above = await page.evaluate(() => {
    const r = document.querySelector('[aria-label="Reminders"]')!, o = document.querySelector('[aria-label="PlayCase orders overview"]')!;
    return r.getBoundingClientRect().bottom <= o.getBoundingClientRect().top;
  });
  expect(above).toBe(true);
  await reminders.getByRole('button', { name: 'Add note' }).click();
  await reminders.getByLabel('Note', { exact: true }).fill('Send a replacement d-pad membrane');
  await reminders.getByLabel('Order number (optional)').fill('#10199');
  await reminders.getByRole('button', { name: 'Add note' }).click();
  expect(sent.at(-1)).toEqual(['POST', '/api/notes', { text: 'Send a replacement d-pad membrane', order: '10199' }]);
  const card = reminders.getByRole('article', { name: 'Note: Send a replacement d-pad membrane' });
  await expect(card).toContainText('#10199');
  await reminders.getByRole('button', { name: 'Add note' }).click();
  await reminders.getByLabel('Note', { exact: true }).fill('Refund shipping for the late order');
  await reminders.getByRole('button', { name: 'Add note' }).click();
  await expect(reminders.getByRole('article')).toHaveCount(2);
  await page.screenshot({ path: 'handoff/spoolside-reminders-desktop.png', clip: { x: 240, y: 0, width: 1200, height: 560 } });
  // Edit, then finish.
  await card.getByRole('button', { name: 'Edit note' }).click();
  await reminders.getByLabel('Note', { exact: true }).fill('Send replacement d-pad and A/B membranes');
  await reminders.getByRole('button', { name: 'Save' }).click();
  const edited = reminders.getByRole('article', { name: 'Note: Send replacement d-pad and A/B membranes' });
  await expect(edited).toContainText('#10199');
  await edited.getByRole('button', { name: '#10199' }).click();
  await expect(page).toHaveURL(/\/orders/);
  await page.goto('https://spoolside.shelbyklein.com/overview');
  await reminders.getByRole('article', { name: /Refund shipping/ }).getByRole('button', { name: 'Done' }).click();
  await expect(reminders.getByRole('article')).toHaveCount(1);
  // On a phone, the reminders are on the water home too.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://spoolside.shelbyklein.com/');
  const home = page.getByRole('region', { name: 'Spoolside home' });
  await expect(home.getByRole('region', { name: 'Reminders' }).getByRole('article')).toHaveCount(1);
  await page.screenshot({ path: 'handoff/spoolside-reminders-mobile.png' });
  await context.close();
});
