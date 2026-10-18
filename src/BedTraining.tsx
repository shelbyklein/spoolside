import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw } from 'lucide-react';

type Area={left:number;top:number;right:number;bottom:number};
// Drag across the photo to mark where the plate sits; bed checks then look only inside the box.
function PlateBox({src,alt,area,onArea,onLoad,onError}:{src:string;alt:string;area:Area|null;onArea:(a:Area|null)=>void;onLoad:()=>void;onError:()=>void}) {
 const box=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null);
 const at=(e:React.PointerEvent)=>{const r=box.current!.getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))};};
 const drag=(e:React.PointerEvent)=>{if(!start.current)return;const p=at(e),a=start.current;onArea({left:Math.min(a.x,p.x),top:Math.min(a.y,p.y),right:Math.max(a.x,p.x),bottom:Math.max(a.y,p.y)});};
 return <div ref={box} className="plate-box" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start.current=at(e);onArea(null);}} onPointerMove={drag} onPointerUp={e=>{drag(e);start.current=null;}}>
  <img className="bed-reference-photo" alt={alt} src={src} draggable={false} onLoad={onLoad} onError={onError}/>
  {area&&<div className="plate-box-mark" aria-label="Marked plate area" style={{left:`${area.left*100}%`,top:`${area.top*100}%`,width:`${(area.right-area.left)*100}%`,height:`${(area.bottom-area.top)*100}%`}}/>}
 </div>;
}

export function BedTraining({printer, onClose, onSaved}: {printer:{id:string;name:string};onClose:()=>void;onSaved:()=>void}) {
 const [capture,setCapture]=useState<{id:string;at:number;area?:Area|null}|null>(null),[area,setArea]=useState<Area|null>(null),[loaded,setLoaded]=useState(false),[clear,setClear]=useState(false),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=`/api/dispatch/${encodeURIComponent(printer.id)}/reference`;
 async function post(url:string,body:unknown={}) {const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save');return d;}
 async function refresh() {setBusy(true);setError('');setCapture(null);setLoaded(false);setClear(false);try{const c=await post(base+'/capture');setCapture(c);setArea(c.area||null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[printer.id]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,onClose]);
 async function save(){if(!capture||!clear||!loaded)return;setBusy(true);setError('');try{const big=area&&area.right-area.left>=0.05&&area.bottom-area.top>=0.05;await post(base,{capture:capture.id,clear:true,note,area:big?area:null});onSaved();}catch(e){setError((e as Error).message);setBusy(false);}}
 return createPortal(<div className="modal-backdrop" onClick={()=>{if(!busy)onClose();}}><section className="bed-training" role="dialog" aria-modal="true" aria-label={`Teach ${printer.name} bed check`} onClick={e=>e.stopPropagation()}>
 <div className="section-heading"><h2>Teach {printer.name} bed check</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18}/></button></div>
 <p>Check this fresh photo. Save it only if the entire bed is visible and completely empty. Future checks will use it to recognize fixed fixtures.</p>
 {capture?<PlateBox alt={`${printer.name} bed to confirm`} src={`${base}/${capture.id}/photo.jpg`} area={area} onArea={setArea} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError('Photo unavailable. Take another photo.');}}/>:<p role="status">{busy?'Taking a fresh photo…':'No photo yet'}</p>}
 {capture&&<p className="plate-meta plate-box-help">{area?<>Bed checks look only inside the box, with a little room for parts at the edge. <button className="text-button" onClick={()=>setArea(null)}>Clear box</button></>:'Optional: drag across the photo to box the plate. Bed checks then ignore everything outside it.'}</p>}
 <button className="text-button" disabled={busy} onClick={refresh}><RefreshCw size={14}/> Take another photo</button>
 <label className="check-row"><input type="checkbox" checked={clear} disabled={!loaded||busy} onChange={e=>setClear(e.target.checked)}/> This photo shows an empty bed</label>
 <label className="bed-reference-note">Note (optional)<textarea maxLength={300} value={note} onChange={e=>setNote(e.target.value)} placeholder="For example: the white circle beside the bed is a fixed printer fixture."/></label>
 {error&&<p role="alert">{error}</p>}
 <button className="primary" disabled={!loaded||!clear||busy} onClick={save}>Save empty-bed reference</button>
 </section></div>,document.body);
}
