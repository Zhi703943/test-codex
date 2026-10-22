const { setup, fixture } = require("./helpers.cjs");
const assert = require("assert/strict");
(async () => {
  const { browser, page: p, errors } = await setup("retry.test");
  const file = {
    name: "retry.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fixture("target")),
  };
  await p.locator("#upload").setInputFiles(file);
  await p.getByText("可以分析", { exact: true }).first().waitFor();
  await p.locator("#upload").setInputFiles(file);
  await p.getByText("预览已更新", { exact: true }).waitFor();
  assert.equal(await p.locator(".draft").count(), 1);
  await p.evaluate(() => {
    window.originalPut = WorkspaceStorage.put;
    WorkspaceStorage.put = async () => {
      throw Error("模拟保存失败");
    };
  });
  await p.locator("#start-analysis").click();
  await p.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("模拟保存失败"),
  );
  assert.equal(
    (await p.evaluate(() => WorkspaceStorage.get("workspace", "state")))
      ?.reports?.length || 0,
    0,
  );
  assert.equal(await p.locator(".draft").count(), 1);
  await p.evaluate(() => (WorkspaceStorage.put = window.originalPut));
  await p.locator("#start-analysis").click();
  await p.getByRole("heading", { name: "每周分析", exact: true }).waitFor();
  assert.equal(
    (await p.evaluate(() => WorkspaceStorage.get("workspace", "state"))).reports
      .length,
    1,
  );
  console.log(
    "PASS pending reupload, failed persistence and retry through one primary button",
  );
  await p.locator("nav").getByRole("button", { name: "上传报表" }).click();
  await p.locator("#upload").setInputFiles(file);
  await p.getByText("重复文件，已跳过", { exact: true }).waitFor();
  await p.locator("#start-analysis").click();
  assert.equal(
    (await p.evaluate(() => WorkspaceStorage.get("workspace", "state"))).reports
      .length,
    1,
  );
  await p.locator("nav").getByRole("button", { name: "上传报表" }).click();
  const bad = fixture("target").replaceAll("Store A", "");
  await p.locator("#upload").setInputFiles([
    {
      name: "missing-store.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(bad),
    },
    {
      name: "bad-date.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        fixture("search").replaceAll("2026-10-01", "2026-02-30"),
      ),
    },
  ]);
  await p.locator(".draft").nth(1).waitFor({ state: "attached" });
  await p.locator("#start-analysis").click();
  await p.getByRole("heading", { name: "每周分析", exact: true }).waitFor();
  const s = await p.evaluate(() => WorkspaceStorage.get("workspace", "state"));
  assert.equal(s.reports.length, 2);
  await p.locator("nav").getByRole("button", { name: "上传报表" }).click();
  assert.match(await p.locator("#app").innerText(), /读取失败/);
  assert.ok(await p.locator("[data-retry-draft]").count());
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS remembered shared ownership, validation failure is isolated, retained retry, duplicate no accumulation",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
