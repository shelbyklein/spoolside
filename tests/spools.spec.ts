import { test, expect } from '@playwright/test';

test('loaded spools show on printer cards, in details, and on the Filament page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const now = new Date().toISOString();
  const tray = (slot: number, color: string, remain: number) => ({ slot, type: 'TPU-AMS', color, name: 'TPU for AMS', remain, grams: remain * 10, materialId: 'bambu-tpu-ams' });
  const machines = [
    { id: 'a3', name: 'AMS 3', state: 'Ready', rawState: 'FINISH', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: true, feeding: 255,
      trays: [tray(0, '#5898DD', 100), tray(1, '#90FF1A', 100), tray(2, '#939393', 12), { slot: 3, type: '', color: '', name: '', remain: null, grams: null, materialId: null }], external: { type: 'TPU', color: '', name: 'TPU' } },
    { id: 'c', name: 'Conductive', state: 'Ready', rawState: 'FINISH', job: '', progress: 0, remaining: '—', material: '', seen: now, stale: false, connected: true, hasAms: false, feeding: 254, trays: [], external: null },
  ];
  const state = { revision: 1, orders: [], jobs: [], spools: [], machines, lastSync: now, syncError: null };
  const catalog = { settings: { zip: '30360', sort: 'fastest' }, materials: [{ id: 'bambu-tpu-ams', name: 'Bambu TPU for AMS', usage: 'cases', url: 'https://us.store.bambulab.com', offers: [] }, { id: 'recreus-conductive', name: 'Recreus Conductive Filaflex', usage: 'Touch pins', url: 'https://recreus.com', offers: [] }] };
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: state });
    if (url.pathname === '/api/materials') return route.fulfill({ json: catalog });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: false, watches: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/printers');
  const card = page.getByRole('button', { name: 'AMS 3, Ready' });
  await expect(card.locator('.spool-chip')).toHaveText(['TPU', 'TPU', 'TPU', 'Empty']);
  await expect(page.getByRole('button', { name: 'Conductive, Ready' }).locator('.spool-chip')).toHaveText(['Not set']);
  await card.click();
  const details = page.getByRole('dialog', { name: 'AMS 3 details' });
  await expect(details.locator('.spool-list li').first()).toContainText('TPU for AMS');
  await expect(details.locator('.spool-list li').first()).toContainText('Slot 1');
  await expect(details.locator('.spool-list li')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.getByRole('navigation').getByRole('button', { name: 'Filament', exact: true }).click();
  const loaded = page.getByRole('region', { name: 'Spools in your printers' });
  await expect(loaded).toContainText('≈ 1,000 g');
  await expect(loaded.locator('li.low')).toContainText('running low');
  await expect(loaded).toContainText('Not set in the printer');
  await expect(page.getByText('Loaded now: 3 spools · ≈ 2,120 g')).toBeVisible();
  await expect(page.getByText('None loaded in a printer.')).toBeVisible();
  await context.close();
});
