import { test, expect } from '@playwright/test';

const machine = (id: string, name: string, rawState = 'IDLE') => ({ id, name, state: rawState === 'RUNNING' ? 'Printing' : 'Ready', rawState, job: rawState === 'RUNNING' ? 'PlayPad cap' : '', progress: rawState === 'RUNNING' ? 2 : 0, remaining: '24 min', material: '', seen: new Date().toISOString(), stale: false, connected: true, error: null });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('bed checks can be tuned: warnings after your own start, remembering a wrong hold, and per-printer settings', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const reason = 'The visible plate looks clear, but the bed is slid toward the camera and its front edge is cut off.';
  const dispatch = {
    auto: true, vision: true, available: [], held: [],
    offers: [{ id: 'of1', printer: 'c', printerName: 'AMS 3', orderId: 'o1', orderNumber: '#10413', group: 'g', groupLabel: 'case', pieceName: 'iPhone 17 Pro Max Case', colorway: 'Black', slot: 3, autoBlocked: `Bed check: ${reason}` }],
    warnings: [{ id: 'w1', printer: 'a', printerName: 'Desk', job: 'PlayPad cap', reason: 'A small disc is near the back of the plate.', at: Date.now() }],
  };
  const settings = { visibleOnly: true, allow: [] as { id: string; text: string; at: number }[], reference: null };
  const calls: string[] = [];
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url()), method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines: [machine('a', 'Desk', 'RUNNING'), machine('c', 'AMS 3')], lastSync: null, syncError: null } });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [], recent: [] } });
    if (url.pathname === '/api/dispatch') return route.fulfill({ json: dispatch });
    if (url.pathname.endsWith('/bed-warning.jpg')) return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (url.pathname.match(/bed-allow$/) && method === 'POST') {
      calls.push(`allow ${url.pathname.split('/')[3]} ${JSON.stringify(body)}`);
      settings.allow.push({ id: 'n' + settings.allow.length, text: body.text, at: Date.now() });
      if (body.warning) dispatch.warnings = [];
      else dispatch.offers = [];
      return route.fulfill({ json: settings });
    }
    if (url.pathname.match(/bed-allow\/n\d$/) && method === 'DELETE') {
      calls.push('remove');
      settings.allow = settings.allow.filter((a) => !url.pathname.endsWith(a.id));
      return route.fulfill({ json: settings });
    }
    if (url.pathname.endsWith('/bed-settings') && method === 'PUT') {
      calls.push(`visible ${body.visibleOnly}`);
      settings.visibleOnly = body.visibleOnly;
      return route.fulfill({ json: settings });
    }
    if (url.pathname.endsWith('/bed-settings')) return route.fulfill({ json: settings });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: ['/api/library', '/api/repeats', '/api/notes', '/api/assets', '/api/categories'].includes(url.pathname) ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets') && !url.pathname.startsWith('/icon')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.route('https://playcase.gg/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('https://spoolside.shelbyklein.com/printers');

  // A print you started that the camera doubted: the photo, and what to do about it.
  const warning = page.getByRole('article', { name: "Check Desk's bed" });
  await expect(warning).toContainText('You started PlayPad cap, but the camera thought: A small disc is near the back of the plate.');
  await expect(warning.getByRole('img', { name: /Desk's bed just before the print started/ })).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Stop print' })).toBeVisible();
  await page.locator('.fleet-column').screenshot({ path: 'handoff/spoolside-bed-warning.png' });
  await warning.getByRole('button', { name: 'It was clear, remember this' }).click();
  await expect.poll(() => calls[0]).toBe('allow a {"text":"Not a reason to hold: A small disc is near the back of the plate.","warning":true}');
  await expect(warning).toHaveCount(0);

  // An auto-print the camera held wrongly: one tap remembers it for that printer.
  const offer = page.getByRole('article', { name: 'AMS 3 is free' });
  await offer.getByRole('button', { name: 'Wrong, remember this' }).click();
  await expect.poll(() => calls[1]).toBe(`allow c {"text":"Not a reason to hold: ${reason}","warning":false}`);
  await expect(page.getByText(/AMS 3's bed check won't hold for that again/)).toBeVisible();

  // Each printer's details: go by what's visible, and the notes on what's fine, editable.
  await page.getByRole('button', { name: /AMS 3, Ready/ }).click();
  const bed = page.getByRole('region', { name: 'AMS 3 bed check' });
  await expect(bed).toContainText("Hasn't been shown AMS 3's empty bed yet.");
  await expect(bed.getByRole('button', { name: 'Teach bed check' })).toBeVisible();
  await expect(bed.getByRole('checkbox', { name: /Go by what's visible/ })).toBeChecked();
  await expect(bed.getByRole('listitem')).toHaveCount(2);
  await bed.getByRole('checkbox', { name: /Go by what's visible/ }).uncheck();
  await expect.poll(() => calls.at(-1)).toBe('visible false');
  await bed.getByLabel("Something that's fine on AMS 3's bed").fill('The white tape on the right edge');
  await bed.getByRole('button', { name: 'Add' }).click();
  await expect(bed.getByRole('listitem')).toHaveCount(3);
  await expect(bed.getByLabel("Something that's fine on AMS 3's bed")).toHaveValue('');
  await bed.screenshot({ path: 'handoff/spoolside-bed-settings.png' });
  await bed.getByRole('button', { name: /Remove “The white tape/ }).click();
  await expect(bed.getByRole('listitem')).toHaveCount(2);
  await context.close();
});
