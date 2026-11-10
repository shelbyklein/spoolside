import { test, expect } from '@playwright/test';

test('a printer refusing connections says why on its card and in its details', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const reason = "AMS 2 is refusing connections: too many apps connected. Close OrcaSlicer's Device tab or Bambu Handy, or restart the printer.";
  const machines = [
    { id: 'a', name: 'AMS 2', state: 'Offline', rawState: 'FINISH', job: '', progress: 0, remaining: '—', material: '', seen: null, stale: true, connected: false, error: reason },
    { id: 'b', name: 'AMS 3', state: 'Ready', rawState: 'IDLE', job: '', progress: 0, remaining: '—', material: '', seen: new Date().toISOString(), stale: false, connected: true, error: null },
  ];
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines, lastSync: null, syncError: null } });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [], recent: [] } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: ['/api/library', '/api/repeats', '/api/notes'].includes(url.pathname) ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/printers');
  const card = page.getByRole('button', { name: 'AMS 2, Offline' });
  await expect(card.getByRole('note')).toHaveText(reason);
  await expect(page.getByRole('button', { name: 'AMS 3, Ready' }).getByRole('note')).toHaveCount(0);
  await card.screenshot({ path: 'handoff/spoolside-printer-refused.png' });
  await card.click();
  await expect(page.getByRole('dialog', { name: 'AMS 2 details' })).toContainText('too many apps connected');
  await context.close();
});
