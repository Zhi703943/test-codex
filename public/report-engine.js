(() => {
  "use strict";
  const labels = {
    date: "日期",
    start: "开始日期",
    end: "结束日期",
    store: "店铺",
    site: "站点",
    currency: "币种",
    adType: "广告类型",
    attribution: "归因口径",
    campaign: "广告活动",
    campaignId: "广告活动ID",
    group: "广告组",
    groupId: "广告组ID",
    target: "关键词/投放目标",
    term: "顾客搜索词",
    match: "匹配方式",
    placement: "广告位置",
    asin: "广告ASIN",
    purchasedAsin: "购买ASIN",
    sku: "SKU",
    impressions: "曝光",
    clicks: "点击",
    spend: "花费",
    orders: "广告订单",
    sales: "广告销售额",
    units: "广告销量",
    sessions: "会话",
    totalSales: "业务销售额",
    totalUnits: "业务销量",
    unitSession: "业务 Unit Session %",
  };
  const aliases = {
    date: ["date", "日期", "报告日期", "统计日期"],
    start: ["start date", "开始日期", "起始日期"],
    end: ["end date", "结束日期", "截止日期"],
    store: ["store", "store name", "店铺", "店铺名称"],
    site: ["marketplace", "marketplace name", "站点", "国家/地区", "country"],
    currency: ["currency", "货币", "币种"],
    adType: [
      "ad type",
      "advertising type",
      "广告类型",
      "广告产品",
      "广告产品类型",
    ],
    attribution: ["attribution", "attribution window", "归因口径"],
    campaign: ["campaign name", "campaign", "广告活动名称", "广告活动"],
    campaignId: ["campaign id", "广告活动id", "广告活动编号"],
    group: ["ad group name", "ad group", "广告组名称", "广告组"],
    groupId: ["ad group id", "广告组id", "广告组编号"],
    target: [
      "targeting",
      "keyword",
      "keyword text",
      "关键词",
      "关键词文本",
      "投放",
      "投放目标",
      "原投放目标",
      "关键词投放",
      "投放表达式",
      "targeting expression",
    ],
    term: [
      "customer search term",
      "search term",
      "顾客搜索词",
      "客户搜索词",
      "买家搜索词",
      "搜索词",
      "实际搜索词或商品asin",
    ],
    match: ["match type", "匹配类型", "匹配方式", "原匹配方式"],
    placement: ["placement", "广告位", "广告位置", "投放位置"],
    asin: [
      "advertised asin",
      "广告asin",
      "推广的asin",
      "推广asin",
      "广告商品asin",
      "(child) asin",
      "（子）asin",
      "(子)asin",
      "子asin",
      "asin",
    ],
    purchasedAsin: ["purchased asin", "购买asin"],
    sku: ["advertised sku", "推广的sku", "sku", "seller sku"],
    impressions: ["impressions", "曝光量", "展示量", "曝光", "展示次数"],
    clicks: ["clicks", "点击量", "点击次数", "点击"],
    spend: ["spend", "cost", "花费", "支出", "广告花费"],
    orders: [
      "orders",
      "total orders",
      "purchases",
      "订单",
      "广告订单",
      "订单数",
    ],
    sales: ["sales", "total sales", "广告销售额", "销售额"],
    units: ["units", "total units", "销量", "广告销量"],
    sessions: [
      "sessions total",
      "sessions - total",
      "sessions",
      "会话数总计",
      "会话次数总计",
      "会话总数",
    ],
    totalSales: [
      "ordered product sales",
      "ordered product sales total",
      "已订购商品销售额",
      "订购商品销售额",
    ],
    totalUnits: [
      "units ordered",
      "units ordered total",
      "已订购商品数量",
      "订购商品数量",
    ],
    unitSession: [
      "unit session percentage",
      "unit session percentage total",
      "商品会话百分比",
      "商品会话百分比总计",
    ],
  };
  const normalize = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[\s\uFEFF()（）\[\]【】\-_\/:%％.,，]/g, "");
  const types = {
    search: "搜索词报告",
    target: "投放报告",
    placement: "广告位置报告",
    product: "广告商品报告",
    campaign: "广告活动报告",
    business: "子ASIN销售与流量",
    unknown: "待确认报告类型",
  };
  function detect(headers, rules = {}) {
    const map = {},
      ambiguous = {};
    for (const [key, list] of Object.entries(aliases)) {
      const candidates = headers.filter((h) =>
        list.some(
          (a) =>
            normalize(a) ===
            normalize(
              h.replace(
                /\s*[（(]?(?:USD|CAD|EUR|GBP|JPY|AUD|CNY|MXN)[）)]?\s*$/i,
                "",
              ),
            ),
        ),
      );
      if (["orders", "sales", "units"].includes(key))
        for (const h of headers) {
          const n = normalize(h);
          if (
            (/(?:7|14|30|1)day/.test(n) || /(?:7|14|30|1)天/.test(n)) &&
            ((key === "orders" &&
              /totalorders|purchases|总订单|订单总数|订单数/.test(n)) ||
              (key === "sales" && /totalsales|总销售额|销售总额/.test(n)) ||
              (key === "units" &&
                /totalunits|总销售量|总销售数量|总销量/.test(n)))
          )
            candidates.push(h);
        }
      const unique = [...new Set(candidates)];
      if (unique.length === 1) map[key] = unique[0];
      else if (unique.length > 1) {
        ambiguous[key] = unique;
      }
    }
    for (const [k, h] of Object.entries(rules))
      if (headers.includes(h)) map[k] = h;
    let type =
      map.sessions || map.totalSales
        ? "business"
        : map.term
          ? "search"
          : map.placement
            ? "placement"
            : map.target
              ? "target"
              : map.asin || map.sku
                ? "product"
                : map.campaign || map.campaignId
                  ? "campaign"
                  : "unknown";
    return {
      map,
      ambiguous: Object.fromEntries(
        Object.entries(ambiguous).filter(([k]) => !map[k]),
      ),
      type,
    };
  }
  function decodeText(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 255 && b[1] === 254)
      return new TextDecoder("utf-16le", { fatal: true }).decode(buffer);
    if (b[0] === 254 && b[1] === 255)
      return new TextDecoder("utf-16be", { fatal: true }).decode(buffer);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
    }
  }
  function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, "");
    const first = text.split(/\r?\n/).slice(0, 5).join("\n");
    const delim =
      (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length
        ? "\t"
        : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
          ? ";"
          : ",";
    const rows = [];
    let row = [],
      cell = "",
      quote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quote && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quote = !quote;
      } else if (c === delim && !quote) {
        row.push(cell);
        cell = "";
      } else if (/[\r\n]/.test(c) && !quote) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (quote) throw Error("CSV 引号未闭合");
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows;
  }
  function date(v) {
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (v == null || String(v).trim() === "") return "";
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (!m) {
      const en = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (en) m = [null, en[3], en[1], en[2]];
    }
    if (m) {
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      return !isNaN(Date.parse(iso)) &&
        new Date(iso).toISOString().slice(0, 10) === iso
        ? iso
        : "";
    }
    if (
      /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$|^\d{1,2}[- ]+[A-Za-z]{3,9}[- ]+\d{4}$/.test(
        s,
      )
    ) {
      const d = new Date(s);
      return isNaN(d) ? "" : d.toISOString().slice(0, 10);
    }
    return "";
  }
  function number(v) {
    if (
      v == null ||
      String(v).trim() === "" ||
      ["—", "-", "N/A", "--"].includes(String(v))
    )
      return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let s = String(v)
      .trim()
      .replace(/[$€£¥￥\s%％]/g, "");
    if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s))
      s = s.replaceAll(".", "").replace(",", ".");
    else s = s.replaceAll(",", "");
    return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
  }
  function inferAd(values, map) {
    if (map.adType) {
      const vals = [
        ...new Set(
          values.map((r) => String(r[map.adType] || "")).filter(Boolean),
        ),
      ];
      if (vals.length === 1) {
        if (/sponsored products|商品推广|^sp$/i.test(vals[0])) return "SP";
        if (/sponsored brands|品牌推广|^sb$/i.test(vals[0])) return "SB";
        if (/sponsored display|展示型推广|^sd$/i.test(vals[0])) return "SD";
      }
    }
    return "";
  }
  function inspect(matrix, rule = {}) {
    let index = 0,
      best = -1;
    for (let i = 0; i < Math.min(matrix.length, 25); i++) {
      const det = detect(matrix[i].map(String), rule.map);
      const score = Object.keys(det.map).length;
      if (score > best) {
        best = score;
        index = i;
      }
    }
    const headers =
      matrix[index]?.map(
        (v, i) => String(v ?? "").trim() || `未命名列${i + 1}`,
      ) || [];
    if (!headers.length) throw Error("空工作表");
    if (new Set(headers).size !== headers.length)
      throw Error("存在重复列名，请在源报告中区分后上传");
    const raw = matrix
      .slice(index + 1)
      .filter((r) => r.some((v) => v != null && String(v).trim() !== ""))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
    if (!raw.length) throw Error("没有数据行");
    const det = detect(headers, rule.map);
    const currencies = [
      ...new Set(
        headers
          .flatMap(
            (h) => h.match(/\b(?:USD|CAD|EUR|GBP|JPY|AUD|CNY|MXN)\b/gi) || [],
          )
          .map((x) => x.toUpperCase()),
      ),
    ];
    return {
      headerIndex: index,
      headers,
      raw,
      map: det.map,
      ambiguous: det.ambiguous,
      type: rule.type || det.type,
      signature: JSON.stringify(headers.map(normalize)),
      adType: inferAd(raw, det.map),
      currencyHint: currencies.length === 1 ? currencies[0] : "",
    };
  }
  const numeric = [
    "impressions",
    "clicks",
    "spend",
    "orders",
    "sales",
    "units",
    "sessions",
    "totalSales",
    "totalUnits",
    "unitSession",
  ];
  function prepare(draft, meta) {
    const { map, raw } = draft;
    const rows = [],
      issues = [];
    let min = "",
      max = "";
    for (let i = 0; i < raw.length; i++) {
      const src = raw[i],
        r = { line: i + (draft.headerIndex || 0) + 2 };
      for (const [key, h] of Object.entries(map))
        if (!["date", "start", "end"].includes(key))
          r[key] = numeric.includes(key)
            ? number(src[h])
            : String(src[h] ?? "").trim();
      if (numeric.some((k) => r[k] != null && r[k] < 0))
        throw Error(`第 ${i + 2} 行出现负指标，需核实退款/调整数据口径`);
      for (const k of numeric)
        if (
          map[k] &&
          src[map[k]] !== "" &&
          r[k] == null &&
          String(src[map[k]]).trim() &&
          !["—", "-", "N/A", "--"].includes(String(src[map[k]]))
        )
          issues.push(`第 ${i + 2} 行 ${labels[k]} 不是可计算数字，保留为缺失`);
      const dt = map.date ? date(src[map.date]) : "";
      r.start = dt || (map.start ? date(src[map.start]) : "") || meta.start;
      r.end = dt || (map.end ? date(src[map.end]) : "") || meta.end;
      if (!r.start || !r.end || r.start > r.end)
        throw Error(`第 ${i + 2} 行缺少有效日期范围，请补充或检查日期映射`);
      if (map.date && !dt)
        throw Error(`第 ${i + 2} 行日期无法识别，不能用整表范围覆盖无效日期`);
      r.store = r.store || meta.store;
      r.site = r.site || meta.site;
      r.currency = r.currency || meta.currency;
      r.adType = draft.type === "business" ? "业务" : r.adType || meta.adType;
      r.attribution =
        draft.type === "business"
          ? "业务报告"
          : r.attribution || meta.attribution;
      if (!r.store || !r.site || !r.currency || !r.adType || !r.attribution)
        throw Error("店铺、站点、币种、广告类型及归因口径尚未补齐");
      if (/sponsored products|商品推广|^sp$/i.test(r.adType)) r.adType = "SP";
      if (/sponsored brands|品牌推广|^sb$/i.test(r.adType)) r.adType = "SB";
      if (/sponsored display|展示型推广|^sd$/i.test(r.adType)) r.adType = "SD";
      r.currency = r.currency.toUpperCase();
      if (
        map.unitSession &&
        r.unitSession != null &&
        (String(src[map.unitSession]).includes("%") || r.unitSession > 1)
      )
        r.unitSession /= 100;
      for (const k of [
        "impressions",
        "clicks",
        "orders",
        "units",
        "sessions",
        "totalUnits",
      ])
        if (r[k] != null && !Number.isInteger(r[k]))
          issues.push(`第 ${i + 2} 行 ${labels[k]} 非整数，请核实口径`);
      if (r.clicks != null && r.impressions != null && r.clicks > r.impressions)
        issues.push(`第 ${i + 2} 行点击大于曝光，请核对源报告指标`);
      if (!min || r.start < min) min = r.start;
      if (!max || r.end > max) max = r.end;
      rows.push(r);
    }
    if (draft.type === "unknown") throw Error("请确认报告类型");
    if (!numeric.some((k) => map[k])) throw Error("至少映射一个数值指标");
    const required = {
      search: ["term"],
      target: ["target"],
      placement: ["placement"],
      product: [],
      campaign: [],
      business: ["asin"],
    }[draft.type];
    for (const k of required)
      if (!map[k]) throw Error(`缺少必要字段：${labels[k]}`);
    return {
      rows,
      start: min,
      end: max,
      issues: [...new Set(issues)],
      daily: rows.every((r) => r.start === r.end),
    };
  }
  function scopeKey(r) {
    return JSON.stringify([
      r.store,
      r.site,
      r.adType,
      r.currency,
      r.attribution,
    ]);
  }
  function ratio(a, b) {
    return a == null || b == null || b === 0 ? null : a / b;
  }
  function metrics(rows) {
    const sum = (k) =>
      rows.length && rows.every((r) => r[k] != null)
        ? rows.reduce((s, r) => s + r[k], 0)
        : null;
    const m = {};
    for (const k of numeric.filter((k) => k !== "unitSession")) m[k] = sum(k);
    m.ctr = ratio(m.clicks, m.impressions);
    m.cpc = ratio(m.spend, m.clicks);
    m.cvr = ratio(m.orders, m.clicks);
    m.acos = ratio(m.spend, m.sales);
    m.roas = ratio(m.sales, m.spend);
    m.businessUnitSession = ratio(m.totalUnits, m.sessions);
    return m;
  }
  function shift(s, n) {
    const d = new Date(s + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function periods(end, n = 7) {
    return {
      a: { start: shift(end, 1 - n), end },
      b: { start: shift(end, 1 - n * 2), end: shift(end, -n) },
    };
  }
  function days(a, b) {
    const result = [];
    for (let s = a; s <= b; s = shift(s, 1)) {
      result.push(s);
      if (result.length > 3660) break;
    }
    return result;
  }
  // Choose one source snapshot per covered day. Whole-period rows are never divided.
  function select(reports, type, scope, period) {
    const eligible = reports
      .filter((r) => r.active !== false && r.type === type)
      .map((r) => ({ ...r, rows: r.rows.filter((x) => scopeKey(x) === scope) }))
      .filter((r) => r.rows.length)
      .sort((a, b) => b.seq - a.seq);
    const daily = eligible.filter((r) => r.daily);
    const chosen = new Map();
    for (const report of daily) {
      const groups = new Map();
      for (const r of report.rows)
        if (r.start >= period.start && r.end <= period.end) {
          if (!groups.has(r.start)) groups.set(r.start, []);
          groups
            .get(r.start)
            .push({ ...r, source: report.id, sourceName: report.name, type });
        }
      for (const [d, rows] of groups) if (!chosen.has(d)) chosen.set(d, rows);
    }
    const need = days(period.start, period.end);
    const summaries = eligible.filter(
      (r) =>
        !r.daily &&
        r.start === period.start &&
        r.end === period.end &&
        r.rows.every((x) => x.start === period.start && x.end === period.end),
    );
    const latestDailySeq = Math.max(
      -1,
      ...[...chosen.values()]
        .flat()
        .map((x) => eligible.find((r) => r.id === x.source)?.seq ?? -1),
    );
    if (
      chosen.size === need.length &&
      (!summaries.length || latestDailySeq >= summaries[0].seq)
    )
      return {
        rows: [...chosen.values()].flat(),
        coverage: chosen.size,
        expected: need.length,
        full: true,
        summary: false,
        warnings: [],
      };
    if (summaries.length) {
      const r = summaries[0];
      return {
        rows: r.rows.map((x) => ({
          ...x,
          source: r.id,
          sourceName: r.name,
          type,
        })),
        coverage: need.length,
        expected: need.length,
        full: true,
        summary: true,
        warnings: ["使用完整周期汇总，不能拆分为每日或每周"],
      };
    }
    return {
      rows: [...chosen.values()].flat(),
      coverage: chosen.size,
      expected: need.length,
      full: false,
      summary: false,
      warnings: eligible.some((r) => !r.daily)
        ? ["存在周期汇总，但与所选周期不完全一致，未拆分或计入"]
        : [],
    };
  }
  function dimensions(kind, summary = false) {
    if (kind === "search")
      return summary
        ? ["term"]
        : [
            "campaignId",
            "campaign",
            "groupId",
            "group",
            "target",
            "match",
            "term",
            "asin",
          ];
    if (kind === "target")
      return ["campaignId", "campaign", "groupId", "group", "target", "match"];
    if (kind === "placement")
      return [
        "campaignId",
        "campaign",
        "groupId",
        "group",
        "placement",
        "target",
        "match",
      ];
    if (kind === "business") return ["asin", "sku"];
    return ["campaignId", "campaign", "groupId", "group", "asin", "sku"];
  }
  function keyFor(row, type, summary = false) {
    return JSON.stringify(
      dimensions(type, summary).map((k) =>
        k === "campaign" && row.campaignId
          ? ""
          : k === "group" && row.groupId
            ? ""
            : row[k] || "",
      ),
    );
  }
  function compare(reports, type, scope, p, summary = false) {
    const a = select(reports, type, scope, p.a),
      b = select(reports, type, scope, p.b),
      dims = dimensions(type, summary),
      groups = new Map();
    for (const [side, data] of [
      ["a", a],
      ["b", b],
    ])
      for (const row of data.rows) {
        const key = keyFor(row, type, summary);
        if (!groups.has(key)) groups.set(key, { key, row, a: [], b: [] });
        groups.get(key)[side].push(row);
      }
    const comparable = a.full && b.full;
    const rows = [...groups.values()].map((g) => ({
      ...g,
      am: metrics(g.a),
      bm: metrics(g.b),
      status: !g.a.length
        ? "本期报告未出现"
        : !g.b.length
          ? "本期首次出现"
          : "两期均有记录",
      comparable: comparable && !!g.a.length && !!g.b.length,
    }));
    return { a, b, rows, comparable };
  }
  function change(a, b) {
    return a == null || b == null
      ? { delta: null, relative: null }
      : { delta: a - b, relative: b === 0 ? null : (a - b) / b };
  }
  function explain(g, context) {
    const facts = [],
      m = g.am,
      b = g.bm;
    if (!g.a.length)
      return ["本期报告未出现；不等于搜索需求消失，需核实覆盖与报告生成规则"];
    if (!g.b.length)
      facts.push(
        g.b.length === 0 && context.b.full
          ? "本期首次出现（不是已证实的新需求）"
          : "缺少可对比上期记录",
      );
    if (!g.b.length && m.orders > 0)
      facts.push("本期首次观察且有出单；不能仅据此认定新需求");
    if (g.comparable) {
      for (const [k, l] of [
        ["impressions", "曝光"],
        ["cpc", "CPC"],
        ["ctr", "CTR"],
        ["cvr", "CVR"],
      ]) {
        const c = change(m[k], b[k]);
        if (c.delta != null && c.delta !== 0)
          facts.push(`${l}${c.delta > 0 ? "上升" : "下降"}`);
      }
      if (
        m.spend != null &&
        b.spend != null &&
        m.spend > b.spend &&
        m.orders != null &&
        b.orders != null &&
        m.orders <= b.orders
      )
        facts.push("花费增加，订单未同步增加");
      if (m.orders > 0 && b.orders === 0) facts.push("本期新增出单");
      if (m.orders > b.orders && b.orders != null) facts.push("订单增长");
      if (
        m.spend != null &&
        b.spend != null &&
        m.spend > b.spend &&
        m.cvr != null &&
        b.cvr != null &&
        m.cvr < b.cvr
      )
        facts.push("花费增长且转化变差");
    }
    if (m.spend > 0 && m.orders === 0)
      facts.push(
        g.b.length && b.spend > 0 && b.orders === 0
          ? "两期持续花费但尚未转化，先核实相关性与归因"
          : "有花费尚未转化，不能据此自动否定",
      );
    if (m.clicks != null && m.clicks < 30)
      facts.push("低样本提示：不足30次点击仅用于标记，非否词阈值");
    if (!context.comparable)
      facts.push("周期覆盖不全，变化不能当作完整周度趋势");
    return facts.length
      ? facts
      : ["当前记录未触发明显变化提示，结合目标继续观察"];
  }
  function safeCSV(rows) {
    return (
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map((v) => {
              let s = String(v ?? "");
              if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
              return '"' + s.replaceAll('"', '""') + '"';
            })
            .join(","),
        )
        .join("\r\n")
    );
  }
  globalThis.ReportEngine = {
    labels,
    types,
    aliases,
    normalize,
    detect,
    parseDelimited,
    decodeText,
    date,
    number,
    inspect,
    prepare,
    scopeKey,
    metrics,
    ratio,
    periods,
    shift,
    days,
    select,
    compare,
    change,
    explain,
    safeCSV,
    dimensions,
    keyFor,
  };
})();
