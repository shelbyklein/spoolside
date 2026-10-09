import {test,expect} from '@playwright/test';
test('assemblies save quantities across reload; sleeve and missing-design filters stay separate from status',async({page})=>{
 const assets=[{id:'11111111-1111-4111-8111-111111111111',name:'DS Sleeve',type:'Sleeve',status:'Stale',fit:{style:'DS',size:'Standard',phone:'',piece:'Sleeve'},designFile:null,source:'sleeves/ds.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''},{id:'22222222-2222-4222-8222-222222222222',name:'DS Top',type:'Faceplate',status:'Up to date',fit:{style:'DS',phone:'',size:'Standard',piece:'Top'},designFile:{id:'design',name:'DS.c4d',source:'DS.c4d'},source:'faceplate/ds.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''}];
 let assemblies:any[]=[];
 await page.route('**/api/**',async route=>{
 const pathname=new URL(route.request().url()).pathname;
 if(pathname==='/api/assets')return route.fulfill({json:assets});
 if(pathname==='/api/designfiles')return route.fulfill({json:[]});
 if(pathname.startsWith('/api/assemblies/')&&route.request().method()==='PUT'){const body={...route.request().postDataJSON(),id:pathname.split('/').pop()};assemblies=assemblies.map(x=>x.id===body.id?body:x);return route.fulfill({json:body});}
 if(pathname==='/api/assemblies'){if(route.request().method()==='POST'){assemblies.push({...route.request().postDataJSON(),id:'33333333-3333-4333-8333-333333333333'});return route.fulfill({json:assemblies[0]});}return route.fulfill({json:assemblies});}
 return route.fulfill({json:{}});
 });
 await page.goto('/library');await page.getByRole('tab',{name:'Sleeves',exact:true}).click();await expect(page.getByRole('button',{name:/^DS Sleeve, Stale/})).toBeVisible();
 await page.getByLabel('Filter status').selectOption('Missing design');await expect(page.getByRole('img',{name:'Missing design file'}).first()).toBeVisible();
 await page.getByRole('tab',{name:'Assemblies',exact:true}).click();await expect(page).toHaveURL(/\/library\/assemblies$/);
 await page.getByRole('button',{name:'Add assembly'}).click();const form=page.locator('.assembly-editor');await form.getByLabel('Name',{exact:true}).fill('DS package');await form.getByLabel('SKU (optional)',{exact:true}).fill('DS');
 await form.getByRole('button',{name:'DS Top Faceplate'}).click();await form.getByLabel('Quantity',{exact:true}).fill('2');await form.getByRole('button',{name:'Save assembly'}).click();
 await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();expect(assemblies[0].components[0].quantity).toBe(2);
 await page.reload();await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/DS Top.*×2/})).toBeHidden();await page.locator('.assembly-tile').filter({hasText:'DS package'}).getByText('Parts').click();await expect(page.getByRole('button',{name:/DS Top.*×2/})).toBeVisible();await expect(page.locator('.assembly-part-list')).toBeVisible();await expect(page.locator('.assembly-part-file')).toHaveAttribute('aria-label',/STL (available to slice|missing)/);await page.screenshot({path:'handoff/spoolside-assembly-part-files.png'});
 await page.getByRole('link',{name:'DS package',exact:true}).click();await expect(page).toHaveURL(/\/library\/assemblies\/33333333-3333-4333-8333-333333333333$/);
 await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();await expect(page.locator('.assembly-parts').getByLabel('Quantity of DS Top')).toHaveValue('2');
 const parts=page.locator('.assembly-parts');
 await parts.getByRole('button',{name:'Remove DS Top from assembly'}).click();
 await expect(parts.locator('.part-row.removed')).toContainText('DS Top × 2');
 await page.reload();
 await expect(page.locator('.assembly-parts .part-row.removed')).toContainText('DS Top × 2');
 await page.locator('.assembly-parts').getByRole('button',{name:'Restore'}).click();
 await expect(page.locator('.assembly-parts').getByLabel('Quantity of DS Top')).toHaveValue('2');
 await expect(page.locator('.assembly-parts .part-row.removed')).toHaveCount(0);await expect(page.locator('.assembly-detail-columns')).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();await page.getByRole('button',{name:'← Assemblies',exact:true}).click();await expect(page).toHaveURL(/\/library\/assemblies$/);await page.goBack();await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();
});

test('sliced prints are a library section with editable per-plate asset coverage',async({page})=>{
 const asset={id:'case-13',name:'iPhone 13 Case',type:'Case',generation:3,status:'Up to date',hasStl:true,fit:{phone:'iPhone 13',style:'',size:'',piece:''}};
 const extra=[...Array.from({length:14},(_,i)=>({...asset,id:'c'+i,name:'Test Case '+i})),{...asset,id:'ds-top',name:'DS – Top',type:'Faceplate',fit:{phone:'',style:'DS',size:'Standard',piece:'Top'}}];
 let file={id:'slice',name:'13 plate',plates:[{index:1,minutes:60,grams:20,filaments:[],coverage:[] as any[]}],size:100,created:'',preferredPrinter:'idle'};
 await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()).pathname;
 if(url==='/api/workspace')return route.fulfill({json:{machines:[{id:'idle',name:'Membrane',connected:true,stale:false,rawState:'IDLE',state:'Ready',trays:[],external:{type:'TPU',color:'#000000'}}]}});
 if(url==='/api/printers/idle/print') { const body=route.request().postDataJSON();expect(body.fileId).toBe('slice');expect(body.bedClear).toBe(true);return route.fulfill({json:{ok:true}}); }
 if(url==='/api/assets')return route.fulfill({json:[asset,...extra]});
 if(url==='/api/library')return route.fulfill({json:[file]});
 if(url==='/api/library/slice'){
 const body=route.request().postDataJSON();
 if(body.quantities){ expect(body.printer).toBe("idle"); file={...file,name:body.name,plates:[{...file.plates[0],quantity:body.quantities[0].quantity}] as any};return route.fulfill({json:file}); }
 expect(body.plate).toBe(1);expect(body.assetIds).toEqual(['case-13']);
 file={...file,plates:[{...file.plates[0],coverage:[{assetId:'case-13',hash:'current'}]}]};return route.fulfill({json:file});
 }
 return route.fulfill({json:[]});
 });
 await page.goto('/library/sliced');await expect(page.getByRole('tab',{name:'Sliced prints'})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'Edit assets'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'DS – Top',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:/^Faceplates/}).click();await expect(dialog.locator('.plate-options button')).toHaveText(['DS – Top']);
 await dialog.getByRole('button',{name:/^Cases/}).click();await page.getByRole('button',{name:'iPhone 13 Case',exact:true}).click();await page.getByRole('button',{name:'Save plate assets'}).click();
 await expect(page.locator('.plate-assets .part-chip')).toHaveText('iPhone 13 Case');await page.reload();await expect(page.locator('.plate-assets .part-chip')).toHaveText('iPhone 13 Case');
 await page.locator('.sliced-card').hover();
 await page.locator('.sliced-card').screenshot({path:'handoff/spoolside-sliced-card-icons.png'});
 await page.getByRole('button',{name:'Edit print details for 13 plate'}).click();
 const details=page.getByRole('dialog',{name:'Print details for 13 plate'});
 await details.getByLabel('Print name').fill('Touch pins');
 await details.getByLabel('Pieces per print').fill('144');
 await details.getByLabel('Default printer',{exact:true}).selectOption('idle');
 await page.screenshot({path:'handoff/spoolside-print-details-editor.png',fullPage:true});
 await details.getByRole('button',{name:'Save print details'}).click();
 await expect(page.locator('.sliced-body > strong')).toHaveText('Touch pins');
 await expect(page.locator('.sliced-body > small')).toContainText('144 pieces');
 await page.reload();await expect(page.locator('.sliced-body > small')).toContainText('144 pieces');
 await page.getByRole('button',{name:'Print',exact:true}).click();
 const print=page.getByRole('dialog',{name:'Print Touch pins'});
 await expect(print.getByLabel('Printer')).toHaveValue('idle');
 await expect(print.getByRole('button',{name:'Start print',exact:true})).toBeDisabled();
 await page.screenshot({path:'handoff/spoolside-card-print-dialog.png',fullPage:true});
 await print.getByLabel('Build plate is clear').check();
 await print.getByRole('button',{name:'Start print',exact:true}).click();
 await expect(print).toHaveCount(0);
 file={...file,preferredPrinter:'busy'};
 await page.reload(); await page.getByRole('button',{name:'Print',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('is busy or offline');
 await expect(page.getByRole('dialog').getByLabel('Printer',{exact:true})).toHaveValue('');
 await expect(page.getByRole('dialog').getByRole('button',{name:'Start print',exact:true})).toHaveCount(0);
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();

});
