import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=path.join(os.homedir(),'Dropbox (Personal)/Work/Playcase/Product/Design Files');
export const designKey=name=>path.basename(name).replace(/\.[^.]+$/,'').toLowerCase().replace(/\bphone\b/g,'').replace(/[^a-z0-9]/g,'');
export function exactDesign(asset,designs){const key=designKey(path.basename(asset.source||asset.name));const matches=designs.filter(d=>!/[.]ai$/i.test(d.name) && designKey(d.name)===key && d.source.split('/')[0]===({Case:'Cases',Faceplate:'Faceplates',Part:'Parts',Sleeve:'Sleeves'}[asset.type]));return matches.length===1?matches[0]:null;}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):/\.(c4d|blend|f3d|step|stp|ai)$/i.test(e.name)?[path.join(dir,e.name)]:[]);
async function main(){
 const files=['Cases','Faceplates','Sleeves','Parts'].flatMap(d=>walk(path.join(root,d)));
 if(process.argv.includes('--dry-run')){console.log(files.map(f=>path.relative(root,f)).join('\n'));return;}
 const site='https://spoolside.shelbyklein.com';const pin=fs.readFileSync(path.join(os.homedir(),'.config/spoolside/pin.txt'),'utf8').match(/PIN: (\d{6})/)[1];
 const login=await fetch(site+'/login',{method:'POST',redirect:'manual',headers:{Origin:site},body:new URLSearchParams({pin})});const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('Login failed');
 const headers={Cookie:cookie,Origin:site};
 for(const f of files){const r=await fetch(site+'/api/designfiles',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Design':encodeURIComponent(JSON.stringify({source:path.relative(root,f),name:path.basename(f)}))},body:fs.readFileSync(f)});if(!r.ok)throw Error('Design upload failed: '+path.basename(f));}
 const designs=await(await fetch(site+'/api/designfiles',{headers})).json();const assets=await(await fetch(site+'/api/assets',{headers})).json();let linked=0;
 for(const asset of assets){if(asset.designFile)continue;const match=exactDesign(asset,designs);if(match){const r=await fetch(site+'/api/assets/'+asset.id+'/design',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({designId:match.id})});if(!r.ok)throw Error('Design link failed');linked++;}}
 console.log(JSON.stringify({designs:designs.length,newExactLinks:linked,unmatched:assets.filter(a=>!a.designFile&&!exactDesign(a,designs)).length}));
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e.message);process.exit(1);});
