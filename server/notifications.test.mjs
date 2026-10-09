import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Notifications, orderChanges, validateSubscription } from './notifications.mjs';
import { Workspace, normalizeOrder } from './workspace.mjs';
const curve=createECDH('prime256v1');curve.generateKeys();
const sub={endpoint:'https://web.push.apple.com/test-device',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
const vapid={subject:'https://spoolside.shelbyklein.com',publicKey:'test',privateKey:'test'};
const raw={id:1,number:'123',status:'processing',line_items:[{id:1,name:'PlayCase',quantity:1,product_id:1,variation_id:2}],refunds:[]};
test('baseline is silent, events are atomic, retries persist, preferences and expired devices are respected', async()=>{
 let now=1000, fail=true;const payloads=[];
 const ws=new Workspace(':memory:',{woo:{url:'https://playcase.gg',key:'k',secret:'s'},fetcher:async()=>Response.json([raw])});
 let service=new Notifications(ws.db,{vapid,now:()=>now,send:async(_s,p)=>{if(fail)throw {statusCode:503};payloads.push(JSON.parse(p));}});
 const device=service.register(sub,{newOrders:true,changes:true});
 ws.onSync=(previous,next,baseline)=>service.enqueue(previous,next,baseline);
 await ws.sync();assert.equal(ws.db.prepare('SELECT count(*) n FROM push_deliveries').get().n,0);
 ws.fetcher=async()=>Response.json([{...raw,status:'completed'}]);await ws.sync();await ws.sync();
 assert.equal(ws.db.prepare('SELECT count(*) n FROM push_deliveries').get().n,1);
 await service.drain();assert.equal(ws.db.prepare('SELECT attempts FROM push_deliveries').get().attempts,1);
 // Reconstruct sender against persisted tables as after process restart.
 service=new Notifications(ws.db,{vapid,now:()=>now,send:async(_s,p)=>payloads.push(JSON.parse(p))});now+=30001;await service.drain();
 assert.equal(payloads.length,1);assert.match(payloads[0].body,/completed/);assert.equal(ws.db.prepare('SELECT count(*) n FROM push_deliveries').get().n,0);
 service.register(sub,{newOrders:true,changes:false});
 ws.fetcher=async()=>Response.json([{...raw,status:'refunded'}, {...raw,id:2,number:'124'}]);await ws.sync();
 assert.equal(ws.db.prepare('SELECT count(*) n FROM push_deliveries').get().n,1);
 service.send=async()=>{throw {statusCode:410};};await service.drain();assert.equal(service.device(device.id),null);
 ws.close();
});
test('order change payloads exclude customer data and local production edits',()=>{
 const order=normalizeOrder({...raw,billing:{email:'private'},shipping:{address_1:'private'}});
 assert.deepEqual(orderChanges([order],[{...order,note:'changed',assembled:true}]),[]);
 const events=orderChanges([order],[{...order,refundReview:true,items:[{...order.items[0],quantity:2}]}]);
 assert.match(events[0].body,/Items changed.*Refund updated/);assert.equal(JSON.stringify(events).includes('private'),false);
});
test('subscription endpoints cannot target arbitrary hosts; disabling clears queued work',()=>{
 for(const endpoint of ['http://web.push.apple.com/x','https://127.0.0.1/x','https://web.push.apple.com.evil.com/x','https://user@web.push.apple.com/x'])assert.throws(()=>validateSubscription({...sub,endpoint}));
 assert.throws(()=>validateSubscription({...sub,keys:{...sub.keys,auth:'short'}}));
 const db=new DatabaseSync(':memory:');const service=new Notifications(db,{vapid});const device=service.register(sub,{newOrders:true,changes:true});
 service.enqueue([],{revision:2,orders:[normalizeOrder(raw)]},false);service.remove(device.id);assert.equal(db.prepare('SELECT count(*) n FROM push_deliveries').get().n,0);db.close();
});
test('outbox failure rolls back imported snapshot as well as deliveries', async()=>{
 const ws=new Workspace(':memory:',{woo:{url:'https://playcase.gg',key:'k',secret:'s'},fetcher:async()=>Response.json([raw])});
 ws.onSync=()=>{throw Error('outbox failed');};await ws.sync();assert.equal(ws.state.orders.length,0);assert.equal(ws.state.lastSync,null);ws.close();
});
test('notification APIs require login/origin and support register, test, preferences and disable', async()=>{
 const {createApp}=await import('./app.mjs');const {scryptSync}=await import('node:crypto');
 const db=new DatabaseSync(':memory:');let sent=0;const service=new Notifications(db,{vapid,send:async()=>{sent++;}});
 const salt='b'.repeat(32);const {app,close}=createApp({pinHash:salt+':'+scryptSync('12345678',salt,64).toString('hex'),origin:'http://localhost',secure:false,notifications:service});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await fetch(base+'/api/notifications')).status,401);
  const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:'http://localhost'},body:new URLSearchParams({pin:'12345678'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(path,method='GET',value,origin='http://localhost')=>fetch(base+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined});
  assert.equal((await call('/api/notifications','POST',{subscription:sub,preferences:{newOrders:true,changes:true}},'https://evil.test')).status,403);
  const registered=await call('/api/notifications','POST',{subscription:sub,preferences:{newOrders:true,changes:true}});assert.equal(registered.status,200);const {id}=await registered.json();
  const config=await (await call('/api/notifications?device='+id)).json();assert.equal(config.publicKey,'test');assert.equal('privateKey' in config,false);assert.equal(config.device.preferences.changes,true);
  assert.equal((await call('/api/notifications/'+id+'/test','POST')).status,200);assert.equal(sent,1);
  assert.equal((await call('/api/notifications/'+id+'/test','POST')).status,429);
  await call('/api/notifications','POST',{subscription:sub,preferences:{newOrders:true,changes:false}});
  assert.equal(service.device(id).preferences.changes,false);
  assert.equal((await call('/api/notifications/'+id,'DELETE')).status,200);assert.equal(service.device(id),null);
 }finally{await new Promise(r=>server.close(r));close();db.close();}
});

test('repeat refunds notify while adding fingerprint to an older baseline stays silent',()=>{
 const before=normalizeOrder({...raw,refunds:[{id:4,total:"-10.00"}]});
 const after=normalizeOrder({...raw,refunds:[{id:4,total:"-10.00"},{id:5,total:"-5.00"}]});
 assert.match(orderChanges([before],[after])[0].body,/Refund updated/);
 delete before.refundVersion;
 assert.deepEqual(orderChanges([before],[after]),[]);
});

test('print-finished preferences route ratings and clear disabled pending alerts', async () => {
 const db=new DatabaseSync(':memory:');const sent=[];
 const service=new Notifications(db,{vapid,send:async(_s,p)=>sent.push(JSON.parse(p))});
 const device=service.register(sub,{newOrders:false,changes:false,printFinished:true});
 service.broadcast({id:'done:1',title:'Print finished',body:'Tap to rate it',url:'/printers?rate=watch-id',kind:'printFinished'});
 await service.drain(); assert.equal(sent[0].url,'/printers?rate=watch-id');
 service.broadcast({id:'done:2',title:'Print finished',body:'Rate it',url:'/printers',kind:'printFinished'});
 service.register(sub,{newOrders:false,changes:false,printFinished:false});
 assert.equal(db.prepare('SELECT count(*) n FROM push_deliveries').get().n,0);
 service.broadcast({id:'done:3',title:'Print finished',body:'Rate it',url:'/printers',kind:'printFinished'});
 await service.drain();assert.equal(sent.length,1);assert.equal(service.device(device.id).preferences.printFinished,false);db.close();
});

test('queued print opportunities respect quiet hours without silencing completion alerts',async()=>{
 const db=new DatabaseSync(':memory:');let now=Date.UTC(2026,9,9,3);const sent=[];
 const n=new Notifications(db,{vapid,now:()=>now,send:async(_s,p)=>sent.push(JSON.parse(p))});n.register(sub,{newOrders:false,changes:false,printFinished:true});
 n.broadcast({id:'offer:1',title:'Free',kind:'printOpportunity'});n.broadcast({id:'done:1',title:'Done',kind:'printFinished'});
 await n.drain();assert.deepEqual(sent.map(s=>s.kind),['printFinished']);
 now=Date.UTC(2026,9,9,13);await n.drain();assert.equal(sent.at(-1).kind,'printOpportunity');db.close();
});
