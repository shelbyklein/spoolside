import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { Assets } from './assets.mjs';
import { Library } from './library.mjs';
import { createApp } from './app.mjs';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="65.896881mm" height="40.795244mm" viewBox="0 0 65.896881 40.795244"><path d="M0 0H10V20Z"/></svg>');
const meta = { name: 'PlayPad tape', fileName: 'PlayPad tape.svg', source: 'PlayPad/Cricut/tape.svg', generation: 4, category: 'hardware', fit: { style: 'PlayPad' }, note: 'Mirror off' };

test('vector assets preserve native bytes and source identity, without STL or slices', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoolside-vector-'));
  const assets = new Assets(':memory:', path.join(dir, 'assets'));
  try {
    const a = assets.addVector(meta, svg);
    assert.equal(a.type, 'Cut template');
    assert.equal(a.hasStl, false);
    assert.equal(a.complete, true);
    assert.deepEqual(a.dims, [65.896881, 40.795244]);
    assert.equal(a.triangles, 0);
    assert.throws(() => assets.saveAssembly({ name: 'Not a model', type: 'Case', components: [{ assetId: a.id, quantity: 1 }] }), /Invalid assembly component/);
    assert.equal(fs.existsSync(assets.file(a.id)), false);
    assert.deepEqual(fs.readFileSync(assets.vectorFile(a.id).path), svg);
    assert.throws(() => assets.linkDesign(a.id, null), /keep an SVG/);
    assets.update(a.id, { name: 'Tape reviewed', status: 'Stale', note: 'Keep my note' });
    const updated = assets.addVector(meta, svg);
    assert.equal(updated.id, a.id);
    assert.equal(updated.name, 'Tape reviewed');
    assert.equal(updated.status, 'Stale');
    assert.equal(updated.note, 'Keep my note');
    assert.equal(assets.list().length, 1);
    assert.equal(assets.designs().length, 1);
    assert.throws(() => assets.addVector(meta, Buffer.from('not svg')), /static SVG/);
    assets.remove(a.id);
    assert.throws(() => assets.vectorFile(a.id), /Unknown SVG/);
    assert.throws(() => assets.addVector(meta, svg), /Deleted/);
  } finally { assets.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('authenticated vector API previews/downloads exact SVG and never adds sliced prints', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoolside-vector-api-'));
  const assets = new Assets(':memory:', path.join(dir, 'assets'));
  const library = new Library(':memory:', path.join(dir, 'library'));
  const salt = 'c'.repeat(32);
  const { app, close } = createApp({ pinHash: salt + ':' + scryptSync('12345678', salt, 64).toString('hex'), secure: false, origin: 'http://localhost', assets, library });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: 'http://localhost' }, body: new URLSearchParams({ pin: '12345678' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/octet-stream', 'X-Asset': encodeURIComponent(JSON.stringify(meta)) };
    assert.equal((await fetch(base + '/api/assets/vectors', { method: 'POST', body: svg })).status, 403);
    const response = await fetch(base + '/api/assets/vectors', { method: 'POST', headers, body: svg });
    assert.equal(response.status, 200);
    const a = await response.json();
    assert.equal(a.type, 'Cut template');
    assert.equal((await fetch(base + `/api/assets/${a.id}/svg`)).status, 401);
    const preview = await fetch(base + `/api/assets/${a.id}/svg`, { headers: { Cookie: cookie } });
    assert.match(preview.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(preview.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), svg);
    const download = await fetch(base + `/api/assets/${a.id}/svg?download=1`, { headers: { Cookie: cookie } });
    assert.match(download.headers.get('content-disposition'), /attachment.*PlayPad tape\.svg/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), svg);
    assert.equal((await fetch(base + `/api/assets/${a.id}/stl`, { headers: { Cookie: cookie } })).status, 404);
    assert.deepEqual(await (await fetch(base + '/api/library', { headers: { Cookie: cookie } })).json(), []);
    assert.equal((await fetch(base + '/api/assets/vectors', { method: 'POST', headers, body: Buffer.from('<svg/>') })).status, 400);
    assert.equal(assets.list().length, 1);
  } finally { await new Promise(r => server.close(r)); close(); library.close(); assets.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
