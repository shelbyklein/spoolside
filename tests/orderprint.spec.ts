import { test, expect } from '@playwright/test';

test('order rows print their case and faceplates on the best-matching printer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const now = new Date().toISOString();
  const tray = (slot: number, color: string) => ({ slot, type: 'TPU-AMS', color, name: 'TPU for AMS', remain: 100, grams: 1000, materialId: 'bambu-tpu-ams' });
  const machines = [
    { id: 'busy', name: 'AMS 1', state: 'Printing', rawState: 'RUNNING', job: 'x', progress: 10, remaining: '9 min', material: '', seen: now, stale: false, connected: true, hasAms: true, trays: [tray(0, '#E3201B')] },
    { id: 'pla', name: 'AMS 2', state: 'Ready', rawState: 'IDLE', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: true, trays: [{ ...tray(0, '#E00000'), type: 'PLA', name: 'PLA Basic' }] },
    { id: 'red', name: 'AMS 3', state: 'Ready', rawState: 'FINISH', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: true, trays: [tray(0, '#90FF1A'), tray(1, '#ED0000')] },
  ];
  const piece = (assetId: string, name: string, done = 0) => ({ assetId, name, needed: 1, done, plates: [{ fileId: 'f-' + assetId, fileName: name, plate: 1 }] });
  const plan = [
    { key: '0:case', label: 'case', done: false, pieces: [piece('case', 'iPhone 12 Case')], next: { assetId: 'case', name: 'iPhone 12 Case', fileId: 'f-case', fileName: 'iPhone 12 Case', plate: 1 } },
    { key: '0:ds', label: 'DS faceplate', done: false, pieces: [piece('top', 'DS – Top'), piece('bottom', 'DS – Bottom')], next: { assetId: 'top', name: 'DS – Top', fileId: 'f-top', fileName: 'DS – Top', plate: 1 } },
    { key: '0:classic', label: 'Classic faceplate', done: true, pieces: [piece('ct', 'Classic – Top', 1)], next: null },
  ];
  const order = { id: 'o1', number: '#10181', placed: 'Oct 7, 2026', commercial: 'processing', refundReview: false, items: [{ id: 'i1', name: 'PlayCase', variant: '', quantity: 1, recipe: [], phone: 'iPhone 12', colorway: 'Red', parts: [] }], assembled: false, packed: false, shipped: false, tracking: '', note: '', printPlan: plan };
  const state = { revision: 1, orders: [order], jobs: [], spools: [], machines, lastSync: now, syncError: null };
  const posts: any[] = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: state });
    if (url.pathname === '/api/library') return route.fulfill({ json: [{ id: 'f-case', name: 'iPhone 12 Case', size: 1, created: now, plates: [{ index: 1, minutes: 80, grams: 33, filaments: [{ id: 1, type: 'TPU-AMS', color: '#ED0000' }] }] }] });
    if (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: pixel });
    if (url.pathname.startsWith('/api/orders/')) { posts.push([url.pathname, route.request().postDataJSON()]); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: false, watches: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/orders');
  const row = page.getByRole('article', { name: 'Order #10181' });
  await expect(row.getByRole('button', { name: 'Print case' })).toBeVisible();
  await expect(row.getByRole('button', { name: /Print DS faceplate/ })).toContainText('0/2');
  await expect(row.getByRole('button', { name: 'Classic faceplate printed' })).toBeVisible();
  await row.getByRole('button', { name: 'Print case' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print case for #10181' });
  await expect(dialog).toContainText('iPhone 12 Case');
  // AMS 2's red is PLA; the plate is TPU, so AMS 3's red TPU wins.
  await expect(dialog.getByLabel('Printer')).toHaveValue('red');
  await expect(dialog.getByLabel('Printer').locator('option[value="pla"]')).toContainText('no TPU loaded');
  await expect(dialog.getByLabel('AMS slot for filament 1')).toHaveValue('1');
  const start = dialog.getByRole('button', { name: 'Start print on AMS 3' });
  await expect(start).toBeDisabled();
  await dialog.getByLabel('Build plate is clear').check();
  await start.click();
  await expect(dialog).toHaveCount(0);
  expect(posts[0]).toEqual(['/api/orders/o1/print', { group: '0:case', printer: 'red', plate: 'f-case:1', useAms: true, amsMapping: [1], bedLevelling: true, bedClear: true }]);
  await row.getByRole('button', { name: 'Classic faceplate printed' }).click();
  expect(posts[1]).toEqual(['/api/orders/o1/pieces', { assetId: 'ct', done: 0 }]);
  await context.close();
});
