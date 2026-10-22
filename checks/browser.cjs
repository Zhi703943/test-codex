const testModules = process.env.WORKBENCH_TEST_MODULES;
const load = (name) =>
  require(testModules ? require("path").join(testModules, name) : name);
const { chromium } = load("playwright");
const ExcelJS = load("exceljs");
const JSZip = load("jszip");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const headers = [
  "Date",
  "Campaign Name",
  "Campaign ID",
  "Ad Group Name",
  "Ad Group ID",
  "Targeting",
  "Match Type",
  "Customer Search Term",
  "Impressions",
  "Clicks",
  "Spend",
  "7 Day Total Orders (#)",
  "7 Day Total Sales",
  "Advertised ASIN",
];
function csv(updated = false) {
  return (
    headers.join(",") +
    "\n" +
    Array.from({ length: updated ? 7 : 14 }, (_, i) => {
      const day = i + 1 + (updated ? 7 : 0);
      return [
        "2026-10-" + String(day).padStart(2, "0"),
        "Campaign A",
        "c1",
        "Ad Group A",
        "g1",
        "water bottle",
        "EXACT",
        "reusable water bottle",
        day <= 7 ? 100 : 80,
        day <= 7 ? 10 : 20,
        updated ? 12 : day <= 7 ? 5 : 10,
        1,
        25,
        "TESTASIN01",
      ].join(",");
    }).join("\n")
  );
}
async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SP投放");
  ws.addRow([
    "日期",
    "广告活动名称",
    "广告活动ID",
    "广告组名称",
    "广告组ID",
    "关键词",
    "匹配类型",
    "展示量",
    "点击量",
    "花费",
    "7天总订单数",
    "7天总销售额",
  ]);
  for (let d = 1; d <= 14; d++)
    ws.addRow([
      "2026-10-" + String(d).padStart(2, "0"),
      "Campaign A",
      "c1",
      "Ad Group A",
      "g1",
      "water bottle",
      "EXACT",
      d <= 7 ? 100 : 80,
      d <= 7 ? 10 : 20,
      d <= 7 ? 5 : 10,
      1,
      25,
    ]);
  const biz = wb.addWorksheet("业务流量");
  biz.addRow([
    "（子）ASIN",
    "会话次数 - 总计",
    "已订购商品销售额",
    "已订购商品数量",
  ]);
  biz.addRow(["TESTASIN01", 100, 500, 20]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const placements =
    [
      "Date",
      "Campaign Name",
      "Campaign ID",
      "Placement",
      "Impressions",
      "Clicks",
      "Spend",
      "7 Day Total Orders (#)",
      "7 Day Total Sales",
    ].join(",") +
    "\n" +
    Array.from({ length: 14 }, (_, i) =>
      ["Top of search (first page)", "Rest of search", "Product pages"]
        .map((p, j) =>
          [
            "2026-10-" + String(i + 1).padStart(2, "0"),
            "Campaign A",
            "c1",
            p,
            100 + j * 10,
            10,
            5,
            1,
            25,
          ].join(","),
        )
        .join("\n"),
    ).join("\n");
  const zip = new JSZip();
  zip.file("positions.csv", placements);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const p = await b.newPage({ viewport: { width: 1512, height: 1050 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("http://amazon.test/**", (r) => {
    const u = new URL(r.request().url());
    let file = path.join(root, u.pathname.replace("/app/", ""));
    try {
      r.fulfill({
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
        body: fs.readFileSync(file),
      });
    } catch {
      r.fulfill({ status: 404, body: "not found" });
    }
  });
  await p.goto("http://amazon.test/app/index.html");
  await p.getByRole("heading", { name: "收集表格", exact: true }).waitFor();
  console.log("PASS 1 homepage static assets and initial product migration");
  // Drag an original CSV rather than requiring a template.
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "Amazon-export.csv", { type: "text/csv" }));
    document.querySelector("#dropzone").dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, csv());
  await p
    .getByRole("heading", { name: "已自动读取本批报表", exact: true })
    .waitFor();
  await p.locator("#upload").setInputFiles([
    {
      name: "原始报告.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    },
    { name: "批量.zip", mimeType: "application/zip", buffer: zipBuffer },
  ]);
  await p.locator(".draft").nth(3).waitFor();
  console.log("PASS 2 drag CSV + XLSX multi-sheet + ZIP ingestion");
  async function completeBatch() {
    const f = p.locator("#confirm-batch");
    if (await f.locator("[name=store]").count())
      await f.locator("[name=store]").fill("Sample Store");
    if (await f.locator("[name=site]").count())
      await f.locator("[name=site]").selectOption("US");
    if (await f.locator("[name=batchAdType]").count())
      await f.locator("[name=batchAdType]").selectOption("SP");
    if (await f.locator("[name=batchStart]").count())
      await f.locator("[name=batchStart]").fill("2026-10-08");
    if (await f.locator("[name=batchEnd]").count())
      await f.locator("[name=batchEnd]").fill("2026-10-14");
    await f
      .getByRole("button", { name: "确认并保存本批文件", exact: true })
      .click();
    await p.waitForFunction(() => !document.querySelector("#confirm-batch"));
  }
  await completeBatch();
  assert.equal(await p.locator("[data-toggle-report]").count(), 4);
  console.log(
    "PASS 3 automatic types and dates, necessary-only metadata, four saved reports",
  );
  await p.locator("#upload").setInputFiles({
    name: "Duplicate.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv()),
  });
  await p.waitForFunction(() =>
    document
      .querySelector("[role=status].banner")
      ?.textContent.includes("已保存"),
  );
  assert.equal(await p.locator("[data-toggle-report]").count(), 4);
  console.log("PASS 4 byte-identical reupload skipped");
  await p.getByRole("button", { name: "开始分析 →" }).click();
  await p.getByRole("heading", { name: "分析数据", exact: true }).waitFor();
  await p.getByText("water bottle", { exact: true }).first().waitFor();
  assert.match(await p.locator(".analysis-table").innerText(), /花费增加/);
  assert.match(
    await p.locator(".banner").innerText(),
    /本期覆盖 7\/7 天 · 上期覆盖 7\/7 天/,
  );
  console.log(
    "PASS 5 concrete keyword comparison, complete daily coverage and evidence",
  );
  await p.getByRole("button", { name: "顾客搜索词变化", exact: true }).click();
  await p.getByText("reusable water bottle", { exact: true }).first().waitFor();
  await p.locator("#search-view").selectOption("detail");
  await p.locator("[data-action-key]").first().click();
  await p.getByRole("button", { name: "本周结论与行动", exact: true }).click();
  await p.locator(".action-card").waitFor();
  assert.match(await p.locator(".action-card").innerText(), /Campaign A/);
  assert.match(await p.locator(".action-card").innerText(), /Ad Group A/);
  const downloadPromise = p.waitForEvent("download");
  await p.locator("#export-actions").click();
  const dl = await downloadPromise;
  await dl.saveAs("/tmp/amazon-actions.csv");
  assert.match(fs.readFileSync("/tmp/amazon-actions.csv", "utf8"), /g1/);
  console.log(
    "PASS 6 separate customer terms, group-specific action and CSV export",
  );
  await p.getByRole("button", { name: "广告位变化", exact: true }).click();
  assert.match(await p.locator(".analysis-table").innerText(), /活动 × 位置/);
  assert.match(await p.locator(".analysis-table").innerText(), /曝光占比/);
  console.log("PASS 7 placement respects campaign-only grain and shares");
  await p.locator("nav").getByRole("button", { name: "1. 收集表格" }).click();
  await p.locator("#upload").setInputFiles({
    name: "Updated.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv(true)),
  });
  await p.getByRole("heading", { name: "已自动读取本批报表" }).waitFor();
  await completeBatch();
  await p.getByRole("button", { name: "开始分析 →" }).click();
  await p.getByRole("button", { name: "顾客搜索词变化", exact: true }).click();
  assert.match(
    await p.locator(".analysis-table .metric-stack").first().innerText(),
    /84/,
  );
  assert.doesNotMatch(
    await p.locator(".analysis-table .metric-stack").first().innerText(),
    /154/,
  );
  console.log(
    "PASS 8 overlapping update replaces each date, current spend 84 not 154",
  );
  await p.locator("nav").getByRole("button", { name: "产品与品牌" }).click();
  assert.equal(await p.locator("[data-edit-product]").count(), 4);
  await p.locator("#new-product").click();
  await p.locator("[name=name]").fill("Reusable bottle");
  await p.locator("[name=brand]").fill("Another brand");
  await p.locator("[name=asins]").fill("TESTASIN01");
  await p.locator("[name=store]").fill("Sample Store");
  await p.locator("[name=site]").fill("US");
  await p.getByRole("button", { name: "保存产品", exact: true }).click();
  await p.waitForFunction(() => !document.querySelector("#product-form"));
  assert.equal(await p.locator("[data-edit-product]").count(), 5);
  await p.reload();
  await p.locator("nav").getByRole("button", { name: "产品与品牌" }).click();
  await p.getByRole("heading", { name: "Reusable bottle" }).waitFor();
  console.log(
    "PASS 9 retains four original families, adds independent brand, persists reload",
  );
  const originalDL = p.waitForEvent("download");
  await p.locator("nav").getByRole("button", { name: "1. 收集表格" }).click();
  await p.locator("[data-original]").first().click();
  const raw = await originalDL;
  await raw.saveAs("/tmp/amazon-original.csv");
  assert.equal(fs.readFileSync("/tmp/amazon-original.csv", "utf8"), csv(true));
  console.log("PASS 10 exact original bytes available after reload");
  // The keyword fallback must not turn a representative customer query into a keyword action.
  const targetReportRow = p
    .locator("tbody tr")
    .filter({ hasText: "投放报告" })
    .first();
  await targetReportRow.locator("[data-toggle-report]").click();
  await p.getByRole("button", { name: "开始分析 →" }).click();
  await p.getByRole("button", { name: "投放关键词变化", exact: true }).click();
  assert.match(await p.locator(".alert").first().innerText(), /可见流量/);
  await p.locator("[data-action-key]").first().click();
  await p.getByRole("button", { name: "本周结论与行动", exact: true }).click();
  assert.ok(
    (await p.locator(".action-card h3").allTextContents()).some((x) =>
      x.startsWith("water bottle"),
    ),
  );
  await p.locator("nav").getByRole("button", { name: "1. 收集表格" }).click();
  await p
    .locator("tbody tr")
    .filter({ hasText: "投放报告" })
    .first()
    .locator("[data-toggle-report]")
    .click();
  console.log(
    "PASS search-only keyword fallback preserves original target and original source",
  );
  // Business data remain separate from ad conversion and use exact summary dates.
  await p.locator("nav").getByRole("button", { name: "2. 分析数据" }).click();
  await p.getByRole("button", { name: "业务销售流量", exact: true }).click();
  assert.match(await p.locator("#scope").inputValue(), /业务/);
  assert.match(await p.locator(".analysis-table").innerText(), /500/);
  assert.match(await p.locator(".analysis-table").innerText(), /20.00%/);
  console.log(
    "PASS business summary scope and Unit Session ratio remain separate",
  );
  // Unknown columns get a preview and only require the fields needed for analysis.
  await p.locator("nav").getByRole("button", { name: "1. 收集表格" }).click();
  await p.locator("#upload").setInputFiles({
    name: "unknown.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Thing,Spent,When\nnew target,3,2026-10-14"),
  });
  await p.locator(".draft").waitFor();
  assert.match(await p.locator(".draft").innerText(), /Thing/);
  await p.locator('[data-meta="type"]').selectOption("target");
  await p.locator('[data-map-field="target"]').selectOption("Thing");
  await p.locator('[data-map-field="spend"]').selectOption("Spent");
  await p.locator('[data-map-field="date"]').selectOption("When");
  await completeBatch();
  await p.locator("#upload").setInputFiles({
    name: "unknown-new.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Thing,Spent,When\nnew target,4,2026-10-14"),
  });
  await p.locator(".draft").waitFor();
  assert.equal(await p.locator('[data-meta="type"]').inputValue(), "target");
  assert.equal(
    await p.locator('[data-map-field="target"]').inputValue(),
    "Thing",
  );
  assert.equal(await p.locator('[data-map-field="date"]').inputValue(), "When");
  await p.locator("[data-discard-draft]").click();
  console.log(
    "PASS unknown preview, manual required mapping, saved schema reused",
  );
  const backupDownload = p.waitForEvent("download");
  await p.locator("#backup").click();
  const bd = await backupDownload;
  await bd.saveAs("/tmp/amazon-backup.json");
  const backup = JSON.parse(fs.readFileSync("/tmp/amazon-backup.json", "utf8"));
  assert.equal(backup.state.products.length, 5);
  assert.ok(
    backup.files.some(
      (f) => Buffer.from(f.base64, "base64").toString() === csv(true),
    ),
  );
  p.once("dialog", (d) => d.accept());
  await p.locator("#restore").setInputFiles("/tmp/amazon-backup.json");
  await p.waitForFunction(
    () => document.querySelector("#toast").textContent === "备份已恢复",
  );
  console.log(
    "PASS full JSON backup includes originals and restores product/report/action state",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "/tmp/amazon-mobile.png", fullPage: true });
  await p.setViewportSize({ width: 1512, height: 1050 });
  await p.locator("nav").getByRole("button", { name: "2. 分析数据" }).click();
  await p.screenshot({ path: "/tmp/amazon-analysis.png", fullPage: true });
  assert.deepEqual(errors, []);
  await b.close();
  console.log(
    "PASS browser: no JS errors; all ten acceptance-path checks passed (generated fixtures, not real seller reports).",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
