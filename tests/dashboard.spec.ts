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
  await expect(page.locator(".printer-card")).toHaveCount(1);
  await page.getByLabel("Filter printers").selectOption("All printers");
  await expect(page.locator(".printer-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Mini One, Printing", exact: true }).click();
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
    page.getByRole("button", { name: "Mini One, Printing", exact: true }),
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
  // The page address survives an offline reload.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Filament");
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
      name === "mobile"
        ? page.getByRole("region", { name: "Spoolside home" })
        : page.getByRole("heading", { name: "Your printers" }),
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
test("each page has its own URL and back navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Printers", exact: true }).click();
  await expect(page).toHaveURL(/\/printers$/);
  await nav.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Printers");
  await page.goto("/filament");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Filament");
});

test('phones open on the water home; it shows the farm and links into it', async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto('/');
  const home = phone.getByRole('region', { name: 'Spoolside home' });
  await expect(home).toBeVisible();
  await expect(home.locator('canvas')).toBeAttached();
  await expect(home.getByRole('button', { name: 'Mini One, Printing' })).toBeVisible();
  await home.getByRole('button', { name: 'Mini Three, Ready' }).click();
  await expect(phone.getByRole('dialog', { name: 'Mini Three details' })).toBeVisible();
  await phone.keyboard.press('Escape');
  await home.getByRole('button', { name: /^Orders/ }).click();
  await expect(phone).toHaveURL(/\/orders$/);
  await expect(home).toHaveCount(0);
  await phone.getByRole('button', { name: 'Overview' }).click();
  await expect(phone.getByRole('region', { name: 'Spoolside home' })).toBeVisible();
  const desk = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await desk.goto('/');
  await expect(desk.getByRole('navigation', { name: 'Main navigation' })).toBeAttached();
  await expect(desk.getByRole('region', { name: 'Spoolside home' })).toHaveCount(0);
  await phone.close(); await desk.close();
});
