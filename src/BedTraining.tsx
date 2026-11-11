import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw } from 'lucide-react';

type Point=[number,number];
type Area={left:number;top:number;right:number;bottom:number;quad?:Point[]};
// Corners in order around their middle, so the outline never crosses itself whatever order they were tapped in.
const ordered=(pts:Point[])=>{if(pts.length<3)return pts;const cx=pts.reduce((n,p)=>n+p[0],0)/pts.length,cy=pts.reduce((n,p)=>n+p[1],0)/pts.length;return [...pts].sort((a,b)=>Math.atan2(a[1]-cy,a[0]-cx)-Math.atan2(b[1]-cy,b[0]-cx));};
// A saved area as four corners: the corners themselves, or an older box's corners.
export const cornersOf=(a:Area|null|undefined):Point[]=>!a?[]:a.quad?.length===4?a.quad:[[a.left,a.top],[a.right,a.top],[a.right,a.bottom],[a.left,a.bottom]];
// Tap the plate's four corners as the camera sees them (at an angle); drag a corner to adjust.
// Bed checks then look only inside that outline.
function PlateCorners({src,alt,corners,onCorners,onLoad,onError}:{src:string;alt:string;corners:Point[];onCorners:(c:Point[])=>void;onLoad:()=>void;onError:()=>void}) {
 const box=useRef<HTMLDivElement>(null),dragging=useRef<number|null>(null);
 const at=(e:React.PointerEvent):Point=>{const r=box.current!.getBoundingClientRect();return [Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))];};
 const near=(e:React.PointerEvent)=>{const r=box.current!.getBoundingClientRect();return corners.findIndex(([x,y])=>Math.hypot(x*r.width-(e.clientX-r.left),y*r.height-(e.clientY-r.top))<22);};
 const down=(e:React.PointerEvent)=>{e.currentTarget.setPointerCapture(e.pointerId);const i=near(e);if(i>=0){dragging.current=i;return;}if(corners.length<4){const next=[...corners,at(e)];onCorners(next.length===4?ordered(next):next);dragging.current=null;}};
 const move=(e:React.PointerEvent)=>{const i=dragging.current;if(i===null)return;onCorners(corners.map((p,j)=>j===i?at(e):p));};
 const up=()=>{if(dragging.current!==null&&corners.length===4)onCorners(ordered(corners));dragging.current=null;};
 const shape=ordered(corners),pts=shape.map(p=>p.join(',')).join(' ');
 return <div ref={box} className="plate-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
  <img className="bed-reference-photo" alt={alt} src={src} draggable={false} onLoad={onLoad} onError={onError}/>
  <svg className="plate-corners" viewBox="0 0 1 1" preserveAspectRatio="none" {...(corners.length===4?{role:'img','aria-label':'Marked plate area'}:{'aria-hidden':true})}>
   {corners.length===4&&<path className="plate-corners-shade" fillRule="evenodd" d={`M0 0H1V1H0Z M${shape.map(p=>p.join(' ')).join(' L')}Z`}/>}
   {corners.length===4?<polygon className="plate-corners-line" points={pts}/>:corners.length>1&&<polyline className="plate-corners-line" points={corners.map(p=>p.join(',')).join(' ')}/>}
  </svg>
  {corners.map(([x,y],i)=><span key={i} className="plate-corner" aria-label={`Corner ${i+1}`} style={{left:`${x*100}%`,top:`${y*100}%`}}/>)}
 </div>;
}

export function BedTraining({printer, onClose, onSaved}: {printer:{id:string;name:string};onClose:()=>void;onSaved:()=>void}) {
 const [capture,setCapture]=useState<{id:string;at:number;area?:Area|null}|null>(null),[corners,setCorners]=useState<Point[]>([]),[loaded,setLoaded]=useState(false),[clear,setClear]=useState(false),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=`/api/dispatch/${encodeURIComponent(printer.id)}/reference`;
 async function post(url:string,body:unknown={}) {const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>null);if(!d)throw Error("Spoolside didn't answer. Try again.");if(!r.ok)throw Error(d.error||'Could not save');return d;}
 async function refresh() {setBusy(true);setError('');setCapture(null);setLoaded(false);setClear(false);try{const c=await post(base+'/capture');setCapture(c);setCorners(cornersOf(c.area));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[printer.id]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,onClose]);
 async function save(){if(!capture||!clear||!loaded)return;setBusy(true);setError('');try{await post(base,{capture:capture.id,clear:true,note,area:corners.length===4?{quad:corners}:null});onSaved();}catch(e){setError((e as Error).message);setBusy(false);}}
 return createPortal(<div className="modal-backdrop" onClick={()=>{if(!busy)onClose();}}><section className="bed-training" role="dialog" aria-modal="true" aria-label={`Teach ${printer.name} bed check`} onClick={e=>e.stopPropagation()}>
 <div className="section-heading"><h2>Teach {printer.name} bed check</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18}/></button></div>
 <p>Check this fresh photo. Save it only if the entire bed is visible and completely empty. Future checks will use it to recognize fixed fixtures.</p>
 {capture?<PlateCorners alt={`${printer.name} bed to confirm`} src={`${base}/${capture.id}/photo.jpg`} corners={corners} onCorners={setCorners} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setError('Photo unavailable. Take another photo.');}}/>:<p role="status">{busy?'Taking a fresh photo…':'No photo yet'}</p>}
 {capture&&<p className="plate-meta plate-box-help">{corners.length===4?<>Bed checks look only inside this outline, with a little room at the edges. Drag a corner to adjust. <button className="text-button" onClick={()=>setCorners([])}>Redo corners</button></>:corners.length?<>Tap the next corner ({corners.length} of 4). <button className="text-button" onClick={()=>setCorners([])}>Start over</button></>:'Optional: tap the plate\'s four corners. Bed checks then ignore everything outside the plate.'}</p>}
 <button className="text-button" disabled={busy} onClick={refresh}><RefreshCw size={14}/> Take another photo</button>
 <label className="check-row"><input type="checkbox" checked={clear} disabled={!loaded||busy} onChange={e=>setClear(e.target.checked)}/> This photo shows an empty bed</label>
 <label className="bed-reference-note">Note (optional)<textarea maxLength={300} value={note} onChange={e=>setNote(e.target.value)} placeholder="For example: the white circle beside the bed is a fixed printer fixture."/></label>
 {error&&<p role="alert">{error}</p>}
 <button className="primary" disabled={!loaded||!clear||busy} onClick={save}>Save empty-bed reference</button>
 </section></div>,document.body);
}
