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
test("map variant quantity into jobs and use search filters", async ({
  page,
}) => {
  await openOrders(page);
  await page.getByRole("button", { name: /DEMO-1043/ }).click();
  const detail = page.locator("#order-demo-1043");
  await expect(
    detail.getByRole("button", { name: "Queue missing parts" }),
  ).toHaveCount(0);
  await detail.getByLabel("Component 1 name").fill("Body");
  await detail.getByLabel("Component 1 quantity").fill("2");
  await detail.getByRole("button", { name: "Save component mapping" }).click();
  await detail.getByRole("button", { name: "Queue missing parts" }).click();
  await expect(detail.locator(".linked-job")).toHaveCount(1);
  await expect(
    detail.getByText("4 units · Mini One", { exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Open queue" }).click();
  await page
    .locator(".job-row")
    .filter({ hasText: "DEMO-1043 · Body" })
    .getByRole("button", { name: "View order" })
    .click();
  await expect(detail).toBeVisible();
  await expect(page.locator("#order-demo-1042")).toHaveCount(0);
  await page.getByLabel("Search orders").fill("not-present");
  await expect(
    page.getByRole("heading", { name: "No orders found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Filter orders").selectOption("Cancelled");
  await expect(page.locator(".order-entry")).toHaveCount(1);
  await page.getByRole("button", { name: /DEMO-1044/ }).click();
  await expect(
    page
      .locator("#order-demo-1044")
      .getByText("This sample order is cancelled.", { exact: false }),
  ).toBeVisible();
});
test("orders desktop and mobile renders", async ({ page }) => {
  for (const [name, width, height] of [
    ["orders-desktop", 1440, 1050],
    ["orders-mobile", 390, 844],
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
