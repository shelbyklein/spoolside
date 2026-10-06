import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {Asset} from './AssetLibrary';
const Viewer=lazy(()=>import('./StlViewer'));
export function AssemblyPreview({parts}:{parts:{asset:Asset;color?:string;positions?:number[][]}[]}){
 const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'100px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 const shown=parts.filter(p=>p.asset.hasStl!==false);
 const urls=shown.map(p=>`/api/assets/${p.asset.id}/stl`),colors=shown.map(p=>p.color||''),positions=shown.map(p=>p.positions);
 return <div className="assembly-combined-preview" ref={host} aria-label="Interactive assembled preview">{visible&&urls.length?<Suspense fallback={<div className="stl-viewer">Loading preview…</div>}><Viewer urls={urls} colors={colors} positions={positions}/></Suspense>:<div className="stl-viewer">{!urls.length?'No STL preview':''}</div>}</div>;
}
