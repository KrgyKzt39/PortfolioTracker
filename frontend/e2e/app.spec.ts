import { expect, test, type Page } from "@playwright/test";

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
  });
});
test.afterEach(() => {
  expect(errors, "browser console errors").toEqual([]);
  errors.length = 0;
});

async function noHorizontalScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
}
const dialog = (page: Page) => page.getByRole("dialog").last();
const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

test.describe.serial("portfolio flow", () => {
  test("first holding creates the broker; no price shows N/A", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Add your holdings")).toBeVisible();
    await page.getByRole("button", { name: "Add holding" }).click();
    const d = dialog(page);
    await d.getByLabel("Broker").fill("Rakuten Trade");
    await d.getByLabel("Stock symbol").fill("1155.KL");
    await d.getByLabel("Quantity").fill("1000");
    await d.getByLabel(/Average cost/).fill("10.02");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("1155.KL added")).toBeVisible();
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("N/A");
    await expect(page.getByTestId("price-status")).toHaveText("Unavailable");
    await noHorizontalScroll(page);
  });

  test("manual price gives value and P/L", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "1155.KL details" }).click();
    await page.getByRole("button", { name: "Enter price" }).click();
    await dialog(page).getByLabel(/^Price/).fill("11");
    await dialog(page).getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("1155.KL price saved")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("total-value")).toHaveText("RM11,000.00");
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("+RM980.00");
    await expect(page.getByTestId("price-status")).toHaveText("Manual");
  });

  test("same stock at a second broker merges into one row", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "1155.KL details" }).click();
    await page.getByRole("button", { name: "Another broker" }).click();
    const d = dialog(page);
    await d.getByLabel("Broker").selectOption("__new");
    await d.getByLabel("New broker name").fill("Moomoo");
    await d.getByLabel("Quantity").fill("1000");
    await d.getByLabel(/Average cost/).fill("12");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("2,000 shares");
    await expect(page.getByRole("button", { name: "Edit 1155.KL at Moomoo" })).toBeVisible();
    await expect(page.getByTestId("total-value")).toHaveText("RM22,000.00");
  });

  test("upload a CSV for a broker with preview", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Upload" }).click();
    const d = dialog(page);
    await d.getByLabel("Broker", { exact: true }).selectOption({ label: "Moomoo" });
    await d.getByLabel("Holdings file").setInputFiles({
      name: "moomoo.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Code,Name,Qty,Avg Price\n1155.KL,Maybank,1000,12\nNVDA,NVIDIA,10,100\n"),
    });
    await expect(d.getByText("1 new")).toBeVisible();
    await d.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported: 1 new/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Uncategorised" })).toBeVisible();
    await expect(page.getByRole("button", { name: "NVDA details" })).toBeVisible();
  });

  test("categories: create one and move a stock with Arrange", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Arrange" }).click();
    await page.getByRole("button", { name: "New category" }).click();
    await dialog(page).getByLabel("Name").fill("Blue chips");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Blue chips" })).toBeVisible();
    // Pointer drag 1155.KL from Uncategorised onto the empty Blue chips drop zone.
    const from = await page.getByLabel("Drag 1155.KL").boundingBox();
    const to = await page.getByText("Drop stocks here").boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + 30, from!.y + from!.height / 2 - 10, { steps: 5 });
    await page.mouse.move(to!.x + 30, to!.y + to!.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByText("Drop stocks here")).toHaveCount(0);
    await page.waitForTimeout(100); // dnd-kit ignores clicks for 50 ms after a drop
    const saved = page.waitForResponse((r) => r.url().includes("/api/layout"));
    await page.getByRole("button", { name: "Save layout" }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(200);
    await expect(page.getByText("Layout saved")).toBeVisible();
    const blue = page.locator("section", { has: page.getByRole("heading", { name: "Blue chips" }) });
    await expect(blue.getByRole("button", { name: "1155.KL details" })).toBeVisible();
    // The non-drag way: stock settings -> category
    await page.getByRole("button", { name: "NVDA details" }).click();
    await page.getByRole("button", { name: "Stock settings" }).click();
    await dialog(page).getByLabel("Category").selectOption({ label: "Blue chips" });
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(blue.getByRole("button", { name: "NVDA details" })).toBeVisible();
  });

  test("dividend: add, confirm received, counts in returns", async ({ page }) => {
    await page.goto("/#/calendar");
    await page.getByRole("main").getByRole("button", { name: "Dividend", exact: true }).click();
    let d = dialog(page);
    await d.getByLabel("Stock").selectOption({ label: "1155.KL" });
    await d.getByLabel("Ex-date").fill(day(-20));
    await d.getByLabel("Payment date").fill(day(-1));
    await d.getByLabel(/Per share/).fill("0.25");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Dividend added")).toBeVisible();
    await page.getByRole("navigation").getByRole("button", { name: "Dividends" }).click();
    await expect(page.getByText("Did these arrive?")).toBeVisible();
    await page.getByRole("button", { name: "Received" }).click();
    d = dialog(page);
    await expect(d.getByLabel(/Before tax/)).toHaveValue("500.00"); // 2,000 shares x 0.25
    await d.getByRole("button", { name: "Received" }).click();
    await expect(page.getByText("Dividend recorded")).toBeVisible();
    await expect(page.getByText("Did these arrive?")).toHaveCount(0);
    await expect(page.getByText("RM500.00").first()).toBeVisible();
  });

  test("calendar shows earnings and upcoming dividends", async ({ page }) => {
    await page.goto("/#/calendar");
    await page.getByRole("main").getByRole("button", { name: "Earnings", exact: true }).click();
    const d = dialog(page);
    await d.getByLabel("Stock").selectOption({ label: "NVDA" });
    await d.getByLabel("Date").fill(day(12));
    await d.getByLabel("When").selectOption("after");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("After market closes")).toBeVisible();
    await page.getByRole("radio", { name: "Dividends" }).click();
    await expect(page.getByText("After market closes")).toHaveCount(0);
  });

  test("fund or savings: EPF balance with amount put in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: "Add", exact: true }).click();
    const d = dialog(page);
    await d.getByRole("radio", { name: "Fund or savings" }).click();
    await d.getByLabel("Held with").selectOption("__new");
    await d.getByLabel("New broker name").fill("KWSP");
    await d.getByLabel("Fund name").fill("EPF");
    await d.getByLabel("Balance or units").fill("85000");
    await d.getByLabel(/Amount you put in/).fill("70000");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("EPF added")).toBeVisible();
    const epf = page.getByRole("button", { name: "EPF details" });
    await expect(epf).toContainText("85,000 balance");
    await expect(epf).toContainText("+RM15,000.00");
  });

  test("dashboard shows the split and starts the value history", async ({ page }) => {
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByText("History builds up from today")).toBeVisible();
    await page.getByRole("radio", { name: "Broker" }).click();
    await expect(page.getByText("KWSP")).toBeVisible();
    await page.getByRole("radio", { name: "Currency" }).click();
    await expect(page.getByText("MYR", { exact: true })).toBeVisible();
  });

  test("AI: statement PDF goes through the normal preview, and Ask answers", async ({ page }) => {
    // The test server has no AI keys; the browser is told one exists and AI replies are mocked.
    await page.route("**/api/meta", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), ai_providers: ["gemini"] } });
    });
    await page.route("**/api/ai/statement", (route) =>
      route.fulfill({
        json: {
          provider: "gemini",
          statement_date: "2026-09-30",
          rows: [{ symbol: "5258.KL", name: "Bank Islam, Malaysia", quantity: "3000", avg_cost: "2.40", currency: "MYR", kind: "stock" }],
        },
      }),
    );
    let asked: { role: string; content: string }[] = [];
    await page.route("**/api/ai/ask", async (route) => {
      asked = route.request().postDataJSON().messages;
      await route.fulfill({ json: { answer: "- Most of your value is in MYR (about 60%).", provider: "gemini" } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Upload" }).click();
    const d = dialog(page);
    await d.getByLabel("Broker", { exact: true }).selectOption({ label: "Moomoo" });
    await d.getByLabel("Holdings file").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await expect(d.getByText(/Read 1 holding from the PDF/)).toBeVisible();
    await d.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported: 1 new/)).toBeVisible();
    await expect(page.getByRole("button", { name: "5258.KL details" })).toBeVisible();

    await page.getByRole("navigation").getByRole("button", { name: "Ask AI" }).click();
    const a = page.getByRole("main");
    await a.getByRole("button", { name: /split by currency/ }).click();
    await expect(a.getByText("Most of your value is in MYR")).toBeVisible();
    expect(asked).toEqual([{ role: "user", content: "How is my money split by currency?" }]);
    await expect(a.getByText(/not financial advice/)).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByRole("navigation").getByRole("button", { name: "Calendar" }).click();
    await page.getByRole("navigation").getByRole("button", { name: "Ask AI" }).click();
    await expect(a.getByText("Most of your value is in MYR")).toBeVisible(); // kept when switching tabs
  });

  test("all tabs fit 375, 390 and 430px phones", async ({ page }) => {
    for (const width of [375, 390, 430]) {
      await page.setViewportSize({ width, height: 860 });
      for (const tab of ["portfolio", "dashboard", "dividends", "calendar", "ask"]) {
        await page.goto(`/#/${tab}`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("navigation")).toBeVisible();
        await noHorizontalScroll(page);
      }
    }
  });

  test("privacy, settings and persistence after reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hide values" }).click();
    await expect(page.getByTestId("total-value")).toContainText("••••");
    await page.getByRole("button", { name: "Show values" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(dialog(page).getByText("Price sources")).toBeVisible();
    await expect(dialog(page).getByText("Moomoo")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Backup now" }).click();
    await expect(page.getByText(/Backup created/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "1155.KL details" })).toBeVisible();
  });
});
