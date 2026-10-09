import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw } from 'lucide-react';

export function BedTraining({printer, onClose, onSaved}: {printer:{id:string;name:string};onClose:()=>void;onSaved:()=>void}) {
 const [capture,setCapture]=useState<{id:string;at:number}|null>(null),[loaded,setLoaded]=useState(false),[clear,setClear]=useState(false),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=`/api/dispatch/${encodeURIComponent(printer.id)}/reference`;
 async function post(url:string,body:unknown={}) {const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save');return d;}
 async function refresh() {setBusy(true);setError('');setCapture(null);setLoaded(false);setClear(false);try{setCapture(await post(base+'/capture'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[printer.id]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,onClose]);
 async function save(){if(!capture||!clear||!loaded)return;setBusy(true);setError('');try{await post(base,{capture:capture.id,clear:true,note});onSaved();}catch(e){setError((e as Error).message);setBusy(false);}}
 return createPortal(<div className="modal-backdrop" onClick={()=>{if(!busy)onClose();}}><section className="bed-training" role="dialog" aria-modal="true" aria-label={`Teach ${printer.name} bed check`} onClick={e=>e.stopPropagation()}>
 <div className="section-heading"><h2>Teach {printer.name} bed check</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18}/></button></div>
 <p>Check this fresh photo. Save it only if the entire bed is visible and completely empty. Future checks will use it to recognize fixed fixtures.</p>
 {capture?<img className="bed-reference-photo" alt={`${printer.name} bed to confirm`} src={`${base}/${capture.id}/photo.jpg`} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError('Photo unavailable. Take another photo.');}}/>:<p role="status">{busy?'Taking a fresh photo…':'No photo yet'}</p>}
 <button className="text-button" disabled={busy} onClick={refresh}><RefreshCw size={14}/> Take another photo</button>
 <label className="check-row"><input type="checkbox" checked={clear} disabled={!loaded||busy} onChange={e=>setClear(e.target.checked)}/> This photo shows an empty bed</label>
 <label className="bed-reference-note">Note (optional)<textarea maxLength={300} value={note} onChange={e=>setNote(e.target.value)} placeholder="For example: the white circle beside the bed is a fixed printer fixture."/></label>
 {error&&<p role="alert">{error}</p>}
 <button className="primary" disabled={!loaded||!clear||busy} onClick={save}>Save empty-bed reference</button>
 </section></div>,document.body);
}
