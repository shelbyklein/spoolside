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
  await expect(row.getByRole("button", { name: "Ship DEMO-1042: mark it printed and assembled first" })).toBeDisabled();
  await row.getByLabel("Printed & assembled, ready to pack").check();
  await expect(row.getByRole("link", { name: "Ship DEMO-1042 in Pirate Ship" })).toHaveAttribute("href", "https://ship.pirateship.com/ship");
  await row.getByLabel("Printed & assembled, ready to pack").uncheck();
  await expect(row.getByRole("link", { name: "Ship DEMO-1042 in Pirate Ship" })).toHaveCount(0);
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
