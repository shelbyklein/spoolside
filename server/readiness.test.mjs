import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderReadiness} from './readiness.mjs';
import {Library} from './library.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const asset=(id,type,fit={})=>({id,name:id,type,fit,generation:3,status:'Up to date',hasStl:true,hash:'v1'});
const assets=[asset('case','Case',{phone:'iPhone 13'}),asset('top','Faceplate',{style:'Classic',size:'Standard'}),asset('buttons','Part')];
const assembly={id:'classic',type:'Faceplate',name:'Classic',partsConfirmed:true,components:[{assetId:'top',quantity:1},{assetId:'buttons',quantity:4}]};
const order={items:[{name:'PlayCase kit',phone:'iPhone 13',parts:[{name:'Classic Faceplate'}]}]};
const files=[{plates:[{coverage:assets.map(a=>({assetId:a.id,hash:a.hash}))}]}];
test('readiness requires a sliced plate for the case and faceplate pieces; STL version and status do not matter',()=>{
 assert.equal(orderReadiness(order,assets,[assembly],files).status,'ready');
 assert.equal(orderReadiness(order,assets,[assembly],[]).status,'missing');
 assert.equal(orderReadiness(order,assets.map(a=>a.id==='top'?{...a,hash:'v2'}:a),[assembly],files).status,'ready');
 assert.equal(orderReadiness(order,assets.map(a=>a.id==='case'?{...a,status:'Stale',hasStl:false}:a),[assembly],files).status,'ready');
});
test('parts are printed ahead, so they never hold an order back',()=>{
 const noParts=[{plates:[{coverage:assets.filter(a=>a.type!=='Part').map(a=>({assetId:a.id,hash:a.hash}))}]}];
 assert.equal(orderReadiness(order,assets,[assembly],noParts).status,'ready');
 assert.equal(orderReadiness(order,assets.map(a=>a.id==='buttons'?{...a,hash:'v2',status:'Stale'}:a),[assembly],noParts).status,'ready');
 assert.equal(orderReadiness(order,assets,[{...assembly,partsConfirmed:false}],noParts).status,'ready');
 assert.equal(orderReadiness(order,assets,[assembly],noParts).required,2);
});
test('unknown, ambiguous, and additional order lines cannot report ready',()=>{
 assert.equal(orderReadiness({...order,items:[...order.items,{name:'Unknown'}]},assets,[assembly],files).status,'review');
 assert.equal(orderReadiness(order,[...assets,{...assets[0],id:'duplicate'}],[assembly],files).status,'review');
 assert.equal(orderReadiness({items:[{name:'Kit',phone:'iPhone 13'}]},assets,[assembly],files).status,'review');
 assert.equal(orderReadiness({...order,items:[{...order.items[0],phone:'iPhone 13 Pro Max'}]},assets,[assembly],files).status,'review');
 assert.equal(orderReadiness(order,assets,[{...assembly,removed:[{assetId:'missing',quantity:1}]}],files).status,'ready');
});
test('plate coverage validates IDs and persists current hashes without modifying sliced file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coverage-'));
 const db=path.join(dir,'test.sqlite'); let library=new Library(db,dir);
 try {
 const fixture=fs.readFileSync(new URL('./fixtures/plate.gcode.3mf',import.meta.url));
 const [file]=library.add('Print',fixture);const store={get:id=>assets.find(a=>a.id===id)};
 assert.throws(()=>library.setCoverage(file.id,99,['case'],store),/plate/);
 assert.throws(()=>library.setCoverage(file.id,1,['unknown'],store),/STL/);
 assert.throws(()=>library.setCoverage(file.id,1,['case','case'],store),/unique/);
 library.setCoverage(file.id,1,['case'],store);library.close();library=new Library(db,dir);
 assert.deepEqual(library.get(file.id).plates[0].coverage,[{assetId:'case',hash:'v1'}]);
 assert.deepEqual(fs.readFileSync(library.file(file.id)),fixture);
 }finally{library.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('the print plan groups an order into its case and each faceplate, and moves on as pieces are printed', async () => {
 const {orderPrintPlan}=await import('./readiness.mjs');
 const bottom=asset('bottom','Faceplate',{style:'Classic',size:'Standard'});
 const all=[...assets,bottom];
 const two={...assembly,components:[...assembly.components,{assetId:'bottom',quantity:1}]};
 const lib=[{id:'f1',name:'Cases',plates:[{index:1,coverage:[{assetId:'case'}]}]},{id:'f2',name:'Classic top',plates:[{index:3,coverage:[{assetId:'top'}]}]},{id:'f3',name:'Classic bottom',plates:[{index:1,coverage:[{assetId:'bottom'}]}]}];
 let plan=orderPrintPlan(order,all,[two],lib);
 assert.deepEqual(plan.map(g=>g.label),['case','Classic faceplate']);
 assert.deepEqual(plan[1].pieces.map(p=>p.name),['top','bottom'],'parts are left out');
 assert.deepEqual(plan[0].next,{assetId:'case',name:'case',fileId:'f1',fileName:'Cases',plate:1});
 plan=orderPrintPlan(order,all,[two],lib,{case:1,top:1});
 assert.equal(plan[0].done,true);
 assert.equal(plan[0].next,null);
 assert.equal(plan[1].next.assetId,'bottom');
 plan=orderPrintPlan(order,all,[two],lib,{case:1,top:1,bottom:1});
 assert.equal(plan[1].done,true);
 assert.equal(orderPrintPlan(order,all,[two],[])[0].next,null,'no linked plate, nothing to print');
});
