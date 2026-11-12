// A whole made-up print farm behind the live address, for specs that need every page to have something on it.
//
//   const { farm, calls } = await mockFarm(page);                       // every endpoint answered
//   await mockFarm(page, { 'GET /api/watches': { vision: true, watches: [], recent: [] } });  // one endpoint replaced
//   await mockFarm(page, { '/api/dispatch/:printer/recheck': ({ farm }) => ({ json: farm.dispatch }) });
//   await mockFarm(page, {}, { now: Date.parse('2026-11-11T15:00:00-05:00') });  // frozen clock, dates from it
//
// Pages open at https://spoolside.shelbyklein.com/<path> (the app only goes live on that host). Requests to it never
// reach the network: /api/* is answered from `farm` (mutable, so a test can change it and reload), every non-GET gets a
// harmless success (recorded in `calls`), and everything else is the local build from `npm run preview`.
// Nothing here is real: printers, orders, names and pictures are invented; images are a 1×1 PNG.
import type { Page, Route } from '@playwright/test';

export const LIVE = 'https://spoolside.shelbyklein.com';
const PREVIEW = 'http://127.0.0.1:4173';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4ee0KAATfAnQI1PPYAAAAAElFTkSuQmCC', 'base64'); // one grey pixel
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><rect x="2" y="2" width="56" height="36" rx="6" fill="none" stroke="#000"/></svg>';

export type Fulfill = { status?: number; json?: unknown; body?: string | Buffer; contentType?: string; headers?: Record<string, string> };
// A full response (status, headers, a non-JSON body). Anything else a handler returns is sent as a JSON body.
export class Reply { constructor(readonly response: Fulfill) {} }
export const reply = (response: Fulfill) => new Reply(response);
export type MockRequest = { url: URL; method: string; params: Record<string, string>; body: any; farm: Farm; route: Route };
// A replacement answer: a JSON body, or a function returning a JSON body or reply(...) (undefined falls through to the farm).
export type Override = ((req: MockRequest) => unknown | Promise<unknown>) | Record<string, unknown> | unknown[] | null;
export type Overrides = Record<string, Override>;
export type Call = { method: string; path: string; body: unknown };

// Ids the app parses from addresses (/library/<asset>, /library/assemblies/<assembly>) are UUID-shaped.
const uuid = (kind: number, n: number) => `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The assembly card's picture is "fresh" when its key matches the parts (src/assemblySnapshot.ts, snapshotKey).
function snapshotKey(parts: { id: string; hash?: string; color?: string; positions?: number[][] }[]) {
  const text = JSON.stringify(parts.map((p) => [p.id, p.hash || '', p.color || '', p.positions || []]));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return 'v3' + (h >>> 0).toString(36) + text.length.toString(36);
}

export function makeFarm(now = Date.now()) {
  const ago = (ms: number) => now - ms;
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
  const day = (ms: number) => new Date(now - ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Printers: one printing, one paused at a pause in its file, one paused by the watcher, two free.
  const tray = (slot: number, color: string, remain = 80, type = 'TPU-AMS', name = 'TPU for AMS') => ({ slot, type, color, name, remain, grams: remain * 10, materialId: type === 'TPU-AMS' ? 'bambu-tpu-ams' : null });
  const emptyTray = (slot: number) => ({ slot, type: '', color: '', name: '', remain: null, grams: null, materialId: null });
  const base = { material: '', seen: iso(5e3), stale: false, connected: true, error: null, pauseReason: null, external: null, feeding: null, layer: null, totalLayers: null, nozzle: 24, bed: 22 };
  const machines = [
    { ...base, id: 'mock-alder', name: 'Alder', state: 'Printing', rawState: 'RUNNING', job: 'spoolside_Handheld Faceplate Top - Ridges (TPU).gcode.3mf', progress: 46, remaining: '1h 12m', nozzle: 221, bed: 35, hasAms: true, feeding: 1, layer: 88, totalLayers: 190, trays: [tray(0, '#E0201B'), tray(1, '#111111'), tray(2, '#2F6FD6'), tray(3, '#F2F2F2', 12)] },
    { ...base, id: 'mock-birch', name: 'Birch', state: 'Paused', rawState: 'PAUSE', job: 'Magnet insert plate.gcode.3mf', progress: 97, remaining: '2 min', nozzle: 219, bed: 35, hasAms: true, feeding: 0, layer: 76, totalLayers: 77, pauseReason: "Paused at layer 76 of 77: a pause in the file, or someone paused it from the screen or a slicer. Resume when it's ready.", trays: [tray(0, '#3BAA35'), emptyTray(1), tray(2, '#F07818', 45), tray(3, '#7E3FB5', 9)] },
    { ...base, id: 'mock-cedar', name: 'Cedar', state: 'Paused', rawState: 'PAUSE', job: 'DS Faceplate Bridge - conductive.gcode.3mf', progress: 31, remaining: '48 min', nozzle: 218, bed: 60, hasAms: true, feeding: 2, layer: 14, totalLayers: 60, pauseReason: 'Paused at layer 14 of 60: paused by Spoolside.', trays: [tray(0, '#111111'), tray(1, '#8A8A8A'), tray(2, '#222222', 60, 'PLA', 'Conductive PLA'), emptyTray(3)] },
    { ...base, id: 'mock-dogwood', name: 'Dogwood', state: 'Ready', rawState: 'IDLE', job: '', progress: 0, remaining: '—', hasAms: true, trays: [tray(0, '#E0201B', 64), tray(1, '#F5D000'), tray(2, '#0F8C8C'), tray(3, '#F06EAA', 30)] },
    { ...base, id: 'mock-elm', name: 'Elm', state: 'Ready', rawState: 'FINISH', job: 'iPhone 15 Pro Max Case (Rounded).gcode.3mf', progress: 100, remaining: '—', hasAms: false, feeding: 254, trays: [], external: { type: 'TPU', color: '#E0201B', name: 'Generic TPU' } },
  ];

  // Assets: every part type, some with long names; thumbnails already drawn so nothing renders in WebGL.
  const categories = [
    { id: 'cat-cases', name: 'Cases', color: '#e0201b', printer: 'mock-dogwood' },
    { id: 'cat-faceplates', name: 'Faceplates', color: '#2f6fd6', printer: null },
    { id: 'cat-parts', name: 'Parts', color: '#5aa9a3', printer: null },
    { id: 'cat-membranes', name: 'Membranes', color: '#f5d000', printer: 'mock-cedar' },
  ];
  type Asset = Record<string, any> & { id: string; name: string; type: string; category?: string; hash: string };
  let n = 0;
  const asset = (type: string, name: string, fit: Record<string, string>, extra: Record<string, unknown> = {}): Asset => {
    n++;
    return { id: uuid(1, n), name, type, generation: 4, status: 'Up to date', note: '', fit: { phone: '', style: '', size: '', piece: '', ...fit }, source: `mock/library/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.stl`, dims: [72.4, 148.1, 11.2], triangles: 48210 + n * 13, bytes: 2_400_000 + n, updated: iso(n * DAY), hash: `mockhash${String(n).padStart(4, '0')}abcdef`, thumb: true, designFile: { id: `d-${n}`, name: `${name}.c4d`, source: `mock/designs/${n}.c4d` }, category: undefined, hasStl: true, ...extra };
  };
  const assets: Asset[] = [
    asset('Case', 'iPhone 15 Case', { phone: 'iPhone 15' }, { category: 'cat-cases' }),
    asset('Case', 'iPhone 15 Pro Case', { phone: 'iPhone 15 Pro' }, { category: 'cat-cases', status: 'Stale', note: 'Camera cut-out is 0.4 mm tight' }),
    asset('Case', 'iPhone 16 Pro Max Case', { phone: 'iPhone 16 Pro Max' }, { category: 'cat-cases' }),
    asset('Case', 'iPhone 16 Pro Max Case (Rounded)', { phone: 'iPhone 16 Pro Max' }, { category: 'cat-cases', designFile: null }),
    asset('Case', 'Galaxy S24 Ultra Case with an extra-long descriptive name for wrapping', { phone: 'Galaxy S24 Ultra' }, { category: 'cat-cases' }),
    asset('Case', 'Pixel 9 Pro XL Case', { phone: 'Pixel 9 Pro XL' }, { category: 'cat-cases' }),
    asset('Faceplate', 'Handheld – Top', { style: 'Handheld', size: 'Standard', piece: 'Top' }, { category: 'cat-faceplates' }),
    asset('Faceplate', 'Handheld – Bottom', { style: 'Handheld', size: 'Standard', piece: 'Bottom' }, { category: 'cat-faceplates' }),
    asset('Faceplate', 'DS – Top', { style: 'DS', size: 'Standard', piece: 'Top' }, { category: 'cat-faceplates', status: 'Stale' }),
    asset('Faceplate', 'DS – Bottom', { style: 'DS', size: 'Standard', piece: 'Bottom' }, { category: 'cat-faceplates' }),
    asset('Faceplate', 'Classic Plus – Top (Ridges)', { style: 'Classic', size: 'Plus', piece: 'Top' }, { category: 'cat-faceplates' }),
    asset('Faceplate', 'Classic Plus – Bottom', { style: 'Classic', size: 'Plus', piece: 'Bottom' }, { category: 'cat-faceplates', designFile: null }),
    asset('Sleeve', 'Handheld Sleeve', { style: 'Handheld', size: 'Standard' }, { category: 'cat-faceplates' }),
    asset('Part', 'AB Button Membrane', { piece: 'AB Button Membrane' }, { category: 'cat-membranes' }),
    asset('Part', 'Four-way directional pad membrane, conductive, second revision', { piece: 'D-pad membrane' }, { category: 'cat-membranes', status: 'Stale' }),
    asset('Part', 'Magnet insert jig', { piece: 'Magnet insert jig' }, { category: 'cat-parts', designFile: null }),
    asset('Purchased', 'Magnets, 3 × 2 mm', { piece: 'Magnets, 3 × 2 mm' }, { hasStl: false, designFile: null, supplyId: 's-magnets', dims: [], triangles: 0 }),
    // Phone references: view-only models, named the long way the library names them.
    asset('Phone', 'iPhone 15', { phone: 'iPhone 15' }, { hasStl: false, designFile: null, thumb: false, dims: [], triangles: 0 }),
    asset('Phone', 'iPhone 15 Pro - phone body (reference)', { phone: 'iPhone 15 Pro', piece: 'Phone body' }, { designFile: null, thumb: false }),
    asset('Phone', 'iPhone 16 Pro Max - phone outline (reference)', { phone: 'iPhone 16 Pro Max', piece: 'Phone body' }, { designFile: null, thumb: false }),
    asset('Phone', 'iPhone 16 / 16 Plus', { phone: 'iPhone 16 / 16 Plus' }, { hasStl: false, designFile: null, thumb: false, dims: [], triangles: 0 }),
    asset('Phone', 'Galaxy S24 Ultra - phone body (reference)', { phone: 'Galaxy S24 Ultra', piece: 'Phone body' }, { designFile: null, thumb: false }),
    asset('Cut template', 'Faceplate decal', { style: 'Cricut', piece: 'Faceplate decal' }, { hasStl: false, designFile: null, dims: [60, 40] }),
  ];
  const A = (name: string) => assets.find((a) => a.name === name)!;
  const colorOf = (a: Asset) => categories.find((c) => c.id === a.category)?.color;

  // Assemblies: cards whose pictures are current, and one whose picture can't be drawn (its STL is missing).
  type Part = { assetId: string; quantity: number; color?: string; positions?: number[][]; hidden?: boolean };
  const assembly = (i: number, name: string, sku: string, type: string, components: Part[], fresh = true) => {
    const parts = components.filter((c) => !c.hidden).map((c) => { const a = assets.find((x) => x.id === c.assetId)!; return { id: a.id, hash: a.hash, color: c.color || colorOf(a), positions: c.positions }; });
    return { id: uuid(2, i), name, sku, type, partsConfirmed: true, components, removed: [], thumbKey: fresh ? snapshotKey(parts) : 'v2-outdated' };
  };
  const assemblies = [
    assembly(1, 'iPhone 15 Handheld PlayCase', 'PC-IP15-HH', 'Case', [{ assetId: A('iPhone 15 Case').id, quantity: 1 }, { assetId: A('Handheld – Top').id, quantity: 1 }, { assetId: A('Handheld – Bottom').id, quantity: 1 }, { assetId: A('AB Button Membrane').id, quantity: 2 }, { assetId: A('Magnets, 3 × 2 mm').id, quantity: 24 }]),
    assembly(2, 'Galaxy S24 Ultra DS PlayCase', 'PC-S24U-DS', 'Case', [{ assetId: A('Galaxy S24 Ultra Case with an extra-long descriptive name for wrapping').id, quantity: 1 }, { assetId: A('DS – Top').id, quantity: 1 }], false),
    assembly(3, 'Handheld faceplate set', 'FP-HH', 'Faceplate', [{ assetId: A('Handheld – Top').id, quantity: 1, color: '#f07818' }, { assetId: A('Handheld – Bottom').id, quantity: 1 }]),
    assembly(4, 'DS faceplate set', '', 'Faceplate', [{ assetId: A('DS – Top').id, quantity: 1 }, { assetId: A('DS – Bottom').id, quantity: 1 }, { assetId: A('Four-way directional pad membrane, conductive, second revision').id, quantity: 1 }]),
    assembly(5, 'Classic Plus faceplate set with ridges', 'FP-CLP-R', 'Faceplate', [{ assetId: A('Classic Plus – Top (Ridges)').id, quantity: 1 }, { assetId: A('Classic Plus – Bottom').id, quantity: 1 }]),
    assembly(6, 'Handheld sleeve', 'SL-HH', 'Sleeve', [{ assetId: A('Handheld Sleeve').id, quantity: 1 }]),
  ];

  // Sliced prints: about a dozen, across part types, some with long names and several plates.
  const filament = (id: number, color: string, type = 'TPU-AMS') => ({ id, type, color, grams: 30 });
  let f = 0;
  const sliced = (name: string, minutes: number, grams: number, covers: string[], extra: Record<string, any> = {}, plates = 1) => {
    f++;
    const cat = covers.length ? categories.find((c) => c.id === A(covers[0]).category) : undefined;
    const printer = extra.printer ?? null;
    const preferred = printer || cat?.printer || null;
    return {
      id: `f-${f}`, name, size: 1_100_000 + f * 7919, created: iso(f * DAY + HOUR), updated: f % 3 ? null : iso(f * HOUR), scope: 'playcase', printer,
      preferredPrinter: preferred, preferredPrinterName: machines.find((m) => m.id === preferred)?.name || null, printerSource: printer ? 'Print override' : preferred ? 'Category default' : null,
      filamentSupplies: {},
      plates: Array.from({ length: plates }, (_, i) => ({ index: i + 1, minutes: minutes + i * 17, grams: grams + i * 3, quantity: extra.quantity ?? null, coverage: covers.map((c) => ({ assetId: A(c).id, hash: A(c).hash })), filaments: extra.filaments || [filament(1, '#E0201B')] })),
      ...extra,
    };
  };
  const library = [
    sliced('iPhone 15 Case', 84, 31, ['iPhone 15 Case']),
    sliced('iPhone 15 Pro Case', 86, 32, ['iPhone 15 Pro Case']),
    sliced('iPhone 16 Pro Max Case (Rounded) - case (TPU) - final fit revision', 97, 36, ['iPhone 16 Pro Max Case (Rounded)'], { printer: 'mock-elm' }),
    sliced('Galaxy S24 Ultra Case', 101, 38, ['Galaxy S24 Ultra Case with an extra-long descriptive name for wrapping']),
    sliced('Handheld Faceplate Top - Ridges (TPU)', 41, 12, ['Handheld – Top']),
    sliced('Handheld Faceplate Bottom', 39, 11, ['Handheld – Bottom']),
    sliced('DS Faceplate Top and Bottom', 63, 19, ['DS – Top', 'DS – Bottom'], { filaments: [filament(1, '#2F6FD6'), filament(2, '#111111')] }),
    sliced('Classic Plus Faceplate - two plates', 52, 16, ['Classic Plus – Top (Ridges)', 'Classic Plus – Bottom'], {}, 2),
    sliced('Handheld Sleeve', 33, 9, ['Handheld Sleeve']),
    sliced('AB Button Membrane x24', 18, 4, ['AB Button Membrane'], { quantity: 24, filaments: [filament(1, '#F5D000')] }),
    sliced('Magnet insert jig', 22, 7, ['Magnet insert jig'], { filaments: [filament(1, '#F2F2F2', 'PLA')] }),
    sliced('Calibration cube', 12, 3, [], { filaments: [filament(1, '#8A8A8A', 'PLA')] }),
    sliced('Desk cable clip x8', 46, 14, [], { scope: 'personal', filaments: [filament(1, '#111111', 'PETG')] }),
    sliced('Spool holder arm', 71, 40, [], { scope: 'personal', filaments: [filament(1, '#F2F2F2', 'PLA')] }),
  ];
  const L = (name: string) => library.find((x) => x.name === name)!;

  // Orders: ready to print, missing a file, under review, printed, printing, on hold, a two-item order, and a shipped one.
  type Group = { key: string; label: string; kind?: 'item'; done: boolean; activity?: string; pieces: { assetId: string; name: string; needed: number; done: number; plates: { fileId: string; fileName: string; plate: number }[] }[]; next: { assetId: string; name: string; fileId: string; fileName: string; plate: number } | null };
  const piece = (assetName: string, file: string | null, needed = 1, done = 0) => ({ assetId: A(assetName).id, name: assetName, needed, done, plates: file ? [{ fileId: L(file).id, fileName: file, plate: 1 }] : [] });
  const group = (key: string, label: string, pieces: Group['pieces'], activity?: string): Group => {
    const todo = pieces.find((p) => p.done < p.needed && p.plates.length);
    return { key, label, done: pieces.every((p) => p.done >= p.needed), pieces, ...(activity ? { activity } : {}), next: todo ? { assetId: todo.assetId, name: todo.name, fileId: todo.plates[0].fileId, fileName: todo.plates[0].fileName, plate: 1 } : null };
  };
  const img = (name: string) => `https://playcase.gg/mock-images/${name}.png`;
  const item = (phone: string, colorway: string, style: string, quantity = 1, id = 'i1') => ({ id, name: 'PlayCase', variant: `${phone} / ${colorway} / ${style}`, quantity, recipe: [], phone, colorway, image: img(`case-${colorway.toLowerCase()}`), parts: [{ name: `${style} Faceplate`, image: img(`faceplate-${style.toLowerCase()}`) }] });
  const order = (num: number, daysAgo: number, items: ReturnType<typeof item>[], plan: Group[], readiness: { status: 'ready' | 'missing' | 'review'; reasons: string[]; required: number } | null, extra: Record<string, unknown> = {}) => ({
    id: `o-${num}`, number: `#${num}`, placed: day(daysAgo * DAY), commercial: 'processing', refundReview: false, sourceReview: false, items, assembled: false, packed: false, tracking: '', shipped: false, note: '', printPlan: plan, ...(readiness ? { printReadiness: readiness } : {}), ...extra,
  });
  const p5101 = [group('0:case', 'case', [piece('iPhone 15 Case', 'iPhone 15 Case')]), group('0:handheld', 'Handheld faceplate', [piece('Handheld – Top', 'Handheld Faceplate Top - Ridges (TPU)'), piece('Handheld – Bottom', 'Handheld Faceplate Bottom')])];
  const p5102 = [group('0:case', 'case', [piece('iPhone 16 Pro Max Case', null)])];
  const p5104 = [group('0:case', 'case', [piece('iPhone 15 Pro Case', 'iPhone 15 Pro Case', 1, 1)]), group('0:ds', 'DS faceplate', [piece('DS – Top', 'DS Faceplate Top and Bottom', 1, 1), piece('DS – Bottom', 'DS Faceplate Top and Bottom', 1, 1)])];
  const p5105 = [group('0:case', 'case', [piece('iPhone 15 Pro Case', 'iPhone 15 Pro Case')], 'Printing now'), group('0:ds', 'DS faceplate', [piece('DS – Top', 'DS Faceplate Top and Bottom'), piece('DS – Bottom', 'DS Faceplate Top and Bottom')])];
  const p5106 = [group('0:case', 'case', [piece('Pixel 9 Pro XL Case', null)])];
  const p5107 = [{ key: '1:item', label: 'Replacement Parts - Classic', kind: 'item' as const, done: false, pieces: [{ assetId: 'item:i2', name: 'Replacement Parts - Classic', needed: 1, done: 0, plates: [] }], next: null }, group('0:case', 'case', [piece('iPhone 16 Pro Max Case (Rounded)', 'iPhone 16 Pro Max Case (Rounded) - case (TPU) - final fit revision', 2, 1)]), group('1:classic', 'Classic faceplate', [piece('Classic Plus – Top (Ridges)', 'Classic Plus Faceplate - two plates'), piece('Classic Plus – Bottom', 'Classic Plus Faceplate - two plates')])];
  const orders = [
    order(5101, 9, [item('iPhone 15', 'Red', 'Handheld')], p5101, { status: 'ready', reasons: [], required: 3 }),
    order(5102, 8, [item('iPhone 16 Pro Max', 'Black', 'DS')], p5102, { status: 'missing', reasons: ['No sliced plate for iPhone 16 Pro Max Case'], required: 1 }, { note: 'Gift wrap if possible' }),
    order(5103, 7, [item('Galaxy S24 Ultra', 'Blue', 'Classic')], [], { status: 'review', reasons: ['No assembly matches Galaxy S24 Ultra with a Classic faceplate'], required: 0 }),
    order(5104, 6, [item('iPhone 15 Pro', 'Green', 'DS')], p5104, { status: 'ready', reasons: [], required: 3 }),
    order(5105, 5, [item('iPhone 15 Pro', 'Purple', 'DS')], p5105, { status: 'ready', reasons: [], required: 3 }),
    order(5106, 4, [item('Pixel 9 Pro XL', 'Orange', 'Handheld')], p5106, { status: 'missing', reasons: ['No sliced plate for Pixel 9 Pro XL Case'], required: 1 }, { commercial: 'on-hold' }),
    order(5107, 2, [item('iPhone 16 Pro Max', 'Teal', 'Classic Plus', 2), { ...item('iPhone 16 Pro Max', 'Teal', 'Classic Plus'), id: 'i2', name: 'Replacement Parts - Classic', variant: 'No variant details', phone: '', colorway: '', image: undefined as unknown as string, parts: [] }], p5107, { status: 'ready', reasons: [], required: 4 }),
    order(5108, 12, [item('iPhone 12', 'Yellow', 'Handheld')], [], null, { commercial: 'completed', shipped: true, tracking: '9400 0000 0000 0000 0000 00' }),
  ];
  const q = (orderId: string, g: Group | null, blocked: string | null = null, missing: string[] = []) => ({ orderId, group: g, blocked, missing });
  const printQueue = [
    q('o-5101', p5101[0]), q('o-5101', p5101[1]),
    q('o-5102', p5102[0], 'No sliced plate linked', ['iPhone 16 Pro Max Case']),
    q('o-5103', null, 'Review order requirements'),
    q('o-5105', p5105[0], 'Printing now'), q('o-5105', p5105[1]),
    q('o-5107', p5107[1]), q('o-5107', p5107[2]),
  ];
  const workspace = { revision: 7, orders, jobs: [], spools: [], machines, printQueue, lastSync: iso(4 * MIN), syncError: null };

  const dispatch = {
    auto: false, vision: true,
    held: [{ printer: 'mock-dogwood', printerName: 'Dogwood', reason: 'A green printed part is sitting on the build plate.' }],
    offers: [{ id: 'mock-elm:o-5101:0:case', printer: 'mock-elm', printerName: 'Elm', orderId: 'o-5101', orderNumber: '#5101', group: '0:case', groupLabel: 'case', pieceName: 'iPhone 15 Case', colorway: 'Red', slot: 0, autoBlocked: 'Bed check: the visible plate looks clear, but its front edge is out of frame.' }],
    warnings: [{ id: 'w1', printer: 'mock-alder', printerName: 'Alder', job: 'Handheld Faceplate Top', reason: 'A small disc is near the back of the plate.', at: ago(6 * MIN) }],
    available: [{ orderId: 'o-5101', printer: 'mock-elm', printerName: 'Elm' }],
  };

  const watch = (n: number, w: Record<string, unknown>) => ({ id: uuid(3, n), external: false, inLibrary: true, importDismissed: false, outcome: null, note: null, mode: 'pause', plan: true, check: null, alert: null, ended: null, endedAs: null, ...w });
  const watches = {
    vision: true,
    watches: [
      watch(1, { printer: 'mock-alder', printerName: 'Alder', job: 'spoolside_Handheld Faceplate Top - Ridges (TPU).gcode.3mf', started: ago(50 * MIN), check: { at: ago(2 * MIN), verdict: 'ok', reason: 'Looks good.', file: '1.jpg', reference: true } }),
      watch(2, { printer: 'mock-cedar', printerName: 'Cedar', job: 'DS Faceplate Bridge - conductive.gcode.3mf', started: ago(25 * MIN), check: { at: ago(3 * MIN), verdict: 'problem', reason: 'Strands of filament around the second piece.', file: '2.jpg' }, alert: { at: ago(3 * MIN), reason: 'Strands of filament around the second piece.', file: '2.jpg', paused: true } }),
      watch(3, { printer: 'mock-elm', printerName: 'Elm', job: 'iPhone 15 Pro Max Case (Rounded).gcode.3mf', started: ago(3 * HOUR), ended: ago(20 * MIN), endedAs: 'finished', check: { at: ago(21 * MIN), verdict: 'ok', file: '3.jpg', final: '4.jpg' } }),
      watch(4, { printer: 'mock-dogwood', printerName: 'Dogwood', job: 'Membrane test strip - longer experimental name.gcode.3mf', started: ago(5 * HOUR), ended: ago(2 * HOUR), endedAs: 'stopped', inLibrary: false, external: true }),
    ],
    recent: [
      watch(5, { printer: 'mock-elm', printerName: 'Elm', job: 'Phone stand v2.gcode.3mf', started: ago(27 * HOUR), ended: ago(26 * HOUR), endedAs: 'finished', outcome: 'success', inLibrary: false, external: true, plan: false }),
      watch(6, { printer: 'mock-elm', printerName: 'Elm', job: 'iPhone 15 Case.gcode.3mf', started: ago(30 * HOUR), ended: ago(29 * HOUR), endedAs: 'finished', outcome: 'failed', note: 'Corner lifted on the left side.', plan: false }),
      watch(7, { printer: 'mock-alder', printerName: 'Alder', job: 'Handheld Faceplate Bottom.gcode.3mf', started: ago(4 * DAY), ended: ago(4 * DAY - HOUR), endedAs: 'finished', outcome: 'success', plan: false }),
    ],
  };

  const bedSettings: Record<string, { visibleOnly: boolean; allow: { id: string; text: string; at: number }[]; reference: { note: string; taught: number; area: boolean } | null }> = {
    'mock-dogwood': { visibleOnly: true, allow: [{ id: 'n1', text: 'The white tape on the right edge', at: ago(9 * DAY) }], reference: { note: 'The white circle beside the bed is a fixture.', taught: ago(5 * DAY), area: true } },
    'mock-elm': { visibleOnly: false, allow: [], reference: { note: '', taught: ago(12 * DAY), area: false } },
  };

  const plate = (minutes: number, grams: number, color: string, type = 'TPU-AMS') => ({ index: 1, minutes, grams, filaments: [{ id: 1, type, color }] });
  const lastPrint: Record<string, { name: string; plates: ReturnType<typeof plate>[] } | null> = {
    'mock-dogwood': { name: 'Membrane test strip', plates: [plate(18, 4, '#F5D000')] },
    'mock-elm': { name: 'iPhone 15 Pro Max Case (Rounded)', plates: [plate(97, 36, '#E0201B', 'TPU')] },
  };
  const repeats = [{ printer: 'mock-alder', name: 'Handheld Faceplate Top - Ridges (TPU)', plate: 1, done: 2, times: 5, status: 'Printing 3 of 5' }];

  const inventoryColors = ['Red', 'Black', 'Blue', 'Green', 'Grey', 'White', 'Orange', 'Purple', 'Pink', 'Yellow', 'Teal'];
  const counts = (seed: number) => Object.fromEntries(inventoryColors.flatMap((c, i) => ((seed + i) % 3 ? [[c, (seed * 7 + i * 3) % 9]] : [])).filter(([, v]) => v));
  const caseNames = ['iPhone 12', 'iPhone 13 mini', 'iPhone 14 Plus', 'iPhone 15', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16 Pro Max (Rounded)', 'Galaxy S24', 'Galaxy S24 Ultra', 'Pixel 9 Pro', 'Pixel 9 Pro XL'];
  const faceNames = ['Handheld', 'Handheld Plus', 'DS', 'DS Plus', 'Classic', 'Classic Plus (Ridges)', '3DS', 'N64'];
  const inventory = {
    colors: inventoryColors,
    items: [
      ...caseNames.map((name, i) => ({ kind: 'case', id: `case-${i}`, name: `${name} Case`, counts: counts(i), ...(i === 0 ? { hidden: true } : {}) })),
      ...faceNames.map((name, i) => ({ kind: 'faceplate', id: `face-${i}`, name: `${name} faceplate`, counts: counts(i + 20) })),
    ],
    updated: ago(2 * DAY),
  };

  const offer = (id: string, seller: string, label: string, price: number, quantity: number, extra: Record<string, unknown> = {}) => ({ id, seller, label, url: `https://example.com/${id}`, price, quantity, available: true, source: 'manual', checked: iso(3 * DAY), stale: false, unitPrice: price / quantity, deliveredUnitPrice: null, shipping: null, ...extra });
  const supplies = {
    supplies: [
      { id: 's-tpu', name: 'Bambu TPU for AMS', kind: 'filament', unit: 'g', usage: 'Cases and faceplates', custom: false, offers: [] },
      { id: 's-pla', name: 'Conductive PLA', kind: 'filament', unit: 'g', usage: 'Touch pins', custom: false, offers: [] },
      { id: 's-magnets', name: 'Magnets, 3 × 2 mm', kind: 'part', unit: 'piece', usage: '24 per case, 12 per faceplate top', url: 'https://example.com/magnets', custom: true, offers: [offer('so-1', 'Mock Supply Co.', '200 pcs, 3 mm × 2 mm, N52', 11.99, 200), offer('so-2', 'Another Seller', '500 pcs, 3 mm × 2 mm', 24.5, 500, { available: null, stale: true, deliveredUnitPrice: 0.055, shipping: 3 })] },
      { id: 's-bands', name: 'Rubber bands', kind: 'part', unit: 'piece', usage: '', custom: true, offers: [] },
      { id: 's-box-small', name: 'Box, 8 × 4 × 1″', kind: 'packaging', unit: 'piece', usage: 'Orders with a case only', custom: true, offers: [offer('so-3', 'Mock Packaging', '50 boxes, kraft', 21, 50)] },
      { id: 's-box-large', name: 'Box, 9 × 6 × 2″', kind: 'packaging', unit: 'piece', usage: 'Everything else', custom: true, offers: [offer('so-4', 'Mock Packaging', '25 boxes, white', 18.75, 25, { available: false })] },
      { id: 's-pouch', name: 'Bubble pouch', kind: 'packaging', unit: 'piece', usage: '', custom: true, offers: [] },
    ],
    settings: { zip: '12345', sort: 'fastest', filamentMap: { 'TPU-AMS': 's-tpu', TPU: 's-tpu', PLA: 's-pla' }, packaging: { small: 's-box-small', large: 's-box-large', pouch: 's-pouch' }, pouchesPerOrder: 2 },
  };
  const arrival = new Date(now + 5 * DAY).toISOString().slice(0, 10);
  const spoolOffer = (id: string, materialId: string, seller: string, label: string, price: number, extra: Record<string, unknown> = {}) => ({ id, materialId, seller, label, color: 'Black', url: `https://example.com/${id}`, grams: 1000, price, available: true, refill: false, source: 'auto', checked: iso(DAY), stale: false, arrival: null, shipping: null, delivered: null, perKg: price, deliveredPerKg: null, image: null, ...extra });
  const materials = {
    materials: [
      { id: 'bambu-tpu-ams', name: 'Bambu TPU for AMS', usage: 'Cases and faceplates', url: 'https://example.com/tpu', lastChecked: iso(DAY), offers: [
        spoolOffer('mo-1', 'bambu-tpu-ams', 'Mock Filament Store', 'Bambu TPU for AMS - Black, 1 kg spool', 41.99, { arrival, shipping: 0, delivered: 41.99, deliveredPerKg: 41.99, deliverySource: 'quote' }),
        spoolOffer('mo-2', 'bambu-tpu-ams', 'Marketplace Seller', 'Bambu TPU for AMS - Red, 1 kg spool', 39.5, { color: 'Red', available: null }),
        spoolOffer('mo-3', 'bambu-tpu-ams', 'Hand-entered Shop', 'Bambu TPU for AMS - Blue, 1 kg spool', 44, { color: 'Blue', source: 'manual', stale: true }),
      ] },
      { id: 'recreus-conductive', name: 'Recreus Conductive Filaflex', usage: 'Touch pins', url: 'https://example.com/conductive', lastChecked: iso(2 * DAY), error: 'The supplier page did not answer.', offers: [
        spoolOffer('mo-4', 'recreus-conductive', 'Mock Filament Store', 'Conductive Filaflex 500 g', 38, { grams: 500, perKg: 76, arrival, shipping: 6.5, delivered: 44.5, deliveredPerKg: 89, deliverySource: 'US estimate' }),
      ] },
    ],
    settings: { zip: '12345', sort: 'fastest' },
  };

  const notes = [
    { id: 'note-1', text: 'Send a replacement d-pad membrane with the next order', order: '#5102', created: ago(3 * HOUR), updated: ago(3 * HOUR) },
    { id: 'note-2', text: 'Follow up about the yellow case colour', order: null, created: ago(2 * DAY), updated: ago(2 * DAY) },
  ];
  const projects = [
    { id: 'proj-1', name: 'Desk cable clips', note: 'Clips for the bench cables. Print in PETG.', files: [{ id: 'pf-1', name: 'cable-clip.stl', size: 241_000, kind: 'STL' }, { id: 'pf-2', name: 'cable-clip x8.3mf', size: 1_820_000, kind: 'Sliced 3MF' }], prints: [L('Desk cable clip x8')] },
    { id: 'proj-2', name: 'Spool holder with a longer project name that should wrap onto two lines', note: '', files: [{ id: 'pf-3', name: 'spool-holder-arm.step', size: 3_400_000, kind: '3D model' }], prints: [L('Spool holder arm')] },
    { id: 'proj-3', name: 'Planter', note: 'Gift for a neighbour', files: [], prints: [] },
  ];
  const chat = { available: true, reason: null, running: false, partial: '', limit: null, items: [] as unknown[] };
  const designfiles = assets.filter((a) => a.designFile).map((a) => a.designFile);
  const costs = {
    orders: Object.fromEntries(orders.map((o, i) => [o.id, { total: 3.1 + i * 0.37, complete: i % 3 !== 1 }])),
    assemblies: Object.fromEntries(assemblies.map((a, i) => [a.id, { total: 1.2 + i * 0.41, complete: i !== 1 }])),
  };
  return { now, machines, workspace, dispatch, watches, bedSettings, lastPrint, repeats, assets, categories, assemblies, library, inventory, supplies, materials, notes, projects, chat, designfiles, costs };
}
export type Farm = ReturnType<typeof makeFarm>;

// The GET answers, by path. `:name` matches one path segment.
function getRoutes(farm: Farm): [string, (r: MockRequest) => unknown][] {
  const orderCost = (id: string) => ({ total: farm.costs.orders[id]?.total ?? 0, complete: farm.costs.orders[id]?.complete ?? true, missing: farm.costs.orders[id]?.complete === false ? ['Rubber bands: no price yet'] : [], lines: [{ label: 'Case', quantity: 1, unit: 1.62, cost: 1.62, complete: true }, { label: 'Faceplate', quantity: 1, unit: 0.84, cost: 0.84, complete: true }, { label: 'Packaging', quantity: 1, cost: 0.64, complete: true }] });
  return [
    ['/api/status', () => ({ mode: 'live', host: 'beelink', orders: { source: 'https://playcase.gg', connected: true, lastSync: farm.workspace.lastSync, error: null }, printers: { connected: farm.machines.length, total: farm.machines.length } })],
    ['/api/workspace', () => farm.workspace],
    ['/api/dispatch', () => farm.dispatch],
    ['/api/dispatch/:printer/bed-settings', ({ params }) => farm.bedSettings[params.printer] || { visibleOnly: true, allow: [], reference: null }],
    ['/api/watches', () => farm.watches],
    ['/api/repeats', () => farm.repeats],
    ['/api/printers/:id/last-print', ({ params }) => reply({ body: JSON.stringify(farm.lastPrint[params.id] ?? null), contentType: 'application/json' })],
    ['/api/library', ({ url }) => farm.library.filter((x) => !url.searchParams.get('scope') || x.scope === url.searchParams.get('scope'))],
    ['/api/library/:id/metadata', () => ({ settings: { printer_model: 'Bambu Lab A1 mini', printer_settings_id: 'Bambu Lab A1 mini 0.4 nozzle', nozzle_diameter: ['0.4'], curr_bed_type: 'Textured PEI Plate', layer_height: '0.2', filament_settings_id: ['Bambu TPU for AMS'] } })],
    ['/api/library/:id/plates/:plate/toolpath', () => reply({ status: 404, json: { error: 'No toolpath in this mock' } })],
    ['/api/assets', () => farm.assets],
    ['/api/assets/:id/stl', () => reply({ status: 404, json: { error: 'No STL in this mock' } })],
    ['/api/assets/:id/svg', () => reply({ body: SVG, contentType: 'image/svg+xml' })],
    ['/api/assets/:id/usdz', () => reply({ status: 404, json: { error: 'No USDZ in this mock' } })],
    ['/api/categories', () => farm.categories],
    ['/api/designfiles', () => farm.designfiles],
    ['/api/assemblies', () => farm.assemblies],
    ['/api/assemblies/:id/cost', ({ params }) => { const a = farm.assemblies.find((x) => x.id === params.id); return { total: farm.costs.assemblies[params.id]?.total ?? 0, complete: true, estimated: false, missing: [], parts: (a?.components || []).map((c) => { const asset = farm.assets.find((x) => x.id === c.assetId); return asset?.type === 'Purchased' ? { assetId: c.assetId, name: asset.name, quantity: c.quantity, kind: 'bought', unitCost: 0.06, cost: 0.06 * c.quantity, supply: 'Mock Supply Co.', delivered: false } : { assetId: c.assetId, name: asset?.name || 'Missing asset', quantity: c.quantity, kind: 'printed', cost: 0.62 * c.quantity, grams: 14, uses: [{ supply: 'Bambu TPU for AMS', grams: 14, perGram: 0.0442 }] }; }) }; }],
    ['/api/costs/assemblies', () => farm.costs.assemblies],
    ['/api/costs/orders', () => farm.costs.orders],
    ['/api/orders/:id/cost', ({ params }) => orderCost(params.id)],
    ['/api/inventory', () => farm.inventory],
    ['/api/supplies', () => farm.supplies],
    ['/api/materials', () => farm.materials],
    ['/api/notes', () => farm.notes],
    ['/api/projects', () => farm.projects],
    ['/api/chat', () => farm.chat],
    ['/api/notifications', () => ({ enabled: true, publicKey: 'BMockPublicKeyForTestsOnly', device: null })],
  ];
}

// What a non-GET answers: the state it would return, unchanged (nothing is saved), or `{ ok: true }`.
function writeRoutes(farm: Farm): [string, (r: MockRequest) => unknown][] {
  return [
    ['/api/workspace', () => farm.workspace],
    ['/api/sync', () => farm.workspace],
    ['/api/dispatch/:printer/reference/capture', () => ({ id: 'mock-capture', at: farm.now, area: null })],
    ['/api/dispatch/:printer/reference', () => ({ ok: true })],
    ['/api/dispatch/:printer/bed-settings', ({ params }) => farm.bedSettings[params.printer] || { visibleOnly: true, allow: [], reference: null }],
    ['/api/dispatch/:printer/bed-allow', ({ params }) => farm.bedSettings[params.printer] || { visibleOnly: true, allow: [], reference: null }],
    ['/api/dispatch/:printer/bed-allow/:id', ({ params }) => farm.bedSettings[params.printer] || { visibleOnly: true, allow: [], reference: null }],
    ['/api/dispatch/:printer/bed-warning', () => farm.dispatch],
    ['/api/dispatch/:printer/:action', () => farm.dispatch],
    ['/api/dispatch/auto', () => farm.dispatch],
    ['/api/inventory', () => farm.inventory],
    ['/api/inventory/:what', () => farm.inventory],
    ['/api/supplies', () => farm.supplies],
    ['/api/supplies/:id', () => farm.supplies],
    ['/api/supply-offers', () => farm.supplies],
    ['/api/supply-offers/:id', () => farm.supplies],
    ['/api/materials/:what', () => farm.materials],
    ['/api/material-offers', () => farm.materials],
    ['/api/material-offers/:id', () => farm.materials],
    ['/api/notes', () => farm.notes],
    ['/api/notes/:id', () => farm.notes],
    ['/api/chat', () => farm.chat],
    ['/api/chat/stop', () => farm.chat],
    ['/api/categories', ({ body }) => ({ id: 'cat-new', color: '#5aa9a3', printer: null, ...body })],
    ['/api/categories/:id', ({ params, body }) => ({ ...farm.categories.find((c) => c.id === params.id), ...body })],
    ['/api/assets/:id', ({ params, body }) => ({ ...farm.assets.find((a) => a.id === params.id), ...body })],
    ['/api/assets/:id/design', ({ params }) => farm.assets.find((a) => a.id === params.id) || {}],
    ['/api/assemblies/:id', ({ params, body }) => ({ ...farm.assemblies.find((a) => a.id === params.id), ...body })],
    ['/api/assembly-order', () => farm.assemblies],
    ['/api/library', () => []],
    ['/api/library/:id', ({ params }) => farm.library.find((x) => x.id === params.id) || {}],
    ['/api/projects', ({ body }) => ({ ...farm.projects[0], ...body })],
    ['/api/projects/:id', ({ params, body }) => ({ ...farm.projects.find((p) => p.id === params.id), ...body })],
    ['/api/printers/:id/repeat', () => farm.repeats],
    ['/api/notifications', () => ({ id: 'mock-device' })],
  ];
}

const compile = (pattern: string) => new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, '/(?<$1>[^/]+)') + '$');
const match = (table: [string, (r: MockRequest) => unknown][], path: string) => {
  for (const [pattern, fn] of table) {
    const m = compile(pattern).exec(path);
    if (m) return { fn, params: { ...m.groups } as Record<string, string> };
  }
  return null;
};
const toFulfill = (v: unknown): Fulfill => (v instanceof Reply ? v.response : { json: v });

// The built app's files, kept per worker: routing turns the browser cache off, and every page loads the same bundle.
const assetCache = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();

export async function mockFarm(page: Page, overrides: Overrides = {}, options: { now?: number } = {}) {
  const farm = makeFarm(options.now);
  const calls: Call[] = [];
  if (options.now !== undefined) await page.clock.setFixedTime(options.now);
  // Push setup waits on a service worker, which specs block; answer as a browser with no subscription yet.
  await page.addInitScript(() => {
    if (!('serviceWorker' in navigator)) return;
    const registration = { pushManager: { getSubscription: async () => null, subscribe: async () => ({ endpoint: 'https://push.invalid/mock', toJSON: () => ({ endpoint: 'https://push.invalid/mock', keys: {} }) }) } };
    Object.defineProperty(navigator.serviceWorker, 'ready', { configurable: true, get: () => Promise.resolve(registration) });
  });
  const custom = Object.entries(overrides).map(([key, value]) => {
    const [method, pattern] = key.includes(' ') ? key.split(' ') : ['*', key];
    return { method: method.toUpperCase(), re: compile(pattern), value };
  });
  const gets = getRoutes(farm), writes = writeRoutes(farm);
  const fulfill = (route: Route, r: Fulfill) => {
    if (r.json !== undefined) return route.fulfill({ status: r.status ?? 200, body: JSON.stringify(r.json), contentType: 'application/json', headers: r.headers });
    return route.fulfill({ status: r.status ?? 200, body: r.body ?? '', contentType: r.contentType, headers: r.headers });
  };
  await page.route(LIVE + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url()), method = request.method(), path = url.pathname;
    let body: unknown = null;
    if (method !== 'GET' && method !== 'HEAD') { try { body = request.postDataJSON(); } catch { body = request.postData(); } }
    for (const c of custom) {
      const m = c.re.exec(path);
      if (!m || (c.method !== '*' && c.method !== method)) continue;
      const answer = typeof c.value === 'function' ? await c.value({ url, method, params: { ...m.groups }, body, farm, route }) : c.value;
      if (answer === undefined) continue;
      if (method !== 'GET') calls.push({ method, path: path + url.search, body });
      return fulfill(route, toFulfill(answer));
    }
    if (path.startsWith('/api/')) {
      if (method !== 'GET') {
        calls.push({ method, path: path + url.search, body });
        const hit = match(writes, path);
        return fulfill(route, toFulfill(hit ? hit.fn({ url, method, params: hit.params, body, farm, route }) : { ok: true }));
      }
      const hit = match(gets, path);
      if (hit) return fulfill(route, toFulfill(hit.fn({ url, method, params: hit.params, body, farm, route })));
      // Camera frames, bed photos, slicer previews, thumbnails, watcher photos: a 1×1 picture.
      if (/\.(jpg|jpeg|png)$/i.test(path) || /\/thumb$/.test(path)) return route.fulfill({ status: 200, body: PNG, contentType: 'image/png', headers: { 'Cache-Control': 'no-store' } });
      return route.fulfill({ status: 404, json: { error: `No mock for GET ${path}` } });
    }
    if (method !== 'GET') { calls.push({ method, path, body }); return route.fulfill({ status: 200, json: { ok: true } }); }
    const key = path + url.search;
    let cached = assetCache.get(key);
    // A test that moves on (navigation, closing the page) cancels files still on their way; that's not a failure.
    try {
      if (!cached) {
        const response = await route.fetch({ url: PREVIEW + key });
        const headers = Object.fromEntries(Object.entries(response.headers()).filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
        cached = { status: response.status(), headers, body: await response.body() };
        // The page shell is small and may change between builds; only hashed bundles are worth keeping.
        if (path.startsWith('/assets/')) assetCache.set(key, cached);
      }
      return await route.fulfill({ status: cached.status, headers: cached.headers, body: cached.body });
    } catch (e) {
      if (/disposed|closed|Target page|Route is already handled/i.test(String(e))) return;
      throw e;
    }
  });
  // Order photos come from the store's site.
  await page.route('https://playcase.gg/**', (route) => (/\.(png|jpe?g|webp)$/i.test(new URL(route.request().url()).pathname) ? route.fulfill({ status: 200, body: PNG, contentType: 'image/png' }) : route.fulfill({ status: 404, body: '' })));
  return { farm, calls };
}
