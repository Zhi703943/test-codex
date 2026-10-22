// Opt-in local acceptance check. Never commit the seller's source files or values.
const path = require("path"),
  fs = require("fs"),
  assert = require("assert/strict");
const load = (name) =>
  require(
    process.env.WORKBENCH_TEST_MODULES
      ? path.join(process.env.WORKBENCH_TEST_MODULES, name)
      : name,
  );
const { chromium } = load("playwright");
(async () => {
  const input = process.env.AMAZON_SAMPLE_ZIP;
  if (!input)
    throw Error("Set AMAZON_SAMPLE_ZIP to the local supplied report ZIP.");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const p = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("http://real-reports.test/**", (route) => {
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
  await p.goto("http://real-reports.test/index.html");
  await p.getByRole("heading", { name: "收集表格", exact: true }).waitFor();
  await p.locator("#upload").setInputFiles(input);
  await p.locator(".draft").nth(6).waitFor();
  assert.equal(await p.locator(".draft").count(), 7);
  assert.equal(await p.locator("[name=batchAdType]").count(), 0);
  assert.equal(await p.locator(".draft > details[open]").count(), 0);
  assert.equal(await p.locator("[name=site]").inputValue(), "US");
  assert.equal(await p.locator("[name=batchStart]").inputValue(), "2026-10-05");
  assert.equal(await p.locator("[name=batchEnd]").inputValue(), "2026-10-18");
  assert.equal(await p.locator(".draft input[required]").count(), 0);
  assert.equal(await p.locator(".draft select[required]").count(), 0);
  console.log(
    "PASS real ZIP: seven reports recognized, no per-report mandatory fields, SP/SB/SD from source, US and shared dates suggested",
  );
  await p.locator("[name=store]").fill("样本校验（非真实店铺名）");
  await p
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await p.waitForFunction(() => !document.querySelector("#confirm-batch"));
  assert.equal(await p.locator("[data-toggle-report]").count(), 7);
  const stats = await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    return s.reports.map((r) => ({
      type: r.type,
      daily: r.daily,
      count: r.rows.length,
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
  const campaigns = stats.find((r) => r.type === "campaign");
  assert.deepEqual(campaigns.adTypes.sort(), ["SB", "SD", "SP"]);
  assert.equal(campaigns.targetPresent, false);
  assert.equal(campaigns.spendComplete, true);
  assert.equal(
    stats.find((r) => r.type === "placement").placementPresent,
    true,
  );
  console.log(
    "PASS real values: US$ parsed, SB total/click attribution separated, manager modes not keywords, campaign SP/SB/SD isolated",
  );
  await p.getByRole("button", { name: "开始分析 →" }).click();
  assert.equal(await p.locator('[name="a-start"]').inputValue(), "2026-10-05");
  assert.equal(await p.locator('[name="a-end"]').inputValue(), "2026-10-18");
  assert.ok((await p.locator(".analysis-table tbody tr").count()) > 1);
  assert.match(await p.locator(".banner").innerText(), /14\/14/);
  await p.getByRole("button", { name: "广告位变化", exact: true }).click();
  assert.match(await p.locator(".analysis-table").innerText(), /活动 × 位置/);
  await p.getByRole("button", { name: "顾客搜索词变化", exact: true }).click();
  assert.equal(await p.locator('[name="a-start"]').inputValue(), "2026-10-05");
  assert.ok((await p.locator(".analysis-table tbody tr").count()) > 1);
  await p.locator("#mode").selectOption("7");
  assert.match(
    await p.locator(".analysis-table").innerText(),
    /暂无可分析记录/,
  );
  await p.locator("#mode").selectOption("auto");
  console.log(
    "PASS real analysis: summary targets/positions use exact 14 days; mixed multi-day search summaries remain whole-period; no fake weekly split",
  );
  // Simulate an older installed parser: same originals must be reparsable after upgrade.
  await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    for (const r of s.reports) delete r.parserVersion;
    await WorkspaceStorage.put(s);
  });
  await p.reload();
  await p.getByRole("heading", { name: "收集表格", exact: true }).waitFor();
  await p.locator("#upload").setInputFiles(input);
  await p.locator(".draft").nth(6).waitFor();
  assert.equal(await p.locator(".draft").count(), 7);
  assert.match(
    await p.locator(".banner[role=status]").innerText(),
    /识别规则已升级/,
  );
  await p
    .getByRole("button", { name: "确认并保存本批文件", exact: true })
    .click();
  await p.waitForFunction(() => !document.querySelector("#confirm-batch"));
  const versions = await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    return {
      active: s.reports.filter((r) => r.active !== false).length,
      total: s.reports.length,
    };
  });
  assert.deepEqual(versions, { active: 7, total: 14 });
  console.log(
    "PASS existing uploads reparse on recognition upgrade, superseding old versions without duplicate active data",
  );
  await p.locator("#upload").setInputFiles(input);
  await p.waitForFunction(() =>
    document
      .querySelector(".banner[role=status]")
      ?.textContent.includes("已保存"),
  );
  assert.equal(await p.locator(".draft").count(), 0);
  const activeAfter = await p.evaluate(async () => {
    const s = await WorkspaceStorage.get("workspace", "state");
    return s.reports.filter((r) => r.active !== false).length;
  });
  assert.equal(activeAfter, 7);
  console.log(
    "PASS repeated upload after upgrade uses newest saved version, does not loop or add versions",
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS actual supplied report archive acceptance, no raw files or seller metrics written to repository",
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
