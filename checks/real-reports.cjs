const { setup, load } = require("./helpers.cjs");
const assert = require("assert/strict");
(async () => {
  const input = process.env.AMAZON_SAMPLE_ZIP;
  if (!input)
    throw Error("Set AMAZON_SAMPLE_ZIP to the supplied report archive.");
  const { browser, page: p, errors } = await setup("real-reports.test");
  await p.locator("#upload").setInputFiles(input);
  await p.locator(".draft").nth(6).waitFor({ state: "attached" });
  assert.equal(await p.locator(".draft").count(), 7);
  assert.equal(await p.locator(".draft [required]").count(), 0);
  assert.equal(await p.locator("#upload-advanced").getAttribute("open"), null);
  assert.equal(await p.locator("[name=site]").inputValue(), "US");
  assert.equal(await p.locator("[name=batchStart]").inputValue(), "2026-10-05");
  assert.equal(await p.locator("[name=batchEnd]").inputValue(), "2026-10-18");
  await p.locator("[name=store]").fill("样本校验（非真实店铺名）");
  await p.locator("#start-analysis").click();
  await p.getByRole("heading", { name: "每周分析", exact: true }).waitFor();
  const stats = await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    return s.reports.map((r) => ({
      type: r.type,
      sites: [...new Set(r.rows.map((x) => x.site))],
      adTypes: [...new Set(r.rows.map((x) => x.adType))],
      salesComplete: r.rows.every((x) => x.sales != null),
      spendComplete: r.rows.every((x) => x.spend != null),
      businessSalesComplete: r.rows.every((x) => x.totalSales != null),
      placementPresent: r.rows.every((x) => !!x.placement),
      targetPresent: r.rows.some((x) => x.target),
      allCurrency: r.rows.every((x) => x.currency === "USD"),
    }));
  });
  assert.equal(stats.length, 7);
  assert.equal(stats.filter((r) => r.type === "search").length, 2);
  for (const t of ["target", "placement", "product", "business", "campaign"])
    assert.equal(stats.filter((r) => r.type === t).length, 1);
  for (const r of stats) {
    assert.deepEqual(r.sites, ["US"]);
    assert.equal(r.allCurrency, true);
  }
  assert.equal(
    stats.find((r) => r.type === "search" && r.adTypes.includes("SB"))
      .salesComplete,
    true,
  );
  assert.equal(
    stats.find((r) => r.type === "business").businessSalesComplete,
    true,
  );
  const c = stats.find((r) => r.type === "campaign");
  assert.deepEqual(c.adTypes.sort(), ["SB", "SD", "SP"]);
  assert.equal(c.targetPresent, false);
  assert.equal(c.spendComplete, true);
  console.log(
    "PASS real ZIP: one click commits all seven types, no per-file required metadata, US$ and attribution parsed separately",
  );
  assert.match(
    await p.locator(".controls").innerText(),
    /2026-10-05.*2026-10-18/s,
  );
  assert.match(await p.locator(".controls").innerText(), /不能拆/);
  await p.getByRole("button", { name: "关键词变化", exact: true }).click();
  assert.ok(await p.locator("[data-expand-row]").count());
  await p.getByRole("button", { name: "广告位变化", exact: true }).click();
  assert.match(await p.locator(".compact-table").innerText(), /活动级/);
  await p.getByRole("button", { name: "搜索词变化", exact: true }).click();
  assert.ok(await p.locator("[data-expand-row]").count());
  console.log(
    "PASS real mixed multi-day summaries remain whole-period; campaign placement grain remains truthful",
  );
  const ev = p.waitForEvent("download");
  await p.locator("#export-excel").click();
  await (await ev).saveAs("/tmp/real-analysis.xlsx");
  const wb = new (load("exceljs").Workbook)();
  await wb.xlsx.readFile("/tmp/real-analysis.xlsx");
  assert.equal(wb.worksheets.length, 5);
  assert.ok(wb.getWorksheet("广告位对比").rowCount > 1);
  await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    for (const r of s.reports) delete r.parserVersion;
    await WorkspaceStorage.put(s);
  });
  await p.reload();
  await p.getByRole("heading", { name: "上传报表", exact: true }).waitFor();
  await p.locator("#upload").setInputFiles(input);
  await p.locator(".draft").nth(6).waitFor({ state: "attached" });
  await p.locator("#start-analysis").click();
  await p.getByRole("heading", { name: "每周分析", exact: true }).waitFor();
  const counts = await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    return [
      s.reports.length,
      s.reports.filter((r) => r.active !== false).length,
    ];
  });
  assert.deepEqual(counts, [14, 7]);
  await p.locator("nav").getByRole("button", { name: "上传报表" }).click();
  await p.locator("#upload").setInputFiles(input);
  await p.getByText("重复文件，已跳过", { exact: true }).first().waitFor();
  assert.equal(await p.locator(".draft").count(), 0);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS actual sample Excel export and parser upgrade preserve histories, no duplicate active data; no raw reports committed",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
