import { test, expect } from "@playwright/test";
const openOrders = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .click();
};
test("order rows show contents, store status and a direct Pirate Ship action", async ({ page }) => {
  await openOrders(page);
  await expect(page.getByLabel("Filter orders")).toHaveValue("Open orders");
  const row = page.getByRole("article", { name: "Order DEMO-1042" });
  await expect(row.getByRole("button", { name: "Ship DEMO-1042: print all required items first" })).toBeDisabled();
  await expect(row.getByLabel("Printed & assembled, ready to pack")).toHaveCount(0);
  await expect(page.locator(".orders-workspace [aria-expanded]")).toHaveCount(0);
  await page.getByLabel("Filter orders").selectOption("All orders");
  const cancelled = page.getByRole("article", { name: "Order DEMO-1044" });
  await expect(cancelled.locator(".production-stage")).toHaveText("Cancelled");
  await expect(cancelled.getByRole("link")).toHaveCount(0);
});
test("orders desktop and mobile renders", async ({ page }) => {
  for (const [name, width, height] of [
    ["orders-desktop", 1440, 1050],
    ["orders-mobile", 428, 926],
  ] as const) {
    await page.setViewportSize({ width, height });
    await openOrders(page);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `.impeccable/review/${name}.png`,
      fullPage: true,
    });
  }
});

test('mobile order content scrolls above the tabs and the last order remains reachable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openOrders(page);await page.getByLabel('Filter orders').selectOption('All orders');
 const bounds=await page.evaluate(()=>{const main=document.querySelector('main')!,nav=document.querySelector('.sidebar')!;return {mainBottom:main.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top,scrolling:getComputedStyle(main).overflowY};});
 expect(bounds.scrolling).toBe('auto');expect(bounds.mainBottom).toBeLessThanOrEqual(bounds.navTop);
 await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);
 const last=page.locator('.overview-order-row').last();await last.scrollIntoViewIfNeeded();
 const row=await last.boundingBox(),nav=await page.locator('.sidebar').boundingBox();expect(row!.y+row!.height).toBeLessThanOrEqual(nav!.y);
 expect(await page.evaluate(()=>window.scrollY)).toBe(0);
 await page.screenshot({path:'handoff/spoolside-mobile-orders-scroll.png'});
});
