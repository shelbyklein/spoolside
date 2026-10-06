import { test, expect } from "@playwright/test";
test("demo fleet, queue, inventory persistence and offline shell", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview" }),
  ).toBeVisible();
  await page.getByLabel("Filter printers").selectOption("Ready");
  await expect(page.locator(".featured")).toHaveCount(0);
  await expect(page.locator(".printer-row")).toHaveCount(1);
  await page.getByLabel("Filter printers").selectOption("All printers");
  await page.getByRole("button", { name: "View printer", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause demo print", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume demo print", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume demo print", exact: true })
    .click();
  await page.getByRole("button", { name: "Close printer details" }).click();
  await expect(
    page.getByRole("button", { name: "View printer", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Add to queue", exact: true }).click();
  await page.getByLabel("Job name").fill("Test bracket");
  await page
    .getByRole("button", { name: "Add to queue", exact: true })
    .last()
    .click();
  await expect(page.getByText("Test bracket", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Queue/ })
    .click();
  await expect(page.getByText("Test bracket", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move Test bracket up" }).click();
  await page.getByRole("button", { name: "Remove Test bracket" }).click();
  await expect(page.getByText("Test bracket", { exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Filament", exact: true })
    .click();
  await page.getByLabel("Tangerine remaining grams").fill("500");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Filament", exact: true })
    .click();
  await expect(page.getByLabel("Tangerine remaining grams")).toHaveValue("500");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You’re offline. Your saved demo workspace is still available.",
    ),
  ).toBeVisible();
  await context.setOffline(false);
});
test("desktop and mobile rendered layouts", async ({ page }) => {
  for (const [name, width, height] of [
    ["desktop", 1440, 1100],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole("heading", { name: "Your printers" }),
    ).toBeVisible();
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
