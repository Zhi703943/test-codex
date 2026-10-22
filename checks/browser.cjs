const { setup, fixture, load } = require("./helpers.cjs");
const assert = require("assert/strict"),
  fs = require("fs");
(async () => {
  const { browser, page: p, errors } = await setup();
  await p.evaluate(async () => {
    const s = WorkspaceStorage.seed();
    s.actions.push({
      title: "既有决策记录",
      fact: "已有事实",
      status: "验证中",
    });
    s.events.push({
      date: "2026-10-01",
      type: "历史事件",
      detail: "已有事件",
      status: "已核实",
    });
    await WorkspaceStorage.put(s);
  });
  await p.reload();
  await p.getByRole("heading", { name: "上传报表", exact: true }).waitFor();
  assert.deepEqual(await p.locator("nav button").allTextContents(), [
    "⇧上传报表",
    "◫每周分析",
    "◷调整记录",
    "▧产品资料",
  ]);
  const zip = new (load("jszip"))();
  zip.file("搜索词.csv", fixture("search"));
  const zipped = await zip.generateAsync({ type: "nodebuffer" });
  await p.locator("#upload").setInputFiles([
    {
      name: "投放.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(fixture("target")),
    },
    { name: "reports.zip", mimeType: "application/zip", buffer: zipped },
    {
      name: "broken.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('Date,Spend\n"broken'),
    },
  ]);
  await p.getByText("读取失败，查看原因", { exact: true }).waitFor();
  await p.getByText("可以分析", { exact: true }).first().waitFor();
  assert.equal(await p.locator("#upload-advanced").getAttribute("open"), null);
  assert.equal(
    await p.getByRole("button", { name: "确认并保存本批文件" }).count(),
    0,
  );
  await p.locator("#start-analysis").click();
  await p.getByRole("heading", { name: "每周分析", exact: true }).waitFor();
  assert.ok((await p.locator(".highlight").count()) > 0);
  assert.ok((await p.locator(".highlight").count()) <= 5);
  assert.match(await p.locator(".controls").innerText(), /2026-10-15/);
  assert.match(
    await p
      .locator(".highlight")
      .allTextContents()
      .then((x) => x.join(" ")),
    /CTR|CVR|CPC/,
  );
  await p.screenshot({
    path: "/tmp/simple-workbench-overview.png",
    fullPage: true,
  });
  console.log(
    "PASS one click saves good multi-file data and opens evidence-based highlights despite broken CSV",
  );
  await p.locator(".highlight button").first().click();
  const visibleRecord = p.locator("[data-record-key]:visible");
  await visibleRecord.first().waitFor();
  await visibleRecord.first().click();
  await p.getByRole("heading", { name: "调整记录", exact: true }).waitFor();
  assert.equal(await p.locator("#record-form [required]").count(), 3);
  await p.locator("[name=action]").fill("改竞价：0.5调整至0.45");
  await p.locator("[name=date]").fill("2026-10-14");
  await p.getByRole("button", { name: "保存已执行调整" }).click();
  await p.locator(".record h3").filter({ hasText: "改竞价：" }).waitFor();
  assert.match(
    await p.locator("#app").innerText(),
    /前后变化不等于调整导致的效果/,
  );
  console.log(
    "PASS simple adjustment captures context; before/after review is explicitly not causal",
  );
  await p.locator("nav").getByRole("button", { name: "每周分析" }).click();
  await p.getByRole("button", { name: "关键词变化", exact: true }).click();
  assert.equal(await p.locator("[data-expand-row]").count(), 3);
  assert.equal(await p.locator("[data-details-key]:visible").count(), 0);
  await p.locator("[data-row-key]").first().locator("td").nth(2).click();
  assert.equal(await p.locator("[data-details-key]:visible").count(), 1);
  await p.locator("[data-row-key]").first().locator("td").nth(2).click();
  await p.locator("#quick-filter").selectOption("cvr-down");
  assert.equal(await p.locator("[data-expand-row]").count(), 1);
  await p.locator("#quick-filter").selectOption("all");
  await p.getByRole("button", { name: "搜索词变化", exact: true }).click();
  assert.equal(await p.locator("[data-expand-row]").count(), 2);
  await p.locator("#search-view").selectOption("detail");
  assert.equal(await p.locator("[data-expand-row]").count(), 3);
  console.log(
    "PASS compact rows, explicit filters, summary grouping versus campaign/ad-group details",
  );
  const event = p.waitForEvent("download");
  await p.locator("#export-excel").click();
  const dl = await event;
  await dl.saveAs("/tmp/workbench-analysis.xlsx");
  const wb = new (load("exceljs").Workbook)();
  await wb.xlsx.readFile("/tmp/workbench-analysis.xlsx");
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["本周重点", "关键词对比", "搜索词对比", "广告位对比", "建议处理清单"],
  );
  assert.equal(wb.getWorksheet("关键词对比").rowCount, 4);
  assert.equal(wb.getWorksheet("搜索词对比").rowCount, 4);
  assert.ok(wb.getWorksheet("建议处理清单").rowCount > 1);
  const ratioColumn = wb
    .getWorksheet("关键词对比")
    .getRow(1)
    .values.indexOf("CTR本期");
  assert.equal(
    wb.getWorksheet("关键词对比").getCell(2, ratioColumn).numFmt,
    "0.00%",
  );
  console.log(
    "PASS exported Excel has five worksheets and identifiable group-level evidence",
  );
  await p.locator("nav").getByRole("button", { name: "上传报表" }).click();
  assert.match(await p.locator("#app").innerText(), /读取失败/);
  await p.locator("#upload").setInputFiles({
    name: "same.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fixture("target")),
  });
  await p.getByText("重复文件，已跳过", { exact: true }).waitFor();
  await p.locator("#start-analysis").click();
  const state = await p.evaluate(() =>
    WorkspaceStorage.get("workspace", "state"),
  );
  assert.equal(state.reports.filter((r) => r.active !== false).length, 2);
  assert.equal(state.adjustments.length, 1);
  assert.ok(state.adjustments[0].context.snapshot);
  assert.equal(state.products.length, 4);
  await p.locator("nav").getByRole("button", { name: "产品资料" }).click();
  await p.locator("#new-product").click();
  assert.equal(await p.locator("#product-form [required]").count(), 1);
  await p.locator("[name=name]").fill("Other product");
  await p.getByRole("button", { name: "保存产品" }).click();
  await p
    .getByRole("heading", { name: "Other product", exact: true })
    .waitFor();
  await p.reload();
  await p.locator("nav").getByRole("button", { name: "产品资料" }).click();
  await p
    .getByRole("heading", { name: "Other product", exact: true })
    .waitFor();
  const s = await p.evaluate(() => WorkspaceStorage.get("workspace", "state"));
  assert.equal(s.products.length, 5);
  assert.equal(s.adjustments.length, 1);
  assert.equal(s.reports.length, 2);
  assert.equal(s.actions[0].title, "既有决策记录");
  assert.ok(s.events.some((e) => e.detail === "已有事件"));
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS duplicate upload, new minimal product, persisted data and original four families; no browser errors",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
