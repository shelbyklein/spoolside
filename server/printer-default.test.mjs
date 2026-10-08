import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultPrinter} from './printer-default.mjs';
test('conductive PLA and TPU share their category printer; overrides win and ambiguity needs a choice', () => {
 const categories=[{id:'pla',printer:'conductive'},{id:'tpu',printer:'conductive'},{id:'membrane',printer:'membrane'}];
 const assets=[{id:'paddle',category:'pla'},{id:'pin',category:'tpu'},{id:'mem',category:'membrane'}];
 const file=(ids,printer)=>({printer,plates:[{coverage:ids.map(assetId=>({assetId}))}]});
 assert.equal(defaultPrinter(file(['paddle','pin']),assets,categories).preferredPrinter,'conductive');
 assert.equal(defaultPrinter(file(['mem']),assets,categories).preferredPrinter,'membrane');
 assert.equal(defaultPrinter(file(['pin'],'desk'),assets,categories).preferredPrinter,'desk');
 assert.equal(defaultPrinter(file(['pin','mem']),assets,categories).preferredPrinter,null);
 assert.equal(defaultPrinter(file(['unknown']),assets,categories).preferredPrinter,null);
 assert.equal(defaultPrinter(file([]),assets,categories).preferredPrinter,null);
});
