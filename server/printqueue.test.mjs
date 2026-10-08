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
