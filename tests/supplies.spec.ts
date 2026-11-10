import { test, expect, type Page } from '@playwright/test';

// A stateful stand-in for the supplies API, so the page can add parts, offers and settings.
function mockSupplies(page: Page) {
  const now = new Date().toISOString();
  const filament = (id: string, name: string, usage: string) => ({ id, name, kind: 'filament', unit: 'g', usage, url: '', custom: false, offers: [] as any[] });
  const catalog: any = {
    settings: { zip: '30360', sort: 'fastest', filamentMap: { 'TPU-AMS': 'bambu-tpu-ams', PLA: 'proto-conductive' }, packaging: { small: null, large: null, pouch: null }, pouchesPerOrder: 1 },
    supplies: [filament('bambu-tpu-ams', 'Bambu TPU for AMS', 'cases, faceplates'), filament('proto-conductive', 'Proto-pasta Conductive PLA', 'Bridges'), filament('recreus-filaflex-70a', 'Recreus Filaflex 70A', 'Membranes')],
  };
  const calls: any[] = [];
  const reply = () => ({ json: { ...catalog, materials: catalog.supplies } });
  page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url()), m = route.request().method(), p = url.pathname;
    const body = m === 'GET' ? null : route.request().postDataJSON();
    if (body) calls.push([m, p, body]);
    if (p === '/api/supplies' && m === 'POST') { catalog.supplies.push({ id: 'supply-' + catalog.supplies.length, name: body.name, kind: body.kind, unit: 'piece', usage: body.usage, url: body.url, custom: true, offers: [] }); return route.fulfill(reply()); }
    if (p === '/api/supplies/settings') { catalog.settings = { ...catalog.settings, ...body, packaging: { ...catalog.settings.packaging, ...(body.packaging || {}) } }; return route.fulfill(reply()); }
    if (p === '/api/supply-offers' && m === 'POST') { const s = catalog.supplies.find((x: any) => x.id === body.supplyId); s.offers.push({ id: 'o' + s.offers.length, ...body, source: 'manual', checked: now, stale: false, unitPrice: body.price / body.quantity, deliveredUnitPrice: null, shipping: null }); return route.fulfill(reply()); }
    if (p === '/api/supplies') return route.fulfill(reply());
    if (p === '/api/materials') return route.fulfill({ json: { settings: { zip: '30360', sort: 'fastest' }, materials: catalog.supplies.filter((s: any) => s.kind === 'filament') } });
    if (p === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines: [], lastSync: now, syncError: null } });
    if (p === '/api/watches') return route.fulfill({ json: { vision: false, watches: [] } });
    if (p.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + p + url.search }) });
  });
  return { catalog, calls };
}

test('Supplies: filament keeps its restock view and costing map; parts and packaging are priced per piece', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const { calls } = mockSupplies(page);
  await page.goto('https://spoolside.shelbyklein.com/filament');
  await expect(page).toHaveURL(/\/supplies$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Supplies');
  await expect(page.getByRole('tab', { name: 'Filament' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Recreus Filaflex 70A' })).toBeVisible();
  await page.getByLabel('Filament for TPU', { exact: true }).selectOption('recreus-filaflex-70a');
  await expect.poll(() => calls.find((c) => c[1] === '/api/supplies/settings')?.[2].filamentMap.TPU).toBe('recreus-filaflex-70a');

  await page.getByRole('tab', { name: 'Parts' }).click();
  await expect(page).toHaveURL(/group=parts/);
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByLabel('Name').fill('Magnets, 3 × 2 mm');
  await page.getByLabel('Used for').first().fill('24 per case, 12 per faceplate top');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const card = page.getByRole('region', { name: 'Magnets, 3 × 2 mm' });
  await expect(card).toBeVisible();
  await expect(card.getByText('No price yet')).toBeVisible();
  await card.getByRole('button', { name: 'Add offer' }).click();
  const form = page.getByRole('form', { name: 'Add offer for Magnets, 3 × 2 mm' });
  await form.getByLabel('Description').fill('MEALOS 200 pcs, 3 mm × 2 mm');
  await form.getByLabel('Product link').fill('https://www.amazon.com/dp/B08NZTN426');
  await form.getByLabel('Price (USD)').fill('8.99');
  await form.getByLabel('Pieces it buys').fill('200');
  await form.getByRole('button', { name: 'Save offer' }).click();
  await expect(card.getByText('$8.99 for 200')).toBeVisible();
  await expect(card.locator('.supply-best strong')).toHaveText('$0.045');
  await page.screenshot({ path: 'handoff/spoolside-supplies-parts-desktop.png' });

  await page.getByRole('tab', { name: 'Packaging' }).click();
  await page.getByRole('button', { name: 'Add packaging supply' }).click();
  await page.getByLabel('Name').fill('Box, 8 × 4 × 1″');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Box for a case on its own').selectOption({ label: 'Box, 8 × 4 × 1″' });
  await expect.poll(() => calls.filter((c) => c[1] === '/api/supplies/settings').at(-1)?.[2].packaging.small).toBeTruthy();
  await page.getByLabel('Bubble pouches per order').fill('2'); await page.getByLabel('Bubble pouches per order').blur();
  await expect.poll(() => calls.filter((c) => c[1] === '/api/supplies/settings').at(-1)?.[2].pouchesPerOrder).toBe(2);
  await page.screenshot({ path: 'handoff/spoolside-supplies-packaging-desktop.png' });

  await page.setViewportSize({ width: 428, height: 926 });
  await page.getByRole('tab', { name: 'Parts' }).click();
  await expect(page.getByRole('region', { name: 'Magnets, 3 × 2 mm' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'handoff/spoolside-supplies-parts-iphone.png', fullPage: true });
  await context.close();
});
