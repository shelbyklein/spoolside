#!/usr/bin/env python3
"""Split unsliced Orca projects into single-plate projects, preserving settings.
Outputs are projects for manual slicing, never labelled printer-ready.
"""
import argparse, copy, hashlib, json, math, re, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD='http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
ET.register_namespace('',CORE);ET.register_namespace('p',PROD)
def md(e):return {m.get('key'):m.get('value') for m in e.findall('metadata')}
def xml(e):return ET.tostring(e,encoding='utf-8',xml_declaration=True)
def shift(t,dx,dy):
 a=list(map(float,t.split()));assert len(a)==12
 a[9]-=dx;a[10]-=dy
 return ' '.join(format(v,'.12g') for v in a)
def split(source,dest):
 with zipfile.ZipFile(source) as z:
  assert not any(n.endswith('.gcode') for n in z.namelist()),'Use the sliced-file importer for G-code archives'
  original=z.read('3D/3dmodel.model');model=ET.fromstring(original);config=ET.fromstring(z.read('Metadata/model_settings.config'))
  settings=json.loads(z.read('Metadata/project_settings.config'));plates=config.findall('plate');cols=math.ceil(math.sqrt(len(plates)))
  area=[tuple(map(float,p.split('x'))) for p in settings['printable_area']];width=max(p[0] for p in area)-min(p[0] for p in area);height=max(p[1] for p in area)-min(p[1] for p in area)
  objects={o.get('id'):o for o in config.findall('object')};build=model.find('{'+CORE+'}build');records=[]
  for index,plate in enumerate(plates):
   meta=md(plate);number=int(meta['plater_id']);assert number==index+1,'Unexpected plate order'
   instances=[(md(i)['object_id'],int(md(i)['instance_id'])) for i in plate.findall('model_instance')]
   if not instances:records.append({'plate':number,'skipped':'Empty plate'});continue
   selected=[];counts={}
   for item in build:
    oid=item.get('objectid');inst=counts.get(oid,0);counts[oid]=inst+1
    if (oid,inst) in instances:selected.append(copy.deepcopy(item))
   assert len(selected)==len(instances),'Missing instance in build'
   dx=(index%cols)*width*1.2;dy=-(index//cols)*height*1.2
   for item in selected:item.set('transform',shift(item.get('transform','1 0 0 0 1 0 0 0 1 0 0 0'),dx,dy))
   ids={i.get('objectid') for i in selected};cfg=copy.deepcopy(config)
   for e in list(cfg):
    if e.tag=='object' and e.get('id') not in ids:cfg.remove(e)
    elif e.tag=='plate':cfg.remove(e)
    elif e.tag=='assemble':
     for a in list(e):
      if a.get('object_id') not in ids:e.remove(a)
      else:a.set('transform',shift(a.get('transform'),dx,dy))
   p=copy.deepcopy(plate)
   for m in p.findall('metadata'):
    if m.get('key')=='plater_id':m.set('value','1')
    if m.get('key') in ['thumbnail_file','thumbnail_no_light_file','top_file','pick_file']:m.set('value',re.sub(r'_(\d+)\.png$',r'_1.png',m.get('value')))
   cfg.insert(len(cfg.findall('object')),p)
   mod=copy.deepcopy(model);b=mod.find('{'+CORE+'}build')
   for item in list(b):b.remove(item)
   b.extend(selected)
   # Retain only selected root resources; referenced external meshes remain byte-identical.
   res=mod.find('{'+CORE+'}resources')
   for e in list(res):
    if e.tag=='{'+CORE+'}object' and e.get('id') not in ids:res.remove(e)
   names=[]
   for oid in dict.fromkeys(i.get('objectid') for i in selected):
    obj=objects[oid];name=md(obj).get('name',oid)
    names.extend([md(part).get('name',name) for part in obj.findall('part')] if name=='Assembly' else [name])
   label=meta.get('plater_name') or ' + '.join(dict.fromkeys(names))
   label=re.sub(r'\.stl','',label,flags=re.I);label=re.sub(r'[^\w .+()-]','-',label)[:100].strip()
   filename=f'{number:02d} - {label}.3mf';target=dest/filename
   assert not target.exists(),'Refuse overwrite: '+str(target)
   with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as out:
    for n in z.namelist():
     if n=='3D/3dmodel.model':out.writestr(n,xml(mod))
     elif n=='Metadata/model_settings.config':out.writestr(n,xml(cfg))
     elif re.match(r'Metadata/(plate(_no_light)?|top|pick)_\d+',n):
      suffix=re.search(r'_(\d+)(?:_small)?\.(?:png|json)$',n)
      if suffix and int(suffix[1])==number and n.endswith('.png'):out.writestr(re.sub(r'_\d+((?:_small)?\.png)$',r'_1\1',n),z.read(n))
     else:out.writestr(n,z.read(n))
   with zipfile.ZipFile(target) as out:
    assert out.testzip() is None
    assert out.read('Metadata/project_settings.config')==z.read('Metadata/project_settings.config')
    for n in z.namelist():
     if n.startswith('3D/Objects/'):assert out.read(n)==z.read(n)
    assert len(ET.fromstring(out.read('Metadata/model_settings.config')).findall('plate'))==1
    assert len(ET.fromstring(out.read('3D/3dmodel.model')).find('{'+CORE+'}build'))==len(instances)
   records.append({'plate':number,'name':label,'file':filename,'objects':names,'instances':len(instances),'printableInstances':sum(i.get('printable','1')=='1' for i in selected),'plateTranslationRemoved':[dx,dy],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sliced':False})
  return {'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'printer':settings.get('printer_settings_id'),'filaments':settings.get('filament_type'),'plates':records}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('source',type=Path);a.add_argument('--output',required=True,type=Path);args=a.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 result=split(args.source,args.output);(args.output/'manifest.json').write_text(json.dumps(result,indent=2));print(json.dumps({'output':str(args.output),'projects':sum('file' in p for p in result['plates']),'emptyPlates':sum('skipped' in p for p in result['plates'])}))
