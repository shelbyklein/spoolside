import {test,expect} from '@playwright/test';
test('assemblies save quantities across reload; sleeve and missing-design filters stay separate from status',async({page})=>{
 const assets=[{id:'11111111-1111-4111-8111-111111111111',name:'DS Sleeve',type:'Sleeve',status:'Needs check',fit:{style:'DS',size:'Standard',phone:'',piece:'Sleeve'},designFile:null,source:'sleeves/ds.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''},{id:'22222222-2222-4222-8222-222222222222',name:'DS Top',type:'Faceplate',status:'Current',fit:{style:'DS',phone:'',size:'Standard',piece:'Top'},designFile:{id:'design',name:'DS.c4d',source:'DS.c4d'},source:'faceplate/ds.stl',generation:3,note:'',dims:[1,2,3],triangles:1,bytes:134,updated:''}];
 let assemblies:any[]=[];
 await page.route('**/api/**',async route=>{
 const pathname=new URL(route.request().url()).pathname;
 if(pathname==='/api/assets')return route.fulfill({json:assets});
 if(pathname==='/api/designfiles')return route.fulfill({json:[]});
 if(pathname.startsWith('/api/assemblies/')&&route.request().method()==='PUT'){const body={...route.request().postDataJSON(),id:pathname.split('/').pop()};assemblies=assemblies.map(x=>x.id===body.id?body:x);return route.fulfill({json:body});}
 if(pathname==='/api/assemblies'){if(route.request().method()==='POST'){assemblies.push({...route.request().postDataJSON(),id:'33333333-3333-4333-8333-333333333333'});return route.fulfill({json:assemblies[0]});}return route.fulfill({json:assemblies});}
 return route.fulfill({json:{}});
 });
 await page.goto('/library');await page.getByRole('tab',{name:'Sleeves',exact:true}).click();await expect(page.getByRole('button',{name:'DS Sleeve, Needs check',exact:true})).toBeVisible();
 await page.getByLabel('Filter status').selectOption('Missing design');await expect(page.getByText('Missing design',{exact:false}).last()).toBeVisible();
 await page.getByRole('tab',{name:'Assemblies',exact:true}).click();await expect(page).toHaveURL(/\/library\/assemblies$/);
 await page.getByRole('button',{name:'Add assembly'}).click();const form=page.locator('.assembly-editor');await form.getByLabel('Name',{exact:true}).fill('DS package');await form.getByLabel('SKU (optional)',{exact:true}).fill('DS');
 await form.getByRole('button',{name:'DS Top Faceplate'}).click();await form.getByLabel('Quantity',{exact:true}).fill('2');await form.getByRole('button',{name:'Save assembly'}).click();
 await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();expect(assemblies[0].components[0].quantity).toBe(2);
 await page.reload();await expect(page.getByRole('heading',{name:'DS package',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/DS Top × 2/})).toBeVisible();
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
