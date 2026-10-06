import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=path.join(os.homedir(),'Dropbox (Personal)/Work/Playcase/Product/Design Files/Phone Bases');
const files=fs.readdirSync(root).filter(n=>/\.(c4d|stl)$/i.test(n));
if(process.argv.includes('--dry-run')){console.log(files.join('\n'));process.exit(0);}
const site='https://spoolside.shelbyklein.com';const pin=fs.readFileSync(path.join(os.homedir(),'.config/spoolside/pin.txt'),'utf8').match(/PIN: (\d{6})/)[1];
const login=await fetch(site+'/login',{method:'POST',redirect:'manual',headers:{Origin:site},body:new URLSearchParams({pin})});const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('Login failed');
const headers={Cookie:cookie,Origin:site};
const post=async(url,options)=>{const r=await fetch(site+url,{method:'POST',...options});if(!r.ok)throw Error('Import failed: '+url);return r.json();};
for(const name of files){const source='Phone Bases/'+name;const meta={name:path.basename(name,path.extname(name)).replace(/[_-]/g,' '),source,type:'Phone Base',status:'Needs check'};const body=fs.readFileSync(path.join(root,name));
 if(/\.stl$/i.test(name))await post('/api/assets',{headers:{...headers,'Content-Type':'application/octet-stream','X-Asset':encodeURIComponent(JSON.stringify(meta))},body});
 else {const d=await post('/api/designfiles',{headers:{...headers,'Content-Type':'application/octet-stream','X-Design':encodeURIComponent(JSON.stringify({source,name}))},body});await post('/api/assets/phone-bases',{headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...meta,designId:d.id})});}
}
const all=await(await fetch(site+'/api/assets',{headers})).json();console.log(JSON.stringify({phoneBases:all.filter(a=>a.type==='Phone Base').length,total:all.length}));
