import { test, expect } from "@playwright/test";
const openOrders = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .click();
};
test("order production guards, reprint, persistence, and independent store status", async ({
  page,
}) => {
  await openOrders(page);
  const detail = page.locator("#order-demo-1042");
  await expect(
    detail.getByRole("button", { name: "Mark demo order shipped" }),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Queue missing parts" }).click();
  await expect(detail.locator(".linked-job")).toHaveCount(2);
  await detail.getByRole("button", { name: "Queue missing parts" }).click();
  await expect(detail.locator(".linked-job")).toHaveCount(2);
  await detail.locator(".linked-job select").first().selectOption("Failed");
  await detail.locator(".linked-job select").nth(1).selectOption("Accepted");
  await expect(
    detail.getByLabel("Assembly and quality check complete"),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Queue missing parts" }).click();
  await expect(detail.locator(".linked-job")).toHaveCount(3);
  await detail.locator(".linked-job select").nth(2).selectOption("Accepted");
  await detail.getByLabel("Assembly and quality check complete").check();
  await detail.getByLabel("Packed and ready for shipping").check();
  await detail.getByLabel("Tracking reference").fill("DEMO-TRACK");
  await detail.getByRole("button", { name: "Mark demo order shipped" }).click();
  await expect(
    page.locator(".order-entry").first().locator(".production-stage"),
  ).toHaveText("Shipped");
  await expect(detail.getByText("Processing", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .click();
  await expect(detail.getByLabel("Tracking reference")).toHaveValue(
    "DEMO-TRACK",
  );
  await expect(
    detail.getByRole("button", { name: "Shipped in demo" }),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Undo demo shipment" }).click();
  await detail
    .getByRole("button", { name: "Simulate order cancellation" })
    .click();
  await expect(
    detail.getByRole("button", { name: "Queue missing parts" }),
  ).toHaveCount(0);
  await expect(detail.locator(".linked-job select").first()).toBeDisabled();
  await expect(
    detail.getByRole("button", { name: "Mark demo order shipped" }),
  ).toBeDisabled();
  await detail.getByRole("button", { name: "Open queue" }).click();
  await expect(
    page.getByText("DEMO-1042 · Case body", { exact: true }),
  ).toHaveCount(0);
});
test("unconfigured orders go directly through fulfillment without a setup step", async ({page}) => {
  await openOrders(page);
  await page.getByRole("button", {name:/DEMO-1043/}).click();
  const detail=page.locator("#order-demo-1043");
  await expect(detail.locator('.recipe-form')).toHaveCount(0);
  await expect(page.locator('.order-entry').filter({hasText:'DEMO-1043'}).locator('.production-stage')).toHaveText('Fulfillment');
  await detail.getByLabel('Assembly and quality check complete').check();
  await detail.getByLabel('Packed and ready for shipping').check();
  await detail.getByRole('button',{name:'Mark demo order shipped'}).click();
  await expect(page.locator('.order-entry').filter({hasText:'DEMO-1043'}).locator('.production-stage')).toHaveText('Shipped');
  await page.reload();await page.getByRole('navigation').getByRole('button',{name:'Orders',exact:true}).click();
  await page.getByRole('button',{name:/DEMO-1043/}).click();
  await expect(detail.getByRole('button',{name:'Shipped in demo'})).toBeDisabled();
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
