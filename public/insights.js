(() => {
  "use strict";
  const E = globalThis.ReportEngine;
  const known = (scope) => {
    const a = JSON.parse(scope || "[]")[4] || "";
    return (
      !/未注明|未知|unknown/i.test(a) &&
      /\d+\s*[- ]?\s*(?:天|日|day)|click|点击|view|浏览|业务报告/i.test(a)
    );
  };
  const fmt = (n, k = "") =>
    n == null
      ? "缺失"
      : ["ctr", "cvr", "acos"].includes(k)
        ? (n * 100).toFixed(2) + "%"
        : Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const pair = (a, b, k) => `${fmt(b, k)} → ${fmt(a, k)}`;
  function metricComparable(g, k, scope) {
    return (
      !!g.comparable &&
      (known(scope) || !["orders", "sales", "cvr", "acos", "roas"].includes(k))
    );
  }
  function evaluate(g, ctx = {}) {
    if (!g.a.length) return null;
    const m = g.am,
      b = g.bm,
      conv = metricComparable(g, "cvr", ctx.scope),
      base = !!g.comparable;
    const facts = [],
      checks = [],
      rules = [];
    let score = 0;
    const stable = (a, b) =>
      a != null &&
      b != null &&
      Math.abs(a - b) <= Math.max(Math.abs(b) * 0.1, 0.001);
    const add = (rule, fact, check, weight) => {
      rules.push(rule);
      facts.push(fact);
      checks.push(check);
      score += weight;
    };
    if (
      base &&
      m.impressions != null &&
      b.impressions > 0 &&
      m.impressions < b.impressions * 0.9 &&
      conv &&
      stable(m.ctr, b.ctr) &&
      stable(m.cvr, b.cvr)
    )
      add(
        "traffic",
        `曝光 ${pair(m.impressions, b.impressions)}，CTR ${pair(m.ctr, b.ctr, "ctr")}、CVR ${pair(m.cvr, b.cvr, "cvr")}基本稳定`,
        "优先检查流量获取：报告覆盖、投放资格、预算消耗时段和位置占比；尚不能认定预算不足。",
        65,
      );
    if (
      conv &&
      m.clicks > b.clicks &&
      b.clicks != null &&
      m.orders != null &&
      b.orders != null &&
      m.orders <= b.orders &&
      m.cvr != null &&
      b.cvr != null &&
      m.cvr < b.cvr
    )
      add(
        "conversion",
        `点击 ${pair(m.clicks, b.clicks)}，订单 ${pair(m.orders, b.orders)}，CVR ${pair(m.cvr, b.cvr, "cvr")}`,
        "先检查新增搜索词构成、产品相关性与配送/价格变化；不要仅为获取点击继续加价。",
        85,
      );
    if (
      conv &&
      m.cpc != null &&
      b.cpc != null &&
      m.cpc > b.cpc &&
      m.cvr != null &&
      b.cvr != null &&
      m.cvr > b.cvr
    )
      add(
        "cost-benefit",
        `CPC ${pair(m.cpc, b.cpc)}，CVR ${pair(m.cvr, b.cvr, "cvr")}，ACOS ${pair(m.acos, b.acos, "acos")}`,
        m.acos != null && b.acos != null && m.acos <= b.acos
          ? "成本上涨同时效率改善，先核对产品目标ACOS，再决定是否保留流量；不能仅因CPC上涨降价。"
          : "成本和转化同时上涨，结合目标ACOS与利润检查这部分流量是否值得；目前不直接给出加减价指令。",
        70,
      );
    if (
      base &&
      m.cpc != null &&
      b.cpc != null &&
      m.cpc > b.cpc &&
      !rules.includes("cost-benefit")
    )
      add(
        "cpc",
        `CPC ${pair(m.cpc, b.cpc)}，花费 ${pair(m.spend, b.spend)}`,
        "查看搜索词和位置流量构成、历史竞价调整，再评估成本；竞争加剧只是待验证原因。",
        45,
      );
    if (conv && m.orders > 0 && b.orders === 0)
      add(
        "new-order",
        `订单 ${pair(m.orders, b.orders)}，本期花费 ${fmt(m.spend)}，ACOS ${fmt(m.acos, "acos")}`,
        "检查出单词是否匹配产品场景、是否已有精准覆盖；达到产品目标后再考虑提取精准。",
        60,
      );
    if (m.spend > 0 && m.orders === 0)
      add(
        "no-order",
        `本期花费 ${fmt(m.spend)}、点击 ${fmt(m.clicks)}、订单 0${g.b.length ? `；上期花费 ${fmt(b.spend)}、订单 ${fmt(b.orders)}` : ""}`,
        "检查相关性、归因回补和样本量；仅在确认不相关等证据后考虑否词，不按固定点击次数自动否定。",
        35,
      );
    if (
      base &&
      !rules.includes("traffic") &&
      m.impressions != null &&
      b.impressions > 0 &&
      Math.abs(m.impressions - b.impressions) / b.impressions >= 0.2
    )
      add(
        "volume",
        `曝光 ${pair(m.impressions, b.impressions)}，CTR ${pair(m.ctr, b.ctr, "ctr")}`,
        "核对市场流量与位置分布，并检查是否更换过投放范围；曝光变化本身不证明自然排名变化。",
        30,
      );
    if (!g.b.length && m.orders > 0)
      add(
        "observed-order",
        `本期记录订单 ${fmt(m.orders)}、花费 ${fmt(m.spend)}；上期${ctx.data?.b.full ? "报告中未出现" : "覆盖不足"}`,
        "可检查这批出单流量，但不能把缺失的上期当0或认定为新需求；补齐对比和产品目标。",
        25,
      );
    const p = ctx.product,
      goal = Number(p?.targetAcos),
      term = String(g.row.term || "")
        .trim()
        .toLowerCase();
    const relevant = p?.relevanceTerms
      ?.split(/[\n,，]/)
      .map((x) => x.trim().toLowerCase())
      .includes(term);
    if (
      ctx.type === "search" &&
      known(ctx.scope) &&
      m.orders > 0 &&
      m.acos != null &&
      goal > 0 &&
      m.acos <= goal / 100 &&
      relevant &&
      ctx.targetCoverageFull &&
      !ctx.hasExact &&
      ctx.detail
    ) {
      add(
        "exact",
        `本期订单 ${fmt(m.orders)}、ACOS ${fmt(m.acos, "acos")}，达到已配置目标 ${goal}%；相关性已人工配置，当前完整投放报告未发现同组精准覆盖`,
        "可考虑新增精准，保留原活动和广告组，先人工复核目标和预算。",
        90,
      );
    }
    if (!rules.length) return null;
    const caveats = [];
    if (m.clicks != null && m.clicks < 30)
      caveats.push("本期不足30次点击，仅标记低样本，不据此判为异常或否词");
    if (!ctx.data?.comparable)
      caveats.push("覆盖不足或缺少上期，不能形成完整周期变化结论");
    if (!known(ctx.scope))
      caveats.push("归因口径未知：暂不比较订单、销售额、CVR、ACOS等归因指标");
    if (!p) caveats.push("产品相关性、目标ACOS未确认，不能据此确定加价或否词");
    return {
      rules,
      observed: facts.join("；"),
      check: checks.join(" "),
      caveats,
      score:
        score + Math.min(Math.abs((m.spend ?? 0) - (b.spend ?? 0)), 100) / 10,
      suggestion: rules.includes("exact")
        ? "新增精准候选"
        : rules.includes("conversion")
          ? "检查转化与搜索词构成"
          : rules.includes("traffic")
            ? "检查流量获取"
            : rules.includes("cost-benefit")
              ? "核对成本与转化收益"
              : rules.includes("no-order")
                ? "检查相关性"
                : "核对变化来源",
    };
  }
  function matches(g, kind, ctx = {}) {
    const a = g.am,
      b = g.bm;
    if (kind === "all") return true;
    if (kind === "high-spend")
      return a.spend != null && a.spend >= ctx.highSpend;
    if (kind === "cpc-up")
      return (
        metricComparable(g, "cpc", ctx.scope) &&
        a.cpc != null &&
        b.cpc != null &&
        a.cpc > b.cpc
      );
    if (kind === "cvr-down")
      return (
        metricComparable(g, "cvr", ctx.scope) &&
        a.cvr != null &&
        b.cvr != null &&
        a.cvr < b.cvr
      );
    if (kind === "new-order")
      return (
        metricComparable(g, "orders", ctx.scope) &&
        a.orders > 0 &&
        b.orders === 0
      );
    if (kind === "no-order" || kind === "relevance")
      return a.spend > 0 && a.orders === 0;
    if (kind === "new") return g.a.length > 0 && !g.b.length;
    if (kind === "both") return g.a.length > 0 && g.b.length > 0;
    if (kind === "gone") return !g.a.length && g.b.length > 0;
    if (kind === "exact") return !!ctx.insight?.rules.includes("exact");
    return true;
  }
  function sort(rows, key) {
    return [...rows].sort((a, b) => {
      if (key === "word")
        return String(
          a.row.term || a.row.target || a.row.placement || "",
        ).localeCompare(
          String(b.row.term || b.row.target || b.row.placement || ""),
        );
      const value = (g) =>
        key === "cpc-change"
          ? g.comparable && g.am.cpc != null && g.bm.cpc != null
            ? g.am.cpc - g.bm.cpc
            : -Infinity
          : (g.am[key] ?? -Infinity);
      return value(b) - value(a);
    });
  }
  function choosePeriods(reports, scope, n, cutoff) {
    const sources = reports.filter(
      (r) => r.active !== false && r.rows.some((x) => E.scopeKey(x) === scope),
    );
    const ends = [
      ...new Set(
        sources
          .filter((r) => r.daily)
          .flatMap((r) =>
            r.rows
              .filter((x) => E.scopeKey(x) === scope && x.end <= cutoff)
              .map((x) => x.end),
          ),
      ),
    ]
      .sort()
      .reverse();
    for (const end of ends) {
      const p = E.periods(end, n);
      if (
        [
          "target",
          "search",
          "placement",
          "campaign",
          "product",
          "business",
        ].some((t) => E.select(sources, t, scope, p.a).full)
      )
        return { periods: p, note: "" };
    }
    const summary = sources
      .filter((r) => !r.daily && r.end <= cutoff)
      .sort((a, b) => b.end.localeCompare(a.end) || b.seq - a.seq)[0];
    if (summary)
      return {
        periods: E.suggestedPeriods([summary], scope, summary.type, cutoff),
        note: `当前只有 ${summary.start} 至 ${summary.end} 的完整汇总，先展示整期，不能拆成${n}天；请补充每日数据以比较周度变化。`,
      };
    const end =
      sources
        .flatMap((r) => r.rows)
        .map((r) => r.end)
        .filter((x) => x <= cutoff)
        .sort()
        .at(-1) || cutoff;
    return {
      periods: E.periods(end, n),
      note: "数据覆盖可能不足，缺失日期不补零。",
    };
  }
  globalThis.OperationsInsights = {
    evaluate,
    matches,
    sort,
    choosePeriods,
    metricComparable,
    known,
  };
})();
