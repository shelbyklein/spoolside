import { test, expect, type Page } from '@playwright/test';

const machine = (id: string, name: string) => ({ id, name, state: 'Ready', rawState: 'IDLE', job: '', progress: 0, remaining: '—', material: '', seen: new Date().toISOString(), stale: false, connected: true, error: null });
// A tiny valid PNG for the camera photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function mock(page: Page, chat: { available: boolean; running: boolean; partial: string; limit: unknown; reason: string | null; items: unknown[] }, posts: unknown[]) {
  await page.route('https://spoolside.shelbyklein.com/**', async (route) => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { revision: 1, orders: [], jobs: [], spools: [], machines: [machine('a', 'Desk'), machine('b', 'Membrane')], lastSync: null, syncError: null } });
    if (url.pathname === '/api/watches') return route.fulfill({ json: { vision: true, watches: [], recent: [] } });
    if (url.pathname === '/api/chat' && method === 'POST') {
      const { text } = route.request().postDataJSON();
      posts.push(text);
      chat.items.push({ id: chat.items.length + 1, kind: 'user', created: Date.now(), text });
      chat.running = true;
      chat.partial = 'Looking at Desk';
      return route.fulfill({ json: chat });
    }
    if (url.pathname === '/api/chat' && method === 'DELETE') {
      chat.items = [];
      return route.fulfill({ json: chat });
    }
    if (url.pathname === '/api/chat') return route.fulfill({ json: chat });
    if (url.pathname.startsWith('/api/chat/images/')) return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: ['/api/library', '/api/repeats', '/api/notes', '/api/assets', '/api/categories'].includes(url.pathname) ? [] : {} });
    if (/\.(jpg|png)$/.test(url.pathname) && !url.pathname.startsWith('/assets') && !url.pathname.startsWith('/icon')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:4173' + url.pathname + url.search }) });
  });
  await page.route('https://playcase.gg/**', (route) => route.fulfill({ status: 404, body: '' }));
}

test('Claude opens from the header, streams an answer with its tool steps, and starts over', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const chat = { available: true, running: false, partial: '', limit: null, reason: null, items: [] as unknown[] };
  const posts: unknown[] = [];
  await mock(page, chat, posts);
  await page.goto('https://spoolside.shelbyklein.com/printers');
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const panel = page.getByRole('dialog', { name: 'Claude' });
  await expect(panel).toContainText('Ask about the farm');
  // Enter sends; Shift+Enter would add a line.
  await panel.getByLabel('Message Claude').fill("Is Desk's bed clear?");
  await panel.getByLabel('Message Claude').press('Enter');
  await expect.poll(() => posts).toEqual(["Is Desk's bed clear?"]);
  await expect(panel.getByLabel('Message Claude')).toHaveValue('');
  await expect(panel.locator('.chat-msg.user')).toHaveText("Is Desk's bed clear?");
  await expect(panel.locator('.chat-msg.streaming')).toContainText('Looking at Desk');
  await expect(panel.getByRole('button', { name: 'Stop Claude' })).toBeVisible();
  // The answer arrives: a camera step with its photo, a failed start, and a formatted reply.
  chat.items.push(
    { id: 2, kind: 'tool', created: Date.now(), name: 'camera', input: { printer: 'Desk' }, status: 'done', result: 'Desk · Ready', images: ['0b7e1d0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f.png'] },
    { id: 3, kind: 'tool', created: Date.now(), name: 'start_print', input: { printer: 'Desk', file: 'x' }, status: 'error', result: 'Not started. The camera sees something on the bed.' },
    { id: 4, kind: 'assistant', created: Date.now(), text: "Desk's bed **isn't clear** yet:\n\n- a part near the middle\n- glare on the left\n\nTell me when it's cleared." },
  );
  chat.running = false;
  chat.partial = '';
  await expect(panel.getByRole('status', { name: "Looked through Desk's camera" })).toBeVisible();
  await expect(panel.getByRole('img', { name: /Photo from looked through desk's camera/i })).toBeVisible();
  await expect(panel.getByRole('status', { name: "Couldn't start the print on Desk" })).toContainText('sees something on the bed');
  await expect(panel.locator('.chat-msg.assistant strong')).toHaveText("isn't clear");
  await expect(panel.locator('.chat-msg.assistant li')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
  await panel.screenshot({ path: 'handoff/spoolside-claude-chat.png' });
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(panel.locator('.chat-msg')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await context.close();
});

test('on a phone Claude fills the screen from the home page, and explains when it is not connected', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const chat = { available: false, running: false, partial: '', limit: null, reason: 'not connected', items: [] as unknown[] };
  await mock(page, chat, []);
  await page.goto('https://spoolside.shelbyklein.com/');
  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const panel = page.getByRole('dialog', { name: 'Claude' });
  await expect(panel).toContainText('claude setup-token');
  await expect(panel.getByLabel('Message Claude')).toBeDisabled();
  const box = await panel.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'handoff/spoolside-claude-chat-setup-mobile.png' });
  await panel.getByRole('button', { name: 'Close Claude' }).click();
  await expect(panel).toHaveCount(0);
  await context.close();
});

test('the empty chat offers starter questions; tapping one sends it as typed, and they go away', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const chat = { available: true, running: false, partial: '', limit: null, reason: null, items: [] as unknown[] };
  const posts: unknown[] = [];
  await mock(page, chat, posts);
  await page.goto('https://spoolside.shelbyklein.com/printers');
  await page.getByRole('button', { name: 'Ask Claude' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Claude' });
  const starters = panel.getByRole('group', { name: 'Suggested questions' }).getByRole('button');
  await expect(starters).toHaveText(["What's printing right now?", 'Is anything waiting on me?', 'Which orders are ready to ship?']);
  for (const b of await starters.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel.screenshot({ path: '/tmp/d34-shots/claude-empty-428.png' });
  await starters.nth(1).tap();
  await expect.poll(() => posts).toEqual(['Is anything waiting on me?']);
  await expect(panel.getByRole('group', { name: 'Suggested questions' })).toHaveCount(0);
  await expect(panel.locator('.chat-msg.user')).toHaveText('Is anything waiting on me?');
});

test('no starter questions while Claude is not connected', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await mock(page, { available: false, running: false, partial: '', limit: null, reason: 'no token', items: [] }, []);
  await page.goto('https://spoolside.shelbyklein.com/printers');
  await page.getByRole('button', { name: 'Ask Claude' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Claude' });
  await expect(panel).toContainText("isn't connected yet");
  await expect(panel.getByRole('group', { name: 'Suggested questions' })).toHaveCount(0);
});
