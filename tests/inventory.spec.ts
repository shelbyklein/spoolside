import { test, expect } from '@playwright/test';

test('PlayCase inventory: counts per case and faceplate type, by color, saved as you type', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  let data: any = { colors: ['Black', 'Grey', 'Red'], updated: null, items: [{ kind: 'case', id: 'c16', name: 'iPhone 16 Pro Max', counts: {} }, { kind: 'faceplate', id: 'ds', name: 'DS', counts: { Red: 2 } }] };
  const puts: any[] = [];
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines: [], lastSync: null, syncError: null } });
    if (url.pathname === '/api/inventory' && route.request().method() === 'PUT') {
      const b = route.request().postDataJSON(); puts.push(b);
      data = { ...data, items: data.items.map((i: any) => (i.id === b.id ? { ...i, counts: { ...i.counts, [b.color]: b.count } } : i)) };
      return route.fulfill({ json: data });
    }
    if (url.pathname === '/api/inventory/hidden') {
      const b = route.request().postDataJSON(); puts.push(b);
      data = { ...data, items: data.items.map((i: any) => (i.id === b.id ? { ...i, hidden: b.hidden } : i)) };
      return route.fulfill({ json: data });
    }
    if (url.pathname === '/api/inventory') return route.fulfill({ json: data });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname === '/api/watches' ? { vision: false, watches: [] } : {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/inventory');
  await expect(page.getByRole('heading', { name: 'PlayCase' })).toBeVisible();
  const inv = page.getByRole('region', { name: 'Inventory' });
  await expect(inv.getByLabel('DS Red')).toHaveValue('2');
  await inv.getByLabel('iPhone 16 Pro Max Grey').fill('4');
  await inv.getByLabel('iPhone 16 Pro Max Grey').press('Enter');
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ kind: 'case', id: 'c16', color: 'Grey', count: 4 });
  await expect(inv.getByRole('columnheader', { name: 'Total' })).toHaveCount(0);
  await inv.getByRole('tab', { name: 'Faceplates' }).click();
  await expect(inv.getByRole('row', { name: /iPhone 16 Pro Max/ })).toHaveCount(0);
  await expect(inv.getByLabel('DS Red')).toBeVisible();
  await inv.getByRole('tab', { name: 'Cases' }).click();
  await expect(inv.getByLabel('DS Red')).toHaveCount(0);
  await expect(inv.getByLabel('iPhone 16 Pro Max Grey')).toHaveValue('4');
  await inv.getByRole('tab', { name: 'All' }).click();
  // Faceplates not sold right now can be hidden, and brought back.
  await inv.getByRole('button', { name: 'Hide DS' }).click();
  await expect.poll(() => puts.at(-1)).toEqual({ kind: 'faceplate', id: 'ds', hidden: true });
  await expect(inv.getByLabel('DS Red')).toHaveCount(0);
  await inv.getByRole('button', { name: 'Show hidden (1)' }).click();
  await expect(inv.getByRole('row', { name: /DS · not sold/ })).toBeVisible();
  await expect(inv.getByLabel('DS Red')).toHaveValue('2');
  await inv.getByRole('button', { name: 'Show DS' }).click();
  await expect.poll(() => puts.at(-1)).toEqual({ kind: 'faceplate', id: 'ds', hidden: false });
  await inv.getByRole('button', { name: 'Hide not sold' }).click();
  await expect(inv.getByLabel('DS Red')).toBeVisible();
  await expect(inv.getByRole('button', { name: /Show hidden/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'handoff/spoolside-inventory-mobile.png' });
  await context.close();
});
