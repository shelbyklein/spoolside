import {useEffect,useRef,useState} from 'react';
import {DEFAULT_PART_COLOR} from './colors';
import {AssemblyPreview} from './AssemblyPreview';
import type {Asset} from './AssetLibrary';
type Part={assetId:string;quantity:number;color?:string};
type Assembly={id:string;name:string;sku:string;type:string;components:Part[];removed?:Part[]};
const assemblyFromPath=()=>window.location.pathname.match(/^\/library\/assemblies\/([0-9a-f-]{36})$/)?.[1] || null;
const empty=()=>({id:'',name:'',sku:'',type:'Case',components:[] as Assembly['components']});
export function Assemblies({assets,onOpen,notify}:{assets:Asset[];onOpen:(id:string)=>void;notify:(m:string)=>void}){
 const [selectedId,setSelectedId]=useState<string|null>(assemblyFromPath);
 const [liveColors,setLiveColors]=useState<Assembly|null>(null);
 const navigate=(id:string|null)=>{window.history.pushState(null,'',id?'/library/assemblies/'+id:'/library/assemblies');setSelectedId(id);setDraft(null);};
 useEffect(()=>{const pop=()=>{setSelectedId(assemblyFromPath());setDraft(null);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 const [items,setItems]=useState<Assembly[]>([]),[draft,setDraft]=useState<ReturnType<typeof empty>|null>(null),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[assetSearch,setAssetSearch]=useState('');
 const load=()=>fetch('/api/assemblies',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load assemblies');setItems(await r.json());setError('');}).catch(e=>setError(e.message)).finally(()=>setLoading(false));
 useEffect(()=>{load();},[]);
 const save=async()=>{if(!draft)return;setBusy(true);setError('');try{
 const r=await fetch('/api/assemblies'+(draft.id?'/'+draft.id:''),{method:draft.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});const result=await r.json();if(!r.ok)throw Error(result.error || 'Could not save assembly');setItems(prior=>[...prior.filter(a=>a.id!==result.id),result].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})));setDraft(null);notify('Assembly saved');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const selected=items.find(a=>a.id===selectedId);
 return <section aria-label="Assemblies">
 {selectedId && <button className="text-button assembly-back" onClick={()=>navigate(null)}>← Assemblies</button>}
 {selected && <section className="assembly-detail"><div className="assembly-heading"><div><h2>{selected.name}</h2><p>{selected.type}{selected.sku?` · SKU ${selected.sku}`:''} · {selected.components.reduce((n,c)=>n+c.quantity,0)} pieces</p></div><button className="secondary" onClick={()=>{setDraft({...selected,components:selected.components.map(c=>({...c}))});setAssetSearch('');}}>Edit assembly</button></div><div className="assembly-detail-columns"><AssemblyPreview parts={(liveColors?.id===selected.id?liveColors.components:selected.components).flatMap(c=>{const asset=assets.find(a=>a.id===c.assetId);return asset?[{asset,color:c.color}]:[];})}/><PartsEditor assembly={selected} assets={assets} onOpen={onOpen} onSaved={saved=>setItems(prior=>prior.map(x=>x.id===saved.id?saved:x))} onPreview={setLiveColors} notify={notify}/></div></section>}
 {selectedId && !selected && !loading && !error && <p role="alert">Assembly not found.</p>}
  {error && <p role="alert">{error} <button className="text-button" onClick={load}>Retry</button></p>}
 {!selectedId && <>
  <div className="asset-toolbar"><label className="search-field"><input aria-label="Search assemblies" placeholder="Search assembly or SKU" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="secondary" onClick={()=>{setDraft(empty());setAssetSearch('');}}>Add assembly</button></div>

  {loading?<p>Loading assemblies…</p>:!items.length?<div className="empty"><p>No assemblies yet.</p></div>:<div className="group-cards assembly-cards">{items.filter(a=>`${a.name} ${a.sku} ${a.type}`.toLowerCase().includes(search.toLowerCase())).map(a=><section key={a.id} className="group-card"><h3><a href={`/library/assemblies/${a.id}`} onClick={e=>{e.preventDefault();navigate(a.id);}}>{a.name}</a></h3><p>{a.type}{a.sku?` · ${a.sku}`:''}</p><AssemblyPreview parts={a.components.flatMap(c=>{const asset=assets.find(x=>x.id===c.assetId);return asset?[{asset,color:c.color}]:[];})}/><div className="asset-pills">{a.components.map(c=>{const asset=assets.find(x=>x.id===c.assetId);return <button key={c.assetId} className={`asset-pill ${asset?.status.toLowerCase().replace(/\s+/g,'-') || ''}`} disabled={!asset} onClick={()=>onOpen(c.assetId)}><span>{asset?.name || 'Missing asset'} × {c.quantity}</span><small>{asset?.status}{!asset?.designFile ? " · Missing design" : ""}</small></button>;})}</div><button className="text-button" onClick={()=>{setDraft({...a,components:a.components.map(c=>({...c}))});setAssetSearch('');}}>Edit assembly</button></section>)}</div>}
  </>}
  {draft && <form className="panel assembly-editor" onSubmit={e=>{e.preventDefault();save();}}>
   <h3>{draft.id?'Edit assembly':'New assembly'}</h3>
   <label>Name<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label>SKU (optional)<input maxLength={100} value={draft.sku} onChange={e=>setDraft({...draft,sku:e.target.value})}/></label>
   <label>Assembly type<select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}>{['Case','Faceplate','Sleeve'].map(t=><option key={t}>{t}</option>)}</select></label>
   <h4>Components</h4>
   {draft.components.map(c=><div className="assembly-component" key={c.assetId}><span>{assets.find(a=>a.id===c.assetId)?.name || 'Missing asset'}</span><label>Quantity<input type="number" required min={1} max={100} value={c.quantity} onChange={e=>setDraft({...draft,components:draft.components.map(x=>x.assetId===c.assetId?{...x,quantity:Number(e.target.value)}:x)})}/></label><button type="button" className="text-button" onClick={()=>setDraft({...draft,components:draft.components.filter(x=>x.assetId!==c.assetId)})}>Remove</button></div>)}
   <label>Find components<input value={assetSearch} onChange={e=>setAssetSearch(e.target.value)} placeholder="Search STL name"/></label>
   <div className="assembly-options">{assets.filter(a=>a.status!=='Retired'&&!draft.components.some(c=>c.assetId===a.id)&&`${a.name} ${a.type}`.toLowerCase().includes(assetSearch.toLowerCase())).map(a=><button type="button" className="asset-pill" key={a.id} onClick={()=>setDraft({...draft,components:[...draft.components,{assetId:a.id,quantity:1}]})}><span>{a.name}</span><small>{a.type}</small></button>)}</div>
   <button className="primary" type="submit" disabled={busy || !draft.components.length}>{busy?'Saving…':'Save assembly'}</button> <button className="text-button" type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button>
  </form>}
 </section>;
}

// Inline part editing on the assembly page. Removing only moves a part to "Removed"; nothing is deleted.
function PartsEditor({assembly,assets,onOpen,onSaved,onPreview,notify}:{assembly:Assembly;assets:Asset[];onOpen:(id:string)=>void;onSaved:(a:Assembly)=>void;onPreview:(a:Assembly|null)=>void;notify:(m:string)=>void}){
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false);
 const colorTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 // Recolor the preview instantly while picking; save once the picker settles.
 const setColor=(c:Part,color:string)=>{const next={...assembly,components:assembly.components.map(x=>x.assetId===c.assetId?{...x,color}:x)};onPreview(next);clearTimeout(colorTimer.current);colorTimer.current=setTimeout(()=>save(next,`${name(c.assetId)} color saved.`).finally(()=>onPreview(null)),600);};
 const removed=assembly.removed||[];
 const save=async(next:Assembly,message:string)=>{
  setBusy(true);
  try{const r=await fetch('/api/assemblies/'+assembly.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});const body=await r.json();if(!r.ok)throw Error(body.error||'Could not save');onSaved(body);notify(message);}
  catch(e){notify((e as Error).message);}finally{setBusy(false);}
 };
 const name=(id:string)=>assets.find(a=>a.id===id)?.name||'Missing asset';
 const remove=(c:{assetId:string;quantity:number})=>save({...assembly,components:assembly.components.filter(x=>x.assetId!==c.assetId),removed:[c,...removed.filter(x=>x.assetId!==c.assetId)]},`Removed ${name(c.assetId)}. Restore it under Removed.`);
 const restore=(c:{assetId:string;quantity:number})=>save({...assembly,components:[...assembly.components,c],removed:removed.filter(x=>x.assetId!==c.assetId)},`Restored ${name(c.assetId)}.`);
 const add=(id:string)=>{setQuery('');save({...assembly,components:[...assembly.components,{assetId:id,quantity:1}],removed:removed.filter(x=>x.assetId!==id)},`Added ${name(id)}.`);};
 const setQty=(c:{assetId:string},q:number)=>q>=1&&q<=100&&save({...assembly,components:assembly.components.map(x=>x.assetId===c.assetId?{...x,quantity:q}:x)},'Quantity updated.');
 const used=new Set(assembly.components.map(c=>c.assetId));
 const matches=query.trim()?assets.filter(a=>a.status!=='Retired'&&!used.has(a.id)&&`${a.name} ${a.type}`.toLowerCase().includes(query.toLowerCase())).slice(0,8):[];
 const pill=(id:string)=>`asset-pill ${assets.find(a=>a.id===id)?.status.toLowerCase().replace(/\s+/g,'-')||''}`;
 return <section className="group-card assembly-parts" aria-busy={busy}>
  <h3>Parts</h3>
  <div className="asset-pills">
   {assembly.components.map(c=>{const asset=assets.find(a=>a.id===c.assetId);return <div key={c.assetId} className="part-row">
    <button className={pill(c.assetId)} disabled={!asset} onClick={()=>onOpen(c.assetId)}><span>{asset?.name||'Missing asset'}</span><small>{asset?.status}{asset&&!asset.designFile?' · Missing design':''}</small></button>
    <input type="color" className="part-color" aria-label={`Color of ${name(c.assetId)}`} defaultValue={c.color||DEFAULT_PART_COLOR} disabled={busy} onChange={e=>setColor(c,e.target.value)}/>
    <input aria-label={`Quantity of ${name(c.assetId)}`} type="number" min={1} max={100} value={c.quantity} disabled={busy} onChange={e=>setQty(c,Number(e.target.value))}/>
    <button className="icon-button" aria-label={`Remove ${name(c.assetId)} from assembly`} disabled={busy} onClick={()=>remove(c)}>×</button>
   </div>;})}
   {!assembly.components.length&&<p className="plate-meta">No parts. Add one below or restore a removed part.</p>}
  </div>
  <label className="add-part">Add part<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search STL name" disabled={busy}/></label>
  {matches.length>0&&<div className="asset-pills">{matches.map(a=><button key={a.id} className="asset-pill" disabled={busy} onClick={()=>add(a.id)}><span>+ {a.name}</span><small>{a.type}</small></button>)}</div>}
  {removed.length>0&&<><h4 className="removed-heading">Removed</h4><div className="asset-pills">{removed.map(c=><div key={c.assetId} className="part-row removed"><button className="asset-pill retired" onClick={()=>onOpen(c.assetId)}><span>{name(c.assetId)} × {c.quantity}</span></button><button className="text-button" disabled={busy} onClick={()=>restore(c)}>Restore</button></div>)}</div></>}
 </section>;
}
