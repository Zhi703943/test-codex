import test from "node:test";
import assert from "node:assert/strict";
import "../public/report-engine.js";
import "../public/insights.js";
const E = globalThis.ReportEngine,
  I = globalThis.OperationsInsights;
const scope = JSON.stringify(["S", "US", "SP", "USD", "7天点击"]);
function fixture(a, b) {
  return {
    key: "k",
    row: { term: "query", campaign: "C", group: "G", match: "BROAD" },
    a: [{}],
    b: [{}],
    am: E.metrics([a]),
    bm: E.metrics([b]),
    comparable: true,
  };
}
const r = (over = {}) => ({
  impressions: 1000,
  clicks: 100,
  spend: 50,
  orders: 10,
  sales: 200,
  ...over,
});
const ctx = {
  scope,
  type: "target",
  data: { comparable: true, b: { full: true } },
};
test("stable conversion with lost impressions suggests traffic checks rather than claiming budget shortage", () => {
  const g = fixture(
    r({ impressions: 500, clicks: 50, orders: 5, spend: 25, sales: 100 }),
    r(),
  );
  const x = I.evaluate(g, ctx);
  assert.ok(x.rules.includes("traffic"));
  assert.match(x.observed, /1,000 → 500/);
  assert.match(x.check, /尚不能认定预算不足/);
});
test("more clicks without orders and declining CVR produces a different conversion explanation", () => {
  const x = I.evaluate(fixture(r({ clicks: 150, orders: 8 }), r()), ctx);
  assert.ok(x.rules.includes("conversion"));
  assert.match(x.check, /搜索词构成|搜索词/);
  assert.notEqual(x.suggestion, "继续观察");
});
test("rising CPC with better conversion is evaluated together with ACOS", () => {
  const x = I.evaluate(
    fixture(r({ spend: 80, orders: 20, sales: 500 }), r()),
    ctx,
  );
  assert.ok(x.rules.includes("cost-benefit"));
  assert.match(x.observed, /ACOS/);
  assert.match(x.check, /不能仅因CPC上涨降价/);
});
test("unknown attribution restricts conversion comparisons and filters", () => {
  const unknown = {
    ...ctx,
    scope: JSON.stringify(["S", "US", "SP", "USD", "未注明归因"]),
  };
  const g = fixture(r({ clicks: 150, orders: 5 }), r());
  const x = I.evaluate(g, unknown);
  assert.ok(!x || !x.rules.includes("conversion"));
  assert.equal(I.matches(g, "cvr-down", { scope: unknown.scope }), false);
  assert.equal(I.metricComparable(g, "spend", unknown.scope), true);
});
test("exact-match candidate requires target, confirmed relevance, and evidence of no existing exact coverage", () => {
  const g = fixture(r({ orders: 10, spend: 20 }), r());
  const full = {
    ...ctx,
    type: "search",
    detail: true,
    product: { targetAcos: "20", relevanceTerms: "query" },
    targetCoverageFull: true,
    hasExact: false,
  };
  assert.ok(I.evaluate(g, full).rules.includes("exact"));
  assert.ok(
    !I.evaluate(g, { ...full, hasExact: true })?.rules.includes("exact"),
  );
  assert.ok(
    !I.evaluate(g, { ...full, product: { targetAcos: 20 } })?.rules.includes(
      "exact",
    ),
  );
});
test("stable rows do not create filler insights", () =>
  assert.equal(I.evaluate(fixture(r(), r()), ctx), null));
test("missing prior values cannot produce infinite growth or fabricated changes", () => {
  const g = fixture(r(), r({ spend: null, orders: null, sales: null }));
  g.comparable = false;
  g.b = [];
  g.bm = E.metrics([]);
  const x = I.evaluate(g, {
    ...ctx,
    data: { comparable: false, b: { full: false } },
  });
  assert.match(x.observed, /上期覆盖不足/);
  assert.doesNotMatch(x.observed, /0 →/);
});
test("low sample is a caveat rather than an automatic negative keyword decision", () => {
  const x = I.evaluate(
    fixture(r({ clicks: 3, orders: 0 }), r({ orders: 0 })),
    ctx,
  );
  assert.match(x.caveats.join(""), /低样本/);
  assert.match(x.check, /不按固定点击次数自动否定/);
});
test("a marketplace name is not an attribution window", () => {
  assert.equal(
    I.known(JSON.stringify(["S", "US", "SP", "USD", "亚马逊"])),
    false,
  );
});
