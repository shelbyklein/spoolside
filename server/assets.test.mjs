import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Assets, inspectStl } from "./assets.mjs";
import { classify } from "../scripts/import-assets.mjs";

// One-triangle binary STL spanning 10 × 20 × 0 mm.
const stl = () => {
  const b = Buffer.alloc(134);
  b.writeUInt32LE(1, 80);
  [[0, 0, 0], [10, 0, 0], [0, 20, 0]].forEach((v, i) => v.forEach((x, a) => b.writeFloatLE(x, 84 + 12 + i * 12 + a * 4)));
  return b;
};

test("STL inspection rejects non-models and measures size", () => {
  assert.deepEqual(inspectStl(stl()), { triangles: 1, size: [10, 20, 0] });
  assert.throws(() => inspectStl(Buffer.from("hello")), /STL/);
});

test("re-importing a source keeps the reviewed status and note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-assets-"));
  const assets = new Assets(":memory:", dir);
  try {
    const a = assets.add({ name: "DS – Top", type: "Faceplate", status: "Current", source: "Faceplates/DS/DS - Top.stl", fit: { style: "DS" } }, stl());
    assets.update(a.id, { status: "Retired", note: "Old" });
    const again = assets.add({ name: "DS – Top", type: "Faceplate", status: "Current", source: "Faceplates/DS/DS - Top.stl", fit: { style: "DS" } }, stl());
    assert.equal(again.id, a.id);
    assert.equal(again.status, "Retired");
    assert.equal(again.note, "Old");
    assert.throws(() => assets.update(a.id, { status: "Maybe" }), /status/);
    assert.equal(assets.list().length, 1);
    assets.remove(a.id);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    assets.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("import rules follow the confirmed Gen 3 decisions", () => {
  assert.equal(classify("Cases/15/Handheld - Bottom - Chamfer.stl"), null);
  assert.equal(classify("Cases/16/iPhone 16 Pro Case.stl").status, "Retired");
  assert.equal(classify("Cases/16/iPhone 16 Pro Phone Case.stl").fit.phone, "iPhone 16 Pro");
  assert.equal(classify("Faceplates/SNES/SNES - Top.stl").status, "Retired");
  assert.deepEqual(classify("Faceplates/SNES/Ridges/SNES - Top.stl").fit, { style: "Classic", size: "Standard", piece: "Top" });
  assert.equal(classify("Faceplates/DS/Plus/DS Plus - Bottom.stl").fit.size, "Plus");
  assert.equal(classify("Faceplates/MAME/MAME - Top.stl").status, "Experimental");
  assert.equal(classify("Parts/2026/Faceplate Trigger Touch Points 5.6.stl").status, "Retired");
  assert.equal(classify("Parts/2026/start select membrane v2.stl").status, "Retired");
  assert.equal(classify("Parts/2026/abxy outie.stl").fit.style, "Classic");
  assert.equal(classify("Parts/2026/Orca/Insert.3mf"), null);
  assert.equal(classify("Parts/2026/dpad.stl"), null);
  assert.equal(classify("Parts/2026/dpad membrane soft.stl").name, "D-pad Membrane (Soft)");
  assert.deepEqual([classify("Parts/2026/Triggers 2026.stl").name, classify("Parts/2026/Triggers 2026.stl").status], ["Paddle", "Current"]);
  assert.deepEqual([classify("Parts/2026/DS Trigger.stl").name, classify("Parts/2026/DS Trigger.stl").status], ["DS Faceplate Bridge", "Current"]);
});

test('sleeves and assemblies preserve asset references; design is required for completeness',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spoolside-assemblies-'));const library=new Assets(':memory:',dir);
 try {
 const sleeve=library.add({name:'DS Sleeve',type:'Sleeve',source:'Faceplate Sleeves/ds sleeve.stl'},stl());assert.equal(sleeve.complete,false);
 const design=library.addDesign({name:'DS.c4d',source:'Faceplates/DS/DS.c4d'},Buffer.from('design project'));
 library.linkDesign(sleeve.id,design.id);assert.equal(library.get(sleeve.id).complete,true);
 const assembly=library.saveAssembly({name:'DS',sku:'DS',type:'Faceplate',components:[{assetId:sleeve.id,quantity:1}]});
 assert.equal(library.assemblies()[0].id,assembly.id);assert.throws(()=>library.remove(sleeve.id),/assembly/);
 assert.throws(()=>library.saveAssembly({...assembly,components:[{assetId:'missing',quantity:1}]}),/Invalid/);
 assert.throws(()=>library.saveAssembly({...assembly,components:[{assetId:sleeve.id,quantity:0}]}),/Invalid/);
 library.linkDesign(sleeve.id,null);assert.equal(library.get(sleeve.id).complete,false);library.deleteAssembly(assembly.id);library.remove(sleeve.id);
 }finally{library.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('design auto linking only accepts unique exact source names; sleeve imports stay unverified',async()=>{
 const {exactDesign}=await import('../scripts/import-designs.mjs');
 const asset={source:'Cases/16/iPhone 16 Pro Phone Case.stl',type:'Case'};const design={id:'a',name:'Iphone 16 Pro Case.c4d',source:'Cases/16/Iphone 16 Pro Case.c4d'};
 assert.equal(exactDesign(asset,[design]).id,'a');assert.equal(exactDesign(asset,[design,{...design,id:'b',source:'Cases/Iphone 16 Pro Case.c4d'}]),null);
 assert.equal(exactDesign({type:'Part',source:'Parts/2026/Triggers 2026.stl'},[{name:'Parts 2026.c4d',source:'Parts/Parts 2026.c4d'}]),null);
 assert.equal(classify('Faceplate Sleeves/ds plus sleeve.stl').fit.size,'Plus');assert.equal(classify('Faceplate Sleeves/red.stl').status,'Needs check');
});
