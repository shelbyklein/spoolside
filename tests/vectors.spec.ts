import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { Assets } from '../server/assets.mjs';
import { Library } from '../server/library.mjs';

test('Cricut SVG upload, preview, exact download and reload use the native asset API', async ({ page, request }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoolside-vector-browser-'));
  const assets = new Assets(':memory:', path.join(dir, 'assets'));
  const library = new Library(':memory:', path.join(dir, 'library'));
  assets.saveCategory({ name: 'PlayPad', color: '#d1a62b' }, 'playpad');
  const salt = 'd'.repeat(32);
  const { app, close } = createApp({ pinHash: salt + ':' + scryptSync('12345678', salt, 64).toString('hex'), secure: false, origin: 'http://localhost', assets, library });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="65.896881mm" height="40.795244mm" viewBox="0 0 65.896881 40.795244"><path d="M0 0H65.896881V40.795244H0Z M10 10H20V20H10Z M40 10H50V20H40Z" fill-rule="evenodd"/></svg>');
  try {
    const login = await request.post(base + '/login', { headers: { Origin: 'http://localhost' }, form: { pin: '12345678' }, maxRedirects: 0 });
    const cookie = login.headers()['set-cookie'].split(';')[0];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (/^\/api\/(assets|designfiles|categories|library)(\/|$)/.test(url.pathname)) {
        const response = await route.fetch({ url: base + url.pathname + url.search, headers: { ...route.request().headers(), Cookie: cookie, Origin: 'http://localhost' } });
        return route.fulfill({ response });
      }
      if (url.pathname === '/api/workspace') return route.fulfill({ json: { machines: [], queue: [], orders: [], source: 'demo' } });
      return route.fulfill({ json: [] });
    });
    await page.goto('/library');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Upload library item' });
    await form.getByLabel('STL or SVG file').setInputFiles({ name: 'PlayPad tape.svg', mimeType: 'image/svg+xml', buffer: svg });
    await form.getByLabel('Name', { exact: true }).fill('PlayPad tape — no keychain cutout');
    await expect(form.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('Cut template');
    await expect(form.getByLabel('Design file (optional)')).toHaveCount(0);
    await form.getByRole('combobox', { name: 'Category', exact: true }).selectOption('playpad');
    await form.getByRole('button', { name: 'Add to library' }).click();
    const detail = page.getByRole('dialog', { name: 'PlayPad tape — no keychain cutout' });
    await expect(detail).toBeVisible();
    const preview = detail.getByRole('img', { name: /SVG preview/ });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(detail.getByText('65.896881 × 40.795244 mm', { exact: true })).toBeVisible();
    await expect(detail.getByRole('link', { name: 'Download SVG' })).toBeVisible();
    await expect(detail.getByRole('link', { name: 'Download STL' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Print', exact: true })).toHaveCount(0);
    await expect(detail.getByText('Triangles', { exact: true })).toHaveCount(0);
    const downloaded = page.waitForEvent('download');
    await detail.getByRole('link', { name: 'Download SVG' }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('PlayPad tape.svg');
    expect(fs.readFileSync((await download.path())!)).toEqual(svg);
    await page.reload();
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('img', { name: /SVG preview/ })).toBeVisible();
    expect(assets.list()).toHaveLength(1);
    expect(library.list()).toHaveLength(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(detail).toHaveCSS('opacity', '1');
    await expect(detail.locator('..')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: 'handoff/cricut-svg-desktop.png' });
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('tab', { name: 'Cut templates', exact: true }).click();
    const card = page.getByRole('button', { name: /^PlayPad tape — no keychain cutout, Up to date$/ });
    await expect(card).toBeVisible();
    await expect(card.getByRole('img', { name: 'Missing design file' })).toHaveCount(0);
    await card.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(detail).toHaveCSS('opacity', '1');
    await expect(detail.locator('..')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: 'handoff/cricut-svg-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
    close(); assets.close(); library.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
