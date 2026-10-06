import { useEffect, useState } from 'react';
function keyBytes(value: string) {
  const text = atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}
async function worker() {
  return Promise.race([navigator.serviceWorker.ready, new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("Notification setup is not ready. Reload Spoolside and retry.")),10000))]);
}
async function request(path: string, init?: RequestInit) {
  const response=await fetch(path,{cache:'no-store',...init});
  const value=await response.json();
  if(!response.ok) throw Error(value.error || 'Notification setup failed. Please retry.');
  return value;
}
export function NotificationSettings() {
  const [id,setId]=useState(''),[key,setKey]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [preferences,setPreferences]=useState({newOrders:true,changes:true});
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone=window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?:boolean}).standalone;
  useEffect(()=>{
    (async()=>{
      const subscription=supported ? await (await worker()).pushManager.getSubscription() : null;
      const device=subscription ? await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subscription.endpoint)).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('')) : '';
      const status=await request('/api/notifications?device='+device);
      setEnabled(status.enabled);setKey(status.publicKey || '');
      if(status.device){setId(status.device.id);setPreferences(status.device.preferences);}
      else if (subscription) await subscription.unsubscribe();
    })().catch(e=>setError(e.message)).finally(()=>setBusy(false));
  },[]);
  const action=async (fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const register=async (next=preferences)=>{
    const permission=Notification.permission==='granted' ? 'granted' : await Notification.requestPermission();
    if(permission!=='granted') throw Error('Notifications were not allowed. Enable them for Spoolside in your device settings, then retry.');
    const registration=await worker();
    const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(key)});
    const value=await request('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON(),preferences:next})});
    setId(value.id);setPreferences(next);setMessage('Notifications enabled on this device. Send a test to check delivery.');
  };
  return <section className="notification-settings" aria-label="Order notifications">
    <h2>Order notifications</h2>
    {ios && !standalone && <p>Add to Home Screen first (iOS 16.4+).</p>}
    {!supported && <p>Push not supported in this browser.</p>}
    {!enabled && !busy && <p>Unavailable on server.</p>}
    <label><input type="checkbox" checked={preferences.newOrders} disabled={busy} onChange={e=>{const next={...preferences,newOrders:e.target.checked};setPreferences(next);if(id) action(async()=>{try{await register(next);}catch(e){setPreferences(preferences);throw e;}});}}/> New orders</label>{' '}
    <label><input type="checkbox" checked={preferences.changes} disabled={busy} onChange={e=>{const next={...preferences,changes:e.target.checked};setPreferences(next);if(id) action(async()=>{try{await register(next);}catch(e){setPreferences(preferences);throw e;}});}}/> Order changes</label>
    {!id ? <button className="primary" disabled={busy || !enabled || !supported || (ios && !standalone)} onClick={()=>action(()=>register())}>{busy?'Checking notifications…':'Enable notifications'}</button> : <>
      <button className="secondary" disabled={busy} onClick={()=>action(async()=>{try {await request('/api/notifications/'+id+'/test',{method:'POST'});} catch(e) {const status=await request('/api/notifications?device='+id);if(!status.device){setId('');await (await (await worker()).pushManager.getSubscription())?.unsubscribe();}throw e;}setMessage('Test accepted by the push service. Check this device for the notification.');})}>Send test notification</button>{' '}
      <button className="text-button" disabled={busy} onClick={()=>action(async()=>{await request('/api/notifications/'+id,{method:'DELETE'});setId('');const subscription=await (await worker()).pushManager.getSubscription();await subscription?.unsubscribe();setId('');setMessage('Notifications disabled on this device.');})}>Disable on this device</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
