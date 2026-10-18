import { test, expect } from '@playwright/test';

test('a printer can repeat its current print each time the bed is cleared', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const machine = { id: 'M', name: 'Membrane', state: 'Printing', rawState: 'RUNNING', job: 'Membranes_plate_12.gcode.3mf', progress: 40, remaining: '20 min', material: '', seen: new Date().toISOString(), stale: false, connected: true, trays: [], external: { type: 'PETG', color: '#ffffff' } };
  let repeats: any[] = [];
  const posts: any[] = [];
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url()), m = route.request().method();
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines: [machine], lastSync: null, syncError: null } });
    if (url.pathname === '/api/printers/M/last-print') return route.fulfill({ json: { name: 'Membranes plate 12', plates: [{ index: 12, minutes: 33, grams: 4, filaments: [{ id: 1, type: 'PETG', color: '#ffffff' }] }] } });
    if (url.pathname === '/api/repeats') return route.fulfill({ json: repeats });
    if (url.pathname === '/api/printers/M/repeat') {
      if (m === 'POST') { posts.push(route.request().postDataJSON()); repeats = [{ printer: 'M', name: 'Membranes plate 12', plate: 12, done: 0, times: 10, status: 'Printing (0 repeated so far)' }]; }
      else repeats = [];
      return route.fulfill({ json: repeats });
    }
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [], recent: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname === '/api/library' ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/printers');
  await page.getByRole('button', { name: 'Membrane, Printing' }).click();
  const details = page.getByRole('dialog', { name: 'Membrane details' });
  await details.getByRole('button', { name: 'Repeat this print…' }).click();
  const setup = details.getByRole('region', { name: 'Repeat print' });
  await expect(setup).toContainText('Prints from the external spool (PETG)');
  await setup.getByLabel('Repeat times').fill('10');
  await setup.screenshot({ path: 'handoff/spoolside-repeat-setup.png' });
  await setup.getByRole('button', { name: 'Start repeating' }).click();
  expect(posts[0]).toEqual({ plate: 12, amsMapping: [-1], useAms: false, bedLevelling: false, times: 10 });
  await expect(setup).toContainText('Repeating Membranes plate 12');
  await expect(setup).toContainText('0 started again of 10');
  await setup.screenshot({ path: 'handoff/spoolside-repeat-active.png' });
  await setup.getByRole('button', { name: 'Stop repeating' }).click();
  await expect(details.getByRole('button', { name: 'Repeat this print…' })).toBeVisible();
  await context.close();
});
