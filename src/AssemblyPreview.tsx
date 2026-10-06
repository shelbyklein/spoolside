import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {Asset} from './AssetLibrary';
const Viewer=lazy(()=>import('./StlViewer'));
export function AssemblyPreview({assets}:{assets:Asset[]}){
 const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'100px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
 const urls=assets.filter(a=>a.hasStl!==false).map(a=>`/api/assets/${a.id}/stl`);
 return <div className="assembly-combined-preview" ref={host} aria-label="Interactive assembled preview">{visible&&urls.length?<Suspense fallback={<div className="stl-viewer">Loading preview…</div>}><Viewer urls={urls}/></Suspense>:<div className="stl-viewer">{!urls.length?'No STL preview':''}</div>}</div>;
}
