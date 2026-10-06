import {test,expect} from '@playwright/test';
test('filament restock uses two columns without inventory and keeps ZIP quotes separate',async({page})=>{
 const materialId='proto-conductive';
 let catalog={settings:{zip:'30360',sort:'fastest'},materials:[{id:materialId,name:'Proto-pasta Conductive PLA',usage:'Other parts',url:'https://proto-pasta.com/products/conductive-pla',offers:[{id:'offer',materialId,seller:'Proto-pasta',label:'Black 1.75mm 500g',grams:500,price:49.99,available:true,refill:false,url:'https://proto-pasta.com/products/conductive-pla',source:'live',checked:new Date().toISOString(),stale:false,arrival:null as string|null,shipping:null as number|null,delivered:null as number|null,deliveredPerKg:null as number|null,perKg:99.98}]}]};
 let state:any={revision:1,orders:[],jobs:[],spools:[],machines:[],lastSync:new Date().toISOString(),syncError:null};
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
 const url=new URL(route.request().url());const method=route.request().method();
 if(url.pathname==='/api/materials/settings'){const b=route.request().postDataJSON();catalog.settings={...catalog.settings,...b};catalog.materials[0].offers[0]={...catalog.materials[0].offers[0],arrival:null,shipping:null,delivered:null,deliveredPerKg:null};return route.fulfill({json:catalog});}
 if(url.pathname==='/api/material-offers'){const b=route.request().postDataJSON();expect(b.id).toBe('offer');catalog.materials[0].offers[0]={...catalog.materials[0].offers[0],arrival:b.arrival,shipping:Number(b.shipping),delivered:59.99,deliveredPerKg:119.98};return route.fulfill({json:catalog});}
 if(url.pathname==='/api/materials')return route.fulfill({json:catalog});
 if(url.pathname==='/api/workspace'){if(method==='PUT')state={...route.request().postDataJSON(),revision:state.revision+1};return route.fulfill({json:state});}
 if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
 const response=await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search});return route.fulfill({response});
 });
 await page.setViewportSize({width:428,height:926});await page.goto('https://spoolside.shelbyklein.com/filament');
 await expect(page.getByLabel('Delivery ZIP')).toHaveValue('30360');await expect(page.getByLabel('Sort restock offers')).toHaveValue('fastest');await expect(page.getByText('Arrival unknown',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Spool',exact:true})).toHaveCount(0);
 await expect(page.getByText('No spools recorded')).toHaveCount(0);
 await page.getByRole('button',{name:'Set shipping quote'}).click();await page.getByLabel('Shipping cost (USD)').fill('10');await page.getByLabel('Latest estimated arrival').fill('2099-10-10');await page.getByRole('button',{name:'Save quote'}).click();await expect(page.getByText('Quote for 30360')).toBeVisible();
 await page.getByLabel('Delivery ZIP').fill('10001');await page.getByLabel('Delivery ZIP').blur();await expect(page.getByText('Arrival unknown',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.setViewportSize({width:1440,height:1000});
 expect(await page.locator('.material-cards').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);

});
