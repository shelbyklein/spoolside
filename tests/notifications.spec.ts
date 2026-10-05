import { test, expect } from '@playwright/test';
test('device opt-in, preferences, test and disable work without storing credentials',async({browser})=>{
 const context=await browser.newContext({viewport:{width:428,height:926},serviceWorkers:'block'});
 const page=await context.newPage();let device:any=null;let tests=0;let expire=false;
 await page.addInitScript(()=>{
  let subscription:any=null;let permission='default';
  Object.defineProperty(Notification,'permission',{get:()=>permission});
  Notification.requestPermission=async()=>{permission='granted';return 'granted';};
  const manager={getSubscription:async()=>subscription,subscribe:async()=>{subscription={endpoint:'https://web.push.apple.com/mock',toJSON:()=>({endpoint:'https://web.push.apple.com/mock',keys:{auth:'mock',p256dh:'mock'}}),unsubscribe:async()=>{subscription=null;return true;}};return subscription;}};
  Object.defineProperty(navigator.serviceWorker,'ready',{value:Promise.resolve({pushManager:manager})});
 });
 await page.route('https://spoolside.shelbyklein.com/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/notifications'){
   if(route.request().method()==='POST'){device={id:'phone',preferences:route.request().postDataJSON().preferences};return route.fulfill({json:device});}
   return route.fulfill({json:{enabled:true,publicKey:'B'.repeat(87),device}});
  }
  if(path.endsWith('/test')){tests++;if(expire){device=null;return route.fulfill({status:400,json:{error:'Push service did not accept the test. Enable notifications again and retry.'}});}return route.fulfill({json:{ok:true}});}
  if(path==='/api/notifications/phone'){device=null;return route.fulfill({json:{ok:true}});}
  if(path==='/api/workspace')return route.fulfill({json:{revision:1,orders:[],jobs:[],spools:[],machines:[],lastSync:null,syncError:null}});
  if(path.startsWith('/api/'))return route.fulfill({json:{}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:4173'+path})});
 });
 await page.goto('https://spoolside.shelbyklein.com/');await page.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Enable notifications'}).click();
 await expect(page.getByText('Notifications enabled on this device. Send a test to check delivery.')).toBeVisible();
 await page.getByLabel('Order changes',{exact:true}).uncheck();await expect.poll(()=>device.preferences.changes).toBe(false);
 await page.getByRole('button',{name:'Send test notification'}).click();await expect.poll(()=>tests).toBe(1);
 await expect(page.getByText('Test accepted by the push service. Check this device for the notification.')).toBeVisible();
 expire=true;await page.getByRole('button',{name:'Send test notification'}).click();
 await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
 expire=false;await page.getByRole('button',{name:'Enable notifications'}).click();
 await page.getByRole('button',{name:'Disable on this device'}).click();await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);await context.close();
});
