import {test,expect} from '@playwright/test';
test('print filters combine printer override, linked type, category, material and search',async({page})=>{
 const assets=[{id:'pin',name:'Touch Pin',type:'Part',category:'conductive',hasStl:true,fit:{phone:'',style:'',size:'',piece:''},status:'Up to date'},{id:'case',name:'Phone Case',type:'Case',hasStl:true,fit:{phone:'',style:'',size:'',piece:''},status:'Up to date'}];
 const plate=(asset:string,material:string)=>[{index:1,minutes:10,grams:2,filaments:[{id:1,type:material,color:'#000000'}],coverage:asset?[{assetId:asset,hash:'x'}]:[]}];
 const files=[{id:'pins',name:'Pin batch',printer:'p1',preferredPrinter:'p1',preferredPrinterName:'Conductive',plates:plate('pin','PLA')},{id:'case',name:'Case batch',preferredPrinter:'p2',preferredPrinterName:'AMS 3',plates:plate('case','TPU-AMS')},{id:'other',name:'Loose print',plates:plate('','PLA')}].map(f=>({...f,created:'',size:100}));
 await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p==='/api/library'?files:p==='/api/assets'?assets:p==='/api/categories'?[{id:'conductive',name:'Conductive',color:'#000'}]:[]});});
 await page.goto('/library/sliced');const cards=page.locator('.sliced-card');await expect(cards).toHaveCount(3);
 await page.getByLabel('Filter by printer').selectOption('override');await expect(cards).toHaveCount(1);await expect(cards).toContainText('Pin batch');
 await page.getByLabel('Filter by part type').selectOption('Case');await expect(cards).toHaveCount(0);await expect(page.getByText('No prints match these filters.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters'}).click();
 await page.getByLabel('Filter by category').selectOption('conductive');await page.getByLabel('Filter by material').selectOption('PLA');await page.getByLabel('Search sliced prints').fill('Touch Pin');await expect(cards).toHaveCount(1);
 await page.screenshot({path:'handoff/spoolside-print-filters-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'handoff/spoolside-print-filters-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'Clear filters'}).click();await page.getByLabel('Filter by printer').selectOption('p2');await expect(cards).toContainText('Case batch');
 await page.getByRole('button',{name:'Clear filters'}).click();await page.getByLabel('Filter by part type').selectOption('unlinked');await expect(cards).toContainText('Loose print');
});
