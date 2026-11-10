import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MATERIALS,Materials,productOffers,rankedOffers} from './materials.mjs';
const html=nodes=>`<script type="application/ld+json">${JSON.stringify(nodes)}</script>`;
const product=(name,url,price=50,currency='USD',availability='InStock')=>({'@type':'Product',name,offers:{url,price,priceCurrency:currency,availability:'https://schema.org/'+availability}});
test('supplier parser uses net filament weight, filters wrong diameter and sample coils, USD and variant',()=>{
 const nodes={'@graph':[
 {...product('PLA 1.75mm / 500g Spool','https://proto-pasta.com/products/conductive-pla?variant=1'),weight:{value:816},image:['https://proto-pasta.com/cdn/spool.jpg']},
 product('PLA 2.85mm / 500g Spool','https://proto-pasta.com/products/conductive-pla?variant=2'),
 product('PLA 1.75mm / 50g Coil','https://proto-pasta.com/products/conductive-pla?variant=3'),
 product('PLA 1.75mm / 1kg Spool','https://proto-pasta.com/products/conductive-pla?variant=4',90),
 product('PLA 1.75mm / 500g Spool','https://proto-pasta.com/products/conductive-pla?variant=5',50,'EUR'),
 ]};
 const offers=productOffers(html(nodes),MATERIALS[2]);assert.deepEqual(offers.map(o=>o.grams),[500,1000]);
 assert.equal(offers[0].available,true);assert.equal(offers[0].image,'https://proto-pasta.com/cdn/spool.jpg');assert.equal(offers[1].image,null);
 assert.throws(()=>productOffers(html(product('Black 1.75mm / 500 GR','https://recreus.com/en-en/products/filaflex-conductivo?variant=wrong')),MATERIALS[1]),/No USD/);
 assert.throws(()=>productOffers(html(product('PLA 1.75mm / 500g','https://evil.example/')),MATERIALS[2]),/No USD/);
});
test('rank fastest then delivered cost per kg; unknown, unavailable and stale cannot outrank verified stock',()=>{
 const now=Date.parse('2026-10-06T12:00:00Z'),checked=new Date(now).toISOString(),base={checked,source:'live',available:true,grams:500,price:50};
 const offer=(id,arrival,price=50)=>({...base,id,price,quote:{zip:'30360',shipping:10,arrival,checked}});
 const rows=[offer('cheap-slow','2026-10-12',20),offer('fast','2026-10-08'),offer('fast-cheaper','2026-10-08',40),{...base,id:'unknown'},{...offer('no-stock','2026-10-07'),available:false},{...offer('stale','2026-10-07'),checked:'2026-10-01T12:00:00Z'}];
 const ranked=rankedOffers(rows,{zip:'30360',sort:'fastest'},now);
 assert.deepEqual(ranked.slice(0,3).map(o=>o.id),['fast-cheaper','fast','cheap-slow']);assert.equal(ranked[0].deliveredPerKg,100);
 assert.equal(rankedOffers(rows,{zip:'30360',sort:'price'},now)[0].id,'cheap-slow');
 assert.equal(rankedOffers([offer('wrong-zip','2026-10-08')],{zip:'10001',sort:'fastest'},now)[0].arrival,null);
 assert.equal(rankedOffers([offer('past','2026-10-01')],{zip:'30360',sort:'fastest'},now)[0].shipping,null);
});
test('published shipping estimates stay distinct from ZIP quotes',()=>{
 const now=Date.parse('2026-10-06T12:00:00Z'),checked=new Date(now).toISOString();
 const offer={checked,source:'live',available:true,price:50,grams:500,published:{days:7,shipping:38.45}};
 const r=rankedOffers([offer],{zip:'30360',sort:'fastest'},now)[0];assert.equal(r.deliverySource,'US estimate');assert.equal(r.arrival,'2026-10-15');assert.equal(r.delivered,88.45);
});
test('settings, usage, offers and quotes persist; failed supplier refresh retains stale offers',async()=>{
 const db=new DatabaseSync(':memory:');
 let fail=false;
 const fetcher=async url=>{if(fail)return {ok:false,status:503};const source=url.includes('proto-pasta')?MATERIALS[2]:url.includes('bambulab')?MATERIALS[0]:url.includes('recreus.com')?MATERIALS[1]:{url,seller:'3DJake',id:url.includes('protopasta')?MATERIALS[2].id:MATERIALS[1].id};
 const name=source.id==='bambu-tpu-ams'?'TPU for AMS - Black / Filament with spool / 1 kg':'Black 1.75mm / 500g Spool';return {ok:true,text:async()=>html(product(name,url))};};
 try {
 let m=new Materials(db,{fetcher});await m.refresh();assert.equal(m.list().materials.reduce((n,x)=>n+x.offers.length,0),6);
 m.saveSettings({zip:'10001',sort:'price'});m.saveUsage(MATERIALS[0].id,'Membranes');
 m.addOffer({materialId:MATERIALS[2].id,seller:'Local',label:'Black 500g',url:'https://example.com/pla',grams:500,price:45,available:true});
 const manual=m.list().materials[2].offers.find(o=>o.source==='manual');m.quote(manual.id,{shipping:0,arrival:'2099-10-10'});
 m=new Materials(db,{fetcher});assert.equal(m.settings().zip,'10001');assert.equal(m.list().materials[0].usage,'Membranes');assert.equal(m.list().materials[2].offers.find(o=>o.id===manual.id).delivered,45);
 fail=true;await m.refresh();assert.equal(m.list().materials[0].offers[0].stale,true);
 assert.equal(m.list().materials[2].offers.find(o=>o.id===manual.id).stale,false);
 assert.throws(()=>m.saveSettings({zip:'abc'}),/ZIP/);assert.throws(()=>m.quote(manual.id,{shipping:-1}),/shipping/);
 }finally{db.close();}
});
test('Filaflex 70A offers keep each colour, 500 g spools only',()=>{
 const ff=MATERIALS.find(m=>m.id==='recreus-filaflex-70a');assert.equal(ff.usage,'Membranes');
 const nodes={'@type':'ProductGroup',name:'Filaflex 70A',hasVariant:[
  product('Filaflex 70A - Transparent / 1.75 MM / 500 GR','https://recreus.com/en-en/products/filaflex-70a?variant=45921629241603',54.9),
  product('Filaflex 70A - Black / 1.75 MM / 3 KG','https://recreus.com/en-en/products/filaflex-70a?variant=45921629044995',209.9)]};
 const offers=productOffers(html(nodes),ff);
 // Only the 500 g spools Shelby buys; the 3 kg spool is left out.
 assert.deepEqual(offers.map(o=>[o.color,o.grams,o.price]),[['Transparent',500,54.9]]);
});
test('supplies: parts and packaging priced per piece; filament keeps $/kg; settings carry the filament map and packaging',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const m=new Materials(db,{fetcher:async()=>({ok:false,status:503})});
  // Existing filament rows read as filament supplies in grams.
  assert.deepEqual(m.list().supplies.slice(0,4).map(s=>[s.kind,s.unit,s.custom]),[['filament','g',false],['filament','g',false],['filament','g',false],['filament','g',false]]);
  assert.equal(m.filaments().materials.length,4);
  m.addSupply({name:'Magnets, 3 x 2 mm',kind:'part',url:'https://www.amazon.com/dp/B08NZTN426'});
  m.addSupply({name:'Box, 8 x 4 x 1 in',kind:'packaging'});
  assert.throws(()=>m.addSupply({name:'magnets, 3 x 2 mm',kind:'part'}),/already exists/);
  assert.throws(()=>m.addSupply({name:'Tape',kind:'tool'}),/Filament, Parts or Packaging/);
  const mag=m.list().supplies.find(s=>s.name.startsWith('Magnets')),box=m.list().supplies.find(s=>s.kind==='packaging');
  assert.equal(mag.unit,'piece');assert.equal(m.filaments().materials.some(s=>s.id===mag.id),false);
  m.addOffer({supplyId:mag.id,seller:'Amazon',label:'MEALOS 200 pcs',url:'https://www.amazon.com/dp/B08NZTN426',price:8.99,quantity:200,available:true});
  assert.throws(()=>m.addOffer({supplyId:mag.id,seller:'Amazon',label:'x',url:'https://a.example/',price:9,quantity:0,available:true}),/pieces/);
  const o=m.list().supplies.find(s=>s.id===mag.id).offers[0];
  assert.equal(o.unitPrice,8.99/200);assert.equal(o.perKg,undefined);
  const best=m.bestUnitPrice(mag.id);assert.equal(best.price,8.99/200);assert.equal(best.unit,'piece');assert.equal(best.delivered,false);
  m.quote(o.id,{shipping:1,arrival:''});assert.equal(m.bestUnitPrice(mag.id).price,9.99/200);assert.equal(m.bestUnitPrice(mag.id).delivered,true);
  assert.equal(m.bestUnitPrice(box.id),null);
  // A manual filament offer still prices per gram and per kg.
  m.addOffer({materialId:'proto-conductive',seller:'Local',label:'500 g',url:'https://example.com/pla',grams:500,price:45,available:true});
  const f=m.list().supplies.find(s=>s.id==='proto-conductive').offers[0];assert.equal(f.perKg,90);assert.equal(f.unitPrice,0.09);
  // Settings: defaults, saved map and packaging, validation.
  assert.deepEqual(m.settings().filamentMap,{'TPU-AMS':'bambu-tpu-ams',PLA:'proto-conductive'});
  m.saveSettings({filamentMap:{'TPU-AMS':'bambu-tpu-ams',PLA:'proto-conductive',TPU:'recreus-filaflex-70a'},packaging:{small:box.id},pouchesPerOrder:2});
  assert.equal(m.settings().filamentMap.TPU,'recreus-filaflex-70a');assert.equal(m.settings().packaging.small,box.id);assert.equal(m.settings().pouchesPerOrder,2);
  assert.equal(m.settings().zip,'30360');
  assert.throws(()=>m.saveSettings({filamentMap:{PLA:'nope'}}),/supply/);
  assert.throws(()=>m.saveSettings({pouchesPerOrder:-1}),/pouches/);
  // Renaming, removal rules.
  m.updateSupply(mag.id,{name:'Magnets 3x2'});assert.equal(m.list().supplies.find(s=>s.id===mag.id).name,'Magnets 3x2');
  assert.throws(()=>m.updateSupply('bambu-tpu-ams',{name:'x'}),/keep their names/);
  assert.throws(()=>m.removeSupply(mag.id,['Magnet']),/Used by Magnet/);
  assert.throws(()=>m.removeSupply('bambu-tpu-ams'),/can't be removed/);
  m.removeSupply(box.id);assert.equal(m.settings().packaging.small,null);assert.equal(m.list().supplies.some(s=>s.id===box.id),false);
  // Survives a restart.
  const again=new Materials(db,{fetcher:async()=>({ok:false})});assert.equal(again.bestUnitPrice(mag.id).price,9.99/200);
 }finally{db.close();}
});
