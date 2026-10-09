import {test,expect} from '@playwright/test';

test('Overview uploads prints and assets directly on desktop and phone',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
 const uploads:string[]=[];
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/workspace') return route.fulfill({json:{revision:1,orders:[],jobs:[],spools:[],machines:[],lastSync:new Date().toISOString(),syncError:null}});
  if(url.pathname==='/api/dispatch') return route.fulfill({json:{offers:[],held:[],available:[]}});
  if(url.pathname==='/api/watches') return route.fulfill({json:{watches:[],recent:[]}});
  if(url.pathname==='/api/categories') return route.fulfill({json:[]});
  if(url.pathname==='/api/library' && route.request().method()==='POST') {uploads.push('print');return route.fulfill({json:[{id:'new-print',name:'Test plate',replaced:false}]});}
  if(url.pathname==='/api/assets' && route.request().method()==='POST') {uploads.push('asset');return route.fulfill({json:{id:'new-asset',name:'Test part'}});}
  if(url.pathname.startsWith('/api/')) return route.fulfill({json:[]});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search})});
 });
 await page.goto('https://spoolside.shelbyklein.com/overview');
 await expect(page.getByRole('button',{name:'Upload print',exact:true})).toBeVisible();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload print',exact:true}).click();
 await (await chooser).setFiles({name:'Test.gcode.3mf',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});
 await expect.poll(()=>uploads).toEqual(['print']);
 await expect(page).toHaveURL(/overview$/);
 await page.getByRole('button',{name:'Upload asset',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Upload library item'});await expect(dialog).toBeVisible();
 await dialog.getByLabel('STL file',{exact:true}).setInputFiles({name:'Test part.stl',mimeType:'application/octet-stream',buffer:Buffer.from('solid part\nendsolid part')});
 await dialog.getByRole('button',{name:'Add to library'}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(()=>uploads).toEqual(['print','asset']);
 await page.screenshot({path:'handoff/spoolside-overview-upload-shortcuts.png'});
 await page.setViewportSize({width:428,height:926});
 await expect(page.getByRole('button',{name:'Upload print',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Upload asset',exact:true}).click();await expect(dialog).toBeVisible();
 const box=(await dialog.boundingBox())!;expect(box.width).toBeLessThanOrEqual(428);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.screenshot({path:'handoff/spoolside-overview-upload-shortcuts-mobile.png'});
 await context.close();
});
