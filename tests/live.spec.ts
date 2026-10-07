import { test, expect } from '@playwright/test';
test('hosted mobile uses active source orders and server saves without browser storage', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const makeOrder = (id: string, commercial: string) => ({id,number:'#'+id,placed:'Oct 5, 2026',commercial,printReadiness:{status:"missing",reasons:["iPhone 16 Pro: no sliced file"],required:1},refundReview:false,items:[{id:'i'+id,name:'PlayCase',variant:'Phone model: iPhone 16 Pro',quantity:1,recipe:[],phone:'iPhone 16 Pro',colorway:'Red',image:'https://playcase.gg/wp-content/uploads/case-'+id+'.png'}],assembled:false,packed:false,shipped:false,tracking:'',note:''});
  let state = {revision:1,orders:[makeOrder('1','processing'),makeOrder('2','delivered'),makeOrder('3','on-hold')],jobs:[],spools:[],machines:[{id:'p1',name:'AMS 2',state:'Ready',job:'Last print',progress:100,remaining:'0 min',material:'Filament not mapped',nozzle:26,bed:25,seen:new Date().toISOString(),stale:false}],lastSync:new Date().toISOString(),syncError:null};
  let saves = 0;
  let releaseSync: (()=>void) | undefined;
  await page.route('https://spoolside.shelbyklein.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sync') { await new Promise<void>(resolve=>{releaseSync=resolve;}); state={...state,revision:state.revision+1}; return route.fulfill({json:state}); }
    if (url.pathname === '/api/workspace') {
      if (route.request().method() === 'PUT') { const value=route.request().postDataJSON(); if(value.revision!==state.revision) return route.fulfill({status:409,json:{error:'Workspace changed. Reload before saving.'}}); state={...value,revision:state.revision+1};saves++;}
      return route.fulfill({json:state});
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
    const response = await route.fetch({url:'http://127.0.0.1:4173'+url.pathname+url.search});
    return route.fulfill({response});
  });
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==','base64');
  await page.route('https://playcase.gg/**', route => route.fulfill({contentType:'image/png',body:pixel}));
  await page.goto('https://spoolside.shelbyklein.com/');
  const home=page.getByRole('region',{name:'Spoolside home'});
  await expect(home.getByRole('button',{name:'AMS 2, Ready'})).toBeVisible();
  await expect(home.getByRole('button',{name:/^Orders/})).toContainText('2');
  await expect(home.locator('.pool-case')).toHaveCount(2);
  await home.getByRole('button',{name:'Order #3, iPhone 16 Pro, Red'}).dispatchEvent('click');
  await expect(page.getByRole('article',{name:'Order #3',exact:true})).toBeVisible();
  await expect(page.getByRole('article',{name:'Order #1',exact:true})).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button',{name:'Overview',exact:true}).click();
  await home.getByRole('button',{name:/^Orders/}).click();
  await expect(page.getByLabel('Filter orders')).toHaveValue('Open orders');
  await expect(page.getByText('2 of 3 orders')).toBeVisible();
  await page.setViewportSize({width:1440,height:926});
  await page.getByRole('navigation').getByRole('button',{name:'Overview',exact:true}).click();
  const overview=page.getByRole('region',{name:'PlayCase orders overview'});
  await expect(overview.getByRole('article',{name:'Order #1',exact:true})).toContainText('Processing');
  await expect(overview.getByRole('article',{name:'Order #3',exact:true})).toContainText('On hold');
  await expect(overview.getByRole('article',{name:'Order #2',exact:true})).toHaveCount(0);
  await expect(overview.getByRole('link',{name:'Ship #1 in Pirate Ship'})).toBeVisible();
  const rowLayout=async (first: import('@playwright/test').Locator)=>{
    const content=await first.locator('.order-content-readiness').boundingBox();
    const ship=await first.locator('.ship-slot').boundingBox();
    const id=await first.locator('.order-id').boundingBox();
    expect(Math.abs(ship!.y-id!.y)).toBeLessThan(20);
    expect(content!.y).toBeGreaterThan(ship!.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  };
  const first=overview.getByRole('article',{name:'Order #1',exact:true});
  await rowLayout(first);
  await first.getByText('V3 sliced files missing',{exact:true}).click();
  await expect(first.getByText('iPhone 16 Pro: no sliced file',{exact:true})).toBeVisible();
  await expect(overview.getByRole('link',{name:'Ship #3 in Pirate Ship'})).toHaveCount(0);
  await overview.getByRole('button',{name:'View orders'}).click();
  await page.setViewportSize({width:428,height:926});
  await rowLayout(page.getByRole('article',{name:'Order #1',exact:true}));
  await page.getByLabel('Filter orders').selectOption('Shipped');
  await expect(page.getByText('#2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh orders'}).click();
  await expect.poll(()=>!!releaseSync).toBe(true);
  releaseSync!();
  expect(saves).toBe(0);
  expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  await page.getByRole('navigation').getByRole('button',{name:'Printers',exact:true}).click();
  await expect(page.getByText('Live LAN telemetry')).toBeVisible();
  await expect(page.locator('.print-object')).toHaveCount(0);
  await context.close();
});
