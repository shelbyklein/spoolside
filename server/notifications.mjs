import webpush from 'web-push';
import { createHash, ECDH } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
export function validateSubscription(value) {
  const endpoint = new URL(value?.endpoint);
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || (endpoint.port && endpoint.port !== '443') || (!allowed.includes(endpoint.hostname) && !endpoint.hostname.endsWith('.notify.windows.com')) || value.endpoint.length > 2048) throw Error('Unsupported push service endpoint');
  for (const [key, size] of [['p256dh',65],['auth',16]]) {
    if (typeof value.keys?.[key] !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value.keys[key]) || Buffer.from(value.keys[key], 'base64url').length !== size) throw Error('Invalid push subscription keys');
  }
  try { ECDH.convertKey(Buffer.from(value.keys.p256dh, 'base64url'), 'prime256v1'); } catch { throw Error('Invalid push public key'); }
  return {endpoint:value.endpoint, keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
export function orderChanges(previous, orders) {
  const old = new Map(previous.map(o=>[o.id,o]));
  const items = o => JSON.stringify(o.items.map(i=>[i.id,i.name,i.quantity,i.variant,i.productId,i.variationId,i.sku]));
  return orders.flatMap(o=>{
    const prior=old.get(o.id);
    const changes = !prior ? ['New order'] : [prior.commercial !== o.commercial && `Status: ${o.commercial}`, items(prior)!==items(o) && 'Items changed', (prior.refundReview !== o.refundReview || (prior.refundVersion != null && prior.refundVersion !== o.refundVersion)) && 'Refund updated'].filter(Boolean);
    return changes.length ? [{orderId:o.id,kind:prior?'changes':'newOrders',title:`PlayCase order ${o.number}`.slice(0,120),body:changes.join(' · ').slice(0,180)}] : [];
  });
}
export class Notifications {
  constructor(db, {vapid, send, now=Date.now}={}) {
    this.db=db;this.vapid=vapid;this.now=now;this.busy=false;
    this.send=send || ((subscription,payload)=>webpush.sendNotification(subscription,payload,{vapidDetails:vapid,TTL:3600,timeout:10000}));
    db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, new_orders INTEGER NOT NULL, changes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_deliveries (event TEXT NOT NULL, device TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(event,device));`);
  }
  get enabled(){return !!this.vapid;}
  register(subscription,preferences) {
    if(!this.enabled) throw Error('Notifications are not configured');
    const clean=validateSubscription(subscription),id=digest(clean.endpoint);
    if(typeof preferences?.newOrders!=='boolean'||typeof preferences?.changes!=='boolean') throw Error('Choose notification preferences');
    this.db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,new_orders=excluded.new_orders,changes=excluded.changes').run(id,JSON.stringify(clean),+preferences.newOrders,+preferences.changes);
    // Preferences apply to pending deliveries too.
    this.db.prepare("DELETE FROM push_deliveries WHERE device=? AND ((json_extract(payload,'$.kind')='newOrders' AND ?=0) OR (json_extract(payload,'$.kind')='changes' AND ?=0))").run(id,+preferences.newOrders,+preferences.changes);
    return {id,preferences};
  }
  remove(id) {this.db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(id);this.db.prepare('DELETE FROM push_deliveries WHERE device=?').run(id);}
  device(id) {const row=this.db.prepare('SELECT new_orders,changes FROM push_subscriptions WHERE id=?').get(id);return row?{id,preferences:{newOrders:!!row.new_orders,changes:!!row.changes}}:null;}
  enqueue(previous,next,baseline) {
    if(!this.enabled || baseline) return;
    const devices=this.db.prepare('SELECT * FROM push_subscriptions').all();
    const insert=this.db.prepare('INSERT OR IGNORE INTO push_deliveries(event,device,payload,due,created) VALUES(?,?,?,?,?)');
    for(const event of orderChanges(previous,next.orders)) {
      const id=`${next.revision}:${event.orderId}:${event.kind}`;
      const payload=JSON.stringify({title:event.title,body:event.body,tag:id,kind:event.kind,url:'/?view=orders'});
      for(const d of devices) if(d[event.kind==='newOrders'?'new_orders':'changes']) insert.run(id,d.id,payload,this.now(),this.now());
    }
  }
  // Print watcher events go to every device: they're about the farm right now.
  broadcast({id,title,body,url}) {
    if(!this.enabled) return;
    const payload=JSON.stringify({title:String(title).slice(0,120),body:String(body).slice(0,180),tag:id,kind:'prints',url});
    const insert=this.db.prepare('INSERT OR IGNORE INTO push_deliveries(event,device,payload,due,created) VALUES(?,?,?,?,?)');
    for(const d of this.db.prepare('SELECT id FROM push_subscriptions').all()) insert.run(id,d.id,payload,this.now(),this.now());
  }
  async test(id) {
    const row=this.db.prepare('SELECT subscription FROM push_subscriptions WHERE id=?').get(id);
    if(!row) throw Error('Enable notifications on this device first');
    try {await this.send(JSON.parse(row.subscription),JSON.stringify({title:'Spoolside is connected',body:'Order updates are enabled on this device.',tag:'spoolside-test',url:'/?view=orders'}));}
    catch(e){if([404,410].includes(e.statusCode))this.remove(id);throw Error('Push service did not accept the test. Enable notifications again and retry.');}
  }
  async drain() {
    if(this.busy||!this.enabled)return;this.busy=true;
    try {
      this.db.prepare('DELETE FROM push_deliveries WHERE created<? OR attempts>=8').run(this.now()-48*3600000);
      const rows=this.db.prepare('SELECT d.*,s.subscription FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.device WHERE due<=? LIMIT 30').all(this.now());
      for(const row of rows) {
        try {await this.send(JSON.parse(row.subscription),row.payload);this.db.prepare('DELETE FROM push_deliveries WHERE event=? AND device=?').run(row.event,row.device);}
        catch(e) {
          if([404,410].includes(e.statusCode))this.remove(row.device);
          else this.db.prepare('UPDATE push_deliveries SET attempts=attempts+1,due=? WHERE event=? AND device=?').run(this.now()+Math.min(3600000,30000*2**row.attempts),row.event,row.device);
        }
      }
    } finally {this.busy=false;}
  }
}
