import { test, expect } from "@playwright/test";
const openOrders = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .click();
};
test("orders show contents, store status and a Pirate Ship action only", async ({ page }) => {
  await openOrders(page);
  await expect(page.getByLabel("Filter orders")).toHaveValue("Open orders");
  await page.getByRole("button", { name: /DEMO-1042/ }).click();
  const detail = page.locator("#order-demo-1042");
  const ship = detail.getByRole("link", { name: "Ship in Pirate Ship" });
  await expect(ship).toHaveAttribute("href", "https://ship.pirateship.com/ship");
  await expect(detail.locator("input, textarea, select")).toHaveCount(0);
  await page.getByLabel("Filter orders").selectOption("All orders");
  await page.getByRole("button", { name: /DEMO-1044/ }).click();
  await expect(page.locator("#order-demo-1044").getByRole("link", { name: "Ship in Pirate Ship" })).toHaveCount(0);
  await expect(page.locator(".order-entry").filter({ hasText: "DEMO-1044" }).locator(".production-stage")).toHaveText("Cancelled");
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
