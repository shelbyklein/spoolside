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
  const state = { revision: 1, orders: [order], printQueue: [{ orderId: order.id, group: plan[0], blocked: null, missing: [] }, { orderId: order.id, group: plan[1], blocked: "Printing / awaiting result", missing: [] }], jobs: [], spools: [], machines, lastSync: now, syncError: null };
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
  await expect(row.getByLabel('Printed & assembled, ready to pack')).toHaveCount(0);
  await expect(row.getByRole('button', { name: /print all required items first/ })).toBeDisabled();
  await expect(row.getByRole('button', { name: /Print DS faceplate/ })).toHaveText('Print');
  await expect(row.getByRole('checkbox', { name: 'Classic faceplate printed' })).toBeChecked();
  await expect(row.locator('.production-stage')).toHaveCount(0);
  await row.screenshot({path:'handoff/spoolside-order-checklist.png'});
  await page.getByRole('navigation').getByRole('button', { name: /^Queue/ }).click();
  const queue = page.getByRole('region', { name: 'Order print queue' });
  await expect(queue).toContainText('Printing / awaiting result');
  await expect(page.getByRole('button', { name: 'Add job' })).toHaveCount(0);
  await page.screenshot({ path: 'handoff/spoolside-order-queue-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 428, height: 926 });
  await page.screenshot({ path: 'handoff/spoolside-order-queue-mobile.png', fullPage: true });
  await queue.getByRole('button', { name: 'Print case', exact: true }).click();
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
  await page.getByRole('navigation').getByRole('button', { name: 'Orders', exact: true }).click();
  await row.getByRole('checkbox', { name: 'Classic faceplate printed' }).click();
  await expect.poll(() => posts[1]).toEqual(['/api/orders/o1/pieces', { assetId: 'ct', done: 0 }]);
  plan.forEach(g => { g.done = true; g.next = null; g.pieces.forEach(p => p.done = p.needed); });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ship #10181 in Pirate Ship' })).toBeVisible();
  await expect(row.getByRole('checkbox', { name: 'Case printed' })).toBeChecked();
  const column = await row.locator('.order-fulfillment').boundingBox();
  const ship = await row.getByRole('link', { name: 'Ship #10181 in Pirate Ship' }).boundingBox();
  expect(Math.abs(column!.width - ship!.width)).toBeLessThan(2);
  await row.screenshot({path:'handoff/spoolside-order-checklist-mobile.png'});
  await page.unrouteAll({ behavior: "wait" });
  await context.close();
});

test('a free printer offers the next order piece; Not now and the automatic printing toggle', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const now = new Date().toISOString();
  const tray = (slot: number, color: string) => ({ slot, type: 'TPU-AMS', color, name: 'TPU for AMS', remain: 100, grams: 1000, materialId: 'bambu-tpu-ams' });
  const machines = [
    { id: 'best', name: 'AMS 2', state: 'Ready', rawState: 'IDLE', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: true, trays: [tray(0, '#ED0000')] },
    { id: 'red', name: 'AMS 3', state: 'Ready', rawState: 'FINISH', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: true, trays: [tray(0, '#5898DD'), tray(1, '#E00000')] },
  ];
  const plan = [{ key: '0:case', label: 'case', done: false, pieces: [{ assetId: 'case', name: 'iPhone 12 Case', needed: 1, done: 0, plates: [] }], next: { assetId: 'case', name: 'iPhone 12 Case', fileId: 'f-case', fileName: 'iPhone 12 Case', plate: 1 } }];
  const order = { id: 'o1', number: '#10181', placed: 'Oct 7, 2026', commercial: 'processing', refundReview: false, items: [{ id: 'i1', name: 'PlayCase', variant: '', quantity: 1, recipe: [], phone: 'iPhone 12', colorway: 'Red', parts: [] }], assembled: false, packed: false, shipped: false, tracking: '', note: '', printPlan: plan };
  const state = { revision: 1, orders: [order], jobs: [], spools: [], machines, lastSync: now, syncError: null };
  let dispatch: any = { auto: false, vision: true, held: [{ printer: 'best', printerName: 'AMS 2', reason: 'A grey case is still on the plate.' }], offers: [{ id: 'red:o1:0:case:f-case:1', printer: 'red', printerName: 'AMS 3', orderId: 'o1', orderNumber: '#10181', group: '0:case', groupLabel: 'case', pieceName: 'iPhone 12 Case', colorway: 'Red', slot: 1, autoBlocked: null }] };
  const posts: any[] = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: state });
    if (url.pathname === '/api/dispatch') return route.fulfill({ json: dispatch });
    if (url.pathname.startsWith('/api/dispatch/')) {
      posts.push([url.pathname, route.request().postDataJSON()]);
      dispatch = url.pathname.endsWith('dismiss') ? { ...dispatch, offers: [] } : { ...dispatch, auto: route.request().postDataJSON().on };
      return route.fulfill({ json: dispatch });
    }
    if (url.pathname === '/api/library') return route.fulfill({ json: [{ id: 'f-case', name: 'iPhone 12 Case', size: 1, created: now, plates: [{ index: 1, minutes: 80, grams: 33, filaments: [{ id: 1, type: 'TPU-AMS', color: '#ED0000' }] }] }] });
    if (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: pixel });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/overview');
  const card = page.getByRole('article', { name: 'AMS 3 is free' });
  await expect(card).toContainText('Print the iPhone 12 Case for #10181 · Red, slot 2');
  await expect(page.getByText('could print the next order, but the camera says: A grey case is still on the plate')).toBeVisible();
  await page.setViewportSize({width:428,height:926});
  const home=page.getByRole('region',{name:'Spoolside home'});
  await expect(home.getByText(/could print the next order/)).toHaveCount(0);
  const blockedPill=home.getByRole('button',{name:/AMS 2, .*bed needs clearing/});
  await expect(blockedPill).toBeVisible();
  await expect(blockedPill.locator('.home-dot')).toHaveCSS('background-color','rgb(255, 90, 79)');
  await home.screenshot({path:'handoff/spoolside-bed-clear-dot-mobile.png'});
  await blockedPill.click();
  await expect(page.getByRole('dialog',{name:'AMS 2 details'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  await card.getByRole('button', { name: 'Print…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print case for #10181' });
  await expect(dialog.getByLabel('Printer')).toHaveValue('red', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  expect(posts[0][0]).toBe('/api/dispatch/red/dismiss');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Start the next order piece on a free printer without asking').check();
  await expect(page.getByLabel('Start the next order piece on a free printer without asking')).toBeChecked();
  expect(posts[1]).toEqual(['/api/dispatch/auto', { on: true }]);
  await page.unrouteAll({ behavior: "wait" });
  await context.close();
});
