const path = require("path"),
  fs = require("fs"),
  assert = require("assert/strict");
const load = (name) =>
  require(
    process.env.WORKBENCH_TEST_MODULES
      ? path.join(process.env.WORKBENCH_TEST_MODULES, name)
      : name,
  );
const { chromium } = load("playwright"),
  ExcelJS = load("exceljs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://retry.test/**", (route) => {
    const f = path.join(
      __dirname,
      "..",
      new URL(route.request().url()).pathname,
    );
    try {
      route.fulfill({
        contentType: f.endsWith(".js")
          ? "text/javascript"
          : f.endsWith(".css")
            ? "text/css"
            : "text/html",
        body: fs.readFileSync(f),
      });
    } catch {
      route.fulfill({ status: 404, body: "not found" });
    }
  });
  await page.goto("http://retry.test/index.html");
  await page.getByRole("heading", { name: "收集表格", exact: true }).waitFor();
  const h = [
    "Date",
    "Store",
    "Marketplace",
    "Currency",
    "Ad Type",
    "Attribution",
    "Campaign Name",
    "Ad Group Name",
    "Customer Search Term",
    "Impressions",
    "Clicks",
    "Spend",
    "Orders",
    "Sales",
  ];
  const r = [
    "2026-10-14",
    "Store A",
    "US",
    "USD",
    "SP",
    "7-day click",
    "Campaign A",
    "Group A",
    "water bottle",
    100,
    10,
    5,
    1,
    20,
  ];
  const file = {
    name: "retry.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(h.join(",") + "\n" + r.join(",")),
  };
  await page.locator("#upload").setInputFiles(file);
  await page.locator(".draft").waitFor();
  await page.locator("#upload").setInputFiles(file);
  await page.waitForFunction(() =>
    document
      .querySelector(".banner[role=status]")
      ?.textContent.includes("尚未保存"),
  );
  assert.equal(await page.locator(".draft").count(), 1);
  assert.equal(await page.locator("[data-toggle-report]").count(), 0);
  console.log(
    "PASS pending reupload refreshes one draft, no false saved/duplicate status",
  );
  await page.getByRole("button", { name: "开始分析 →" }).click();
  assert.match(await page.locator("#toast").innerText(), /尚未保存/);
  await page.evaluate(() => {
    window.originalPut = WorkspaceStorage.put;
    WorkspaceStorage.put = async () => {
      throw Error("模拟保存失败");
    };
  });
  await page
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("模拟保存失败"),
  );
  assert.equal(await page.locator("[data-toggle-report]").count(), 0);
  await page.locator("#upload").setInputFiles(file);
  await page.waitForFunction(() =>
    document
      .querySelector(".banner[role=status]")
      ?.textContent.includes("尚未保存"),
  );
  assert.equal(await page.locator(".draft").count(), 1);
  await page.evaluate(() => {
    WorkspaceStorage.put = window.originalPut;
  });
  await page
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("#confirm-batch"));
  assert.equal(await page.locator("[data-toggle-report]").count(), 1);
  console.log(
    "PASS failed save does not mark file imported; same file can retry and save exactly once",
  );
  await page.locator("#upload").setInputFiles(file);
  await page.waitForFunction(() =>
    document
      .querySelector(".banner[role=status]")
      ?.textContent.includes("已保存"),
  );
  assert.equal(await page.locator(".draft").count(), 0);
  assert.equal(await page.locator("[data-toggle-report]").count(), 1);
  console.log("PASS only committed worksheet receives already-saved notice");
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Sheet A");
  a.addRow(h);
  a.addRow(r);
  const b = wb.addWorksheet("Sheet B");
  const hh = [...h];
  hh.splice(11, 0, "Clicks");
  const rr = [...r];
  rr.splice(11, 0, 99);
  b.addRow(hh);
  b.addRow(rr);
  const xlsx = {
    name: "partial.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
  await page.locator("#upload").setInputFiles(xlsx);
  await page.locator(".draft").nth(1).waitFor();
  const second = page.locator(".draft").filter({ hasText: "Sheet B" });
  assert.match(await second.innerText(), /重复列名/);
  await second.locator("[data-discard-draft]").click();
  await page
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("#confirm-batch"));
  assert.equal(await page.locator("[data-toggle-report]").count(), 2);
  await page.locator("#upload").setInputFiles(xlsx);
  await page.locator(".draft").waitFor();
  assert.equal(await page.locator(".draft").count(), 1);
  assert.match(await page.locator(".draft").innerText(), /Sheet B/);
  await page.locator(".draft > details > summary").click();
  const select = page.locator("[data-map-field=clicks]");
  const clickHeader = await select
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => o.value).find((v) => v.startsWith("Clicks")),
    );
  await select.selectOption(clickHeader);
  await page
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("#confirm-batch"));
  assert.equal(await page.locator("[data-toggle-report]").count(), 3);
  console.log(
    "PASS partially saved workbook retries unsaved sheets and duplicate headers map without editing source",
  );
  await page.reload();
  await page.getByRole("heading", { name: "收集表格", exact: true }).waitFor();
  assert.equal(await page.locator("[data-toggle-report]").count(), 3);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("PASS persisted import counts and no browser errors");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
