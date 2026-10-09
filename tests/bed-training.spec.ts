import {test,expect} from '@playwright/test';

test('held printer can be taught using the displayed photo and explicit confirmation',async({browser})=>{
 const context=await browser.newContext({viewport:{width:428,height:926},serviceWorkers:'block'}),page=await context.newPage();let saved:any=null;
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/workspace')return route.fulfill({json:{revision:1,orders:[],jobs:[],spools:[],machines:[{id:"P1",name:"AMS 3",state:"Ready",rawState:"FINISH",connected:true,stale:false,trays:[],hasAms:true,job:"",progress:0,remaining:"—",material:""}],lastSync:new Date().toISOString(),syncError:null}});
  if(url.pathname==='/api/dispatch')return route.fulfill({json:{offers:[],held:[{printer:'P1',printerName:'AMS 3',reason:'White fixture visible'}],available:[]}});
  if(url.pathname.endsWith('/reference/capture'))return route.fulfill({json:{id:'photo-1',at:Date.now()}});
  if(url.pathname.endsWith('/photo.jpg'))return route.fulfill({path:'public/spoolside.png'});
  if(url.pathname.endsWith('/reference')){saved=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}
  if(url.pathname==='/api/watches')return route.fulfill({json:{watches:[],recent:[]}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search})});
 });
 await page.goto('https://spoolside.shelbyklein.com/printers');await page.getByRole('button',{name:'Teach bed check'}).click();
 const dialog=page.getByRole('dialog',{name:'Teach AMS 3 bed check'});await expect(dialog).toBeVisible();
 const save=dialog.getByRole('button',{name:'Save empty-bed reference'});await expect(save).toBeDisabled();
 await expect(dialog.getByRole('img',{name:'AMS 3 bed to confirm'})).toBeVisible();await dialog.getByLabel('This photo shows an empty bed').check();
 await dialog.getByLabel('Note (optional)').fill('White circle is a fixture beside the bed');await expect(save).toBeEnabled();
 await page.screenshot({path:'handoff/spoolside-bed-training-mobile.png'});
 await save.click();await expect(dialog).toHaveCount(0);expect(saved).toEqual({capture:'photo-1',clear:true,note:'White circle is a fixture beside the bed'});
 await page.goto('https://spoolside.shelbyklein.com/overview');
 await page.getByRole('button',{name:/AMS 3/}).first().click();
 const details=page.getByRole('dialog',{name:'AMS 3 details'});await expect(details).toBeVisible();
 await details.getByRole('button',{name:'Teach bed check'}).click();await expect(dialog).toBeVisible();await expect(details).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await context.close();
});
