import { test, expect } from '@playwright/test';

const ASM = '33333333-3333-4333-8333-333333333333';
const base = { status: 'Up to date', designFile: null, generation: 3, note: '', dims: [1, 2, 3], triangles: 1, bytes: 134, updated: '', fit: { style: '', phone: '', size: '', piece: '' } };
const top = { ...base, id: '22222222-2222-4222-8222-222222222222', name: 'Handheld – Top', type: 'Faceplate', source: 't.stl' };
const magnet = { ...base, id: '44444444-4444-4444-8444-444444444444', name: 'Magnet', type: 'Purchased', supplyId: 'supply-mag', hasStl: false, triangles: 0, dims: [] };
const assembly = { id: ASM, name: 'Handheld', type: 'Faceplate', sku: '', components: [{ assetId: top.id, quantity: 1 }, { assetId: magnet.id, quantity: 12 }] };
const cost = { total: 1.02, complete: false, estimated: false, missing: ['Touch Pin: no sliced print linked'], parts: [
  { assetId: top.id, name: 'Handheld – Top', quantity: 1, kind: 'printed', unitCost: 0.48, cost: 0.48, grams: 20, uses: [{ supply: 'Bambu TPU for AMS', grams: 20, perGram: 0.024 }], estimated: false, print: 'Handheld' },
  { assetId: magnet.id, name: 'Magnet', quantity: 12, kind: 'bought', unitCost: 0.045, cost: 0.54, supply: 'Magnets, 3 × 2 mm', delivered: false },
  { assetId: 'pin', name: 'Touch Pin', quantity: 8, kind: 'printed', cost: null, missing: 'Touch Pin: no sliced print linked' },
] };

test('assembly cost panel lists parts, bought parts and what is missing; cards show the total', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/assets') return route.fulfill({ json: [top, magnet] });
    if (p === '/api/designfiles') return route.fulfill({ json: [] });
    if (p === '/api/assemblies') return route.fulfill({ json: [assembly] });
    if (p === `/api/assemblies/${ASM}/cost`) return route.fulfill({ json: cost });
    if (p === '/api/costs/assemblies') return route.fulfill({ json: { [ASM]: { total: 1.02, complete: false } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/library/assemblies');
  await expect(page.locator('.tile-cost')).toHaveText(' · at least $1.02');
  await page.goto(`/library/assemblies/${ASM}`);
  const panel = page.getByRole('region', { name: 'Cost per unit' });
  await expect(panel.locator('.cost-head strong')).toHaveText('at least $1.02');
  await expect(panel.locator('li').nth(0)).toContainText('20.0 g Bambu TPU for AMS × $0.024/g');
  await expect(panel.locator('li').nth(0)).toContainText('$0.48');
  await expect(panel.locator('li').nth(1)).toContainText('Magnet ×12');
  await expect(panel.locator('li').nth(1)).toContainText('12 × $0.045');
  await expect(panel.locator('li.missing')).toContainText('no sliced print linked');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'handoff/spoolside-assembly-cost-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 428, height: 926 });
  await expect(panel.locator('.cost-head strong')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('a bought part is created from a supply, without a model file', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const posted: any[] = [];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/assets/purchased') { const b = route.request().postDataJSON(); posted.push(b); return route.fulfill({ json: { ...magnet, name: b.name, supplyId: b.supplyId } }); }
    if (p === '/api/assets') return route.fulfill({ json: [top] });
    if (p === '/api/supplies') return route.fulfill({ json: { settings: {}, supplies: [{ id: 'bambu-tpu-ams', name: 'Bambu TPU', kind: 'filament' }, { id: 'supply-mag', name: 'Magnets, 3 × 2 mm', kind: 'part' }] } });
    if (p === '/api/designfiles' || p === '/api/categories') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/library');
  await page.getByRole('button', { name: /Upload/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Upload library item' });
  await dialog.getByLabel('Type').selectOption('Purchased');
  await expect(dialog.getByLabel('STL or SVG file')).toHaveCount(0);
  await dialog.getByLabel('Name').fill('Magnet');
  await expect(dialog.getByLabel('Bought as').locator('option')).toHaveText(['Choose a supply', 'Magnets, 3 × 2 mm']);
  await dialog.getByLabel('Bought as').selectOption('supply-mag');
  await dialog.getByRole('button', { name: 'Add to library' }).click();
  await expect.poll(() => posted[0]).toMatchObject({ name: 'Magnet', supplyId: 'supply-mag' });
});

test('a print can say which filament supply it is costed as', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const puts: any[] = [];
  const file = { id: 'slice', name: 'Membranes', created: '', size: 1, scope: 'playcase', filamentSupplies: {}, plates: [{ index: 1, minutes: 30, grams: 4, filaments: [{ id: 1, type: 'TPU', color: '#ffffff', grams: 4 }], coverage: [] }] };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname, m = route.request().method();
    if (p === '/api/library/slice/filaments' && m === 'PUT') { puts.push(route.request().postDataJSON()); return route.fulfill({ json: { ...file, filamentSupplies: puts.at(-1) } }); }
    if (p === '/api/library/slice' && m === 'PATCH') return route.fulfill({ json: file });
    if (p === '/api/library') return route.fulfill({ json: [file] });
    if (p === '/api/supplies') return route.fulfill({ json: { settings: { filamentMap: { 'TPU-AMS': 'bambu-tpu-ams' } }, supplies: [{ id: 'bambu-tpu-ams', name: 'Bambu TPU for AMS', kind: 'filament' }, { id: 'recreus-filaflex-70a', name: 'Recreus Filaflex 70A', kind: 'filament' }, { id: 'mag', name: 'Magnets', kind: 'part' }] } });
    if (p === '/api/workspace') return route.fulfill({ json: { machines: [] } });
    if (p === '/api/assets' || p === '/api/designfiles') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/library/sliced');
  await page.getByRole('button', { name: 'Edit print details for Membranes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print details for Membranes' });
  const pick = dialog.getByLabel('Costed filament for filament 1');
  await expect(pick.locator('option')).toHaveText(['Default for TPU (not set)', 'Bambu TPU for AMS', 'Recreus Filaflex 70A']);
  await pick.selectOption('recreus-filaflex-70a');
  await dialog.getByRole('button', { name: 'Save print details' }).click();
  await expect.poll(() => puts[0]).toEqual({ 1: 'recreus-filaflex-70a' });
});

test('hosted order rows show an estimated cost with its breakdown', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const order = { id: '1', number: '#1', placed: 'Nov 10, 2026', commercial: 'processing', refundReview: false, items: [{ id: 'i1', name: 'PlayCase', variant: 'Phone model: iPhone 16 Pro', quantity: 1, recipe: [], phone: 'iPhone 16 Pro', colorway: 'Red', parts: [{ name: 'Handheld Faceplate' }] }] };
  const state = { revision: 1, orders: [order], jobs: [], spools: [], machines: [], lastSync: new Date().toISOString(), syncError: null };
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/workspace') return route.fulfill({ json: state });
    if (p === '/api/costs/orders') return route.fulfill({ json: { 1: { total: 4.07, complete: true } } });
    if (p === '/api/orders/1/cost') return route.fulfill({ json: { total: 4.07, complete: true, missing: [], lines: [{ label: 'iPhone 16 Pro case', quantity: 1, unit: 2.6, cost: 2.6, complete: true }, { label: 'Handheld faceplate', quantity: 1, unit: 0.48, cost: 0.48, complete: true }, { label: 'Box, 8 × 4 × 2″', quantity: 1, unit: 0.88, cost: 0.88, complete: true }, { label: 'Bubble pouch, 4 × 8″', quantity: 1, unit: 0.11, cost: 0.11, complete: true }] } });
    if (p.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + p }) });
  });
  await page.route('https://playcase.gg/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('https://spoolside.shelbyklein.com/orders');
  const row = page.getByRole('article', { name: 'Order #1', exact: true });
  const est = row.getByRole('button', { name: 'Est. cost $4.07' });
  await expect(est).toBeVisible();
  await est.click();
  const breakdown = row.getByRole('list', { name: 'Estimated cost' });
  await expect(breakdown.locator('li')).toHaveCount(5);
  await expect(breakdown.locator('li').nth(2)).toContainText('Box, 8 × 4 × 2″');
  await expect(breakdown.locator('li.cost-total')).toContainText('$4.07');
  await page.screenshot({ path: 'handoff/spoolside-order-cost-desktop.png' });
  await context.close();
});
