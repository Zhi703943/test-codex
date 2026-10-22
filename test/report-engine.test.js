import test from "node:test";
import assert from "node:assert/strict";
import "../public/report-engine.js";
import "../public/seed.js";
import "../public/storage.js";
const E = globalThis.ReportEngine;
const row = (extra = {}) => ({
  store: "Store A",
  site: "US",
  adType: "SP",
  currency: "USD",
  attribution: "7-day click",
  campaign: "Campaign",
  campaignId: "c1",
  group: "Group",
  groupId: "g1",
  target: "bottle",
  term: "water bottle",
  match: "EXACT",
  start: "2026-10-01",
  end: "2026-10-01",
  impressions: 100,
  clicks: 10,
  spend: 5,
  orders: 1,
  sales: 20,
  ...extra,
});
const scope = E.scopeKey(row());
const report = (id, seq, rows, extra = {}) => ({
  id,
  name: id,
  type: "search",
  seq,
  rows,
  daily: true,
  start: rows[0]?.start,
  end: rows.at(-1)?.end,
  active: true,
  ...extra,
});
test("recognizes English Amazon search-term headers and attribution metrics, not units as orders", () => {
  const d = E.inspect([
    [
      "Date",
      "Campaign Name",
      "Ad Group Name",
      "Targeting",
      "Customer Search Term",
      "Match Type",
      "Impressions",
      "Clicks",
      "Spend",
      "7 Day Total Orders (#)",
      "7 Day Total Sales",
      "7 Day Total Units (#)",
    ],
    [
      "10/01/2026",
      "C",
      "G",
      "bottle",
      "water bottle",
      "EXACT",
      100,
      10,
      5,
      1,
      20,
      3,
    ],
  ]);
  assert.equal(d.type, "search");
  assert.equal(d.map.orders, "7 Day Total Orders (#)");
  assert.equal(d.map.units, "7 Day Total Units (#)");
  const p = E.prepare(d, {
    store: "a",
    site: "US",
    adType: "SP",
    currency: "USD",
    attribution: "7-day",
  });
  assert.equal(p.rows[0].orders, 1);
  assert.equal(p.rows[0].units, 3);
  assert.equal(p.rows[0].start, "2026-10-01");
});
test("recognizes Chinese report families by columns rather than filename", () => {
  for (const [headers, type] of [
    [
      [
        "日期",
        "广告活动名称",
        "广告组名称",
        "投放",
        "展示量",
        "点击量",
        "花费",
      ],
      "target",
    ],
    [["日期", "广告活动名称", "广告位", "曝光", "花费"], "placement"],
    [
      ["（子）ASIN", "会话次数 - 总计", "已订购商品销售额", "已订购商品数量"],
      "business",
    ],
    [["Date", "Campaign Name", "Impressions", "Clicks", "Spend"], "campaign"],
    [["Date", "Advertised ASIN", "Advertised SKU", "Spend"], "product"],
  ])
    assert.equal(E.inspect([headers, headers.map(() => 1)]).type, type);
});
test("conflicting attribution windows remain explicit mapping choices", () => {
  const d = E.detect([
    "7 Day Total Orders (#)",
    "14 Day Total Orders (#)",
    "Clicks",
  ]);
  assert.equal(d.map.orders, undefined);
  assert.equal(d.ambiguous.orders.length, 2);
  assert.equal(
    E.detect(["7 Day Total Orders (#)", "14 Day Total Orders (#)"], {
      orders: "7 Day Total Orders (#)",
    }).map.orders,
    "7 Day Total Orders (#)",
  );
});
test("currency suffixes and locale numbers are recognized", () => {
  assert.equal(E.detect(["Spend (USD)", "Date"]).map.spend, "Spend (USD)");
  assert.equal(E.number("1.234,56"), 1234.56);
  assert.equal(E.number("$1,234.56"), 1234.56);
  assert.equal(E.number(""), null);
  assert.equal(E.number("not a number"), null);
});
test("CSV handles quoted newlines, TSV and BOM", () => {
  assert.deepEqual(E.parseDelimited('\uFEFFa,b\r\n"x,y","a""b\nc"'), [
    ["a", "b"],
    ["x,y", 'a"b\nc'],
  ]);
  assert.deepEqual(E.parseDelimited("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.throws(() => E.parseDelimited('a\n"unclosed'));
});
test("date parsing rejects impossible dates and validates periods", () => {
  assert.equal(E.date("2026-02-30"), "");
  assert.equal(E.date("2026年10月2日"), "2026-10-02");
  assert.deepEqual(E.periods("2026-10-14"), {
    a: { start: "2026-10-08", end: "2026-10-14" },
    b: { start: "2026-10-01", end: "2026-10-07" },
  });
});
test("aggregate metrics sum numerators, preserve missing and zero denominators", () => {
  const m = E.metrics([
    row(),
    row({ clicks: 90, spend: 180, orders: 9, sales: 900 }),
  ]);
  assert.equal(m.cpc, 1.85);
  assert.equal(m.cvr, 0.1);
  assert.equal(m.acos, 185 / 920);
  assert.equal(E.metrics([row({ clicks: 0 })]).cpc, null);
  assert.equal(E.metrics([row(), row({ spend: null })]).spend, null);
  assert.equal(E.metrics([]).impressions, null);
  assert.equal(E.change(5, 0).relative, null);
});
test("same-day updated snapshots replace whole earlier day, including removed terms", () => {
  const old = report("old", 1, [
    row(),
    row({ term: "removed", impressions: 500 }),
  ]);
  const update = report("new", 2, [row({ impressions: 120 })]);
  const s = E.select([old, update], "search", scope, {
    start: "2026-10-01",
    end: "2026-10-01",
  });
  assert.equal(s.rows.length, 1);
  assert.equal(E.metrics(s.rows).impressions, 120);
  assert.equal(s.rows[0].source, "new");
});
test("overlapping daily reports do not double count and retain non-overlap", () => {
  const a = report("a", 1, [
    row(),
    row({ start: "2026-10-02", end: "2026-10-02" }),
  ]);
  const b = report("b", 2, [
    row({ start: "2026-10-02", end: "2026-10-02", impressions: 200 }),
    row({ start: "2026-10-03", end: "2026-10-03" }),
  ]);
  const s = E.select([a, b], "search", scope, {
    start: "2026-10-01",
    end: "2026-10-03",
  });
  assert.equal(s.rows.length, 3);
  assert.equal(E.metrics(s.rows).impressions, 400);
  assert.equal(s.full, true);
});
test("summary rows require exact periods and never split into weeks", () => {
  const r = report(
    "summary",
    1,
    [row({ start: "2026-10-01", end: "2026-10-14" })],
    { daily: false, start: "2026-10-01", end: "2026-10-14" },
  );
  assert.equal(
    E.select([r], "search", scope, { start: "2026-10-08", end: "2026-10-14" })
      .rows.length,
    0,
  );
  assert.equal(
    E.select([r], "search", scope, { start: "2026-10-01", end: "2026-10-14" })
      .full,
    true,
  );
});
test("currency, ad type, attribution, report families stay separate", () => {
  const reports = [
    report("a", 1, [row()]),
    report("cad", 2, [row({ currency: "CAD", impressions: 900 })]),
    report("target", 3, [row({ impressions: 700 })], { type: "target" }),
    report("sb", 4, [row({ adType: "SB", impressions: 500 })]),
  ];
  assert.equal(
    E.metrics(
      E.select(reports, "search", scope, {
        start: "2026-10-01",
        end: "2026-10-01",
      }).rows,
    ).impressions,
    100,
  );
});
test("missing-period objects are not converted to zeros or fake demand declines", () => {
  const p = {
    a: { start: "2026-10-02", end: "2026-10-02" },
    b: { start: "2026-10-01", end: "2026-10-01" },
  };
  const c = E.compare([report("old", 1, [row()])], "search", scope, p);
  assert.equal(c.rows[0].am.impressions, null);
  assert.equal(c.rows[0].comparable, false);
  assert.match(E.explain(c.rows[0], c)[0], /不等于搜索需求消失/);
});
test("search summary aggregates same term but ad-group details remain actionable", () => {
  const r = report("a", 1, [row(), row({ groupId: "g2" })]);
  const p = {
    a: { start: "2026-10-01", end: "2026-10-01" },
    b: { start: "2026-09-30", end: "2026-09-30" },
  };
  assert.equal(E.compare([r], "search", scope, p, true).rows.length, 1);
  assert.equal(E.compare([r], "search", scope, p, false).rows.length, 2);
});
test("activity-level placement data never invents keyword dimensions", () => {
  const r = report(
    "p",
    1,
    [
      row({
        target: undefined,
        term: undefined,
        group: undefined,
        groupId: undefined,
        placement: "Top of search",
      }),
    ],
    { type: "placement" },
  );
  const p = {
    a: { start: "2026-10-01", end: "2026-10-01" },
    b: { start: "2026-09-30", end: "2026-09-30" },
  };
  const c = E.compare([r], "placement", scope, p);
  assert.equal(c.rows[0].row.target, undefined);
  assert.equal(c.rows[0].row.groupId, undefined);
});
test("legacy migration retains product families, ASINs, edited mappings, experiments and decisions", () => {
  const s = globalThis.WorkspaceStorage.migrate({
    rows: [],
    mappings: { B0G13CGMVP: { parent: "verified-parent" } },
    actions: [{ title: "old experiment" }],
    events: [{ detail: "old event" }],
    decisions: { term: "observe" },
  });
  assert.equal(s.products.length, 4);
  assert.match(s.products[0].variants, /verified-parent/);
  assert.match(s.products[0].asins, /B0G13CGMVP/);
  assert.equal(s.actions[0].title, "old experiment");
  assert.equal(s.legacy.decisions.term, "observe");
});
test("CSV export protects spreadsheet formulas", () => {
  assert.match(E.safeCSV([['=HYPERLINK("bad")']]), /'=HYPERLINK/);
});
test("stable campaign and ad-group IDs survive display-name changes", () => {
  const p = {
    a: { start: "2026-10-02", end: "2026-10-02" },
    b: { start: "2026-10-01", end: "2026-10-01" },
  };
  const r = report("a", 1, [
    row(),
    row({
      start: "2026-10-02",
      end: "2026-10-02",
      campaign: "Renamed",
      group: "Renamed Group",
    }),
  ]);
  const c = E.compare([r], "search", scope, p);
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].comparable, true);
});
test("newer exact-period summary can replace an older complete daily snapshot", () => {
  const daily = report("daily", 1, [row()]);
  const summary = report("new summary", 2, [row({ impressions: 130 })], {
    daily: false,
  });
  const s = E.select([daily, summary], "search", scope, {
    start: "2026-10-01",
    end: "2026-10-01",
  });
  assert.equal(E.metrics(s.rows).impressions, 130);
  assert.equal(s.summary, true);
});
test("missing prior spend never becomes a false spending-growth claim", () => {
  const p = {
    a: { start: "2026-10-02", end: "2026-10-02" },
    b: { start: "2026-10-01", end: "2026-10-01" },
  };
  const r = report("r", 1, [
    row({ spend: null }),
    row({ start: "2026-10-02", end: "2026-10-02", spend: 100, clicks: 20 }),
  ]);
  const c = E.compare([r], "search", scope, p);
  assert.doesNotMatch(E.explain(c.rows[0], c).join(" "), /花费增加|花费增长/);
});
test("UTF-16 exported tables decode before delimiter parsing", () => {
  const data = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from("日期\t点击\n2026-10-01\t5", "utf16le"),
  ]);
  assert.deepEqual(E.parseDelimited(E.decodeText(data)), [
    ["日期", "点击"],
    ["2026-10-01", "5"],
  ]);
});

test("duplicate original headers retain every column without overwriting data", () => {
  const d = E.inspect([
    ["Date", "Customer Search Term", "Clicks", "Clicks", "Spend"],
    ["2026-10-01", "water bottle", 5, 99, 10],
  ]);
  assert.equal(new Set(d.headers).size, 5);
  assert.equal(d.map.clicks, undefined);
  assert.equal(d.raw[0][d.headers[2]], 5);
  assert.equal(d.raw[0][d.headers[3]], 99);
  assert.equal(d.headerWarnings.length, 2);
  const retry = E.inspect(
    [
      ["Date", "Customer Search Term", "Clicks", "Clicks", "Spend"],
      ["2026-10-01", "water bottle", 5, 99, 10],
    ],
    { map: { clicks: d.headers[2] } },
  );
  assert.equal(retry.map.clicks, d.headers[2]);
});
