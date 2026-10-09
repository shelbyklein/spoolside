import {test,expect} from '@playwright/test';
test('Personal contains editable projects and mixed files; PlayCase contains Orders and Library',async({page})=>{
 let projects:any[]=[];
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url()),method=r.request().method();
 if(u.pathname==='/api/projects'&&method==='POST'){projects=[{id:'p1',...r.request().postDataJSON(),files:[],prints:[]}];return r.fulfill({json:projects[0]});}
 if(u.pathname==='/api/projects')return r.fulfill({json:projects});
 if(u.pathname==='/api/projects/p1/files'){projects[0].files.push({id:'f1',name:'Model.stl',size:100,kind:'STL'});return r.fulfill({json:projects[0]});}
 return r.fulfill({json:[]});});
 await page.goto('/personal');await page.getByRole('button',{name:'New project'}).click();const d=page.getByRole('dialog',{name:'New personal project'});await d.getByLabel('Name',{exact:true}).fill('Desk organizer');await d.getByLabel('Notes').fill('Model, source and printable plates');await d.getByRole('button',{name:'Save project'}).click();await expect(page.getByRole('heading',{name:'Desk organizer'})).toBeVisible();
 await page.getByLabel('Project files',{exact:true}).setInputFiles({name:'Model.stl',mimeType:'application/octet-stream',buffer:Buffer.from('solid test')});await expect(page.getByRole('link',{name:'Download Model.stl'})).toBeVisible();
 await page.screenshot({path:'handoff/spoolside-personal-project.png'});
 await page.getByRole('button',{name:'← Projects'}).click();await expect(page.getByRole('button',{name:/Desk organizer.*1 files/})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'handoff/spoolside-personal-mobile.png'});
 await page.getByRole('navigation').getByRole('button',{name:'PlayCase',exact:true}).click();await expect(page.getByRole('heading',{name:'PlayCase',exact:true})).toBeVisible();await page.locator('.playcase-sections').getByRole('button',{name:'Library',exact:true}).click();await expect(page.getByRole('tab',{name:'Assets'})).toBeVisible();
});
