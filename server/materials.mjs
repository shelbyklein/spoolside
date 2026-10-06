import {randomUUID} from 'node:crypto';
const SIX_HOURS=6*60*60*1000;
export const MATERIALS=[
 {id:'bambu-tpu-ams',name:'Bambu TPU for AMS',usage:'',url:'https://us.store.bambulab.com/products/tpu-for-ams',seller:'Bambu Lab'},
 {id:'recreus-conductive',name:'Recreus Conductive Filaflex',usage:'Touch pins',url:'https://recreus.com/en-en/products/filaflex-conductivo?variant=45921625833731',seller:'Recreus'},
 {id:'proto-conductive',name:'Proto-pasta Conductive PLA',usage:'Other parts',url:'https://proto-pasta.com/products/conductive-pla',seller:'Proto-pasta'},
];
const SOURCES=[...MATERIALS,
 {...MATERIALS[1],url:'https://www.3djake.com/recreus/conductive-filaflex-black?sai=11093',seller:'3DJake'},
 {...MATERIALS[2],url:'https://www.3djake.com/protopasta/electrically-conductive-composite-pla?sai=17573',seller:'3DJake'},
];
const text=(v,n=200)=>String(v||'').trim().slice(0,n);
const money=v=>v===null||v===undefined||v===''?null:Number(v);
const weight=name=>{const m=name.match(/(\d+(?:\.\d+)?)\s*(kg|gr|g)\b/i);return m ? Number(m[1])*(m[2].toLowerCase()==='kg'?1000:1) : null;};
export function productOffers(html,material,checked=new Date().toISOString()) {
 const nodes=[];
 const visit=j=>{if(Array.isArray(j))return j.forEach(visit);if(!j||typeof j!=='object')return;nodes.push(j);if(j['@graph'])visit(j['@graph']);if(j.hasVariant)visit(j.hasVariant);};
 for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{}
 const results=new Map();
 for(const node of nodes) {
  if(!['Product','ProductGroup'].includes(node['@type']))continue;
  for(const offer of (Array.isArray(node.offers)?node.offers:node.offers?[node.offers]:[])) {
   const label=(offer.name||node.name||'').replace(/1,75/g,'1.75');
   if(/2\.85\s*mm|50\s*g\b|coil/i.test(label))continue;
   if(material.id!=='bambu-tpu-ams'&&!/1\.75\s*mm/i.test(label))continue;
   const grams=weight(label);
   if(!grams || grams<100 || grams>10000)continue;
   let url;try{url=new URL(offer.url||node.url,material.url);if(url.protocol!=='https:' || url.hostname!==new URL(material.url).hostname)continue;}catch{continue;}
   if(material.id==='recreus-conductive' && url.hostname==='recreus.com' && url.searchParams.get('variant')!=='45921625833731')continue;
   const price=money(offer.price);if(price===null||!Number.isFinite(price)||price<=0||offer.priceCurrency!=='USD')continue;
   const available=/\/InStock$/.test(offer.availability||'')?true:/\/(OutOfStock|SoldOut|Discontinued|PreOrder|BackOrder)$/.test(offer.availability||'')?false:null;
   const delivery=offer.shippingDetails;
   const us=delivery?.shippingDestination?.addressCountry==='US';
   const days=Number(delivery?.deliveryTime?.handlingTime?.maxValue)+Number(delivery?.deliveryTime?.transitTime?.maxValue);
   const rate=delivery?.shippingRate?.currency==='USD'?Number(delivery.shippingRate.value):null;
   const published=us&&Number.isFinite(days)&&days>0&&days<100 ? {days,shipping:Number.isFinite(rate)&&rate!==null&&rate>=0?rate:null}:null;
   const color=material.id==='bambu-tpu-ams'?(label.match(/Neon Green|Red|Yellow|Blue|White|Gray|Black/i)?.[0]||'Unknown'):'Black';
   const picture=offer.image||node.image;
   const rawImage=Array.isArray(picture)?picture[0]:typeof picture==='object'?picture?.url:picture;
   let image=null;try{if(typeof rawImage!=='string'||!rawImage)throw Error();const u=new URL(rawImage,material.url);if(u.protocol==='https:'&&['store.bblcdn.com','proto-pasta.com','recreus.com','3d.nice-cdn.com'].includes(u.hostname))image=u.href;}catch{}
   results.set(url.href,{image,color,sourceUrl:material.url,published,id:url.href,materialId:material.id,seller:material.seller,label,grams,price,currency:'USD',available,url:url.href,refill:/refill/i.test(label),checked,source:'live'});
  }
 }
 if(!results.size)throw Error('No USD 1.75 mm spool offers found');
 return [...results.values()];
}
export function rankedOffers(offers,settings,now=Date.now()) {
 const today=new Date(now).toISOString().slice(0,10);
 const enriched=offers.map(o=>{
  const stale=now-Date.parse(o.checked)> (o.source==='manual'?7*86400000:SIX_HOURS) || !!o.error;
  const q=o.quote;
  const quoteValid=q?.zip===settings.zip && now-Date.parse(q.checked)<7*86400000 && (!q.arrival || q.arrival>=today);
  let policyArrival=null;
  if(o.published&&!stale&&o.available===true){const date=new Date(now);for(let left=Math.ceil(o.published.days);left>0;){date.setUTCDate(date.getUTCDate()+1);if(![0,6].includes(date.getUTCDay()))left--;}policyArrival=date.toISOString().slice(0,10);}
  const arrival=quoteValid?q.arrival:policyArrival;
  const shipping=quoteValid?q.shipping:(!stale?o.published?.shipping??null:null);
  const deliverySource=quoteValid?'ZIP quote':policyArrival?'US estimate':null;
  const delivered=shipping!==null&&shipping!==undefined?o.price+shipping:null;
  return {...o,stale,arrival,shipping,delivered,deliverySource,perKg:o.price*1000/o.grams,deliveredPerKg:delivered===null?null:delivered*1000/o.grams};
 });
 const score=o=>o.stale?3:o.available===true?0:o.available===false?2:1;
 const cost=o=>o.deliveredPerKg??Infinity;
 enriched.sort((a,b)=>score(a)-score(b) || (settings.sort==='price'?cost(a)-cost(b)||String(a.arrival||'9999').localeCompare(b.arrival||'9999'):String(a.arrival||'9999').localeCompare(b.arrival||'9999')||cost(a)-cost(b)) || a.perKg-b.perKg || a.label.localeCompare(b.label));
 return enriched;
}
export class Materials {
 constructor(db,{fetcher=fetch}={}) {
  this.db=db;this.fetcher=fetcher;this.busy=null;
  db.exec('CREATE TABLE IF NOT EXISTS material_catalog (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS material_offers (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS material_settings (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  for(const m of MATERIALS)db.prepare('INSERT OR IGNORE INTO material_catalog VALUES (?,?)').run(m.id,JSON.stringify(m));
  db.prepare('INSERT OR IGNORE INTO material_settings VALUES (1,?)').run(JSON.stringify({zip:'30360',sort:'fastest'}));
 }
 settings(){return JSON.parse(this.db.prepare('SELECT body FROM material_settings WHERE id=1').get().body);}
 list(){const settings=this.settings();const offers=this.db.prepare('SELECT body FROM material_offers').all().map(r=>JSON.parse(r.body));return {settings,materials:this.db.prepare('SELECT body FROM material_catalog').all().map(r=>{const m=JSON.parse(r.body);return {...m,offers:rankedOffers(offers.filter(o=>o.materialId===m.id),settings)};})};}
 saveSettings(input){const next={...this.settings(),...input};if(!/^\d{5}$/.test(next.zip)||!['fastest','price'].includes(next.sort))throw Error('Enter a five-digit ZIP and sort order');this.db.prepare('UPDATE material_settings SET body=? WHERE id=1').run(JSON.stringify({zip:next.zip,sort:next.sort}));return this.list();}
 saveUsage(id,usage){const r=this.db.prepare('SELECT body FROM material_catalog WHERE id=?').get(id);if(!r)throw Error('Unknown material');const m={...JSON.parse(r.body),usage:text(usage)};this.db.prepare('UPDATE material_catalog SET body=? WHERE id=?').run(JSON.stringify(m),id);return this.list();}
 putOffer(o){this.db.prepare('INSERT INTO material_offers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(o.id,JSON.stringify(o));}
 confirmOffer(id){const row=this.db.prepare('SELECT body FROM material_offers WHERE id=?').get(id);if(!row)throw Error('Unknown offer');const offer=JSON.parse(row.body);if(offer.source!=='manual')throw Error('Live offers are refreshed from the supplier');this.putOffer({...offer,checked:new Date().toISOString()});return this.list();}
 quote(id,input){const row=this.db.prepare('SELECT body FROM material_offers WHERE id=?').get(id);if(!row)throw Error('Unknown offer');const shipping=money(input.shipping),arrival=text(input.arrival,10),zip=this.settings().zip;
  if(shipping!==null&&(!Number.isFinite(shipping)||shipping<0||shipping>10000))throw Error('Enter shipping cost');
  if(arrival&&(!/^\d{4}-\d{2}-\d{2}$/.test(arrival)||Number.isNaN(Date.parse(arrival))||new Date(arrival).toISOString().slice(0,10)!==arrival||arrival<new Date().toISOString().slice(0,10)))throw Error('Enter a future arrival date');
  this.putOffer({...JSON.parse(row.body),quote:{zip,shipping,arrival:arrival||null,checked:new Date().toISOString()}});return this.list();
 }
 addOffer(input){const material=this.list().materials.find(m=>m.id===input.materialId);let url;try{url=new URL(input.url);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{throw Error('Enter an HTTPS product link');}
  const price=money(input.price),grams=Number(input.grams),seller=text(input.seller,80),label=text(input.label,150);
  if(!material||!seller||!label||!Number.isFinite(price)||price<=0||price>10000||!Number.isFinite(grams)||grams<100||grams>10000||typeof input.available!=='boolean')throw Error('Enter exact 1.75 mm spool, seller, price and grams');
  const id=randomUUID();this.putOffer({id,color:text(input.color,40)||'Black',materialId:material.id,seller,label,price,grams,url:url.href,currency:'USD',available:input.available,refill:!!input.refill,source:'manual',checked:new Date().toISOString()});return this.list();
 }
 removeOffer(id){const o=this.db.prepare('SELECT body FROM material_offers WHERE id=?').get(id);if(!o||JSON.parse(o.body).source!=='manual')throw Error('Only added offers can be removed');this.db.prepare('DELETE FROM material_offers WHERE id=?').run(id);return this.list();}
 recordCheck(source,error){const m=this.list().materials.find(m=>m.id===source.id),checked=new Date().toISOString();const checks={...m.checks,[source.url]:{seller:source.seller,checked,error}};this.db.prepare('UPDATE material_catalog SET body=? WHERE id=?').run(JSON.stringify({...m,offers:undefined,lastChecked:checked,checks,error:Object.values(checks).filter(c=>c.error).map(c=>c.seller+': '+c.error).join('; ')||null}),source.id);}
 refresh(){if(this.busy)return this.busy;this.busy=this.runRefresh().finally(()=>{this.busy=null;});return this.busy;}
 async runRefresh(){
  await Promise.allSettled(SOURCES.map(async material=>{
   try{
    const response=await this.fetcher(material.url,{signal:AbortSignal.timeout(20000),redirect:'error',headers:{'User-Agent':'Spoolside/1.0','Accept-Language':'en-US,en;q=0.9'}});
    if(!response.ok)throw Error(`Supplier returned ${response.status}`);
    const html=await response.text();if(html.length>5e6)throw Error('Supplier response too large');
    const offers=productOffers(html,material);const old=this.list().materials.find(m=>m.id===material.id);
    for(const offer of offers)this.putOffer({...offer,quote:old.offers.find(o=>o.id===offer.id)?.quote});
    const ids=new Set(offers.map(o=>o.id));for(const o of old.offers)if(o.source==='live'&&o.sourceUrl===material.url&&!ids.has(o.id))this.putOffer({...o,available:null,error:'Variant no longer listed'});
    this.recordCheck(material,null);
   }catch(e){const m=this.list().materials.find(m=>m.id===material.id);for(const o of m.offers)if(o.source==='live'&&o.sourceUrl===material.url)this.putOffer({...o,error:'Refresh failed'});this.recordCheck(material,text(e.message));}
  }));return this.list();
 }
}
