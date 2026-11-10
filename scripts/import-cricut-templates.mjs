// Import the three revised native SVGs into the existing PlayPad asset category.
// node scripts/import-cricut-templates.mjs /absolute/path/to/patch/tape-cutting
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectSvg } from '../server/svg.mjs';

const dir = process.argv[2];
if (!dir) throw Error('Supply the folder containing the revised Cricut SVG files');
const site = (process.env.SPOOLSIDE_URL || 'https://spoolside.shelbyklein.com').replace(/\/$/, '');
const key = process.env.SPOOLSIDE_API_KEY || fs.readFileSync(path.join(os.homedir(), '.config/spoolside/api-key'), 'utf8').trim();
const hash = buf => createHash('sha256').update(buf).digest('hex');
async function api(route, options = {}) {
  const response = await fetch(site + route, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } });
  if (!response.ok) throw Error(`${route}: ${response.status} ${await response.text()}`);
  return response;
}
const category = (await (await api('/api/categories')).json()).find(c => c.name === 'PlayPad');
if (!category) throw Error('The existing PlayPad category was not found');
const files = [
  ['PlayPad tape - single.svg', 'PlayPad suction tape - single', 'Single piece'],
  ['PlayPad tape - 4x1 row.svg', 'PlayPad suction tape - 4x1 row', 'Four in a row'],
  ['PlayPad tape - 25 per AirStick sheet.svg', 'PlayPad suction tape - 25 per sheet', '25 per AirStick sheet'],
].map(([fileName, name, piece]) => {
  const bytes = fs.readFileSync(path.join(dir, fileName));
  const dimensions = inspectSvg(bytes).size;
  return { fileName, name, piece, bytes, dimensions };
});
const report = [];
for (const file of files) {
  const meta = {
    name: file.name, fileName: file.fileName, source: `PlayPad/Cricut/${file.fileName}`,
    type: 'Cut template', generation: 4, status: 'Up to date', category: category.id,
    fit: { style: 'PlayPad', piece: file.piece, size: '70.6 mm pad' },
    note: 'Cricut SVG for 0.5 mm AirStick micro-suction tape. Revised: no keychain cutout. Import at original size; Basic Cut; Mirror off. Keep both liners on, adhesive liner against the mat. Physical cut fit still needs checking.',
  };
  const asset = await (await api('/api/assets/vectors', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Asset': encodeURIComponent(JSON.stringify(meta)) }, body: file.bytes })).json();
  const download = Buffer.from(await (await api(`/api/assets/${asset.id}/svg?download=1`)).arrayBuffer());
  if (hash(download) !== hash(file.bytes) || asset.hasStl !== false || asset.type !== 'Cut template' || JSON.stringify(asset.dims) !== JSON.stringify(file.dimensions)) throw Error(`Native SVG verification failed: ${file.fileName}`);
  report.push({ id: asset.id, name: asset.name, fileName: file.fileName, dims: asset.dims, sha256: hash(download), url: `${site}/library/${asset.id}`, verified: true });
}
console.log(JSON.stringify(report, null, 2));
