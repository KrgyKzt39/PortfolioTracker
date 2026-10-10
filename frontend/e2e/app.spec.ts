import { expect, test, type Page } from "@playwright/test";

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // 4xx responses are expected in validation tests; anything else is a real error.
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

async function addTxn(page: Page, fill: (d: ReturnType<typeof dialog>) => Promise<void>) {
  await page.getByRole("main").getByRole("button", { name: "Transaction", exact: true }).click();
  const d = dialog(page);
  await fill(d);
  await d.getByRole("button", { name: "Save", exact: true }).click();
}

test.describe.serial("portfolio flow", () => {
  test("empty dashboard, create account and first buy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No accounts yet")).toBeVisible();
    await page.getByRole("button", { name: "Add account" }).click();
    const d = dialog(page);
    await d.getByLabel("Name").fill("Dividend Acc");
    await d.getByRole("radio", { name: "Dividend" }).click();
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Account created")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dividend Acc" })).toBeVisible();

    await page.getByRole("button", { name: "Add a buy" }).click();
    const t = dialog(page);
    await t.getByLabel("Trade date").fill(new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10));
    await t.getByLabel("Instrument").selectOption("__new");
    await t.getByLabel("Symbol", { exact: true }).fill("1155.KL");
    await t.getByLabel("Forward annual DPS").fill("0.60");
    await t.getByLabel("Quantity", { exact: true }).fill("1000");
    await t.getByLabel(/^Price/).fill("10");
    await t.getByLabel("Fees & commission").fill("20");
    await t.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Transaction saved")).toBeVisible();
    // No price yet: N/A, never a made-up value
    const row = page.getByRole("button", { name: "1155.KL details" });
    await expect(row).toContainText("N/A");
    await expect(page.getByTestId("price-status")).toHaveText("Unavailable");
    await noHorizontalScroll(page);
  });

  test("manual price drives valuation and P/L", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "1155.KL details" }).click();
    await page.getByRole("button", { name: "Update price" }).click();
    const d = dialog(page);
    await d.getByLabel(/^Price/).fill("11");
    await d.getByRole("button", { name: "Save price" }).click();
    await expect(page.getByText("1155.KL price saved (manual)")).toBeVisible();
    await d.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("total-value")).toHaveText("RM11,000.00");
    // cost 10,020 -> P/L +980.00 (+9.78%)
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("+RM980.00");
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("+9.78%");
    await expect(page.getByTestId("price-status")).toHaveText("Manual");
    // Est annual DV = 1000 * 0.60
    await expect(page.getByText("RM600.00").first()).toBeVisible();
  });

  test("overselling is rejected with a clear message", async ({ page }) => {
    await page.goto("/");
    await addTxn(page, async (d) => {
      await d.getByLabel("Type", { exact: true }).selectOption("SELL");
      await d.getByLabel("Instrument").selectOption({ label: "1155.KL · MYR" });
      await d.getByLabel("Quantity", { exact: true }).fill("5000");
      await d.getByLabel(/^Price/).fill("11");
    });
    await expect(dialog(page).getByText(/exceeds holding/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
  });

  test("sell and dividend update holdings; duplicate warning", async ({ page }) => {
    await page.goto("/");
    const sell = async () =>
      addTxn(page, async (d) => {
        await d.getByLabel("Type", { exact: true }).selectOption("SELL");
        await d.getByLabel("Instrument").selectOption({ label: "1155.KL · MYR" });
        await d.getByLabel("Quantity", { exact: true }).fill("200");
        await d.getByLabel(/^Price/).fill("12");
      });
    await sell();
    await expect(page.getByText("Transaction saved")).toBeVisible();
    await sell();
    await expect(dialog(page).getByText(/looks identical/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).first().click();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("800 shares");

    await addTxn(page, async (d) => {
      await d.getByLabel("Type", { exact: true }).selectOption("DIVIDEND");
      await d.getByLabel("Instrument").selectOption({ label: "1155.KL · MYR" });
      await d.getByLabel("Gross dividend").fill("250");
    });
    await expect(page.getByText("Transaction saved")).toBeVisible();
    // unrealised 800*(11-10.02)=784, realised 200*12-2004=396, DV 250 -> 1,430
    await expect(page.getByRole("button", { name: "1155.KL details" })).toContainText("+RM1,430.00");
  });

  test("all tabs work and fit a phone screen", async ({ page }) => {
    await page.goto("/");
    for (const [tab, heading] of [
      ["DV Summary", "Dividend summary"],
      ["Transactions", "Transactions"],
      ["Dividends", "Dividends"],
      ["Dashboard", "Total portfolio value"],
    ]) {
      await page.getByRole("navigation").getByRole("button", { name: tab }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await noHorizontalScroll(page);
    }
    await page.getByRole("navigation").getByRole("button", { name: "DV Summary" }).click();
    await expect(page.getByText("RM250.00").first()).toBeVisible(); // trailing 12m received
    await page.getByRole("navigation").getByRole("button", { name: "Transactions" }).click();
    await expect(page.getByText("3 transactions")).toBeVisible();
    await page.getByLabel("Search transactions").fill("zzz");
    await expect(page.getByText("No matching transactions")).toBeVisible();
  });

  test("dividend event, then reconcile", async ({ page }) => {
    await page.goto("/#/dividends");
    await page.getByRole("button", { name: "Event" }).click();
    const d = dialog(page);
    await d.getByLabel("Security").selectOption({ label: "1155.KL" });
    const exd = new Date(Date.now() - 5 * 86400e3).toISOString().slice(0, 10);
    await d.getByLabel("Ex-dividend date").fill(exd);
    await d.getByLabel(/Amount per share/).fill("0.25");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Dividend event added")).toBeVisible();
    await page.getByRole("button", { name: /1155.KL dividend/ }).click();
    await expect(page.getByText("1,000").first()).toBeVisible(); // held before ex-date (sale came later)
    await expect(page.getByText("RM250.00").first()).toBeVisible(); // 1000 * 0.25
    await page.getByRole("button", { name: "Reconcile received" }).click();
    await dialog(page).getByRole("button", { name: "Record received" }).click();
    await expect(page.getByText("1155.KL dividend recorded as received")).toBeVisible();
    await page.getByRole("radio", { name: "Received" }).click();
    await expect(page.getByText("reconciled")).toBeVisible();
  });

  test("CSV import with preview, and export", async ({ page }) => {
    await page.goto("/#/transactions");
    await page.getByRole("button", { name: "Import CSV" }).click();
    const d = dialog(page);
    const today = new Date().toISOString().slice(0, 10);
    await d.getByLabel("CSV file").setInputFiles({
      name: "t.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`date,type,account,symbol,quantity,price\n${today},BUY,Dividend Acc,JEPQ,10,55\n`),
    });
    await expect(d.getByText("unknown symbol 'JEPQ'")).toBeVisible();
    await d.getByText("Create missing accounts and instruments").click();
    await expect(d.getByText("1 valid")).toBeVisible();
    await d.getByRole("button", { name: "Import 1" }).click();
    await expect(page.getByText("Imported 1 transactions")).toBeVisible();
    const res = await page.request.get("/api/transactions/export.csv");
    expect(res.status()).toBe(200);
    expect((await res.text()).split("\n").filter(Boolean).length).toBe(6);
  });

  test("layout fits 375px and 430px phones on every tab", async ({ page }) => {
    for (const width of [375, 430]) {
      await page.setViewportSize({ width, height: 860 });
      for (const tab of ["dashboard", "dv", "transactions", "dividends"]) {
        await page.goto(`/#/${tab}`);
        await expect(page.getByRole("navigation")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await noHorizontalScroll(page);
      }
    }
  });

  test("privacy toggle, settings and data persist after reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hide values" }).click();
    await expect(page.getByTestId("total-value")).toContainText("••••");
    await page.getByRole("button", { name: "Show values" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(dialog(page).getByText("FX rates")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Backup now" }).click();
    await expect(page.getByText(/Backup created/)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "1155.KL details" })).toBeVisible();
  });
});
