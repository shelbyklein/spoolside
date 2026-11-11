import {test,expect} from '@playwright/test';

test('held printer can be taught using the displayed photo and explicit confirmation',async({browser})=>{
 const context=await browser.newContext({viewport:{width:428,height:926},serviceWorkers:'block'}),page=await context.newPage();let saved:any=null,captures=0;
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/workspace')return route.fulfill({json:{revision:1,orders:[],jobs:[],spools:[],machines:[{id:"P1",name:"AMS 3",state:"Ready",rawState:"FINISH",connected:true,stale:false,trays:[],hasAms:true,job:"",progress:0,remaining:"—",material:""}],lastSync:new Date().toISOString(),syncError:null}});
  if(url.pathname==='/api/dispatch')return route.fulfill({json:{offers:[],held:[{printer:'P1',printerName:'AMS 3',reason:'White fixture visible'}],available:[]}});
  // The second photo comes back with the older box saved for this printer.
  if(url.pathname.endsWith('/reference/capture')){captures++;return route.fulfill({json:{id:'photo-'+captures,at:Date.now(),area:captures>1?{left:0.1,top:0.5,right:0.6,bottom:0.95}:null}});}
  if(url.pathname.endsWith('/photo.jpg'))return route.fulfill({path:'public/spoolside.png'});
  if(url.pathname.endsWith('/reference')){saved=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}
  if(url.pathname==='/api/watches')return route.fulfill({json:{watches:[],recent:[]}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:[]});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search})});
 });
 await page.goto('https://spoolside.shelbyklein.com/printers');await page.getByRole('button',{name:'Teach empty bed'}).click();
 const dialog=page.getByRole('dialog',{name:'Teach AMS 3 bed check'});await expect(dialog).toBeVisible();
 const save=dialog.getByRole('button',{name:'Save empty-bed reference'});await expect(save).toBeDisabled();
 await expect(dialog.getByRole('img',{name:'AMS 3 bed to confirm'})).toBeVisible();await dialog.getByLabel('This photo shows an empty bed').check();
 await dialog.getByLabel('Note (optional)').fill('White circle is a fixture beside the bed');await expect(save).toBeEnabled();
 // Tap the plate's four corners as the camera sees them, in any order; then drag one to adjust.
 const photo=dialog.locator('.plate-box');const b=(await photo.boundingBox())!;
 const tap=(x:number,y:number)=>page.mouse.click(b.x+b.width*x,b.y+b.height*y);
 await expect(dialog).toContainText("Optional: tap the plate's four corners.");
 await tap(0.42,0.46);await expect(dialog).toContainText('Tap the next corner (1 of 4).');
 await tap(0.05,0.98);await tap(0.56,0.9);
 await expect(dialog.getByLabel('Marked plate area')).toHaveCount(0);
 await tap(0.02,0.5);
 await expect(dialog.getByLabel('Marked plate area')).toBeVisible();
 await expect(dialog).toContainText('Drag a corner to adjust.');
 await page.mouse.move(b.x+b.width*0.56,b.y+b.height*0.9);await page.mouse.down();await page.mouse.move(b.x+b.width*0.6,b.y+b.height*0.94,{steps:4});await page.mouse.up();
 await dialog.screenshot({path:'handoff/spoolside-mark-plate.png'});
 await page.screenshot({path:'handoff/spoolside-bed-training-mobile.png'});
 await save.click();await expect(dialog).toHaveCount(0);expect(saved).toMatchObject({capture:'photo-1',clear:true,note:'White circle is a fixture beside the bed'});
 // The corners go round the plate in order, with the dragged one moved.
 const q=saved.area.quad as [number,number][];expect(q).toHaveLength(4);
 const want=[[0.02,0.5],[0.42,0.46],[0.6,0.94],[0.05,0.98]];
 for(const [x,y] of want)expect(q.some(([qx,qy])=>Math.abs(qx-x)<0.02&&Math.abs(qy-y)<0.02)).toBeTruthy();
 const cx=q.reduce((n,p)=>n+p[0],0)/4,cy=q.reduce((n,p)=>n+p[1],0)/4,angles=q.map(([x,y])=>Math.atan2(y-cy,x-cx));
 expect([...angles].sort((a,b)=>a-b)).toEqual(angles);
 await page.goto('https://spoolside.shelbyklein.com/overview');
 await page.getByRole('button',{name:/AMS 3/}).first().click();
 const details=page.getByRole('dialog',{name:'AMS 3 details'});await expect(details).toBeVisible();
 await details.getByRole('button',{name:'Teach bed check'}).click();await expect(dialog).toBeVisible();await expect(details).toHaveCount(0);
 // A printer marked with the older box opens with its four corners, ready to adjust.
 await expect(dialog.getByLabel('Marked plate area')).toBeVisible();await expect(dialog.getByLabel(/^Corner \d$/)).toHaveCount(4);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await context.close();
});
