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
