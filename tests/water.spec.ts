import {test,expect} from '@playwright/test';

test('water ripples follow mouse and touch without moving the pool',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{
  const original=WebGLRenderingContext.prototype.uniform4fv;
  WebGLRenderingContext.prototype.uniform4fv=function(location,value){
   (window as any).waterRipples=Array.from(value as Float32Array);
   return original.call(this,location,value);
  };
 });
 const page=await context.newPage(); const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 const canvas=page.locator('.sidebar-water'); await expect(canvas).toBeVisible();
 const box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.55);
 await expect.poll(()=>page.evaluate(()=>(window as any).waterRipples?.some((v:number,i:number)=>i%4===3&&v>0))).toBeTruthy();
 await page.waitForTimeout(500);
 await canvas.screenshot({path:'handoff/spoolside-water-ripple-desktop.png'});
 const mouse=await page.evaluate(()=>(window as any).waterRipples);
 expect(mouse[0]).toBeCloseTo(.5,2);expect(mouse[1]).toBeCloseTo(.45,2);
 await page.setViewportSize({width:428,height:926});
 const home=page.locator('.home-water');await expect(home).toBeVisible();
 const rect=(await home.boundingBox())!;
 await home.evaluate((el,{x,y})=>el.parentElement!.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,pointerType:'touch',bubbles:true})),{x:rect.x+rect.width*.5,y:rect.y+rect.height*.4});
 await expect.poll(()=>page.evaluate(()=>(window as any).waterRipples?.some((v:number,i:number)=>i%4===3&&v===1))).toBeTruthy();
 await page.waitForTimeout(500);
 await page.screenshot({path:'handoff/spoolside-water-ripple-mobile.png'});
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect.poll(()=>page.evaluate(()=>(window as any).waterRipples?.every((v:number)=>v===0))).toBeTruthy();
 expect(errors).toEqual([]);await context.close();
});

test('dragging the spool hides app information, leaves waves and returns home on mouse and touch release',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 const spool=page.locator('.sidebar .floating-spool');const home=(await spool.boundingBox())!;
 await page.mouse.move(home.x+home.width/2,home.y+home.height/2);await page.mouse.down();
 await page.mouse.move(home.x+home.width/2+20,home.y+home.height/2-280,{steps:15});
 await expect(page.locator('.sidebar')).toHaveClass(/spool-dragging/);
 await expect.poll(()=>page.locator('.sidebar nav').evaluate(el=>Number(getComputedStyle(el).opacity))).toBeLessThan(.05);
 const dragged=(await spool.boundingBox())!;expect(dragged.y).toBeLessThan(home.y-200);
 await page.screenshot({path:'handoff/spoolside-drag-desktop.png'});
 await page.mouse.up();await expect(page.locator('.sidebar')).not.toHaveClass(/spool-dragging/);
 await expect.poll(async()=>Math.abs((await spool.boundingBox())!.y-home.y),{timeout:4000}).toBeLessThan(2);
 await expect.poll(()=>page.locator('.sidebar nav').evaluate(el=>Number(getComputedStyle(el).opacity))).toBeGreaterThan(.95);
 await page.setViewportSize({width:428,height:926});
 const phoneSpool=page.locator('.water-home .floating-spool');await expect(phoneSpool).toBeVisible();
 const original=(await phoneSpool.boundingBox())!;
 // Real pointer capture needs a trusted press. Chromium's touchscreen input dispatches it.
 const client=await context.newCDPSession(page);
 const x=original.x+original.width/2,y=original.y+original.height/2;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+70,y:y+100}]});
 await expect(page.locator('.water-home')).toHaveClass(/spool-dragging/);
 await expect.poll(()=>page.locator('.home-pills').evaluate(el=>Number(getComputedStyle(el).filter.match(/opacity\((.*?)\)/)?.[1]))).toBeLessThan(.05);
 expect((await phoneSpool.boundingBox())!.x).toBeGreaterThan(original.x+50);
 await page.screenshot({path:'handoff/spoolside-drag-mobile.png'});
 await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await expect(page.locator('.water-home')).not.toHaveClass(/spool-dragging/);
 await expect.poll(async()=>Math.abs((await phoneSpool.boundingBox())!.x-original.x),{timeout:4000}).toBeLessThan(2);
 await page.emulateMedia({reducedMotion:'reduce'});
 await phoneSpool.focus();await page.keyboard.press('ArrowLeft');
 await expect.poll(()=>phoneSpool.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
 expect(errors).toEqual([]);await context.close();
});

test('five printer pills clear the phone tabs and floating orders respond to waves while dragging',async({browser})=>{
 const context=await browser.newContext({viewport:{width:428,height:926},serviceWorkers:'block'});const page=await context.newPage();
 const machines=['AMS 2','AMS 3','Conductive','Desk','Membrane'].map((name,i)=>({id:String(i),name,state:'Ready',rawState:'IDLE',job:'',progress:0,remaining:'',material:'',seen:new Date().toISOString(),stale:false,connected:true}));
 const orders=[{id:'o1',number:'#123',placed:'Oct 8',commercial:'processing',items:[{id:'i1',name:'PlayCase',quantity:1,recipe:[],image:'/icon-192.png',parts:[],phone:'iPhone',colorway:'Red'}],shipped:false,tracking:'',note:''}];
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/workspace') return route.fulfill({json:{revision:1,orders,jobs:[],spools:[],machines,lastSync:new Date().toISOString(),syncError:null}});
  if(url.pathname==='/api/watches') return route.fulfill({json:{watches:[],recent:[]}});
  if(url.pathname==='/api/dispatch') return route.fulfill({json:{offers:[],held:[]}});
  if(url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search})});
 });
 await page.goto('https://spoolside.shelbyklein.com/');await page.waitForTimeout(800);
 // Emulate a 34px iPhone home-indicator inset in the computed layout.
 await page.addStyleTag({content:'.sidebar{height:103px!important;padding-bottom:34px!important}.water-home{bottom:103px!important}'});
 const pills=page.locator('.home-pills');const nav=(await page.locator('.sidebar').boundingBox())!;
 expect((await pills.boundingBox())!.y+(await pills.boundingBox())!.height).toBeLessThan(nav.y-15);
 await page.screenshot({path:'handoff/spoolside-home-spacing-mobile.png'});
 const boat=page.locator('.pool-case-force');await expect(boat).toBeAttached();
 await page.locator('.pool-case').evaluate(el=>{el.style.animation='none';el.style.left='150px';el.style.top='100px';});
 const spool=page.locator('.water-home .floating-spool');const rect=(await spool.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
 await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2-100,{steps:12});
 await expect(page.locator('.pool-cases')).toHaveCSS('opacity','1');
 const b=(await boat.boundingBox())!;
 // Mouse wave originates beside the case and propagates through the same event as spool waves.
 await page.locator('.water-home').dispatchEvent('pointerdown',{clientX:b.x-8,clientY:b.y+b.height/2,pointerType:'mouse'});
 await expect.poll(()=>boat.evaluate(el=>Math.abs(new DOMMatrix(getComputedStyle(el).transform).m41))).toBeGreaterThan(1);
 await page.mouse.up();
 await page.emulateMedia({reducedMotion:'reduce'});await expect(boat).toHaveCSS('transform','none');
 await context.close();
});
