import { test, expect } from '@playwright/test';

test('the print watcher shows alerts and asks how finished prints went', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const now = Date.now();
  const machine = { id: 'p1', name: 'Conductive', state: 'Paused', rawState: 'PAUSE', job: 'Touch Pin.gcode.3mf', progress: 40, remaining: '8 min', material: '', seen: new Date().toISOString(), stale: false, connected: true };
  const state = { revision: 1, orders: [], jobs: [], spools: [], machines: [machine], lastSync: new Date().toISOString(), syncError: null };
  let watches = [
    { id: '11111111-1111-4111-8111-111111111111', printer: 'p1', printerName: 'Conductive', job: 'Touch Pin.gcode.3mf', external: true, inLibrary: false, importDismissed: false, started: now - 600000, ended: null, endedAs: null, outcome: null, mode: 'pause', plan: true,
      check: { at: now - 60000, verdict: 'problem', reason: 'Spaghetti around the part.', file: '2.jpg' }, alert: { at: now - 60000, reason: 'Spaghetti around the part.', file: '2.jpg', paused: true } },
    { id: '22222222-2222-4222-8222-222222222222', printer: 'p2', printerName: 'AMS 3', job: 'Bridge.gcode.3mf', inLibrary: false, started: now - 9000000, ended: now - 300000, endedAs: 'finished', outcome: null, mode: 'pause', plan: false,
      check: { at: now - 400000, verdict: 'ok', reason: 'Fine.', file: '1.jpg', final: '3.jpg' }, alert: null },
    { id: '33333333-3333-4333-8333-333333333333', printer: 'p3', printerName: 'AMS 2', job: 'DS Top.gcode.3mf', inLibrary: true, started: now - 9000000, ended: now - 200000, endedAs: 'stopped', outcome: null, mode: 'pause', plan: false, check: null, alert: null },
  ];
  let recent: any[] = [{ id: '44444444-4444-4444-8444-444444444444', printer: 'p1', printerName: 'Conductive', job: 'Touch Pin.gcode.3mf', started: now - 99000000, ended: now - 90000000, endedAs: 'finished', outcome: 'failed', note: null, mode: 'pause', plan: false, check: null, alert: null }];
  const posts: string[] = [];
  let workspaceLoads = 0;
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace') { workspaceLoads++; return route.fulfill({ json: state }); }
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches, recent } });
    if (/^\/api\/watches\/[^/]+\/[^/]+\.jpg$/.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: pixel });
    if (route.request().method() === 'POST' && url.pathname.startsWith('/api/watches/')) {
      posts.push(url.pathname + ' ' + (route.request().postData() || ''));
      if (url.pathname.endsWith('/skip')) watches = watches.filter(w => w.id !== url.pathname.split('/')[3]);
      if (url.pathname.endsWith('/dismiss-import')) watches = watches.map(w => w.id === url.pathname.split('/')[3] ? { ...w, importDismissed: true } : w);
      if (url.pathname.endsWith('/library')) { const id = url.pathname.split('/')[3]; watches = watches.map(w => w.id === id ? { ...w, inLibrary: true } : w); recent = recent.map(w => w.id === id ? { ...w, inLibrary: true } : w); }
      if (url.pathname.endsWith('false-alarm')) watches = watches.map((w) => (w.printer === 'p1' ? { ...w, alert: null, mode: 'warn' } : w));
      if (url.pathname.endsWith('note')) {
        const id = url.pathname.split('/')[3], body = route.request().postDataJSON();
        watches = watches.map(w => w.id === id ? { ...w, note: body.note } : w);
        recent = recent.map(w => w.id === id ? { ...w, note: body.note } : w);
      }
      if (url.pathname.endsWith('outcome')) {
        const id = url.pathname.split('/')[3], body = route.request().postDataJSON();
        const answered = watches.find((w) => w.id === id);
        watches = watches.filter((w) => w.id !== id);
        recent = answered ? [{ ...answered, outcome: body.success ? 'success' : 'failed', note: body.note }, ...recent] : recent.map((w) => (w.id === id ? { ...w, note: body.note } : w));
      }
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.includes('library') ? [] : {} });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.goto('https://spoolside.shelbyklein.com/');
  const home = page.getByRole('region', { name: 'Spoolside home' });
  const alert = home.getByRole('article', { name: 'Conductive alert' });
  // Prints started elsewhere aren't interrupted with a library prompt; it comes with the rating.
  await expect(home.getByText('Add this print to the library?')).toHaveCount(0);
  await expect(alert).toContainText('Spoolside paused Conductive');
  await expect(alert).toContainText('Spaghetti around the part.');
  // Reviews wait behind a summary button, in a modal.
  await expect(home.getByRole('article', { name: 'Print review: Bridge' })).toHaveCount(0);
  await home.getByRole('button', { name: /2 prints to review/ }).click();
  const reviews = page.getByRole('dialog', { name: 'Print reviews' });
  await reviews.screenshot({ path: 'handoff/spoolside-review-modal.png' });
  const ask = reviews.getByRole('article', { name: 'Print review: Bridge' });
  await expect(ask.getByRole('heading', { name: 'Bridge' })).toBeVisible();
  await expect(ask).toContainText('Finished on AMS 3');
  await ask.screenshot({path:'handoff/spoolside-review-add-library.png'});
  await expect(ask.getByLabel('Also add this plate to the library')).not.toBeChecked();
  await ask.getByLabel('Also add this plate to the library').check();
  await expect(ask.getByRole('button', {name:'Came out fine'})).toBeVisible();
  await ask.screenshot({ path: 'handoff/spoolside-outcome-icons.png' });
  await ask.getByRole('button', { name: 'Notes', exact: true }).click();
  await ask.getByLabel(/Print notes/).fill('Calibration run');
  await ask.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(ask).toContainText('Calibration run');
  expect(posts).toContain('/api/watches/22222222-2222-4222-8222-222222222222/note {"note":"Calibration run"}');
  await expect(ask.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await ask.getByRole('button', { name: 'Came out fine' }).click();
  await expect(ask.getByLabel(/Print notes/)).toHaveValue('Calibration run');
  await page.screenshot({ path: 'handoff/spoolside-print-notes-mobile.png', fullPage: true });
  const beforeOutcome = workspaceLoads;
  await ask.getByRole('button', { name: 'Save as successful' }).click();
  await expect.poll(() => workspaceLoads).toBeGreaterThan(beforeOutcome);
  await expect(ask).toHaveCount(0);
  expect(posts).toContain('/api/watches/22222222-2222-4222-8222-222222222222/outcome {"success":true,"note":"Calibration run"}');
  const importDialog = page.getByRole('dialog', { name: 'Add Bridge to library' });
  await expect(importDialog).toContainText('Added to Sliced prints, with AMS 3 as its printer.');
  expect(posts.some((p) => p.startsWith('/api/watches/22222222-2222-4222-8222-222222222222/library'))).toBe(true);
  await importDialog.getByRole('button', { name: 'Done' }).click();
  await expect(importDialog).toHaveCount(0);
  await page.goto('https://spoolside.shelbyklein.com/printers?rate=33333333-3333-4333-8333-333333333333');
  // A notification link opens the modal on that print.
  const stopped = page.getByRole('dialog', { name: 'Print reviews' }).getByRole('article', { name: 'Print review: DS Top' });
  await expect(stopped).toHaveClass(/rating-target/);
  await expect(stopped.getByRole('button', { name: 'Came out fine' })).toBeFocused();
  await page.screenshot({path:'handoff/spoolside-notification-rating.png',fullPage:true});
  await stopped.getByRole('button', { name: 'Failed' }).click();
  await stopped.getByLabel(/What went wrong/).fill('Corner lifted on the left');
  await stopped.getByRole('button', { name: 'Save as failed' }).click();
  await expect(stopped).toHaveCount(0);
  expect(posts).toContain('/api/watches/33333333-3333-4333-8333-333333333333/outcome {"success":false,"note":"Corner lifted on the left"}');
  // A review can also be deleted in one tap, without a rating or notes.
  watches = [...watches, { ...watches[0], id: '55555555-5555-4555-8555-555555555555', printer: 'p5', printerName: 'Desk', job: 'Spare.gcode.3mf', ended: now - 100000, endedAs: 'finished', external: false, alert: null, check: null }];
  await page.reload();
  await page.getByRole('button', { name: /print to review/ }).first().click();
  const spare = page.getByRole('article', { name: 'Print review: Spare' });
  await spare.getByRole('button', { name: 'Delete review' }).click();
  await expect(spare).toHaveCount(0);
  expect(posts).toContain('/api/watches/55555555-5555-4555-8555-555555555555/skip {}');
  await page.getByRole('navigation').getByRole('button',{name:'Overview',exact:true}).click();
  await alert.getByRole('button', { name: 'False alarm, resume' }).click();
  await expect(alert).toHaveCount(0);
  await home.getByRole('button', { name: 'Conductive, Paused' }).click();
  const details = page.getByRole('dialog', { name: 'Conductive details' });
  await expect(details).toContainText('Watching (warnings only)');
  const history = details.getByRole('region', { name: 'Recent prints' });
  await history.getByRole('button', { name: 'Add note' }).click();
  await history.getByLabel(/Print notes/).fill('Under-extruded, nozzle clog');
  await history.getByRole('button', { name: 'Save note' }).click();
  await expect(history).toContainText('Under-extruded, nozzle clog');
  await expect(history.getByRole('button', { name: 'Edit note' })).toBeVisible();
  await context.close();
});
