(() => {
  "use strict";
  const PARSER_VERSION = 2;
  const E = globalThis.ReportEngine,
    S = globalThis.WorkspaceStorage,
    $ = (s) => document.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const id = () =>
    globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  let state,
    page = "collect",
    tab = "target",
    scope = "",
    drafts = [],
    pendingFiles = [],
    storageWarning = "",
    busy = false,
    lastError = "",
    importNotices = [];
  let batchValues = {},
    periods = null,
    mode = "auto",
    searchView = "summary",
    metric = "impressions",
    filter = "",
    campaign = "",
    group = "",
    editProduct = null;
  const nav = [
    ["collect", "⇅", "1. 收集表格"],
    ["analyze", "◫", "2. 分析数据"],
    ["products", "▧", "产品与品牌"],
    ["experiments", "◎", "决策与验证"],
    ["events", "◷", "运营事件簿"],
  ];
  const metricLabels = {
    impressions: "曝光",
    clicks: "点击",
    ctr: "CTR",
    spend: "广告花费",
    cpc: "CPC",
    orders: "广告订单",
    sales: "广告销售额",
    cvr: "CVR",
    acos: "ACOS",
    roas: "ROAS",
    sessions: "业务会话",
    totalSales: "业务销售额",
    totalUnits: "业务销量",
    businessUnitSession: "业务 Unit Session %",
  };
  const pctKeys = ["ctr", "cvr", "acos", "businessUnitSession"];
  const fmt = (v, k = "") =>
    v == null
      ? "缺失 / 不支持"
      : pctKeys.includes(k)
        ? (v * 100).toFixed(2) + "%"
        : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString("sv-SE");
  function toast(t) {
    $("#toast").textContent = t;
    $("#toast").style.display = "block";
    setTimeout(() => ($("#toast").style.display = "none"), 7000);
  }
  async function save(files = []) {
    await S.put(state, files);
  }
  function download(name, data, type = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function top(title, sub, button = "") {
    return `<div class="topline"><div><div class="eyebrow">AMAZON / OPERATIONS</div><h1>${title}</h1><p>${sub}</p></div>${button}</div>`;
  }
  function head(t, s = "") {
    return `<div class="card-head"><h2>${t}</h2><small>${s}</small></div>`;
  }
  function options(items, value, empty = "") {
    return (
      (empty ? `<option value="">${empty}</option>` : "") +
      items
        .map((x) => {
          const [v, l] = Array.isArray(x) ? x : [x, x];
          return `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
        })
        .join("")
    );
  }
  function field(label, name, value = "", type = "text", required = false) {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`;
  }
  function scopes() {
    return [
      ...new Set(
        state.reports
          .filter((r) => r.active !== false)
          .flatMap((r) => r.rows.map(E.scopeKey)),
      ),
    ];
  }
  function initPeriods() {
    const all = state.reports
      .filter((r) => r.active !== false)
      .flatMap((r) => r.rows)
      .filter((r) => (!scope || E.scopeKey(r) === scope) && r.end < today());
    const latest =
      all
        .map((r) => r.end)
        .sort()
        .at(-1) || E.shift(today(), -1);
    periods =
      mode === "auto"
        ? E.suggestedPeriods(
            state.reports,
            scope,
            availableType(),
            E.shift(today(), -1),
          )
        : E.periods(latest, Number(mode) || 7);
  }
  function render() {
    if (!state) return;
    if ($("#confirm-batch"))
      batchValues = {
        ...batchValues,
        ...Object.fromEntries(new FormData($("#confirm-batch"))),
      };
    $("#nav").innerHTML = nav
      .map(
        ([p, i, t]) =>
          `<button data-page="${p}" class="${page === p ? "active" : ""}"><span>${i}</span>${t}</button>`,
      )
      .join("");
    $("#breadcrumb").textContent = nav.find((x) => x[0] === page)[2];
    document.title = "亚马逊运营工作台 · " + nav.find((x) => x[0] === page)[2];
    $("#app").innerHTML =
      (storageWarning
        ? `<div class="alert">${esc(storageWarning)}</div>`
        : "") +
      { collect, analyze, products, experiments, events }[page]() +
      `<div class="foot"><span>AMAZON OPERATIONS WORKSPACE</span><span>事实 · 证据 · 动作 · 验证</span></div>`;
    bind();
  }
  function capabilities(type) {
    return (
      {
        search: "顾客搜索词变化、广告组明细、投放目标的可见搜索流量",
        target: "投放关键词与目标变化",
        placement: "报表实际层级的广告位变化",
        product: "广告商品表现",
        campaign: "活动整体表现",
        business: "子ASIN业务销售与流量（独立口径）",
      }[type] || "待确认"
    );
  }
  function collect() {
    return (
      top(
        "收集表格",
        "直接上传后台原始报表。自动识别字段，先分析已有数据。",
        '<button class="primary" id="start-analysis">开始分析 →</button>',
      ) +
      `<div class="steps workflow"><span class="current">01 收集表格</span><span>02 分析数据</span></div><section class="card drop-zone" id="dropzone"><div class="upload-icon">⇧</div><h2>拖入亚马逊后台原始报表</h2><p>支持多文件 CSV / TSV / XLSX，以及 ZIP 批量导入，无需先下载模板。</p><label class="button primary">选择多份报表<input id="upload" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.zip" hidden ${busy ? "disabled" : ""}></label><p class="note">${busy ? "正在读取文件，请稍候…" : "所有读取和分析在浏览器本地完成，不上传至服务器。旧式 .xls 暂不支持，请在 Excel 中另存为 .xlsx。"}</p></section>${importNotices.length ? `<div class="banner" role="status"><div>${importNotices.map(esc).join("<br>")}</div></div>` : ""}${lastError ? `<div class="alert" role="alert">${esc(lastError)}</div>` : ""}${drafts.length ? draftPanel() : ""}<section class="card" style="margin-top:22px">${head("数据收集清单", `${state.reports.length} 个报告版本 · 原始文件可追溯`)}<p class="note">同一分析范围、同一报告类型、同一天只采用最新启用版本的完整快照，不累加新旧上传。同一周期汇总必须与分析周期完全一致才使用，不拆分。不同报告类型独立分析，不叠加曝光与花费。上传不同筛选范围的报告时，请停用不适用版本，避免将部分导出误当完整快照。</p><div class="table-wrap"><table><thead><tr><th>文件 / 工作表</th><th>店铺 / 站点</th><th>报告类型</th><th>日期范围</th><th>行数 / 识别状态</th><th>可支持的分析 / 缺少内容</th><th>来源与版本</th></tr></thead><tbody>${
        [...state.reports]
          .sort((a, b) => b.seq - a.seq)
          .map((r) => {
            const domains = [
              ...new Set(
                r.rows.map((x) =>
                  [x.store, x.site, x.adType, x.currency, x.attribution].join(
                    " / ",
                  ),
                ),
              ),
            ];
            const missing = [];
            if (!r.rows.some((x) => x.campaignId || x.campaign))
              missing.push("活动定位");
            if (
              ["search", "target"].includes(r.type) &&
              !r.rows.some((x) => x.groupId || x.group)
            )
              missing.push("广告组定位");
            for (const k of [
              "impressions",
              "clicks",
              "spend",
              "orders",
              "sales",
            ])
              if (r.type !== "business" && !r.rows.some((x) => x[k] != null))
                missing.push(E.labels[k]);
            return `<tr><td>${esc(r.name)}<small>${esc(r.sheet || "CSV")} · ${esc(r.importedAt)}</small></td><td>${domains.map(esc).join("<br>")}</td><td>${E.types[r.type] || esc(r.type)}</td><td>${esc(r.start)} ~ ${esc(r.end)}<small>${r.daily ? "每日明细" : "周期汇总 · 不拆分"}</small></td><td>${r.rows.length} 行<small>${r.active === false ? "已停用 / 保留历史" : "已识别 · 已入库"}</small></td><td>${capabilities(r.type)}<small>缺少：${esc(missing.join("、") || "核心字段已具备；仍需核实归因回补")}</small>${r.issues?.length ? `<details><summary>${r.issues.length} 条质量提示</summary><p>${r.issues.slice(0, 15).map(esc).join("<br>")}</p></details>` : ""}</td><td><button data-original="${r.fileId || ""}" ${r.fileId ? "" : "disabled"}>下载原始文件</button><small><button data-toggle-report="${r.id}">${r.active === false ? "启用此版本" : "停用此版本"}</button> #${r.seq}</small></td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="7" class="empty"><strong>还没有报表</strong>可先上传搜索词报告，无需备齐所有报告。</td></tr>'
      }</tbody></table></div></section><details class="card" style="margin-top:18px"><summary>需要哪些后台报表？</summary><p class="note">优先上传 SP 搜索词报告、SP 投放报告、SP 广告位置报告（每日粒度，覆盖至少最近两个完整周期）；SB 报告可单独上传分析。广告商品、广告活动报告及业务报告中的子ASIN销售与流量报告可补充。周期汇总也可导入，但只能用于完全匹配的周期。</p></details>`
    );
  }
  function detectedMeta(d) {
    return E.metadata(d);
  }
  const siteCurrencies = {
    US: "USD",
    CA: "CAD",
    UK: "GBP",
    DE: "EUR",
    FR: "EUR",
    IT: "EUR",
    ES: "EUR",
    JP: "JPY",
    AU: "AUD",
    MX: "MXN",
  };
  function draftPanel() {
    const needed = (k) => drafts.some((d) => !detectedMeta(d)[k]);
    const metas = drafts.map(detectedMeta);
    const sites = [
      ...new Set(
        metas.map((m) => m.site).filter((v) => v && v !== "文件内多值"),
      ),
    ];
    const ranges = [
      ...new Set(
        metas.filter((m) => m.start && m.end).map((m) => m.start + "|" + m.end),
      ),
    ];
    const suggested = ranges.length === 1 ? ranges[0].split("|") : [];
    const defaults = {
      site: sites.length === 1 ? sites[0] : "",
      batchStart: suggested[0] || "",
      batchEnd: suggested[1] || "",
      ...(state.importDefaults || {}),
      ...batchValues,
    };
    const missingDates = drafts.filter(
      (d) => !detectedMeta(d).start || !detectedMeta(d).end,
    );
    return `<section class="card" style="margin-top:22px">${head("已自动读取本批报表", `${drafts.length} 个工作表 · 只补文件中缺失的信息`)}<form id="confirm-batch"><p class="note">报告类型、广告类型、日期、指标和归因窗口优先从原始文件读取。下方表格是识别结果，不需要逐份填写。点击保存后即可分析；文件没提供的口径标记为未知，不编造。</p><div class="form-grid">${needed("store") ? field("本批店铺（文件未提供，只填一次）", "store", defaults.store || "", "text", true) : ""}${needed("site") ? `<label>本批站点（文件未提供，只选一次）<select name="site" required>${options(["US", "CA", "UK", "DE", "FR", "IT", "ES", "JP", "AU", "MX", "其他"], defaults.site || "", "请选择")}</select></label>` : ""}${
      needed("adType")
        ? `<label>未标明广告类型的文件（可选）<select name="batchAdType">${options(
            [
              ["", "保留未注明，不影响导入"],
              ["SP", "SP 商品推广"],
              ["SB", "SB 品牌推广"],
              ["SD", "SD 展示型推广"],
            ],
            defaults.batchAdType || "",
          )}</select></label>`
        : ""
    }</div>${missingDates.length ? `<div class="alert">仅 ${missingDates.length} 个文件未包含统计日期；${suggested.length ? "已预填本批其他报表一致的范围，请确认这些无日期文件是否也是该范围，不是则修改。" : "请统一补充生成报告时选择的范围。"} 已识别的其他文件不会被覆盖。导出日期和广告活动创建日期不等于统计周期。</div><div class="form-grid">${needed("start") ? field("缺失文件的开始日期", "batchStart", defaults.batchStart || "", "date", true) : ""}${needed("end") ? field("缺失文件的结束日期", "batchEnd", defaults.batchEnd || "", "date", true) : ""}</div>` : ""}<details><summary>本批可选设置：币种 / 未注明归因口径</summary><div class="form-grid"><label>缺失币种时<select name="currency">${options([["", "自动按文件站点/本批站点识别"], ...["USD", "CAD", "GBP", "EUR", "JPY", "AUD", "MXN", "CNY"].map((x) => [x, x])], defaults.currency || "")}</select></label>${field("未注明归因的补充说明（可留空）", "batchAttribution", "", "text")}</div><p class="note">未注明归因时自动标记未知并按格式隔离，不要求手填。站点明确时仅推定记账币种，并在入库提示中记录；可在此更正。</p></details><div class="table-wrap"><table><thead><tr><th>原始文件 / 工作表</th><th>报告类型 / 广告类型</th><th>日期范围 / 来源</th><th>归因 / 可用字段</th><th>状态</th></tr></thead><tbody>${drafts
      .map((d, i) => {
        const m = detectedMeta(d);
        return `<tr><td>${esc(d.name)}<small>${esc(d.sheet)}</small></td><td>${E.types[d.type]}<small>${esc(m.adType || "未注明，可导入")} · ${esc(m.adTypeSource)}</small></td><td>${esc(m.start || defaults.batchStart || "需补日期")} ~ ${esc(m.end || defaults.batchEnd || "需补日期")}<small>${esc(m.dateSource)}</small></td><td>${esc(m.attribution)}<small>${Object.keys(
          d.map,
        )
          .map((k) => esc(E.labels[k]))
          .join(
            "、",
          )}</small></td><td>${d.raw.length} 行 · 待保存${m.mixedWindows ? '<small class="status">归因窗口冲突，需检查映射</small>' : ""}</td></tr>`;
      })
      .join("")}</tbody></table></div>${drafts
      .map((d, i) => {
        const m = detectedMeta(d),
          unknown = d.type === "unknown" || Object.keys(d.ambiguous).length;
        return `<article class="draft"><h3>${esc(d.name)} / ${esc(d.sheet)} <span class="tag">${d.raw.length} 行 · 待确认，未保存</span></h3>${d.headerWarnings?.length ? `<div class="alert">${d.headerWarnings.map(esc).join("<br>")}</div>` : ""}<details ${unknown || d.mappingOpen ? "open" : ""}><summary>${unknown ? "仅此工作表需确认：未识别类型或有歧义字段" : "自动识别已完成 · 查看原始预览或更正（可跳过）"}</summary><div class="form-grid"><label>报告类型<select data-draft="${i}" data-meta="type">${options(Object.entries(E.types), d.type)}</select></label><label>更正广告类型<select name="adType-${i}">${options(
          [
            ["", `自动：${m.adType || "未注明"}`],
            ["SP", "SP"],
            ["SB", "SB"],
            ["SD", "SD"],
          ],
          "",
        )}</select></label>${field("更正归因口径（留空自动识别）", `attribution-${i}`, "")}${field("更正缺失的开始日期（可选）", `start-${i}`, "", "date")}${field("更正缺失的结束日期（可选）", `end-${i}`, "", "date")}</div><p class="note">${capabilities(d.type)}。原始数据预览如下；不必逐列填写，只有需要更正的字段才调整。</p><div class="mapping-grid">${Object.entries(
          E.labels,
        )
          .map(
            ([k, l]) =>
              `<label>${l}<select data-draft="${i}" data-map-field="${k}">${options(
                d.headers.map((h) => [h, h]),
                d.map[k] || "",
                "未提供 / 不映射",
              )}</select></label>`,
          )
          .join(
            "",
          )}</div><div class="table-wrap"><table><thead><tr>${d.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${d.raw
          .slice(0, 3)
          .map(
            (r) =>
              `<tr>${d.headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`,
          )
          .join(
            "",
          )}</tbody></table></div></details><button type="button" data-discard-draft="${i}">移除此工作表</button></article>`;
      })
      .join(
        "",
      )}<button class="primary" type="submit">确认并保存本批文件</button><span class="note"> 保存后点击“开始分析”。店铺/站点选择会记住，下次自动带入。</span></form></section>`;
  }
  async function fingerprint(buffer) {
    if (crypto.subtle) {
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(hash)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    }
    return (
      "binary-" +
      Array.from(new Uint8Array(buffer))
        .reduce((a, v) => Math.imul(a ^ v, 16777619), 2166136261)
        .toString(16) +
      "-" +
      buffer.byteLength
    );
  }
  function cellValue(cell) {
    const v = cell.value;
    if (v == null) return "";
    if (v instanceof Date) return E.date(v);
    if (typeof v === "object") {
      if ("result" in v) return v.result ?? "";
      if (v.richText) return v.richText.map((t) => t.text).join("");
      if (v.text) return v.text;
      return "";
    }
    return v;
  }
  async function ingest(files) {
    if (busy) return;
    busy = true;
    lastError = "";
    importNotices = [];
    render();
    const errors = [];
    let total = 0;
    try {
      for (const input of files) {
        try {
          if (input.size > 30 * 1024 * 1024) throw Error("单文件上限30MB");
          const buffer = await input.arrayBuffer();
          await readBuffer(input.name, buffer, null);
        } catch (err) {
          errors.push(input.name + "：" + err.message);
        }
      }
    } finally {
      busy = false;
      lastError = errors.join("\n");
      render();
      if (drafts.length) toast("文件已读取，请确认缺失信息后保存。");
    }
    async function readBuffer(name, buffer, parent) {
      total += buffer.byteLength;
      if (total > 80 * 1024 * 1024)
        throw Error("本批解压后总量超过80MB，请分批上传");
      const ext = name.split(".").pop().toLowerCase();
      if (ext === "zip") {
        const zip = await JSZip.loadAsync(buffer);
        const entries = Object.values(zip.files).filter(
          (f) =>
            !f.dir &&
            !f.name.startsWith("__MACOSX/") &&
            !f.name.split("/").pop().startsWith("."),
        );
        if (entries.length > 50) throw Error("ZIP文件数量超过50，请拆分");
        const archiveId = await fingerprint(buffer);
        if (!pendingFiles.some((f) => f.id === archiveId))
          pendingFiles.push({ id: archiveId, name, buffer });
        for (const f of entries) {
          if (!/\.(csv|tsv|txt|xlsx)$/i.test(f.name)) {
            errors.push(name + "/" + f.name + "：不支持此文件格式");
            continue;
          }
          if (f._data?.uncompressedSize > 30 * 1024 * 1024)
            throw Error("ZIP内单文件超过30MB");
          try {
            await readBuffer(
              name + "/" + f.name,
              await f.async("arraybuffer"),
              archiveId,
            );
          } catch (err) {
            errors.push(name + "/" + f.name + "：" + err.message);
          }
        }
        return;
      }
      if (!["xlsx", "csv", "tsv", "txt"].includes(ext))
        throw Error("支持 CSV、TSV、XLSX、ZIP；旧式XLS请另存为XLSX");
      const fileId = await fingerprint(buffer);
      const sheets = [];
      if (ext === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        workbook.eachSheet((ws) => {
          const matrix = [];
          ws.eachRow({ includeEmpty: true }, (row) => {
            const line = [];
            row.eachCell(
              { includeEmpty: true },
              (c, i) => (line[i - 1] = cellValue(c)),
            );
            matrix.push(line);
          });
          if (matrix.some((r) => r.some((v) => v !== "")))
            sheets.push({ sheet: ws.name, matrix });
        });
      } else {
        const text = E.decodeText(buffer);
        sheets.push({ sheet: "CSV", matrix: E.parseDelimited(text) });
      }
      if (!sheets.length) throw Error("没有可读取的工作表");
      let successes = 0;
      for (const { sheet, matrix } of sheets) {
        try {
          const saved = state.reports
            .filter((r) => r.fileId === fileId && r.sheet === sheet)
            .sort((a, b) => b.seq - a.seq)[0];
          if (saved && saved.parserVersion === PARSER_VERSION) {
            importNotices.push(
              `${name} / ${sheet}：此工作表已保存（版本 #${saved.seq}），未重复入库。其他未保存工作表仍会继续读取。`,
            );
            continue;
          }
          let d = E.inspect(matrix);
          const existing = drafts.findIndex(
            (x) => x.fileId === fileId && x.sheet === sheet,
          );
          const previous = existing >= 0 ? drafts[existing] : null;
          const rule =
            previous?.signature === d.signature
              ? {
                  map: previous.map,
                  type: previous.type,
                  userType: previous.userType,
                }
              : state.rules[d.signature];
          if (rule) d = E.inspect(matrix, rule);
          const next = {
            ...d,
            replaces: saved?.id,
            name,
            sheet,
            fileId,
            parent,
            userType: rule?.userType || false,
            mappingOpen:
              previous?.mappingOpen ||
              d.type === "unknown" ||
              Object.keys(d.ambiguous).length > 0,
          };
          if (saved && saved.parserVersion !== PARSER_VERSION)
            importNotices.push(
              `${name} / ${sheet}：识别规则已升级，已重新读取；保存后替换旧识别版本，历史文件仍保留。`,
            );
          if (existing >= 0) {
            drafts[existing] = next;
            importNotices.push(
              `${name} / ${sheet}：已更新待确认预览，尚未保存，请在下方确认入库。`,
            );
          } else drafts.push(next);
          successes++;
        } catch (err) {
          errors.push(name + "/" + sheet + "：" + err.message);
        }
      }
      if (successes) {
        const f = { id: fileId, name, buffer, parent };
        const at = pendingFiles.findIndex((x) => x.id === fileId);
        if (at < 0) pendingFiles.push(f);
        else pendingFiles[at] = f;
      }
    }
  }
  async function confirmBatch(form) {
    if (busy) throw Error("文件仍在读取，请稍候再保存");
    const values = Object.fromEntries(new FormData(form));
    const prepared = [];
    const seq = state.reports.reduce((n, r) => Math.max(n, r.seq), 0);
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i],
        m = detectedMeta(d);
      if (m.mixedWindows)
        throw Error(d.name + "：订单和销售额归因窗口不同，需修正映射");
      const result = E.prepare(d, {
        store: m.store || values.store,
        site: m.site || values.site,
        currency:
          m.currency ||
          values.currency ||
          siteCurrencies[m.site || values.site],
        adType:
          values[`adType-${i}`] || m.adType || values.batchAdType || "未注明",
        attribution:
          values[`attribution-${i}`] ||
          (/未注明/.test(m.attribution) ? values.batchAttribution : "") ||
          m.attribution,
        start: m.start || values[`start-${i}`] || values.batchStart,
        end: m.end || values[`end-${i}`] || values.batchEnd,
      });
      result.issues.push(...(d.headerWarnings || []));
      if (!m.currency && !values.currency)
        result.issues.push("币种依据站点推定，请核对是否使用其他记账币种");
      if (/未注明/.test(m.attribution))
        result.issues.push(
          "原报告未提供归因窗口，按报表格式隔离；不可认定为7天或14天归因",
        );
      if (!m.adType && !values.batchAdType)
        result.issues.push("原报告未注明广告类型，作为未知广告类型独立分析");
      const seen = new Set();
      result.rows = result.rows.filter((r, index) => {
        // Only identical original rows are duplicates; unmapped source dimensions may differ.
        const k = JSON.stringify(d.raw[index]);
        if (seen.has(k)) {
          result.issues.push(
            "文件内完全重复行已去重，请核实源报告是否有重复导出",
          );
          return false;
        }
        seen.add(k);
        return true;
      });
      prepared.push({
        ...result,
        parserVersion: PARSER_VERSION,
        replaces: d.replaces,
        id: id(),
        name: d.name,
        sheet: d.sheet,
        fileId: d.fileId,
        parent: d.parent,
        type: d.type,
        map: d.map,
        headers: d.headers,
        seq: seq + i + 1,
        active: true,
        importedAt: new Date().toLocaleString("zh-CN"),
        signature: d.signature,
      });
    }
    const next = structuredClone(state);
    for (const r of prepared)
      if (r.replaces)
        for (const old of next.reports)
          if (old.fileId === r.fileId && old.sheet === r.sheet)
            old.active = false;
    next.reports.push(...prepared);
    next.importDefaults = {
      ...(state.importDefaults || {}),
      store: values.store || state.importDefaults?.store || "",
      site: values.site || state.importDefaults?.site || "",
      currency: values.currency || "",
      batchAdType: values.batchAdType || "",
    };
    for (const d of drafts)
      next.rules[d.signature] = {
        map: d.map,
        type: d.type,
        userType: !!d.userType,
      };
    await S.put(next, pendingFiles);
    state = next;
    drafts = [];
    pendingFiles = [];
    batchValues = {};
    importNotices = [];
    lastError = "";
    periods = null;
    toast("报表与原始文件已保存，可以开始分析。");
    render();
  }
  function scopeControls() {
    const keys = scopes();
    if (!keys.includes(scope)) {
      const primary = [
        "target",
        "search",
        "placement",
        "product",
        "campaign",
        "business",
      ]
        .map((t) =>
          state.reports.find(
            (r) => r.active !== false && r.type === t && r.rows.length,
          ),
        )
        .find(Boolean);
      scope = primary ? E.scopeKey(primary.rows[0]) : keys[0] || "";
    }
    if (!periods) initPeriods();
    const p = periods;
    return `<section class="card controls"><div class="toolbar"><label>分析范围<select id="scope">${options(
      keys.map((k) => [k, JSON.parse(k).join(" / ")]),
      scope,
      "请选择范围",
    )}</select></label><label>对比模式<select id="mode">${options(
      [
        ["auto", "自动：按报告可用粒度选择周期"],
        ["7", "最近完整7天 vs 此前7天"],
        ["14", "最近完整14天 vs 此前14天"],
        ["custom", "自定义两个周期"],
      ],
      mode,
    )}</select></label></div><div class="toolbar">${field("本期开始", "a-start", p.a.start, "date")}${field("本期结束", "a-end", p.a.end, "date")}${field("上期开始", "b-start", p.b.start, "date")}${field("上期结束", "b-end", p.b.end, "date")}<button id="apply-periods" class="primary">应用周期</button></div><p class="note">默认截止到所选数据最新已结束的日期，不包含当天。金额单位：${esc(scope ? JSON.parse(scope)[3] : "未选择")}。不同店铺、站点、广告类型、币种、归因口径独立分析。最近数据可能仍有归因回补。</p></section>`;
  }
  function availableType() {
    if (tab === "actions") return "search";
    if (
      tab === "target" &&
      !state.reports.some(
        (r) =>
          r.active !== false &&
          r.type === "target" &&
          r.rows.some((x) => E.scopeKey(x) === scope),
      ) &&
      state.reports.some(
        (r) =>
          r.active !== false &&
          r.type === "search" &&
          r.rows.some((x) => E.scopeKey(x) === scope),
      )
    )
      return "search";
    return tab;
  }
  function analysisData() {
    const type = availableType(),
      result = E.compare(
        state.reports,
        type,
        scope,
        periods,
        tab === "search" && searchView === "summary",
      );
    if (tab === "target" && type === "search") {
      const grouped = new Map(),
        dims = E.dimensions("target");
      for (const side of ["a", "b"])
        for (const row of result[side].rows.filter((r) => r.target)) {
          const key = E.keyFor(row, "target");
          if (!grouped.has(key))
            grouped.set(key, { key, row: { ...row, term: "" }, a: [], b: [] });
          grouped.get(key)[side].push(row);
        }
      result.rows = [...grouped.values()].map((g) => ({
        ...g,
        am: E.metrics(g.a),
        bm: E.metrics(g.b),
        status: !g.a.length
          ? "本期报告未出现"
          : !g.b.length
            ? "本期首次出现"
            : "两期均有记录",
        comparable: result.comparable && !!g.a.length && !!g.b.length,
      }));
      return result;
    }
    return result;
  }
  function visibleRows(result) {
    return result.rows.filter(
      (g) =>
        (!campaign || (g.row.campaignId || g.row.campaign) === campaign) &&
        (!group || (g.row.groupId || g.row.group) === group) &&
        (!filter ||
          Object.values(g.row)
            .join(" ")
            .toLowerCase()
            .includes(filter.toLowerCase())),
    );
  }
  function analyze() {
    const controls = scopeControls();
    return (
      top(
        "分析数据",
        "先看具体对象与证据，再决定是否行动。",
        '<button id="export-analysis">导出当前分析 CSV</button>',
      ) +
      controls +
      `<div class="tabs">${[
        ["target", "投放关键词变化"],
        ["placement", "广告位变化"],
        ["search", "顾客搜索词变化"],
        ["actions", "本周结论与行动"],
        ["product", "广告商品"],
        ["campaign", "广告活动"],
        ["business", "业务销售流量"],
      ]
        .map(
          ([k, l]) =>
            `<button data-tab="${k}" class="${tab === k ? "primary" : ""}">${l}</button>`,
        )
        .join("")}</div>` +
      (tab === "actions" ? actionPanel() : analysisPanel())
    );
  }
  function coverage(result) {
    return `<div class="banner"><span class="icon">◷</span><div><strong>本期覆盖 ${result.a.coverage}/${result.a.expected} 天 · 上期覆盖 ${result.b.coverage}/${result.b.expected} 天</strong><p>${result.comparable ? "两个周期覆盖完整；仍需检查筛选范围与归因一致性。" : "覆盖不足：仅展示已有记录，不将缺失日期或对象补零，不据此制造下降。"} ${[...result.a.warnings, ...result.b.warnings].map(esc).join("；")}</p></div></div>`;
  }
  function deltaText(a, b, k) {
    const c = E.change(a, b);
    if (c.delta == null) return "不可比较";
    return `${c.delta > 0 ? "+" : ""}${pctKeys.includes(k) ? (c.delta * 100).toFixed(2) + " 个百分点" : fmt(c.delta, k)} / ${c.relative == null ? "上期为0，增长率不可计算" : (c.relative > 0 ? "+" : "") + (c.relative * 100).toFixed(1) + "%"}`;
  }
  function metricRows(g) {
    return Object.entries(metricLabels)
      .filter(([k]) =>
        tab === "business"
          ? [
              "sessions",
              "totalSales",
              "totalUnits",
              "businessUnitSession",
            ].includes(k)
          : ![
              "sessions",
              "totalSales",
              "totalUnits",
              "businessUnitSession",
            ].includes(k),
      )
      .map(
        ([k, l]) =>
          `<tr><td>${l}</td><td>${fmt(g.am[k], k)}</td><td>${fmt(g.bm[k], k)}</td><td>${g.comparable ? deltaText(g.am[k], g.bm[k], k) : "覆盖不足或对象仅出现于一期，不补零"}</td></tr>`,
      )
      .join("");
  }
  function summaryMetrics(m) {
    const keys =
      tab === "business"
        ? ["sessions", "totalSales", "totalUnits", "businessUnitSession"]
        : [
            "impressions",
            "clicks",
            "ctr",
            "spend",
            "cpc",
            "orders",
            "sales",
            "cvr",
            "acos",
            "roas",
          ];
    return keys
      .map(
        (k) => `<span><small>${metricLabels[k]}</small> ${fmt(m[k], k)}</span>`,
      )
      .join("");
  }
  function sources(g) {
    return [
      ...new Set(
        [...g.a, ...g.b].map(
          (r) =>
            `${r.sourceName || "来源记录"} · 行${r.line || "?"} [${r.source}]`,
        ),
      ),
    ]
      .map(esc)
      .join("<br>");
  }
  function shareMetrics(g, result) {
    const key = (r) =>
      JSON.stringify([
        r.campaignId || r.campaign,
        r.groupId || r.group || "",
        r.target || "",
      ]);
    const peers = (side) =>
      result[side].rows.filter((r) => key(r) === key(g.row));
    const a = E.metrics(peers("a")),
      b = E.metrics(peers("b"));
    return {
      trafficA: E.ratio(g.am.impressions, a.impressions),
      trafficB: E.ratio(g.bm.impressions, b.impressions),
      spendA: E.ratio(g.am.spend, a.spend),
      spendB: E.ratio(g.bm.spend, b.spend),
    };
  }
  function placementShare(g, result) {
    const s = shareMetrics(g, result),
      point = (a, b) =>
        g.comparable && a != null && b != null
          ? ((a - b) * 100).toFixed(2) + " 个百分点"
          : "不可比较";
    return `<p class="note">同层级曝光占比：${fmt(s.trafficA, "ctr")} / ${fmt(s.trafficB, "ctr")}；变化 ${point(s.trafficA, s.trafficB)}。花费占比：${fmt(s.spendA, "ctr")} / ${fmt(s.spendB, "ctr")}；变化 ${point(s.spendA, s.spendB)}（本期 / 上期）</p>`;
  }

  function analysisPanel() {
    const result = analysisData(),
      type = availableType(),
      rows = visibleRows(result);
    const allRows = result.rows;
    const campaigns = [
      ...new Set(
        allRows.map((g) => g.row.campaignId || g.row.campaign).filter(Boolean),
      ),
    ];
    const groups = [
      ...new Set(
        allRows
          .filter(
            (g) =>
              !campaign || (g.row.campaignId || g.row.campaign) === campaign,
          )
          .map((g) => g.row.groupId || g.row.group)
          .filter(Boolean),
      ),
    ];
    return (
      coverage(result) +
      (tab === "target" && type === "search"
        ? '<div class="alert">未提供投放报告，当前仅按搜索词报告中的原投放目标汇总可见流量，不代表完整投放表现。</div>'
        : "") +
      (tab === "placement"
        ? '<div class="alert">严格按原始报告层级展示。活动级位置指标只作为活动背景，不能归因到单个关键词。份额仅基于同层级已提供位置；缺失位置不补零。</div>'
        : "") +
      `<section class="card"><div class="toolbar"><select id="campaign-filter">${options(campaigns, campaign, "全部活动")}</select><select id="group-filter">${options(groups, group, "全部广告组")}</select><input id="filter" value="${esc(filter)}" placeholder="筛选关键词、搜索词、商品或活动"><select id="metric">${options(
        Object.entries(metricLabels).filter(([k]) =>
          tab === "business"
            ? [
                "sessions",
                "totalSales",
                "totalUnits",
                "businessUnitSession",
              ].includes(k)
            : ![
                "sessions",
                "totalSales",
                "totalUnits",
                "businessUnitSession",
              ].includes(k),
        ),
        metric,
      )}</select>${
        tab === "search"
          ? `<select id="search-view">${options(
              [
                ["summary", "搜索词汇总视图"],
                ["detail", "广告组明细视图"],
              ],
              searchView,
            )}</select>`
          : ""
      }</div>${tab === "search" && searchView === "summary" ? '<p class="note">汇总仅合并当前同口径范围的同一实际搜索词。选择建议动作前请切换广告组明细，避免无法定位。</p>' : ""}<div class="table-wrap"><table class="analysis-table"><thead><tr><th>对象 / 层级 / 来源</th><th>本期指标</th><th>上期指标</th><th>${metricLabels[metric]} 变化值 / 幅度</th><th>判断依据与明细</th></tr></thead><tbody>${
        rows
          .map((g) => {
            const r = g.row,
              title =
                tab === "search"
                  ? r.term
                  : tab === "target"
                    ? r.target
                    : tab === "placement"
                      ? r.placement
                      : tab === "business" || tab === "product"
                        ? r.asin || r.sku
                        : r.campaign || r.campaignId;
            const level =
              tab === "placement"
                ? r.target
                  ? "投放目标 × 位置"
                  : r.group || r.groupId
                    ? "广告组 × 位置"
                    : "活动 × 位置"
                : "";
            return `<tr><td><b>${esc(title || "对象字段未提供")}</b><small>${esc(r.match || "匹配方式未提供")} ${level}</small><small>${esc(r.campaign || r.campaignId || "活动未提供")} / ${esc(r.group || r.groupId || "广告组未提供")}</small><small>活动ID ${esc(r.campaignId || "缺失")} · 组ID ${esc(r.groupId || "缺失")}</small>${tab === "search" && searchView === "detail" ? `<small>原目标 ${esc(r.target)} · ${esc(r.match)} · 广告ASIN ${esc(r.asin)}</small>` : ""}<span class="tag">${g.status}</span></td><td><div class="metric-stack">${summaryMetrics(g.am)}</div></td><td><div class="metric-stack">${summaryMetrics(g.bm)}</div></td><td>${g.comparable ? deltaText(g.am[metric], g.bm[metric], metric) : "不可比较：不补零"}${tab === "placement" ? placementShare(g, result) : ""}</td><td><p>${E.explain(g, result).map(esc).join("；")}</p>${tab === "search" && g.am.orders > 0 && r.match && !/exact|精准|精确/i.test(r.match) ? '<p class="note">精准提取候选：已有出单，原匹配非精准；先核实产品相关性与现有精准覆盖，再决定是否新增。</p>' : ""}<details><summary>所有指标与来源证据</summary><table><thead><tr><th>指标</th><th>本期</th><th>上期</th><th>变化 / 幅度</th></tr></thead><tbody>${metricRows(g)}</tbody></table><p class="note">来源：${sources(g)}</p>${tab === "target" ? keywordPlacementContext(r) : ""}</details>${["search", "target"].includes(tab) && !(tab === "search" && searchView === "summary") ? `<button data-action-key="${esc(g.key)}">加入行动清单</button>` : ""}</td></tr>`;
          })
          .join("") ||
        `<tr><td colspan="5" class="empty"><strong>所选范围与周期暂无可分析记录</strong>${E.types[type]} 尚缺失、周期汇总不匹配，或当前筛选无结果。可以返回收集表格补充，不影响其他已有报表分析。</td></tr>`
      }</tbody></table></div></section>${trend(type)}${tab === "business" ? '<div class="alert">业务 Unit Session % = 已订购商品数量 / 会话，与广告订单 / 点击的 CVR 不同。业务数据独立显示，不从总订单中减广告订单推断自然订单。</div>' : ""}`
    );
  }
  function keywordPlacementContext(r) {
    const p = E.compare(state.reports, "placement", scope, periods);
    const same = p.rows.filter(
      (g) =>
        (g.row.campaignId || g.row.campaign) === (r.campaignId || r.campaign),
    );
    if (!same.length)
      return '<p class="note">所属活动的广告位置背景：尚无对应位置报告，无法定位关键词 × 位置。</p>';
    return (
      "<h3>所属活动的广告位置背景（非关键词归因）</h3>" +
      same
        .map(
          (g) =>
            `<p class="note">${esc(g.row.placement)} · 层级 ${g.row.target ? "报告含投放目标交叉（请另见位置页）" : "活动/广告组"} · CPC ${fmt(g.am.cpc)} / ${fmt(g.bm.cpc)}；仅作背景</p>`,
        )
        .join("")
    );
  }
  function trend(type) {
    if (!scope || !periods) return "";
    const result = [];
    for (let i = 7; i >= 0; i--) {
      const end = E.shift(periods.a.end, -i * 7),
        period = { start: E.shift(end, -6), end },
        s = E.select(state.reports, type, scope, period);
      if (s.full) {
        const filtered = s.rows.filter(
          (r) =>
            (!campaign || (r.campaignId || r.campaign) === campaign) &&
            (!group || (r.groupId || r.group) === group),
        );
        result.push({ period, m: E.metrics(filtered), summary: s.summary });
      }
    }
    if (result.length < 2)
      return '<p class="note">连续多周趋势：完整周覆盖不足，暂不绘制虚假的周度变化。</p>';
    return `<section class="card" style="margin-top:20px">${head("连续多周趋势", "只展示覆盖完整的7天窗口，不拆周期汇总")}<div class="table-wrap"><table><thead><tr><th>周期</th><th>曝光</th><th>点击</th><th>花费</th><th>订单</th><th>CVR</th><th>业务销售额</th></tr></thead><tbody>${result.map((x) => `<tr><td>${x.period.start} ~ ${x.period.end}</td>${["impressions", "clicks", "spend", "orders", "cvr", "totalSales"].map((k) => `<td>${fmt(x.m[k], k)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  }
  function relatedProduct(r) {
    return state.products.find(
      (p) =>
        r.asin &&
        p.asins.split(/[,，\s]+/).includes(r.asin) &&
        (!p.store || p.store === r.store) &&
        (!p.site || p.site === r.site),
    );
  }
  function addAction(g, result) {
    const r = g.row,
      p = relatedProduct(r),
      evidence = E.explain(g, result).join("；");
    if (!g.a.length) {
      toast("本期无记录，只能观察覆盖，不生成执行建议。");
      return;
    }
    const key = [
      scope,
      periods.a.start,
      periods.a.end,
      r.campaignId || r.campaign,
      r.groupId || r.group,
      r.term || r.target,
      r.match,
    ].join("|");
    if (state.actions.some((a) => a.analysisKey === key)) {
      toast("此对象已在本期行动清单中");
      return;
    }
    state.actions.push({
      id: id(),
      analysisKey: key,
      priority: "中",
      store: r.store,
      site: r.site,
      adType: r.adType,
      currency: r.currency,
      attribution: r.attribution,
      campaign: r.campaign || "",
      campaignId: r.campaignId || "",
      group: r.group || "",
      groupId: r.groupId || "",
      subject: r.term || r.target || "",
      asin: r.asin || "",
      productId: p?.id || "",
      newTarget: r.term || r.target || "",
      originalTarget: r.target || "",
      match: r.match || "",
      issue: evidence,
      suggestion: "继续观察",
      evidence: `本期花费 ${fmt(g.am.spend)}；订单 ${fmt(g.am.orders)}；上期花费 ${fmt(g.bm.spend)}；订单 ${fmt(g.bm.orders)}。来源 ${[...new Set(g.a.map((x) => x.sourceName))].join("、")}。`,
      cause:
        "待检验：预算、竞价、相关性、促销、库存、评分或变体变化，当前数据不证明因果。",
      missing: p
        ? `已关联产品：${p.brand} / ${p.name}。相关性仍需人工确认；目标ACOS、当前库存、竞价及归因回补待补齐。`
        : "产品相关性待确认；缺少关联产品信息、目标与外部事件证据。",
      verify:
        "下个完整同口径周期复核曝光、CTR、CPC、订单、CVR、ACOS；控制单变量并记录事件。",
      status: "待审核",
      due: E.shift(periods.a.end, 7),
      period: `${periods.a.start}~${periods.a.end}`,
    });
  }
  function productContext(a) {
    const p = state.products.find((p) => p.id === a.productId);
    return `<label class="full">关联产品（未能从报告识别时手动确认）<select data-action="${a.id}" data-field="productId">${options(
      state.products.map((p) => [
        p.id,
        `${p.brand} / ${p.name} / ${p.store || "店铺未限定"}`,
      ]),
      a.productId || "",
      "未关联 · 相关性待确认",
    )}</select></label>${p ? `<div class="full alert">产品背景（不是相关性判定，也不是实时经营数据）：${esc(p.brand)} / ${esc(p.name)}<br>规格：${esc(p.spec || "未提供")}<br>卖点：${esc(p.selling || "未提供")}<br>场景：${esc(p.scenes || "未提供")}<br>关键词：${esc(p.keywords || "未提供")}<br>目标：${esc(p.goals || "未配置")}<br>限制/历史问题：${esc(p.issues || "未提供")}<br>资料状态：${esc(p.status || "待核实")}。请结合这些信息审核搜索词意图与产品差异，不能把词面相似等同转化原因。</div>` : ""}`;
  }
  function actionPanel() {
    const items = state.actions.filter((a) => a.analysisKey);
    return `<section class="card">${head("本周结论与行动", "建议均需人工审核，不自动投放/否词")}<p class="note">从关键词或搜索词广告组明细中，将具体发现加入行动清单。每条卡保留事实、可能原因、缺失证据与验证标准。无活动或广告组定位时标记不可执行，不输出无位置的否词指令。</p>${weeklyConclusions()}<div class="toolbar"><button id="generate-actions" class="primary">从本期具体变化生成待审核清单</button><button id="export-actions">导出全部行动 CSV</button></div>${
      items.length
        ? items
            .map(
              (a) =>
                `<article class="action-card"><h3>${esc(a.subject)} <span class="tag">${esc(a.store)} / ${esc(a.site)}</span></h3><p class="note">${esc(a.campaign)} [${esc(a.campaignId)}] → ${esc(a.group)} [${esc(a.groupId)}] · ${esc(a.adType)} · ${esc(a.currency)} · ${esc(a.attribution)} · ${esc(a.period)}</p>${!(a.campaign || a.campaignId) || !(a.group || a.groupId) ? '<div class="alert">执行定位不足：须补充原报告活动与广告组后再操作。</div>' : ""}<div class="form-grid">${[
                  ["priority", "优先级"],
                  ["suggestion", "建议动作"],
                  ["status", "执行状态"],
                ]
                  .map(
                    ([k, l]) =>
                      `<label>${l}<select data-action="${a.id}" data-field="${k}">${options(k === "priority" ? ["高", "中", "低"] : k === "suggestion" ? ["继续观察", "调整竞价", "调整预算", "新增精准", "新增短语", "否定精准", "否定词组"] : ["待审核", "待执行", "验证中", "已复盘"], a[k])}</select></label>`,
                  )
                  .join(
                    "",
                  )}<label>复盘日期<input type="date" data-action="${a.id}" data-field="due" value="${esc(a.due)}"></label><label class="full">新增投放目标（动作审核时确认）<input data-action="${a.id}" data-field="newTarget" value="${esc(a.newTarget || a.subject)}"></label>${productContext(a)}${[
                  ["issue", "具体变化 / 问题"],
                  ["evidence", "支撑数据与来源"],
                  ["cause", "可能原因（假设）"],
                  ["missing", "缺少证据 / 相关性"],
                  ["verify", "后续验证指标"],
                ]
                  .map(
                    ([k, l]) =>
                      `<label class="full">${l}<textarea data-action="${a.id}" data-field="${k}">${esc(a[k])}</textarea></label>`,
                  )
                  .join("")}</div></article>`,
            )
            .join("")
        : '<div class="empty">尚未添加本期行动，不以空数据生成通用结论。</div>'
    }</section>`;
  }
  function weeklyConclusions() {
    const previous = tab;
    tab = "target";
    const r = analysisData();
    tab = previous;
    const records = visibleRows(r)
      .filter((g) => g.a.length)
      .sort(
        (a, b) =>
          (b.comparable && b.am.spend != null && b.bm.spend != null
            ? Math.abs(b.am.spend - b.bm.spend)
            : 0) -
          (a.comparable && a.am.spend != null && a.bm.spend != null
            ? Math.abs(a.am.spend - a.bm.spend)
            : 0),
      )
      .slice(0, 5);
    return `<div class="analysis-block"><h3>本周最重要的具体变化（按可比花费变化规模排列，缺失不计差值）</h3>${records.map((g) => `<article class="record"><b>${esc(g.row.target || g.row.term || "目标未提供")}</b><small>${esc(g.row.campaign || g.row.campaignId)} / ${esc(g.row.group || g.row.groupId)}</small><p>${E.explain(g, r).map(esc).join("；")}。本期花费 ${fmt(g.am.spend)}，上期 ${fmt(g.bm.spend)}；本期订单 ${fmt(g.am.orders)}，上期 ${fmt(g.bm.orders)}。</p><p class="note">可能原因：预算、竞价、相关性或外部事件变化，均未确证。缺少证据：当前库存、价格促销、评分与目标ACOS。建议：先核对证据再做单变量调整；下个完整周期复核曝光、CTR、CPC、订单与ACOS。</p></article>`).join("") || '<p class="note">没有可支持结论的投放目标记录，请补充投放报告或含投放目标的搜索词报告。</p>'}</div>`;
  }
  const productFields = {
    name: "产品名称",
    brand: "品牌",
    store: "店铺",
    site: "站点",
    asins: "ASIN（多个用逗号分隔）",
    sku: "SKU",
    spec: "规格",
    colors: "颜色",
    pack: "包装数量",
    cost: "成本（注明币种/口径）",
    price: "售价（注明日期/币种）",
    selling: "核心卖点",
    scenes: "使用场景",
    keywords: "核心关键词",
    goals: "运营目标",
    issues: "历史问题 / 产品限制",
    history: "历史经营记录",
    variants: "变体、父体映射和核实记录",
    status: "资料状态",
  };
  function products() {
    const p = state.products.find((p) => p.id === editProduct);
    return (
      top(
        "产品与品牌",
        "历史资料保留并可编辑，新产品独立配置，不继承其他品牌的结论。",
        '<button id="new-product" class="primary">＋ 添加产品</button>',
      ) +
      (editProduct
        ? `<section class="card">${head(p ? "编辑产品" : "添加新产品")}<form id="product-form" class="form-grid">${Object.entries(
            productFields,
          )
            .map(([k, l]) =>
              [
                "spec",
                "selling",
                "scenes",
                "keywords",
                "goals",
                "issues",
                "history",
                "variants",
              ].includes(k)
                ? `<label class="full">${l}<textarea name="${k}">${esc(p?.[k] || "")}</textarea></label>`
                : field(
                    l,
                    k,
                    p?.[k] || "",
                    "text",
                    ["name", "brand"].includes(k),
                  ),
            )
            .join(
              "",
            )}<button class="primary">保存产品</button><button type="button" id="cancel-product">取消</button></form></section>`
        : "") +
      `<div class="product-grid" style="margin-top:20px">${state.products
        .map(
          (p) =>
            `<section class="card">${head(esc(p.name), esc(p.brand))}<div class="chips"><span class="tag">${esc(p.store || "店铺待配置")}</span><span class="tag">${esc(p.site || "站点待配置")}</span><span class="tag amber">${esc(p.status || "待核实")}</span></div><p class="note">ASIN ${esc(p.asins || "待补充")} · SKU ${esc(p.sku || "待补充")}</p><div class="facts">${esc(p.spec || "规格待补充").replaceAll("\n", "<br>")}</div><p><b>场景</b> ${esc(p.scenes)}</p><p><b>定位</b> ${esc(p.selling)}</p><details><summary>全部资料与历史记录</summary>${Object.entries(
              productFields,
            )
              .map(
                ([k, l]) =>
                  `<p class="note"><b>${l}：</b>${esc(p[k] || "未提供").replaceAll("\n", "<br>")}</p>`,
              )
              .join(
                "",
              )}</details><button data-edit-product="${p.id}">编辑 / 补充</button></section>`,
        )
        .join("")}</div>`
    );
  }
  function experiments() {
    return (
      top("决策与验证", "保留已有实验记录，并可继续记录运营假设与验证。") +
      `<section class="card"><form id="experiment-form" class="form-grid">${field("问题 / 假设", "title", "", "text", true)}${field("复核日期", "due", "", "date", true)}<label>状态<select name="status"><option>待执行</option><option>验证中</option><option>已复盘</option></select></label>${[
        ["fact", "数据事实"],
        ["cause", "可能原因"],
        ["support", "支持证据"],
        ["against", "反对证据"],
        ["action", "动作及活动/广告组范围"],
        ["verify", "验证标准"],
      ]
        .map(
          ([k, l]) =>
            `<label class="full">${l}<textarea name="${k}" required></textarea></label>`,
        )
        .join(
          "",
        )}<button class="primary">保存实验</button></form></section><section class="card" style="margin-top:20px">${head("已有实验记录")}${
        state.actions
          .filter((a) => !a.analysisKey)
          .map(
            (a, i) =>
              `<div class="record"><h3>${esc(a.title)}</h3><small>${esc(a.at)} · ${esc(a.due)} · ${esc(a.scope)}</small>${["fact", "cause", "support", "against", "action", "verify"].map((k) => `<p>${esc(a[k])}</p>`).join("")}<select data-experiment="${i}">${options(["待执行", "验证中", "已复盘"], a.status)}</select></div>`,
          )
          .join("") || '<div class="empty">暂无实验记录</div>'
      }${state.legacy?.decisions && Object.keys(state.legacy.decisions).length ? `<details><summary>旧版搜索词执行建议（完整保留）</summary><pre>${esc(JSON.stringify(state.legacy.decisions, null, 2))}</pre></details>` : ""}</section>`
    );
  }
  function events() {
    return (
      top(
        "运营事件簿",
        "记录大促、价格、评论、库存、配送、变体及投放结构变化。",
      ) +
      `<section class="card"><form id="event-form" class="form-grid">${field("日期", "date", "", "date", true)}${field("品牌 / 店铺 / 站点 / ASIN", "scope", "", "text", true)}<label>事件类型<select name="type">${options(["平台大促", "季节 / 搜索量", "价格 / 优惠券", "评分 / 评论", "库存 / 配送", "变体合并 / 拆分", "Listing / 主图", "预算 / 竞价 / 位置", "其他"], "")}</select></label><label class="full">事件与证据来源<textarea name="detail" required></textarea></label><label>核实状态<select name="status"><option>待核实</option><option>已核实</option></select></label><button class="primary">保存事件</button></form></section><section class="card" style="margin-top:20px">${head("事件记录")}${[
        ...state.events,
      ]
        .reverse()
        .map(
          (e) =>
            `<div class="event"><h3>${esc(e.date)} · ${esc(e.type)} <span class="tag">${esc(e.status)}</span></h3><p class="note">${esc(e.scope)}</p><p>${esc(e.detail)}</p></div>`,
        )
        .join("")}</section>`
    );
  }
  function exportAnalysis() {
    if (tab === "actions") {
      exportActions();
      return;
    }
    const data = analysisData(),
      rows = visibleRows(data);
    const keys = Object.keys(metricLabels);
    const header = [
      "店铺",
      "站点",
      "广告类型",
      "币种",
      "归因口径",
      "报告类型",
      "活动",
      "活动ID",
      "广告组",
      "广告组ID",
      "关键词/目标",
      "匹配",
      "搜索词",
      "位置",
      "广告ASIN",
      "本期起",
      "本期止",
      "上期起",
      "上期止",
      "覆盖可比",
      "出现状态",
      ...keys.flatMap((k) => [
        metricLabels[k] + "本期",
        metricLabels[k] + "上期",
        metricLabels[k] + "变化",
        metricLabels[k] + "变化率",
        metricLabels[k] + "百分点变化（比率指标）",
      ]),
      "本期曝光占比",
      "上期曝光占比",
      "曝光占比百分点变化",
      "本期花费占比",
      "上期花费占比",
      "花费占比百分点变化",
      "分析说明",
      "来源",
    ];
    download(
      "亚马逊运营-分析.csv",
      E.safeCSV([
        header,
        ...rows.map((g) => {
          const r = g.row;
          const shares = tab === "placement" ? shareMetrics(g, data) : {};
          return [
            r.store,
            r.site,
            r.adType,
            r.currency,
            r.attribution,
            E.types[availableType()],
            r.campaign,
            r.campaignId,
            r.group,
            r.groupId,
            r.target,
            r.match,
            r.term,
            r.placement,
            r.asin,
            periods.a.start,
            periods.a.end,
            periods.b.start,
            periods.b.end,
            g.comparable ? "是" : "否",
            g.status,
            ...keys.flatMap((k) => {
              const c = g.comparable ? E.change(g.am[k], g.bm[k]) : {};
              return [
                g.am[k],
                g.bm[k],
                c.delta,
                c.relative,
                pctKeys.includes(k) && c.delta != null ? c.delta * 100 : null,
              ];
            }),
            shares.trafficA,
            shares.trafficB,
            g.comparable && shares.trafficA != null && shares.trafficB != null
              ? (shares.trafficA - shares.trafficB) * 100
              : null,
            shares.spendA,
            shares.spendB,
            g.comparable && shares.spendA != null && shares.spendB != null
              ? (shares.spendA - shares.spendB) * 100
              : null,
            E.explain(g, data).join("；"),
            [
              ...new Set(
                [...g.a, ...g.b].map(
                  (r) => `${r.sourceName} [${r.source}] 行${r.line}`,
                ),
              ),
            ].join("；"),
          ];
        }),
      ]),
    );
  }
  function exportActions() {
    const keys = [
      "priority",
      "store",
      "site",
      "adType",
      "currency",
      "attribution",
      "campaign",
      "campaignId",
      "group",
      "groupId",
      "subject",
      "originalTarget",
      "asin",
      "newTarget",
      "productId",
      "match",
      "issue",
      "suggestion",
      "evidence",
      "cause",
      "missing",
      "verify",
      "status",
      "due",
      "period",
    ];
    const labels = [
      "优先级",
      "店铺",
      "站点",
      "广告类型",
      "币种",
      "归因口径",
      "活动",
      "活动ID",
      "广告组",
      "广告组ID",
      "关键词/搜索词",
      "原目标",
      "广告ASIN",
      "新增投放目标",
      "关联产品ID",
      "匹配方式",
      "问题",
      "建议动作",
      "依据",
      "可能原因",
      "缺少证据",
      "验证指标",
      "执行状态",
      "复盘日期",
      "分析周期",
    ];
    download(
      "亚马逊运营-行动清单.csv",
      E.safeCSV([
        [...labels, "执行定位检查"],
        ...state.actions
          .filter((a) => a.analysisKey)
          .map((a) => [
            ...keys.map((k) => a[k]),
            (a.campaign || a.campaignId) && (a.group || a.groupId)
              ? "可定位，仍需人工审核"
              : "定位不足，不可执行",
          ]),
      ]),
    );
  }
  function bind() {
    if ($("#confirm-batch"))
      for (const [k, v] of Object.entries(batchValues)) {
        const el = $("#confirm-batch").elements.namedItem(k);
        if (el) el.value = v;
      }
    document.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          page = b.dataset.page;
          render();
        }),
    );
    if ($("#upload"))
      $("#upload").onchange = (e) => ingest([...e.target.files]);
    const drop = $("#dropzone");
    if (drop) {
      drop.ondragover = (e) => {
        e.preventDefault();
        drop.classList.add("dragging");
      };
      drop.ondragleave = () => drop.classList.remove("dragging");
      drop.ondrop = (e) => {
        e.preventDefault();
        ingest([...e.dataTransfer.files]);
      };
    }
    if ($("#start-analysis"))
      $("#start-analysis").onclick = () => {
        if (!state.reports.some((r) => r.active !== false)) {
          toast(
            drafts.length
              ? `已读取 ${drafts.length} 个工作表，但尚未保存。请先补齐下方信息并点击“确认并保存本批文件”。`
              : "尚未保存报表，请先选择文件并确认入库。",
          );
          $("#confirm-batch")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          return;
        }
        page = "analyze";
        render();
      };
    document.querySelectorAll("[data-draft]").forEach(
      (el) =>
        (el.onchange = () => {
          const d = drafts[Number(el.dataset.draft)];
          d.mappingOpen = true;
          if (el.dataset.meta === "type") {
            d.type = el.value;
            d.userType = true;
          } else if (el.value) d.map[el.dataset.mapField] = el.value;
          else delete d.map[el.dataset.mapField];
          render();
        }),
    );
    document.querySelectorAll("[data-discard-draft]").forEach(
      (b) =>
        (b.onclick = () => {
          drafts.splice(Number(b.dataset.discardDraft), 1);
          render();
        }),
    );
    if ($('#confirm-batch [name="site"]'))
      $('#confirm-batch [name="site"]').onchange = () => render();
    if ($("#confirm-batch"))
      $("#confirm-batch").onsubmit = (e) => {
        e.preventDefault();
        confirmBatch(e.target).catch((err) => toast(err.message));
      };
    document.querySelectorAll("[data-toggle-report]").forEach(
      (b) =>
        (b.onclick = async () => {
          const r = state.reports.find((r) => r.id === b.dataset.toggleReport);
          r.active = r.active === false;
          await save();
          render();
        }),
    );
    document.querySelectorAll("[data-original]").forEach(
      (b) =>
        (b.onclick = async () => {
          const f = await S.get("files", b.dataset.original);
          if (!f) {
            toast("原文件未保存或已丢失，请恢复完整备份");
            return;
          }
          download(
            f.name.split("/").at(-1),
            f.buffer,
            "application/octet-stream",
          );
        }),
    );
    if ($("#scope"))
      $("#scope").onchange = (e) => {
        scope = e.target.value;
        campaign = "";
        group = "";
        initPeriods();
        render();
      };
    if ($("#mode"))
      $("#mode").onchange = (e) => {
        mode = e.target.value;
        if (mode !== "custom") initPeriods();
        render();
      };
    if ($("#apply-periods"))
      $("#apply-periods").onclick = () => {
        const p = {
          a: {
            start: $('[name="a-start"]').value,
            end: $('[name="a-end"]').value,
          },
          b: {
            start: $('[name="b-start"]').value,
            end: $('[name="b-end"]').value,
          },
        };
        if (
          Object.values(p).some(
            (x) => !x.start || !x.end || x.start > x.end || x.end >= today(),
          )
        ) {
          toast("请选择有效的已完成日期范围（不含今天）");
          return;
        }
        if (!(p.a.start > p.b.end || p.b.start > p.a.end)) {
          toast("两个对比周期不可重叠；周滚动趋势在下方单独展示");
          return;
        }
        periods = p;
        mode = "custom";
        render();
      };
    document.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          campaign = "";
          group = "";
          filter = "";
          metric = tab === "business" ? "totalSales" : "impressions";
          if (mode === "auto") initPeriods();
          if (scope) {
            const current = JSON.parse(scope),
              wantBusiness = tab === "business";
            if ((current[2] === "业务") !== wantBusiness) {
              scope =
                scopes().find((k) => {
                  const v = JSON.parse(k);
                  return (
                    v[0] === current[0] &&
                    v[1] === current[1] &&
                    v[3] === current[3] &&
                    (v[2] === "业务") === wantBusiness
                  );
                }) || scope;
              initPeriods();
            }
          }
          render();
        }),
    );
    for (const [selector, fn] of [
      [
        "#campaign-filter",
        (v) => {
          campaign = v;
          group = "";
        },
      ],
      ["#group-filter", (v) => (group = v)],
      ["#metric", (v) => (metric = v)],
      [
        "#search-view",
        (v) => {
          searchView = v;
          campaign = "";
          group = "";
        },
      ],
      ["#filter", (v) => (filter = v)],
    ])
      if ($(selector))
        $(selector).onchange = (e) => {
          fn(e.target.value);
          render();
        };
    if ($("#export-analysis")) $("#export-analysis").onclick = exportAnalysis;
    if ($("#export-actions")) $("#export-actions").onclick = exportActions;
    document.querySelectorAll("[data-action-key]").forEach(
      (b) =>
        (b.onclick = async () => {
          const result = analysisData();
          const g = result.rows.find((g) => g.key === b.dataset.actionKey);
          addAction(g, result);
          await save();
          toast("已加入待审核行动清单");
        }),
    );
    if ($("#generate-actions"))
      $("#generate-actions").onclick = async () => {
        const previous = tab;
        let added = 0;
        for (const t of ["target", "search"]) {
          tab = t;
          const old = searchView;
          searchView = "detail";
          const r = analysisData();
          for (const g of r.rows
            .filter((g) => g.a.length && (g.am.spend > 0 || g.am.orders > 0))
            .slice(0, 100)) {
            const n = state.actions.length;
            addAction(g, r);
            added += state.actions.length - n;
          }
          searchView = old;
        }
        tab = previous;
        await save();
        render();
        toast(`已新增 ${added} 条待审核行动，不自动否词或加价。`);
      };
    document.querySelectorAll("[data-action]").forEach(
      (el) =>
        (el.onchange = async () => {
          const a = state.actions.find((a) => a.id === el.dataset.action);
          a[el.dataset.field] = el.value;
          await save();
          if (el.dataset.field === "productId") render();
        }),
    );
    if ($("#new-product"))
      $("#new-product").onclick = () => {
        editProduct = "new";
        render();
      };
    document.querySelectorAll("[data-edit-product]").forEach(
      (b) =>
        (b.onclick = () => {
          editProduct = b.dataset.editProduct;
          render();
        }),
    );
    if ($("#cancel-product"))
      $("#cancel-product").onclick = () => {
        editProduct = null;
        render();
      };
    if ($("#product-form"))
      $("#product-form").onsubmit = async (e) => {
        e.preventDefault();
        const p = {
          ...Object.fromEntries(new FormData(e.target)),
          id: editProduct === "new" ? id() : editProduct,
        };
        const i = state.products.findIndex((x) => x.id === p.id);
        if (i < 0) state.products.push(p);
        else state.products[i] = p;
        await save();
        editProduct = null;
        render();
      };
    if ($("#experiment-form"))
      $("#experiment-form").onsubmit = async (e) => {
        e.preventDefault();
        state.actions.push({
          ...Object.fromEntries(new FormData(e.target)),
          at: new Date().toLocaleString(),
          scope: scope ? JSON.parse(scope).join(" / ") : "未指定",
        });
        await save();
        render();
      };
    document.querySelectorAll("[data-experiment]").forEach(
      (el) =>
        (el.onchange = async () => {
          state.actions.filter((a) => !a.analysisKey)[
            Number(el.dataset.experiment)
          ].status = el.value;
          await save();
        }),
    );
    if ($("#event-form"))
      $("#event-form").onsubmit = async (e) => {
        e.preventDefault();
        state.events.push(Object.fromEntries(new FormData(e.target)));
        await save();
        render();
      };
  }
  function base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768)
      s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(s);
  }
  $("#backup").onclick = async () => {
    try {
      const wanted = new Set(
        state.reports.flatMap((r) => [r.fileId, r.parent]).filter(Boolean),
      );
      const files = (await S.listFiles()).filter((f) => wanted.has(f.id));
      const backup = {
        format: "amazon-operations-backup",
        version: 2,
        state,
        files: files.map((f) => ({
          ...f,
          buffer: undefined,
          base64: base64(f.buffer),
        })),
      };
      download(
        "亚马逊运营-完整备份.json",
        JSON.stringify(backup),
        "application/json",
      );
    } catch (err) {
      toast("备份失败：" + err.message);
    }
  };
  $("#restore").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const b = JSON.parse(await file.text());
      let next,
        files = [];
      if (b.version === 1 && Array.isArray(b.rows) && b.mappings)
        next = S.migrate(b);
      else if (
        b.format === "amazon-operations-backup" &&
        b.state?.version === 2 &&
        Array.isArray(b.state.reports) &&
        Array.isArray(b.state.products) &&
        Array.isArray(b.state.actions) &&
        Array.isArray(b.state.events)
      ) {
        next = b.state;
        files = (b.files || []).map((f) => ({
          ...f,
          buffer: Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
            .buffer,
        }));
      } else throw Error("无法识别备份格式");
      if (!confirm("恢复会替换当前工作空间，建议先导出备份。是否继续？"))
        return;
      await S.put(next, files);
      state = next;
      scope = "";
      periods = null;
      drafts = [];
      render();
      toast("备份已恢复");
    } catch (err) {
      toast("恢复失败：" + err.message);
    }
  };
  window.addEventListener("unhandledrejection", (e) => {
    toast("操作未完成：" + (e.reason?.message || e.reason));
  });
  S.load()
    .then((result) => {
      state = result.state;
      storageWarning = result.warning;
      render();
    })
    .catch((err) => {
      $("#app").textContent = "工作空间读取失败：" + err.message;
    });
})();
