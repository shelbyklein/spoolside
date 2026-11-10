import {test,expect} from '@playwright/test';
test('pill opens part options; copies add and move',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const a1={id:'22222222-2222-4222-8222-222222222222',name:'AB Buttons',type:'Buttons',status:'Up to date',fit:{style:'',phone:'',size:'',piece:''},designFile:null,source:'b.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''};
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
 await page.locator('.part-name',{hasText:'AB Buttons'}).click();
 await expect(page.getByRole('option',{name:/Copy 2/})).toBeVisible();
 await page.getByRole('button',{name:'+ Add copy'}).click();
 await expect(page.getByRole('option',{name:/Copy 3/})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>puts.at(-1)?.components[0].positions).toEqual([[0,0,0],[12,0,0],[10,0,0]]);
 await page.getByRole('button',{name:'Move X up 0.5 mm'}).click();
 await page.waitForTimeout(900);
 await expect.poll(()=>puts.at(-1)?.components[0].positions[2]).toEqual([10.5,0,0]);
 // Tilt is kept when the copy is then moved or turned.
 await page.getByRole('button',{name:'Tilt X +5°'}).click();
 await page.waitForTimeout(900);
 await expect.poll(()=>puts.at(-1)?.components[0].positions[2]).toEqual([10.5,0,0,0,5]);
 await page.getByRole('button',{name:'Rotate 5° counterclockwise'}).click();
 await page.getByRole('button',{name:'Move Y up 0.5 mm'}).click();
 await page.waitForTimeout(900);
 await expect.poll(()=>puts.at(-1)?.components[0].positions[2]).toEqual([10.5,0.5,0,5,5]);
 await expect(page.getByRole('option',{name:/Copy 3/})).toContainText('tilt 5.0°/0.0°');
 await page.getByRole('button',{name:'← Parts'}).click();
 await expect(page.locator('.part-name',{hasText:'d-pad'})).toBeVisible();
});

test('a part can be hidden from the preview, like a reference phone outline',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const a1={id:'22222222-2222-4222-8222-222222222222',name:'iPhone 12 Pro Max Case',type:'Case',status:'Up to date',fit:{style:'',phone:'',size:'',piece:''},designFile:null,source:'c.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''};
 const a2={...a1,id:'44444444-4444-4444-8444-444444444444',name:'iPhone 12 Pro Max - phone outline (reference)',type:'Part',source:'p.stl'};
 let asm:any={id:'33333333-3333-4333-8333-333333333333',name:'iPhone 12 Pro Max Case',type:'Case',sku:'',components:[{assetId:a1.id,quantity:1},{assetId:a2.id,quantity:1}]};
 const puts:any[]=[],stl:string[]=[];
 // A one-triangle binary STL, so the viewer loads every part.
 const tri=Buffer.alloc(134);tri.writeUInt32LE(1,80);[0,0,0, 0,0,0, 10,0,0, 0,10,0].forEach((v,i)=>tri.writeFloatLE(v,84+i*4));
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/stl')){stl.push(p.split('/')[3]);return route.fulfill({contentType:'model/stl',body:tri});}
  if(p==='/api/assets')return route.fulfill({json:[a1,a2]});if(p==='/api/designfiles')return route.fulfill({json:[]});
  if(p.startsWith('/api/assemblies/')&&route.request().method()==='PUT'){asm=route.request().postDataJSON();puts.push(asm);return route.fulfill({json:asm});}
  if(p==='/api/assemblies')return route.fulfill({json:[asm]});return route.fulfill({json:{}});});
 await page.goto('/library/assemblies/33333333-3333-4333-8333-333333333333');
 await expect.poll(()=>stl.includes(a2.id)).toBe(true);
 const hide=page.getByRole('button',{name:'Hide iPhone 12 Pro Max - phone outline (reference) in the preview'});
 await hide.click();
 await expect.poll(()=>puts.at(-1)?.components[1]).toEqual({assetId:a2.id,quantity:1,hidden:true});
 stl.length=0;
 await expect.poll(()=>stl.includes(a1.id)).toBe(true);
 expect(stl).not.toContain(a2.id);
 const show=page.getByRole('button',{name:'Show iPhone 12 Pro Max - phone outline (reference) in the preview'});
 await expect(show).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('2 pieces')).toBeVisible();
 await page.locator('.assembly-parts').screenshot({path:'handoff/spoolside-hide-part.png'});
 await show.click();
 await expect.poll(()=>puts.at(-1)?.components[1]).toEqual({assetId:a2.id,quantity:1});
});
