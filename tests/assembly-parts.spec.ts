import {test,expect} from '@playwright/test';
test('pill opens part options; copies add and move',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const a1={id:'22222222-2222-4222-8222-222222222222',name:'AB Buttons',type:'Buttons',status:'Current',fit:{style:'',phone:'',size:'',piece:''},designFile:null,source:'b.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''};
 const a2={...a1,id:'44444444-4444-4444-8444-444444444444',name:'d-pad',source:'d.stl'};
 let asm:any={id:'33333333-3333-4333-8333-333333333333',name:'Handheld',type:'Faceplate',sku:'',components:[{assetId:a1.id,quantity:2,positions:[[0,0,0],[12,0,0]]},{assetId:a2.id,quantity:1}]};
 const puts:any[]=[];
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
  if(p==='/api/assets')return route.fulfill({json:[a1,a2]});if(p==='/api/designfiles')return route.fulfill({json:[]});
  if(p.startsWith('/api/assemblies/')&&route.request().method()==='PUT'){asm=route.request().postDataJSON();puts.push(asm);return route.fulfill({json:asm});}
  if(p==='/api/assemblies')return route.fulfill({json:[asm]});return route.fulfill({json:{}});});
 await page.goto('/library/assemblies/33333333-3333-4333-8333-333333333333');
 await expect(page.getByRole('button',{name:'Edit assembly'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Position parts'})).toHaveCount(0);
 await page.locator('.part-chip',{hasText:'AB Buttons'}).click();
 await expect(page.getByRole('option',{name:/Copy 2/})).toBeVisible();
 await page.getByRole('button',{name:'+ Add copy'}).click();
 await expect(page.getByRole('option',{name:/Copy 3/})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>puts.at(-1)?.components[0].positions).toEqual([[0,0,0],[12,0,0],[10,0,0]]);
 await page.getByRole('button',{name:'Move X up 0.5 mm'}).click();
 await page.waitForTimeout(900);
 await expect.poll(()=>puts.at(-1)?.components[0].positions[2]).toEqual([10.5,0,0]);
 await page.getByRole('button',{name:'← Parts'}).click();
 await expect(page.locator('.part-chip',{hasText:'d-pad'})).toBeVisible();
});
