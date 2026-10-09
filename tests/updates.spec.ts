import {test,expect} from '@playwright/test';

test('PWA checks on resume and offers a refresh when code changes during use',async({browser})=>{
 const context=await browser.newContext({viewport:{width:428,height:926},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  const mock=new EventTarget();
  Object.defineProperties(mock,{
   controller:{value:{}},
   getRegistration:{value:async()=>({update:async()=>{(window as any).updateChecks=((window as any).updateChecks||0)+1;}})}
  });
  Object.defineProperty(navigator,'serviceWorker',{value:mock});
 });
 const page=await context.newPage();await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>(window as any).updateChecks)).toBeGreaterThan(0);
 await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
 const prompt=page.getByRole('status').filter({hasText:'A new Spoolside version'});
 await expect(prompt.getByRole('button',{name:'Refresh app'})).toBeVisible();
 await page.screenshot({path:'handoff/spoolside-update-prompt-mobile.png'});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(prompt).toHaveCount(0);
 await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
 const refresh=page.getByRole('button',{name:'Refresh app',exact:true});await expect(refresh).toBeVisible();
 await page.screenshot({path:'handoff/spoolside-refresh-app-settings.png'});
 await refresh.click();await expect(refresh).toBeVisible();
 await context.close();
});
