import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {Asset} from './AssetLibrary';
import type {PartRef} from './StlViewer';
const Viewer=lazy(()=>import('./StlViewer'));
export type PreviewPart={asset:Asset;color?:string;positions?:number[][]};
export type PartPick={assetId:string;instance:number};
type Editing={selected:PartPick|null;onSelect:(p:PartPick|null)=>void;onMove:(p:PartPick,position:number[])=>void};
export function AssemblyPreview({parts,editing}:{parts:PreviewPart[];editing?:Editing}){
 const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'100px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 const shown=parts.filter(p=>p.asset.hasStl!==false);
 const urls=shown.map(p=>`/api/assets/${p.asset.id}/stl`),colors=shown.map(p=>p.color||p.asset.categoryColor||''),positions=shown.map(p=>p.positions);
 // The viewer works in indexes; translate to asset ids for the page.
 const toPick=(r:PartRef|null):PartPick|null=>r?{assetId:shown[r.part].asset.id,instance:r.instance}:null;
 const sel=editing?.selected?shown.findIndex(p=>p.asset.id===editing.selected!.assetId):-1;
 return <div className="assembly-combined-preview" ref={host} aria-label="Interactive assembled preview">{visible&&urls.length?<Suspense fallback={<div className="stl-viewer">Loading preview…</div>}>
  <Viewer urls={urls} colors={colors} positions={positions} editable={!!editing}
   selected={sel>=0?{part:sel,instance:editing!.selected!.instance}:null}
   onSelect={r=>editing?.onSelect(toPick(r))} onMove={(r,p)=>editing?.onMove(toPick(r)!,p)}/>
 </Suspense>:<div className="stl-viewer">{!urls.length?'No STL preview':''}</div>}</div>;
}
