import { test, expect } from '@playwright/test';

test('the print watcher shows alerts and asks how finished prints went', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const now = Date.now();
  const machine = { id: 'p1', name: 'Conductive', state: 'Paused', rawState: 'PAUSE', job: 'Touch Pin.gcode.3mf', progress: 40, remaining: '8 min', material: '', seen: new Date().toISOString(), stale: false, connected: true };
  const state = { revision: 1, orders: [], jobs: [], spools: [], machines: [machine], lastSync: new Date().toISOString(), syncError: null };
  let watches = [
    { id: '11111111-1111-4111-8111-111111111111', printer: 'p1', printerName: 'Conductive', job: 'Touch Pin.gcode.3mf', started: now - 600000, ended: null, endedAs: null, outcome: null, mode: 'pause', plan: true,
      check: { at: now - 60000, verdict: 'problem', reason: 'Spaghetti around the part.', file: '2.jpg' }, alert: { at: now - 60000, reason: 'Spaghetti around the part.', file: '2.jpg', paused: true } },
    { id: '22222222-2222-4222-8222-222222222222', printer: 'p2', printerName: 'AMS 3', job: 'Bridge.gcode.3mf', started: now - 9000000, ended: now - 300000, endedAs: 'finished', outcome: null, mode: 'pause', plan: false,
      check: { at: now - 400000, verdict: 'ok', reason: 'Fine.', file: '1.jpg', final: '3.jpg' }, alert: null },
  ];
  const posts: string[] = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') return route.fulfill({ json: state });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches } });
    if (/^\/api\/watches\/[^/]+\/[^/]+\.jpg$/.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: pixel });
    if (route.request().method() === 'POST' && url.pathname.startsWith('/api/watches/')) {
      posts.push(url.pathname + ' ' + (route.request().postData() || ''));
      if (url.pathname.endsWith('false-alarm')) watches = watches.map((w) => (w.printer === 'p1' ? { ...w, alert: null, mode: 'warn' } : w));
      if (url.pathname.endsWith('outcome')) watches = watches.filter((w) => w.printer !== 'p2');
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.includes('library') ? [] : {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/');
  const home = page.getByRole('region', { name: 'Spoolside home' });
  const alert = home.getByRole('article', { name: 'Conductive alert' });
  await expect(alert).toContainText('Spoolside paused Conductive');
  await expect(alert).toContainText('Spaghetti around the part.');
  const ask = home.getByRole('article', { name: 'How did Bridge go?' });
  await expect(ask).toContainText('Finished on AMS 3');
  await ask.getByRole('button', { name: 'Came out fine' }).click();
  await expect(ask).toHaveCount(0);
  expect(posts).toContain('/api/watches/22222222-2222-4222-8222-222222222222/outcome {"success":true}');
  await alert.getByRole('button', { name: 'False alarm, resume' }).click();
  await expect(alert).toHaveCount(0);
  await home.getByRole('button', { name: 'Conductive, Paused' }).click();
  await expect(page.getByRole('dialog', { name: 'Conductive details' })).toContainText('Watching (warnings only)');
  await context.close();
});
