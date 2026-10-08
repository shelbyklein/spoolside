import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printQueue, reservedPieces } from './printqueue.mjs';
const group = (id, linked = true) => ({ key: '0:case', label: 'case', done: false, pieces: [{ assetId: id, name: id, needed: 2, done: 1, plates: linked ? [{}] : [] }], next: linked ? { assetId: id } : null });
const order = (id, n, g) => ({ id, number: '#' + n, commercial: 'processing', printPlan: [g] });
test('queue derives oldest unfinished orders and keeps missing plates visible', () => {
 const g = group('case');
 const rows = printQueue([order('new', 20, g), order('old', 10, group('missing', false)), {...order('done', 2, g), assembled: true}, {...order('hold', 1, g), commercial: 'on-hold'}, order('printed', 3, {...g, done:true})]);
 assert.deepEqual(rows.map(r=>r.orderId), ['old','new']);
 assert.equal(rows[0].blocked, 'No sliced plate linked');
 assert.deepEqual(rows[0].missing, ['missing']);
 assert.equal(rows[1].group.pieces[0].needed - rows[1].group.pieces[0].done, 1);
});
test('active watches and pending sends block duplicate work; unresolved orders remain visible', () => {
 const taken = reservedPieces({inFlight:()=>new Set(['o:case'])}, {pending:new Map([['p',{orderId:'x',assetIds:['top']}]])});
 assert.equal(printQueue([order('o',1,group('case')), order('x',2,group('top'))], taken).every(r=>r.blocked==='Printing / awaiting result'),true);
 assert.equal(printQueue([{id:'review',number:'#3',commercial:'processing',sourceReview:true,printPlan:[]}])[0].blocked, 'Review order requirements');
});

test('order handoffs survive restart and are removed when claimed or cancelled', async () => {
 const {OrderPrints} = await import('./orderprints.mjs');
 const fs = await import('node:fs');
 const os = await import('node:os');
 const path = await import('node:path');
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-handoff-'));
 const file = path.join(dir, 'test.sqlite');
 let prints = new OrderPrints(file);
 try {
  prints.sent('p1', {orderId:'o1',assetIds:['case']});
  prints.close(); prints = new OrderPrints(file);
  assert.equal(reservedPieces(null, prints).has('o1:case'), true);
  assert.deepEqual(prints.claim('p1').assetIds, ['case']);
  prints.sent('p2', {orderId:'o2',assetIds:['top']}); prints.cancel('p2');
  prints.close(); prints = new OrderPrints(file);
  assert.equal(prints.pending.size, 0);
 } finally { prints.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
