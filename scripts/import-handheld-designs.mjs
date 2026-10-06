// Targeted import of the verified editable Handheld split; native designs stay outside Git.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.join(os.homedir(),'Dropbox (Personal)/Work/Playcase/Product/Design Files/Extracted/Handheld');
const site='https://spoolside.shelbyklein.com';
const links=[
 ['Handheld - Top.c4d','a55c097d-9197-4397-8c5e-66ffdc251981'],
 ['Handheld - Bottom.c4d','31b801ec-d442-4fe8-8f2c-939e9c437395'],
 ['Handheld - D-pad.c4d','d56af1d6-6601-423f-a9f5-4a8d2fc987ca'],
 ['Handheld - Start Button.c4d','f67a5eeb-7770-4556-b068-137743d5375d'],
 ['Handheld - Touch Pin.c4d','23722cc9-36b0-4308-afaa-ff4490e8f325'],
];
const additions=[
 {assetId:'d56af1d6-6601-423f-a9f5-4a8d2fc987ca',quantity:1,positions:[[.01,-.18,-2.85]]},
 {assetId:'f67a5eeb-7770-4556-b068-137743d5375d',quantity:2,positions:[[-.05,.01,-1.73],[-10.79,.01,-1.73]]},
 // Measured Top openings; display caps approximately 1 mm above the surface.
 {assetId:'cb2a5902-2ba8-4e0e-914d-b7305b03da87',quantity:2,positions:[[-.02,0,-2.2],[-13.97,-6.51,-2.2]]},
];
const assemblyId='2386a769-d054-45e2-95ee-ca8d731d8d84';
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const files=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).files.map(f=>{
 const body=fs.readFileSync(path.join(root,f.file));if(hash(body)!==f.sha256)throw Error('Split changed: '+f.file);
 return {...f,body,source:'Extracted/Handheld/'+f.file};
});
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({designs:files.map(f=>f.source),exactGeometryLinks:links,standardAssemblyAdditions:additions,partsConfirmed:false},null,2));
}else{
 const pin=fs.readFileSync(path.join(os.homedir(),'.config/spoolside/pin.txt'),'utf8').match(/PIN: (\d{8})/)?.[1];if(!pin)throw Error('Private PIN missing');
 const login=await fetch(site+'/login',{method:'POST',redirect:'manual',headers:{Origin:site},body:new URLSearchParams({pin})});const cookie=login.headers.get('set-cookie')?.split(';')[0];if(login.status!==303||!cookie)throw Error('Login failed');
 const headers={Cookie:cookie,Origin:site};
 async function api(route,options={}){const r=await fetch(site+route,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error(route+': '+r.status);return r;}
 const read=async route=>(await api(route)).json();
 const jsonPut=(route,body)=>api(route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const designs=await read('/api/designfiles');let linked=0,added=0;const skipped=[];
 for(const f of files){
  let d=designs.find(d=>d.source===f.source);
  if(d&&d.hash!==f.sha256)throw Error('Existing design changed: '+f.file);
  d=d||await(await api('/api/designfiles',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Design':encodeURIComponent(JSON.stringify({source:f.source,name:f.file}))},body:f.body})).json();
  if(hash(Buffer.from(await(await api('/api/designfiles/'+d.id+'/download')).arrayBuffer()))!==f.sha256)throw Error('Download mismatch: '+f.file);
  const id=links.find(([name])=>name===f.file)?.[1];if(!id)continue;
  const asset=(await read('/api/assets')).find(a=>a.id===id);if(!asset)throw Error('Expected asset missing');
  if(asset.designFile){if(asset.designFile.id!==d.id)skipped.push(asset.name+': existing design kept');continue;}
  await jsonPut('/api/assets/'+id+'/design',{designId:d.id});
  if((await read('/api/assets')).find(a=>a.id===id)?.designFile?.id!==d.id)throw Error('Link readback failed');linked++;
 }
 // Re-read immediately before writing; never override existing parts or restore removed parts.
 const assemblies=await read('/api/assemblies'),assembly=assemblies.find(a=>a.id===assemblyId);if(!assembly)throw Error('Standard assembly missing');
 const fresh=additions.filter(c=>!assembly.components.some(p=>p.assetId===c.assetId)&&!assembly.removed?.some(p=>p.assetId===c.assetId));
 if(fresh.length){const saved=await(await jsonPut('/api/assemblies/'+assemblyId,{...assembly,components:[...assembly.components,...fresh],partsConfirmed:false})).json();
  const actual=(await read('/api/assemblies')).find(a=>a.id===assemblyId);if(JSON.stringify(actual)!==JSON.stringify(saved))throw Error('Assembly readback failed');added=fresh.length;}
 console.log(JSON.stringify({designsVerified:files.length,newLinks:linked,assemblyPartsAdded:added,skipped,assemblyConfirmed:false}));
}
