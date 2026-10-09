import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Library} from './library.mjs';import {Projects} from './projects.mjs';
const fixture=fs.readFileSync(new URL('./fixtures/plate.gcode.3mf',import.meta.url));
test('project files and printable plates are isolated from products and other projects',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spoolside-projects-'));const l=new Library(':memory:',dir),p=new Projects(l);
 try{const [product]=l.add('Plate',fixture);const a=p.save(null,'Test project','Notes'),b=p.save(null,'Other project');
 p.upload(a.id,'Part.stl',Buffer.from('solid test'));p.upload(a.id,'Plate.gcode.3mf',fixture);p.upload(b.id,'Plate.gcode.3mf',fixture);
 assert.equal(p.get(a.id).files.length,2);assert.equal(p.get(a.id).prints.length,1);assert.equal(p.get(a.id).prints[0].scope,'personal');
 assert.notEqual(p.get(a.id).prints[0].id,p.get(b.id).prints[0].id);assert.notEqual(product.id,p.get(a.id).prints[0].id);
 p.upload(a.id,'Plate.gcode.3mf',fixture);assert.equal(p.get(a.id).prints.length,1,'reupload replaces within project');
 const file=p.get(a.id).files.find(f=>f.name==='Part.stl');assert.deepEqual(fs.readFileSync(p.file(a.id,file.id).path),Buffer.from('solid test'));assert.throws(()=>p.file(b.id,file.id),/Unknown/);
 assert.throws(()=>p.upload(a.id,'evil.exe',Buffer.from('x')),/Choose/);p.remove(a.id);assert.equal(p.get(a.id),undefined);assert.ok(l.get(product.id));assert.equal(p.get(b.id).prints.length,1);
 assert.equal(l.metadata(product.id).plates.length,1);
 }finally{l.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('metadata exposes slicer printer, bed and nozzle settings without inventing absent values',async()=>{
 const {zipWrite}=await import('./library.mjs');const {crc32}=await import('node:zlib');
 const packed=(name,text)=>{const data=Buffer.from(text);return {name,data,method:0,crc:crc32(data),usize:data.length};};
 const buf=zipWrite([packed('Metadata/plate_1.gcode','; layer_height = 0.2\nG1 X0'),packed('Metadata/project_settings.config',JSON.stringify({printer_model:'Bambu Lab A1 mini',curr_bed_type:'Textured PEI Plate',nozzle_diameter:['0.4'],private_key:'omit'}))]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spoolside-metadata-')),l=new Library(':memory:',dir);
 try{const [f]=l.add('Metadata test',buf);assert.deepEqual(l.metadata(f.id).settings,{printer_model:'Bambu Lab A1 mini',nozzle_diameter:['0.4'],curr_bed_type:'Textured PEI Plate',layer_height:'0.2'});}finally{l.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('project APIs require sign-in and origin, store uploads and return original downloads',async()=>{
 const {createApp}=await import('./app.mjs');const {scryptSync}=await import('node:crypto');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spoolside-project-api-')),l=new Library(':memory:',dir),salt='a'.repeat(32);
 const {app,close}=createApp({library:l,pinHash:salt+':'+scryptSync('12345678',salt,64).toString('hex'),origin:'http://localhost',secure:false});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(base+'/api/projects')).status,401);const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:'http://localhost'},body:new URLSearchParams({pin:'12345678'})});const cookie=login.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,Origin:'http://localhost','Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify({name:'Test'})})).status,403);
 const p=await(await fetch(base+'/api/projects',{method:'POST',headers,body:JSON.stringify({name:'Test'})})).json();
 const uploaded=await(await fetch(base+`/api/projects/${p.id}/files`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'Test.stl'},body:'solid test'})).json();
 assert.equal(uploaded.files.length,1);const f=uploaded.files[0];assert.equal(await(await fetch(base+`/api/projects/${p.id}/files/${f.id}`,{headers:{Cookie:cookie}})).text(),'solid test');
 }finally{await new Promise(r=>server.close(r));close();l.close();fs.rmSync(dir,{recursive:true,force:true});}
});
