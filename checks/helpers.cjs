const path = require("path"),
  fs = require("fs");
const load = (name) =>
  require(
    process.env.WORKBENCH_TEST_MODULES
      ? path.join(process.env.WORKBENCH_TEST_MODULES, name)
      : name,
  );
async function setup(host = "workflow.test") {
  const { chromium } = load("playwright");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`http://${host}/**`, (route) => {
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
  await page.goto(`http://${host}/index.html`);
  await page.getByRole("heading", { name: "上传报表", exact: true }).waitFor();
  return { browser, page, errors };
}
const headers = [
  "Date",
  "Store",
  "Marketplace",
  "Currency",
  "Ad Type",
  "Attribution",
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
  "Orders",
  "Sales",
  "Advertised ASIN",
];
function fixture(kind = "search", updates = false) {
  const h =
    kind === "target"
      ? headers.filter((x) => x !== "Customer Search Term")
      : headers;
  const rows = [];
  for (let day = 1; day <= 21; day++)
    for (let i = 0; i < 3; i++) {
      if (updates && day <= 14) continue;
      const m =
        day <= 14
          ? [
              [1000, 100, 50, 10, 200],
              [1000, 100, 50, 10, 200],
              [1000, 100, 50, 10, 200],
            ][i]
          : [
              [500, 50, 25, 5, 100],
              [1000, 150, 90, 8, 160],
              [1000, 100, 80, 20, 500],
            ][i];
      const obj = Object.fromEntries(
        headers.map((k, j) => [
          k,
          [
            "2026-10-" + String(day).padStart(2, "0"),
            "Store A",
            "US",
            "USD",
            "SP",
            "7天点击",
            "Campaign " + i,
            "c" + i,
            "Group " + i,
            "g" + i,
            i === 0 ? "lunch container" : "bottle",
            "BROAD",
            i === 0 ? "lunch reusable" : "bottle precise",
            ...m,
            "TESTASIN" + i,
          ][j],
        ]),
      );
      rows.push(h.map((k) => obj[k]));
    }
  return [h, ...rows].map((r) => r.join(",")).join("\n");
}
module.exports = { load, setup, fixture };
