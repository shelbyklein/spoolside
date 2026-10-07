import {useEffect,useRef,useState} from 'react';
import {DEFAULT_PART_COLOR} from './colors';
import {AssemblyPreview,type PartPick} from './AssemblyPreview';
import {requestSnapshot,snapshotKey,type SnapshotPart} from './assemblySnapshot';
import type {Asset} from './AssetLibrary';
type Part={assetId:string;quantity:number;color?:string;positions?:number[][]};
type Assembly={thumbKey?:string|null;partsConfirmed?:boolean;id:string;name:string;sku:string;type:string;components:Part[];removed?:Part[]};
const assemblyFromPath=()=>window.location.pathname.match(/^\/library\/assemblies\/([0-9a-f-]{36})$/)?.[1] || null;
const empty=():Assembly=>({id:'',name:'',sku:'',type:'Case',partsConfirmed:false,components:[] as Assembly['components']});
export function Assemblies({assets,onOpen,notify}:{assets:Asset[];onOpen:(id:string)=>void;notify:(m:string)=>void}){
 const [selectedId,setSelectedId]=useState<string|null>(assemblyFromPath);
 const [liveColors,setLiveColors]=useState<Assembly|null>(null);
 const navigate=(id:string|null)=>{window.history.pushState(null,'',id?'/library/assemblies/'+id:'/library/assemblies');setSelectedId(id);setDraft(null);};
 useEffect(()=>{const pop=()=>{setSelectedId(assemblyFromPath());setDraft(null);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 const [items,setItems]=useState<Assembly[]>([]),[draft,setDraft]=useState<ReturnType<typeof empty>|null>(null),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[assetSearch,setAssetSearch]=useState('');
 const [arranging,setArranging]=useState(false);
 const reorder=async(ids:string[])=>{
  setItems(prior=>ids.map(id=>prior.find(a=>a.id===id)!).concat(prior.filter(a=>!ids.includes(a.id))));
  const r=await fetch('/api/assembly-order',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
  if(!r.ok)notify('Could not save the order');
 };
 const load=()=>fetch('/api/assemblies',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load assemblies');setItems(await r.json());setError('');}).catch(e=>setError(e.message)).finally(()=>setLoading(false));
 useEffect(()=>{load();},[]);
 const save=async()=>{if(!draft)return;setBusy(true);setError('');try{
 const r=await fetch('/api/assemblies'+(draft.id?'/'+draft.id:''),{method:draft.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,confirmParts:true})});const result=await r.json();if(!r.ok)throw Error(result.error || 'Could not save assembly');setItems(prior=>prior.some(a=>a.id===result.id)?prior.map(a=>a.id===result.id?{...a,...result}:a):[...prior,result]);setDraft(null);notify('Assembly saved');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const selected=items.find(a=>a.id===selectedId);
 return <section aria-label="Assemblies">
 {selectedId && <button className="text-button assembly-back" onClick={()=>navigate(null)}>← Assemblies</button>}
 {selected && <section className="assembly-detail"><div className="assembly-heading"><div><h2>{selected.name}</h2><p>{selected.type}{selected.sku?` · SKU ${selected.sku}`:''} · {selected.components.reduce((n,c)=>n+c.quantity,0)} pieces</p></div><button className="secondary" onClick={()=>{setDraft({...selected,components:selected.components.map(c=>({...c}))});setAssetSearch('');}}>Edit assembly</button></div><div className="assembly-detail-columns"><PositionTool assembly={liveColors?.id===selected.id?liveColors:selected} assets={assets} onPreview={setLiveColors} onSaved={saved=>setItems(prior=>prior.map(x=>x.id===saved.id?saved:x))} notify={notify}/><PartsEditor assembly={selected} assets={assets} onOpen={onOpen} onSaved={saved=>setItems(prior=>prior.map(x=>x.id===saved.id?saved:x))} onPreview={setLiveColors} notify={notify}/></div></section>}
 {selectedId && !selected && !loading && !error && <p role="alert">Assembly not found.</p>}
  {error && <p role="alert">{error} <button className="text-button" onClick={load}>Retry</button></p>}
 {!selectedId && <>
  <div className="asset-toolbar"><label className="search-field"><input aria-label="Search assemblies" placeholder="Search assembly or SKU" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className={arranging?'primary':'secondary'} disabled={!!search} title={search?'Clear search to arrange':undefined} onClick={()=>setArranging(!arranging)}>{arranging?'Done arranging':'Arrange'}</button><button className="secondary" onClick={()=>{setDraft(empty());setAssetSearch('');}}>Add assembly</button></div>

  {loading?<p>Loading assemblies…</p>:!items.length?<div className="empty"><p>No assemblies yet.</p></div>:<AssemblyGrid items={items} search={search} assets={assets} arranging={arranging} onReorder={reorder} onOpenAssembly={navigate} onOpenAsset={onOpen} onEdit={a=>{setDraft({...a,components:a.components.map(c=>({...c}))});setAssetSearch('');}} onThumb={(id,key)=>setItems(prior=>prior.map(x=>x.id===id?{...x,thumbKey:key}:x))}/>}
  </>}
  {draft && <form className="panel assembly-editor" onSubmit={e=>{e.preventDefault();save();}}>
   <h3>{draft.id?'Edit assembly':'New assembly'}</h3>
   <label>Name<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label>SKU (optional)<input maxLength={100} value={draft.sku} onChange={e=>setDraft({...draft,sku:e.target.value})}/></label>
   <label>Assembly type<select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}>{['Case','Faceplate','Sleeve'].map(t=><option key={t}>{t}</option>)}</select></label>
   <label className="check-row"><input type="checkbox" checked={draft.partsConfirmed || false} onChange={e=>setDraft({...draft,partsConfirmed:e.target.checked})}/> Complete v3 print parts list</label>
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
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<string|null>(null);
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
    <button className="part-chip" style={chipStyle(asset?.categoryColor)} disabled={!asset} onClick={()=>onOpen(c.assetId)}><span>{asset?.name||'Missing asset'}</span></button>
    <input type="color" className="part-color" aria-label={`Color of ${name(c.assetId)}`} key={c.color||assets.find(a=>a.id===c.assetId)?.categoryColor||'default'} defaultValue={c.color||assets.find(a=>a.id===c.assetId)?.categoryColor||DEFAULT_PART_COLOR} title={c.color?'Custom color for this assembly':'Category color'} disabled={busy} onChange={e=>setColor(c,e.target.value)}/>
    {c.color&&<button className="text-button reset-color" title="Use the category color" aria-label={`Use category color for ${name(c.assetId)}`} disabled={busy} onClick={()=>{const {color:_,...rest}=c;save({...assembly,components:assembly.components.map(x=>x.assetId===c.assetId?rest:x)},'Using category color.');}}>↺</button>||<span className="reset-color" aria-hidden="true"/>}
    <input aria-label={`Quantity of ${name(c.assetId)}`} type="number" min={1} max={100} value={c.quantity} disabled={busy} onChange={e=>setQty(c,Number(e.target.value))}/>
    <button className="text-button positions-toggle" aria-expanded={editing===c.assetId} onClick={()=>setEditing(editing===c.assetId?null:c.assetId)}>{c.positions?.length?`${c.positions.length} position${c.positions.length===1?'':'s'}`:'Position'}</button>
    <button className="icon-button" aria-label={`Remove ${name(c.assetId)} from assembly`} disabled={busy} onClick={()=>remove(c)}>×</button>
    {editing===c.assetId&&<PositionsEditor part={c} busy={busy} onSave={positions=>save({...assembly,components:assembly.components.map(x=>x.assetId===c.assetId?{...x,positions}:x)},'Positions saved.')}/>}
   </div>;})}
   {!assembly.components.length&&<p className="plate-meta">No parts. Add one below or restore a removed part.</p>}
  </div>
  <label className="add-part">Add part<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search STL name" disabled={busy}/></label>
  {matches.length>0&&<div className="asset-pills">{matches.map(a=><button key={a.id} className="asset-pill" disabled={busy} onClick={()=>add(a.id)}><span>+ {a.name}</span><small>{a.type}</small></button>)}</div>}
  {removed.length>0&&<><h4 className="removed-heading">Removed</h4><div className="asset-pills">{removed.map(c=><div key={c.assetId} className="part-row removed"><button className="asset-pill retired" onClick={()=>onOpen(c.assetId)}><span>{name(c.assetId)} × {c.quantity}</span></button><button className="text-button" disabled={busy} onClick={()=>restore(c)}>Restore</button></div>)}</div></>}
 </section>;
}

// Display-only copies of a part, as mm offsets from where its STL sits (x, y, z).
function PositionsEditor({part,busy,onSave}:{part:Part;busy:boolean;onSave:(p:number[][])=>void}){
 const [rows,setRows]=useState<string[][]>(()=>(part.positions||[]).map(p=>p.map(String)));
 const parsed=rows.map(r=>r.map(Number));
 const valid=parsed.every(r=>r.every(n=>Number.isFinite(n)));
 return <div className="positions-editor">
  <p className="plate-meta">Show this part at several spots in the preview. Offsets are in mm from where the STL sits. Leave empty to show it once.</p>
  {rows.map((r,i)=><div className="position-row" key={i}>
   {['x','y','z'].map((axis,j)=><label key={axis}>{axis}<input type="number" step="0.1" value={r[j]} onChange={e=>setRows(rows.map((x,k)=>k===i?x.map((v,m)=>m===j?e.target.value:v):x))}/></label>)}
   <button type="button" className="icon-button" aria-label={`Remove position ${i+1}`} onClick={()=>setRows(rows.filter((_,k)=>k!==i))}>×</button>
  </div>)}
  <div className="position-actions">
   <button type="button" className="text-button" disabled={rows.length>=20} onClick={()=>setRows([...rows,['0','0','0']])}>+ Add position</button>
   <button type="button" className="secondary" disabled={busy||!valid} onClick={()=>onSave(parsed)}>Save positions</button>
  </div>
 </div>;
}

// Preview plus hands-on positioning: click a part, drag its arrows, or nudge it in mm.
function PositionTool({assembly,assets,onPreview,onSaved,notify}:{assembly:Assembly;assets:Asset[];onPreview:(a:Assembly|null)=>void;onSaved:(a:Assembly)=>void;notify:(m:string)=>void}){
 const [editing,setEditing]=useState(false),[pick,setPick]=useState<PartPick|null>(null),[step,setStep]=useState(0.5);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const parts=assembly.components.flatMap(c=>{const asset=assets.find(a=>a.id===c.assetId);return asset?[{asset,color:c.color,positions:c.positions}]:[];});
 const comp=pick?assembly.components.find(c=>c.assetId===pick.assetId):undefined;
 const spots=comp?(comp.positions?.length?comp.positions:[[0,0,0]]):[];
 const current=pick?spots[pick.instance]:undefined;
 // Show the move instantly; save once you pause.
 const move=(p:PartPick,position:number[])=>{
  const next={...assembly,components:assembly.components.map(c=>{if(c.assetId!==p.assetId)return c;const list=(c.positions?.length?c.positions:[[0,0,0]]).map(x=>[...x]);list[p.instance]=position.map(n=>Math.round(n*100)/100);return {...c,positions:list};})};
  onPreview(next);
  clearTimeout(timer.current);
  timer.current=setTimeout(async()=>{
   const r=await fetch('/api/assemblies/'+assembly.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
   const body=await r.json().catch(()=>({}));
   if(!r.ok){notify(body.error||'Could not save position');return;}
   onSaved(body);onPreview(null);
  },700);
 };
 const nudge=(axis:number,dir:number)=>{if(!pick||!current)return;move(pick,current.map((n,i)=>i===axis?n+dir*step:n));};
 const name=pick?assets.find(a=>a.id===pick.assetId)?.name:'';
 return <div className="position-tool">
  <AssemblyPreview parts={parts} editing={editing?{selected:pick,onSelect:setPick,onMove:move}:undefined}/>
  <div className="position-bar">
   <button className={editing?'primary':'secondary'} onClick={()=>{setEditing(!editing);setPick(null);}}>{editing?'Done positioning':'Position parts'}</button>
   {editing&&!pick&&<span className="plate-meta">Click a part in the preview to select it.</span>}
  </div>
  {editing&&pick&&current&&<div className="nudge-panel" aria-label={`Position of ${name}`}>
   <strong>{name}{spots.length>1?` · copy ${pick.instance+1} of ${spots.length}`:''}</strong>
   <p className="plate-meta">Drag the arrows in the preview, or nudge below. Offsets are mm from where the STL sits.</p>
   {['X','Y','Z'].map((axis,i)=><div className="nudge-row" key={axis}>
    <span>{axis}</span>
    <button className="secondary" aria-label={`Move ${axis} down ${step} mm`} onClick={()=>nudge(i,-1)}>−</button>
    <output>{current[i].toFixed(2)}</output>
    <button className="secondary" aria-label={`Move ${axis} up ${step} mm`} onClick={()=>nudge(i,1)}>+</button>
   </div>)}
   <label className="nudge-step">Step<select value={step} onChange={e=>setStep(Number(e.target.value))}>{[0.1,0.25,0.5,1,5].map(n=><option key={n} value={n}>{n} mm</option>)}</select></label>
  </div>}
 </div>;
}

// Chip filled with the part's category color; text flips to white on dark colors.
function chipStyle(color?:string){
 if(!color)return undefined;
 const [r,g,b]=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 return {background:color,color:(0.299*r+0.587*g+0.114*b)>150?'#102d44':'#fff'};
}

// Static image of the assembled parts for list cards; renders once when missing or outdated.
function AssemblySnapshot({assembly,parts,onSaved,onOpen}:{assembly:Assembly;parts:SnapshotPart[];onSaved:(key:string)=>void;onOpen:()=>void}){
 const key=snapshotKey(parts),fresh=assembly.thumbKey===key,ref=useRef<HTMLButtonElement>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  if(fresh||failed||!ref.current||!parts.length)return;
  const io=new IntersectionObserver(([e])=>{if(!e.isIntersecting)return;io.disconnect();requestSnapshot(assembly.id,key,parts).then(ok=>ok?onSaved(key):setFailed(true));},{rootMargin:'300px'});
  io.observe(ref.current);return()=>io.disconnect();
 },[key,fresh,failed]);
 return <button ref={ref} className="assembly-snapshot" onClick={onOpen} aria-label={`Open ${assembly.name}`}>
  {fresh?<img src={`/api/assemblies/${assembly.id}/thumb?k=${key}`} alt="" loading="lazy"/>:<span>{!parts.length?'No STL preview':failed?'Preview unavailable':'Rendering preview…'}</span>}
 </button>;
}

// Assembly cards in your order: square snapshot, name, and parts tucked in a disclosure.
// Arrange mode: drag a card onto another, or use the arrow buttons (works on touch too).
function AssemblyGrid({items,search,assets,arranging,onReorder,onOpenAssembly,onOpenAsset,onEdit,onThumb}:{items:Assembly[];search:string;assets:Asset[];arranging:boolean;onReorder:(ids:string[])=>void;onOpenAssembly:(id:string)=>void;onOpenAsset:(id:string)=>void;onEdit:(a:Assembly)=>void;onThumb:(id:string,key:string)=>void}){
 const [dragging,setDragging]=useState<string|null>(null),[over,setOver]=useState<string|null>(null);
 const shown=items.filter(a=>`${a.name} ${a.sku} ${a.type}`.toLowerCase().includes(search.toLowerCase()));
 const ids=items.map(a=>a.id);
 const move=(id:string,to:number)=>{const next=ids.filter(x=>x!==id);next.splice(Math.max(0,Math.min(to,next.length)),0,id);onReorder(next);};
 return <div className={`assembly-grid${arranging?' arranging':''}`}>{shown.map(a=>{
  const i=ids.indexOf(a.id);
  const parts=a.components.flatMap(c=>{const asset=assets.find(x=>x.id===c.assetId);return asset?[{asset,color:c.color,positions:c.positions}]:[];});
  return <section key={a.id} className={`assembly-tile${dragging===a.id?' dragging':''}${over===a.id&&dragging!==a.id?' drop-target':''}`}
   draggable={arranging} onDragStart={e=>{setDragging(a.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setDragging(null);setOver(null);}}
   onDragOver={e=>{if(!dragging)return;e.preventDefault();setOver(a.id);}} onDrop={e=>{e.preventDefault();if(dragging&&dragging!==a.id)move(dragging,ids.indexOf(a.id));setDragging(null);setOver(null);}}>
   <AssemblySnapshot assembly={a} parts={parts} onSaved={key=>onThumb(a.id,key)} onOpen={()=>!arranging&&onOpenAssembly(a.id)}/>
   <h3><a href={`/library/assemblies/${a.id}`} onClick={e=>{e.preventDefault();if(!arranging)onOpenAssembly(a.id);}}>{a.name}</a></h3>
   <p>{a.type}{a.sku?` · ${a.sku}`:''}</p>
   {arranging?<div className="arrange-buttons">
    <button className="secondary" aria-label={`Move ${a.name} earlier`} disabled={i===0} onClick={()=>move(a.id,i-1)}>←</button>
    <button className="secondary" aria-label={`Move ${a.name} later`} disabled={i===ids.length-1} onClick={()=>move(a.id,i+1)}>→</button>
   </div>:<details className="tile-parts">
    <summary>Parts <span>{a.components.reduce((n,c)=>n+c.quantity,0)}</span></summary>
    <div className="part-chips-list">{a.components.map(c=>{const asset=assets.find(x=>x.id===c.assetId);return <button key={c.assetId} className="part-chip" style={chipStyle(asset?.categoryColor)} disabled={!asset} onClick={()=>onOpenAsset(c.assetId)}>{asset?.name || 'Missing asset'}{c.quantity>1?` × ${c.quantity}`:''}</button>;})}</div>
    <button className="text-button" onClick={()=>onEdit(a)}>Edit assembly</button>
   </details>}
  </section>;})}</div>;
}
