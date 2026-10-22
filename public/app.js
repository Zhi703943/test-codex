(() => {
  "use strict";
  const PARSER_VERSION = 2;
  const E = globalThis.ReportEngine,
    S = globalThis.WorkspaceStorage,
    I = globalThis.OperationsInsights,
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
    tab = "overview",
    scope = "",
    drafts = [],
    pendingFiles = [],
    storageWarning = "",
    busy = false,
    lastError = "",
    importNotices = [];
  let batchValues = {},
    periods = null,
    mode = "7",
    searchView = "summary",
    metric = "impressions",
    filter = "",
    campaign = "",
    group = "",
    editProduct = null;
  let periodNote = "",
    quickFilter = "all",
    sortBy = "spend",
    recordContext = null,
    importFailures = [],
    retryInputs = new Map(),
    saving = false;
  const nav = [
    ["collect", "⇧", "上传报表"],
    ["analyze", "◫", "每周分析"],
    ["records", "◷", "调整记录"],
    ["products", "▧", "产品资料"],
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
    const choice = I.choosePeriods(
      state.reports,
      scope,
      Number(mode) || 7,
      E.shift(today(), -1),
    );
    periods = choice.periods;
    periodNote = choice.note;
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
      { collect, analyze, products, records }[page]() +
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
  function batchDefaults() {
    const metas = drafts.map(detectedMeta),
      values = (k) => [
        ...new Set(
          metas.map((m) => m[k]).filter((v) => v && v !== "文件内多值"),
        ),
      ],
      sites = values("site"),
      stores = values("store"),
      ranges = [
        ...new Set(
          metas
            .filter((m) => m.start && m.end)
            .map((m) => m.start + "|" + m.end),
        ),
      ],
      range = ranges.length === 1 ? ranges[0].split("|") : [],
      v = {
        ...Object.fromEntries(
          Object.entries(state.importDefaults || {}).filter(([k]) =>
            ["store", "site", "currency", "batchAdType"].includes(k),
          ),
        ),
        ...batchValues,
      };
    if (!v.site && sites.length === 1) v.site = sites[0];
    if (!v.store && stores.length === 1) v.store = stores[0];
    if (!v.batchStart) v.batchStart = range[0] || "";
    if (!v.batchEnd) v.batchEnd = range[1] || "";
    return v;
  }
  function batchInput() {
    return {
      ...batchDefaults(),
      ...($("#confirm-batch")
        ? Object.fromEntries(new FormData($("#confirm-batch")))
        : {}),
    };
  }
  function draftNeeds(d, v) {
    const m = detectedMeta(d),
      needs = [];
    if (!m.store && !v.store) needs.push("店铺");
    if (!m.site && !v.site) needs.push("站点");
    if (!m.start && !v.batchStart && !v[`start-${drafts.indexOf(d)}`])
      needs.push("开始日期");
    if (!m.end && !v.batchEnd && !v[`end-${drafts.indexOf(d)}`])
      needs.push("结束日期");
    if (d.type === "unknown") needs.push("报告类型");
    if (m.mixedWindows) needs.push("归因字段冲突");
    if (m.currencyConflict) needs.push("币种字段冲突");
    if (!m.currency && !v.currency && !siteCurrencies[m.site || v.site])
      needs.push("币种");
    return needs;
  }
  function advancedDrafts() {
    return drafts
      .map(
        (d, i) =>
          `<details class="draft"><summary>${esc(d.name)} / ${esc(d.sheet)}：修改识别、字段映射和原始预览（同格式同步）</summary>${d.headerWarnings?.length ? `<p class="note">${d.headerWarnings.map(esc).join("<br>")}</p>` : ""}<div class="form-grid"><label>报告类型<select data-draft="${i}" data-meta="type">${options(Object.entries(E.types), d.type)}</select></label><label>广告类型<select name="adType-${i}">${options(
            [
              ["", `自动：${detectedMeta(d).adType || "未知"}`],
              ["SP", "SP"],
              ["SB", "SB"],
              ["SD", "SD"],
            ],
            "",
          )}</select></label>${field("归因更正（可空）", `attribution-${i}`)}${field("仅补缺失开始日期", `start-${i}`, "", "date")}${field("仅补缺失结束日期", `end-${i}`, "", "date")}</div><div class="mapping-grid">${Object.entries(
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
            )}</tbody></table></div><button type="button" data-discard-draft="${i}">移除此工作表</button></details>`,
      )
      .join("");
  }
  function collect() {
    const v = batchDefaults(),
      missing = (k) => drafts.some((d) => !detectedMeta(d)[k]),
      emptyProfile = !v.store || !v.site;
    return (
      top(
        "上传报表",
        "原始报表拖进来，准备好的数据直接开始分析。",
        '<button class="primary" id="start-analysis" ' +
          (busy || saving ? "disabled" : "") +
          ">开始分析</button>",
      ) +
      `<form id="confirm-batch"><section class="card"><div class="card-head"><h2>当前归属：${esc(v.store || "请选择店铺")} · ${esc(v.site || "请选择站点")}</h2><span class="tag">已记住的选择自动沿用</span></div><details id="ownership" ${emptyProfile ? "open" : ""}><summary>切换店铺 / 站点</summary><div class="form-grid">${field("本批店铺", "store", v.store || "")}<label>本批站点<select name="site">${options(["US", "CA", "UK", "DE", "FR", "IT", "ES", "JP", "AU", "MX", "其他"], v.site || "", "请选择")}</select></label><label>币种<select name="currency">${options([["", "按原文件或站点自动识别"], ...["USD", "CAD", "GBP", "EUR", "JPY", "AUD", "MXN", "CNY"].map((x) => [x, x])], v.currency || "")}</select></label></div><p class="note">原文件中明确的归属优先；这里的选择用于补充文件缺失的信息，不覆盖已保存报表。</p></details><div class="drop-zone" id="dropzone"><div class="upload-icon">⇧</div><h2>拖入 Excel、CSV 或 ZIP</h2><p>可一次上传多份，已识别内容直接采用，不用逐份确认。</p><label class="button">选择多份报表<input id="upload" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.zip" hidden ${busy ? "disabled" : ""}></label><p class="note">${busy ? "正在自动整理…" : "纯前端处理，数据保留在当前浏览器。"}</p></div>${drafts.length && (missing("start") || missing("end")) ? `<details open><summary>只为缺少统计日期的文件统一补充</summary><p class="note">已预填本批一致范围（如有），请核对；导出日期不等于统计周期。不会覆盖文件内已有日期。</p><div class="toolbar">${missing("start") ? field("开始日期", "batchStart", v.batchStart || "", "date") : ""}${missing("end") ? field("结束日期", "batchEnd", v.batchEnd || "", "date") : ""}</div></details>` : ""}</section><section class="card" style="margin-top:20px">${head("报表整理结果", `${drafts.length} 份待处理 · ${state.reports.filter((r) => r.active !== false).length} 份已保存`)}<div class="table-wrap"><table><thead><tr><th>文件名</th><th>报告类型</th><th>日期范围</th><th>状态</th></tr></thead><tbody>${drafts
        .map((d, i) => {
          const m = detectedMeta(d),
            needs = draftNeeds(d, v);
          return `<tr><td>${esc(d.name)}<small>${esc(d.sheet)}</small></td><td>${E.types[d.type]} <span class="tag">${esc(m.adType || "未知")}</span></td><td>${esc(m.start || v.batchStart || "待补充")} ~ ${esc(m.end || v.batchEnd || "待补充")}</td><td data-upload-status="${i}">${d.importError ? `<details open><summary>读取失败，查看原因</summary><p>${esc(d.importError)}</p><button type="button" data-retry-draft="${i}">重试此文件</button></details>` : needs.length ? `<span class="status">需要补充${needs.length}项信息</span><small>${needs.map(esc).join("、")} <button type="button" data-fix="${i}">修改</button></small>` : '<span class="ready">可以分析</span>'}</td></tr>`;
        })
        .join(
          "",
        )}${importFailures.map((f, i) => `<tr><td>${esc(f.name)}</td><td>未识别</td><td>—</td><td><details><summary>读取失败，查看原因</summary><p>${esc(f.error)}</p><button type="button" data-retry-failed="${i}">重试</button></details></td></tr>`).join("")}${importNotices.map((n) => `<tr><td>${esc(n.split("：")[0])}</td><td>—</td><td>—</td><td><span>${/已保存/.test(n) ? "重复文件，已跳过" : "预览已更新"}</span><details><summary>详情</summary>${esc(n)}</details></td></tr>`).join("")}${
        state.reports
          .filter((r) => r.active !== false)
          .map(
            (r) =>
              `<tr><td>${esc(r.name)}<small>${esc(r.sheet)}</small></td><td>${E.types[r.type]}</td><td>${r.start} ~ ${r.end}</td><td class="ready">可以分析 · 已保存</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="4" class="empty">上传后台原始报表即可开始。</td></tr>'
      }</tbody></table></div><p class="note">有问题的文件保留在这里，不会阻止其他已就绪文件分析。开始分析会一次完成保存和切页。</p></section><details id="upload-advanced" class="card" style="margin-top:20px"><summary>高级设置：字段映射、原始预览、版本管理</summary>${advancedDrafts()}<div class="form-grid"><label>未注明广告类型的文件（可选）<select name="batchAdType">${options(
        [
          ["", "保留未知"],
          ["SP", "SP"],
          ["SB", "SB"],
          ["SD", "SD"],
        ],
        v.batchAdType || "",
      )}</select></label>${field("未知归因说明（可空）", "batchAttribution")}</div>${state.reports.map((r) => `<div class="record">${esc(r.name)} / ${esc(r.sheet)} · 版本${r.seq} · ${r.active === false ? "已停用" : "已启用"} <button type="button" data-original="${r.fileId || ""}">下载原文件</button> <button type="button" data-toggle-report="${r.id}">${r.active === false ? "启用" : "停用"}</button></div>`).join("")}</details></form>`
    );
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
          retryInputs.set(input.name, input);
          importFailures = importFailures.filter(
            (f) => !f.name.startsWith(input.name),
          );
          const buffer = await input.arrayBuffer();
          await readBuffer(input.name, buffer, null);
        } catch (err) {
          errors.push(input.name + "：" + err.message);
          importFailures.push({ name: input.name, error: err.message, input });
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
            importFailures.push({
              name: name + "/" + f.name,
              error: "不支持此文件格式",
              input: retryInputs.get(name),
            });
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
          importFailures.push({
            name: name + "/" + sheet,
            error: err.message,
            input: [...retryInputs.entries()].find(([n]) =>
              name.startsWith(n),
            )?.[1],
          });
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
    const values = {
      ...batchDefaults(),
      ...Object.fromEntries(new FormData(form)),
    };
    const accepted = new Set();
    const indices = new Map(drafts.map((d, i) => [d, i]));
    const prepared = [];
    const seq = state.reports.reduce((n, r) => Math.max(n, r.seq), 0);
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i],
        m = detectedMeta(d);
      try {
        const needs = draftNeeds(d, values);
        if (needs.length) {
          delete d.importError;
          continue;
        }
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
        accepted.add(d);
        delete d.importError;
      } catch (err) {
        d.importError = err.message;
      }
    }
    if (!prepared.length) return 0;
    const next = structuredClone(state);
    for (const r of prepared)
      if (r.replaces)
        for (const old of next.reports)
          if (old.fileId === r.fileId && old.sheet === r.sheet)
            old.active = false;
    next.reports.push(...prepared);
    next.lastImportIds = prepared.map((r) => r.id);
    next.importDefaults = {
      ...(state.importDefaults || {}),
      store:
        values.store ||
        prepared[0]?.rows[0]?.store ||
        state.importDefaults?.store ||
        "",
      site:
        values.site ||
        prepared[0]?.rows[0]?.site ||
        state.importDefaults?.site ||
        "",
      currency: values.currency || "",
      batchAdType: values.batchAdType || "",
    };
    for (const d of accepted)
      next.rules[d.signature] = {
        map: d.map,
        type: d.type,
        userType: !!d.userType,
      };
    const used = new Set(
      prepared.flatMap((r) => [r.fileId, r.parent]).filter(Boolean),
    );
    await S.put(
      next,
      pendingFiles.filter((f) => used.has(f.id)),
    );
    state = next;
    drafts = drafts.filter((d) => !accepted.has(d));
    pendingFiles = pendingFiles.filter((f) =>
      drafts.some((d) => d.fileId === f.id || d.parent === f.id),
    );
    batchValues = drafts.length
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([k]) => !/^(adType|attribution|start|end)-\d+$/.test(k),
          ),
        )
      : {};
    drafts.forEach((d, i) => {
      for (const k of ["adType", "attribution", "start", "end"])
        if (values[`${k}-${indices.get(d)}`] != null)
          batchValues[`${k}-${i}`] = values[`${k}-${indices.get(d)}`];
    });
    importNotices = [];
    lastError = "";
    periods = null;
    return prepared.length;
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
    return `<section class="card controls"><div class="toolbar"><label>店铺 / 站点 / 广告范围<select id="scope">${options(
      keys.map((k) => [k, JSON.parse(k).join(" / ")]),
      scope,
      "请选择范围",
    )}</select></label><label>周期<select id="mode">${options(
      [
        ["7", "最近完整7天"],
        ["14", "最近完整14天"],
        ["custom", "自定义两个周期"],
      ],
      mode,
    )}</select></label></div><div class="chips"><span class="tag">本期 ${p.a.start} — ${p.a.end}</span><span class="tag">上期 ${p.b.start} — ${p.b.end}</span></div>${mode === "custom" ? `<div class="toolbar">${field("本期开始", "a-start", p.a.start, "date")}${field("本期结束", "a-end", p.a.end, "date")}${field("上期开始", "b-start", p.b.start, "date")}${field("上期结束", "b-end", p.b.end, "date")}<button id="apply-periods">应用周期</button></div>` : ""}<p class="note">${esc(periodNote)} 不包含尚未结束的今天，缺失不补零。金额：${esc(scope ? JSON.parse(scope)[3] : "未选择")}；不同站点/币种/广告类型/归因独立计算，近期归因可能回补。${scope && !I.known(scope) ? "归因未知，订单、销售额和转化比率暂不进行跨期变化判断。" : ""}</p></section>`;
  }
  function availableType() {
    if (tab === "overview") return "target";
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
  function moduleData(type, summary = false) {
    const prev = tab,
      view = searchView;
    tab = type;
    searchView = summary ? "summary" : "detail";
    const data = analysisData();
    tab = prev;
    searchView = view;
    return data;
  }
  function contextFor(g, type, data) {
    const targets = E.select(state.reports, "target", scope, periods.a);
    const same = (r, a) =>
      (r.campaignId || r.campaign) === (a.campaignId || a.campaign) &&
      (r.groupId || r.group) === (a.groupId || a.group);
    return {
      scope,
      type,
      data,
      product:
        type === "search" && g.key === E.keyFor(g.row, "search", true)
          ? null
          : relatedProduct(g.row),
      detail: !(type === "search" && g.key === E.keyFor(g.row, "search", true)),
      targetCoverageFull: targets.full,
      hasExact: targets.rows.some(
        (r) =>
          same(r, g.row) &&
          /exact|精准|精确/i.test(r.match || "") &&
          String(r.target || "")
            .trim()
            .toLowerCase() ===
            String(g.row.term || "")
              .trim()
              .toLowerCase(),
      ),
    };
  }
  function insightFor(g, type, data) {
    return I.evaluate(g, contextFor(g, type, data));
  }
  function highlights() {
    const all = [];
    for (const type of ["target", "search", "placement"]) {
      const data = moduleData(type);
      for (const g of data.rows) {
        const insight = insightFor(g, type, data);
        if (insight) all.push({ type, g, data, insight });
      }
    }
    const seen = new Set();
    return all
      .sort((a, b) => b.insight.score - a.insight.score)
      .filter((x) => {
        const k = JSON.stringify([
          x.type === "search"
            ? x.g.row.term
            : x.type === "placement"
              ? x.g.row.placement
              : x.g.row.target,
          x.g.row.campaignId || x.g.row.campaign,
          x.g.row.groupId || x.g.row.group,
          x.insight.rules[0],
        ]);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 5);
  }
  function analyze() {
    const controls = scopeControls();
    return (
      top(
        "每周分析",
        "自动计算与规则分析 · 没有接入AI，不代表自动执行建议。",
        '<button id="export-excel" class="primary">导出Excel</button>',
      ) +
      controls +
      `<div class="tabs">${[
        ["overview", "本周重点"],
        ["target", "关键词变化"],
        ["search", "搜索词变化"],
        ["placement", "广告位变化"],
      ]
        .map(
          ([k, l]) =>
            `<button data-tab="${k}" class="${tab === k ? "primary" : ""}">${l}</button>`,
        )
        .join("")}</div>` +
      (tab === "overview" ? overviewPanel() : compactPanel()) +
      `<details class="card" style="margin-top:20px"><summary>其他已导入数据：广告商品 / 活动 / 业务报告</summary><div class="toolbar">${[
        ["product", "广告商品"],
        ["campaign", "活动报告"],
        ["business", "业务销售与流量"],
      ]
        .map(([k, l]) => `<button data-tab="${k}">${l}</button>`)
        .join(
          "",
        )}</div><p class="note">业务转化率与广告CVR独立；不同广告类型和归因口径通过顶部范围选择，始终不混算。</p></details>`
    );
  }
  function overviewPanel() {
    const list = highlights();
    return `<section class="card">${head("本周重点", `${list.length} 项有数据依据的发现`)}${
      list
        .map((x) => {
          const r = x.g.row;
          return `<article class="highlight"><span class="tag">${{ target: "投放关键词", search: "顾客搜索词", placement: "广告位置" }[x.type]}</span><h3><button data-highlight-type="${x.type}" data-key="${esc(x.g.key)}">${esc(r.term || r.target || r.placement || r.campaign)}</button></h3><small>${esc(r.campaign || r.campaignId)} / ${esc(r.group || r.groupId || "活动级")}</small><p><b>已观察到：</b>${esc(x.insight.observed)}</p><p><b>建议检查：</b>${esc(x.insight.check)}</p><p class="note">${x.insight.caveats.map(esc).join("；")}</p></article>`;
        })
        .join("") ||
      '<div class="empty">当前没有足够证据形成重点变化。可先查看已有明细，缺少的上期和产品信息不会被补成0。</div>'
    }</section><section class="card" style="margin-top:20px">${head("建议处理清单", "系统建议：尚未执行")}<p class="note">建议和实际调整分开记录。点击某一项进入明细后，可记录你确实做过的操作。</p>${list.map((x) => `<div class="record"><b>${esc(x.g.row.term || x.g.row.target || x.g.row.placement)}</b> · ${esc(x.insight.suggestion)}<small>${esc(x.g.row.campaign || x.g.row.campaignId)} / ${esc(x.g.row.group || x.g.row.groupId || "活动级")}</small></div>`).join("")}</section>`;
  }
  const tableMetrics = [
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "orders",
    "cvr",
    "spend",
    "acos",
  ];
  function compactCell(g, k) {
    const valid = I.metricComparable(g, k, scope),
      c = valid ? E.change(g.am[k], g.bm[k]) : {};
    return `<td>${fmt(g.am[k], k)}<small>${c.delta != null ? (c.delta > 0 ? "+" : "") + (pctKeys.includes(k) ? (c.delta * 100).toFixed(2) + "个百分点" : fmt(c.delta, k)) : g.b.length ? "不可比 / 口径待核实" : "上期缺失"}</small></td>`;
  }
  function compactPanel() {
    const type = tab,
      data = moduleData(type, type === "search" && searchView === "summary");
    let rows = visibleRows(data);
    const costs = data.rows
        .map((g) => g.am.spend)
        .filter((x) => x != null)
        .sort((a, b) => a - b),
      highSpend =
        costs[Math.max(0, Math.ceil(costs.length * 0.75) - 1)] ?? Infinity;
    rows = rows.filter((g) =>
      I.matches(g, quickFilter, {
        scope,
        highSpend,
        insight: insightFor(g, type, data),
      }),
    );
    rows = I.sort(rows, sortBy);
    const filters = [
      ["all", "全部"],
      ["high-spend", "花费高"],
      ["cpc-up", "CPC上涨"],
      ["cvr-down", "转化下降"],
      ["new-order", "新增出单"],
      ["no-order", "有花费未出单"],
      ...(type === "search"
        ? [
            ["new", "本期新出现"],
            ["both", "两期都有"],
            ["gone", "本期报告未出现"],
            ["exact", "可考虑新增精准"],
            ["relevance", "需要检查相关性"],
          ]
        : []),
    ];
    const metrics =
      type === "business"
        ? ["sessions", "totalSales", "totalUnits", "businessUnitSession"]
        : tableMetrics;
    return (
      coverage(data) +
      `<section class="card"><div class="toolbar"><input id="filter" value="${esc(filter)}" placeholder="搜索词、活动或广告组"><select id="quick-filter">${options(filters, quickFilter)}</select><select id="sort-by">${options(
        [
          ["spend", "按花费从高到低"],
          ["impressions", "按曝光从高到低"],
          ["orders", "按订单从高到低"],
          ["cpc-change", "按CPC涨幅"],
          ["word", "按词排序"],
        ],
        sortBy,
      )}</select>${
        type === "search"
          ? `<select id="search-view">${options(
              [
                ["summary", "搜索词汇总视图"],
                ["detail", "广告组明细视图"],
              ],
              searchView,
            )}</select>`
          : ""
      }</div><p class="note">花费高＝当前范围花费前25%，不表示亏损。CPC/CVR筛选只用可比两期；低样本会标记，不直接判异常。${type === "search" ? "“本期未出现”不等于需求消失；精准候选需有产品目标、已确认相关性和完整投放覆盖证据。" : ""}${type === "placement" ? "位置指标按原始层级展示；活动级数据不能分摊到关键词。" : ""}</p><div class="table-wrap"><table class="compact-table"><thead><tr><th>${type === "search" ? "顾客搜索词" : type === "placement" ? "广告位置" : type === "target" ? "投放关键词 / 目标" : "对象"}</th><th>活动 / 广告组</th>${metrics.map((k) => `<th>${metricLabels[k]}</th>`).join("")}${type === "placement" ? "<th>曝光占比（本 / 上）</th>" : ""}</tr></thead><tbody>${
        rows
          .map((g) => {
            const r = g.row,
              insight = insightFor(g, type, data),
              title =
                type === "search"
                  ? r.term
                  : type === "placement"
                    ? r.placement
                    : type === "target"
                      ? r.target
                      : r.asin || r.campaign;
            return `<tr data-row-key="${esc(g.key)}"><td><button class="text-button" data-expand-row="${esc(g.key)}">${esc(title || "未提供")}</button><small>${esc(r.match || "")} ${type === "placement" ? (r.target ? "目标 × 位置" : r.group || r.groupId ? "广告组级" : "活动级") : ""}</small>${type === "search" ? `<small>${esc(g.status)}</small>` : ""}</td><td>${type === "search" && searchView === "summary" ? `当前范围汇总<small>涉及 ${new Set([...g.a, ...g.b].map((x) => (x.campaignId || x.campaign) + "|" + (x.groupId || x.group))).size} 个活动/广告组组合</small>` : `${esc(r.campaign || r.campaignId || "未提供")}<small>${esc(r.group || r.groupId || "活动级 / 未提供")}</small>`}</td>${metrics.map((k) => compactCell(g, k)).join("")}${type === "placement" ? `<td>${fmt(shareMetrics(g, data).trafficA, "ctr")} / ${fmt(shareMetrics(g, data).trafficB, "ctr")}</td>` : ""}</tr><tr class="detail-row" data-details-key="${esc(g.key)}" hidden><td colspan="${metrics.length + 3}"><div class="detail-content">${insight ? `<p><b>已观察到：</b>${esc(insight.observed)}</p><p><b>建议检查：</b>${esc(insight.check)}</p><p class="note">${insight.caveats.map(esc).join("；")}</p>` : '<p class="note">当前没有足够数据形成处理建议；保留实际数值，不制造原因。</p>'}<table><thead><tr><th>指标</th><th>本期 ${periods.a.start} ~ ${periods.a.end}</th><th>上期 ${periods.b.start} ~ ${periods.b.end}</th><th>变化 / 幅度</th></tr></thead><tbody>${Object.entries(
              metricLabels,
            )
              .map(
                ([k, l]) =>
                  `<tr><td>${l}</td><td>${fmt(g.am[k], k)}</td><td>${fmt(g.bm[k], k)}</td><td>${I.metricComparable(g, k, scope) ? deltaText(g.am[k], g.bm[k], k) : "不可比"}</td></tr>`,
              )
              .join(
                "",
              )}</tbody></table><p class="note">来源：${sources(g)}</p>${type === "target" ? keywordPlacementContext(r) : ""}${type === "placement" ? placementShare(g, data) : ""}${type === "search" && searchView === "summary" ? `<button data-show-search-groups="${esc(r.term)}">查看广告组明细后记录调整</button>` : `<button class="primary" data-record-key="${esc(g.key)}">记录调整</button>`}</div></td></tr>`;
          })
          .join("") ||
        `<tr><td colspan="12" class="empty">当前周期没有可用明细，可能缺少此类报告、周期汇总不能拆分，或筛选无结果。已有数据不补零。</td></tr>`
      }</tbody></table></div></section>`
    );
  }
  function records() {
    const ctx = recordContext;
    return (
      top("调整记录", "只记录你确认实际做过的操作；记录不会修改亚马逊后台。") +
      `<section class="card">${head("记录实际调整")}${ctx ? `<p class="note">已带入 ${esc(ctx.row.store)} / ${esc(ctx.row.site)} · ${esc(ctx.row.campaign || ctx.row.campaignId)} / ${esc(ctx.row.group || ctx.row.groupId || "活动级")}，以及当期数据。</p>` : ""}<form id="record-form" class="form-grid">${field("调整对象", "subject", ctx?.row.term || ctx?.row.target || ctx?.row.placement || ctx?.row.campaign || "", "text", true)}<label>做了什么调整<input name="action" list="adjustment-types" required placeholder="改竞价、改预算、新增词、否词、改价、换图…"><datalist id="adjustment-types">${["改竞价", "改预算", "新增关键词", "否词", "改价", "换图"].map((x) => `<option value="${x}">`).join("")}</datalist></label>${field("调整日期", "date", today(), "date", true)}<label class="full">备注（选填）<textarea name="notes"></textarea></label><button class="primary">保存已执行调整</button></form></section><section class="card" style="margin-top:20px">${head("已记录调整（用户确认实际做过）")}${
        [...(state.adjustments || [])]
          .reverse()
          .map(
            (a) =>
              `<article class="record"><h3>${esc(a.subject)} · ${esc(a.action)}</h3><small>${esc(a.date)} · ${esc(a.context?.row.store || "店铺未指定")} · ${esc(a.context?.row.campaign || "")} / ${esc(a.context?.row.group || "")}</small><p>${esc(a.notes)}</p>${adjustmentReview(a)}</article>`,
          )
          .join("") ||
        '<div class="empty">暂无实际调整。系统建议不会自动写入这里。</div>'
      }</section><details class="card" style="margin-top:20px"><summary>历史决策、运营事件与旧建议（完整保留）</summary>${state.actions.map((a) => `<article class="record"><h3>${esc(a.title || a.subject)} <span class="tag">${a.analysisKey ? "历史系统建议，未视为已执行" : "历史决策记录"}</span></h3><small>${esc(a.due || a.at || "")} · ${esc(a.status || "")}</small><details><summary>查看原始记录</summary><pre>${esc(JSON.stringify(a, null, 2))}</pre></details></article>`).join("")}${state.events.map((e) => `<article class="event"><h3>${esc(e.date)} · ${esc(e.type)}</h3><p>${esc(e.scope)}</p><p>${esc(e.detail)}</p><small>${esc(e.status)}</small></article>`).join("")}${state.legacy ? `<details><summary>旧版原始归档</summary><pre>${esc(JSON.stringify(state.legacy, null, 2))}</pre></details>` : ""}</details>`
    );
  }
  function adjustmentReview(a) {
    if (!a.context)
      return '<p class="note">待补充数据：未关联到具体报表对象。</p>';
    const c = a.context,
      p = {
        a: { start: E.shift(a.date, 1), end: E.shift(a.date, 7) },
        b: { start: E.shift(a.date, -7), end: E.shift(a.date, -1) },
      };
    if (p.a.end >= today())
      return '<p class="note">待补充数据：调整后7个完整日尚未结束。</p>';
    const prevScope = scope,
      prevPeriods = periods;
    scope = c.scope;
    periods = p;
    const data = moduleData(c.type, false);
    scope = prevScope;
    periods = prevPeriods;
    const g = data.rows.find((x) => x.key === c.key);
    if (!data.comparable || !g?.comparable)
      return '<p class="note">待补充数据：需同对象调整前后各7天的可比明细，周期汇总不能硬拆。</p>';
    return `<p class="note">前7天 ${p.b.start}~${p.b.end} / 后7天 ${p.a.start}~${p.a.end}：曝光 ${fmt(g.bm.impressions)} → ${fmt(g.am.impressions)}，花费 ${fmt(g.bm.spend)} → ${fmt(g.am.spend)}，${I.known(c.scope) ? `订单 ${fmt(g.bm.orders)} → ${fmt(g.am.orders)}` : "归因未知，订单不进行跨期比较"}。前后变化不等于调整导致的效果；需同时检查外部事件和归因。</p>`;
  }
  function exportRows(type) {
    const data = moduleData(type, false);
    const keys = [
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "orders",
      "cvr",
      "spend",
      "sales",
      "acos",
      "roas",
    ];
    return data.rows.map((g) => {
      const r = g.row,
        ins = insightFor(g, type, data),
        obj = {
          店铺: r.store,
          站点: r.site,
          广告类型: r.adType,
          币种: r.currency,
          归因: r.attribution,
          本期开始: periods.a.start,
          本期结束: periods.a.end,
          上期开始: periods.b.start,
          上期结束: periods.b.end,
          对象: r.term || r.target || r.placement || "",
          活动: r.campaign,
          活动ID: r.campaignId,
          广告组: r.group,
          广告组ID: r.groupId,
          匹配方式: r.match,
          原目标: r.target,
          出现状态: g.status,
          来源: [
            ...new Set(
              [...g.a, ...g.b].map(
                (x) => x.sourceName + " [" + x.source + "] 行" + x.line,
              ),
            ),
          ].join("；"),
        };
      for (const k of keys) {
        obj[metricLabels[k] + "本期"] = g.am[k];
        obj[metricLabels[k] + "上期"] = g.bm[k];
        obj[metricLabels[k] + "变化"] = I.metricComparable(g, k, scope)
          ? E.change(g.am[k], g.bm[k]).delta
          : null;
        if (pctKeys.includes(k))
          obj[metricLabels[k] + "百分点变化"] =
            obj[metricLabels[k] + "变化"] != null
              ? obj[metricLabels[k] + "变化"] * 100
              : null;
      }
      if (type === "placement") {
        const share = shareMetrics(g, data);
        Object.assign(obj, {
          位置层级: r.target
            ? "目标级"
            : r.group || r.groupId
              ? "广告组级"
              : "活动级",
          本期曝光占比: share.trafficA,
          上期曝光占比: share.trafficB,
          本期花费占比: share.spendA,
          上期花费占比: share.spendB,
        });
      }
      obj.已观察到 = ins?.observed || "";
      obj.建议检查 = ins?.check || "";
      obj.限制 = ins?.caveats.join("；") || "";
      return obj;
    });
  }
  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    wb.creator = "亚马逊运营工作台";
    const add = (name, objects) => {
      const sheet = wb.addWorksheet(name);
      if (!objects.length) {
        sheet.addRow(["当前范围/周期暂无可支持数据，不补零或生成结论。"]);
        return;
      }
      const headers = [...new Set(objects.flatMap(Object.keys))];
      sheet.addRow(headers);
      for (const obj of objects)
        sheet.addRow(headers.map((k) => obj[k] ?? null));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheet.rowCount, column: headers.length },
      };
      sheet.columns.forEach((c, i) => {
        c.width = 18;
        const label = headers[i];
        if (/百分点/.test(label)) c.numFmt = '0.00" 个百分点"';
        else if (/CTR|CVR|ACOS|曝光占比|花费占比/.test(label))
          c.numFmt = "0.00%";
        else if (/花费|CPC|销售额/.test(label)) c.numFmt = "#,##0.00";
      });
    };
    const list = highlights();
    add(
      "本周重点",
      list.map((x) => ({
        店铺: x.g.row.store,
        站点: x.g.row.site,
        广告类型: x.g.row.adType,
        币种: x.g.row.currency,
        归因: x.g.row.attribution,
        本期: periods.a.start + " ~ " + periods.a.end,
        上期: periods.b.start + " ~ " + periods.b.end,
        对象: x.g.row.term || x.g.row.target || x.g.row.placement,
        活动: x.g.row.campaign,
        活动ID: x.g.row.campaignId,
        广告组: x.g.row.group,
        广告组ID: x.g.row.groupId,
        匹配方式: x.g.row.match,
        来源: [
          ...new Set(
            [...x.g.a, ...x.g.b].map(
              (r) => r.sourceName + " [" + r.source + "]",
            ),
          ),
        ].join("；"),
        已观察到: x.insight.observed,
        建议检查: x.insight.check,
        限制: x.insight.caveats.join("；"),
      })),
    );
    const targets = exportRows("target"),
      terms = exportRows("search"),
      placements = exportRows("placement");
    add("关键词对比", targets);
    add("搜索词对比", terms);
    add("广告位对比", placements);
    add(
      "建议处理清单",
      [...targets, ...terms, ...placements]
        .filter((r) => r.建议检查)
        .map((r) => ({ ...r, 执行状态: "系统建议，尚未执行" })),
    );
    download(
      "亚马逊运营分析.xlsx",
      await wb.xlsx.writeBuffer(),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    toast("已导出5个工作表，建议与页面使用相同数据规则。");
  }
  function coverage(result) {
    return `<div class="banner"><span class="icon">◷</span><div><strong>本期覆盖 ${result.a.coverage}/${result.a.expected} 天 · 上期覆盖 ${result.b.coverage}/${result.b.expected} 天</strong><p>${result.comparable ? "两个周期覆盖完整；仍需检查筛选范围与归因一致性。" : "覆盖不足：仅展示已有记录，不将缺失日期或对象补零，不据此制造下降。"} ${[...result.a.warnings, ...result.b.warnings].map(esc).join("；")}</p></div></div>`;
  }
  function deltaText(a, b, k) {
    const c = E.change(a, b);
    if (c.delta == null) return "不可比较";
    return `${c.delta > 0 ? "+" : ""}${pctKeys.includes(k) ? (c.delta * 100).toFixed(2) + " 个百分点" : fmt(c.delta, k)} / ${c.relative == null ? "上期为0，增长率不可计算" : (c.relative > 0 ? "+" : "") + (c.relative * 100).toFixed(1) + "%"}`;
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
  function relatedProduct(r) {
    return state.products.find(
      (p) =>
        r.asin &&
        p.asins.split(/[,，\s]+/).includes(r.asin) &&
        (!p.store || p.store === r.store) &&
        (!p.site || p.site === r.site),
    );
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
        "产品资料",
        "历史资料保留并可编辑，新产品独立配置，不继承其他品牌的结论。",
        '<button id="new-product" class="primary">＋ 添加产品</button>',
      ) +
      (editProduct
        ? `<section class="card">${head(p ? "编辑产品" : "添加新产品")}<form id="product-form" class="form-grid">${Object.entries(
            productFields,
          )
            .filter(([k]) =>
              ["name", "brand", "store", "site", "asins", "sku"].includes(k),
            )
            .map(([k, l]) => field(l, k, p?.[k] || "", "text", k === "name"))
            .join(
              "",
            )}<details class="full"><summary>逐步补充：规格、场景、成本、目标与历史信息（选填）</summary><div class="form-grid">${Object.entries(
            productFields,
          )
            .filter(
              ([k]) =>
                !["name", "brand", "store", "site", "asins", "sku"].includes(k),
            )
            .map(
              ([k, l]) =>
                `<label class="full">${l}<textarea name="${k}">${esc(p?.[k] || "")}</textarea></label>`,
            )
            .join(
              "",
            )}${field("目标ACOS（百分数，可选）", "targetAcos", p?.targetAcos || "", "number")}<label class="full">已人工确认相关的搜索词（每行一词，可选）<textarea name="relevanceTerms">${esc(p?.relevanceTerms || "")}</textarea></label></div></details><button class="primary">保存产品</button><button type="button" id="cancel-product">取消</button></form></section>`
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
  function bind() {
    if ($("#confirm-batch"))
      for (const [k, v] of Object.entries(batchValues)) {
        const el = $("#confirm-batch").elements.namedItem(k);
        if (el && v !== "") el.value = v;
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
    if ($("#confirm-batch")) {
      $("#confirm-batch").onsubmit = (e) => {
        e.preventDefault();
        $("#start-analysis")?.click();
      };
      for (const name of [
        "store",
        "site",
        "currency",
        "batchStart",
        "batchEnd",
        "batchAdType",
      ]) {
        const el = $("#confirm-batch").elements.namedItem(name);
        if (el)
          el.oninput = () => {
            batchValues[name] = el.value;
            const v = batchInput();
            drafts.forEach((d, i) => {
              if (d.importError?.startsWith("请补充")) delete d.importError;
              const cell = document.querySelector(
                `[data-upload-status="${i}"]`,
              );
              if (cell && !d.importError) {
                const needs = draftNeeds(d, v);
                cell.textContent = needs.length
                  ? `需要补充${needs.length}项信息：${needs.join("、")}`
                  : "可以分析";
              }
            });
          };
      }
    }
    if ($("#start-analysis"))
      $("#start-analysis").onclick = async () => {
        if (busy || saving) return;
        const form = $("#confirm-batch");
        batchValues = batchInput();
        saving = true;
        $("#start-analysis").disabled = true;
        try {
          const saved = drafts.length ? await confirmBatch(form) : 0;
          if (!drafts.length && batchValues.store && batchValues.site) {
            state.importDefaults = {
              store: batchValues.store,
              site: batchValues.site,
              currency: batchValues.currency || "",
              batchAdType: batchValues.batchAdType || "",
            };
            await save();
          }
          if (!state.reports.some((r) => r.active !== false)) {
            toast("请补充表格中标出的缺失信息，已识别内容不需要重复填写。");
            render();
            return;
          }
          if (saved) {
            const recent = state.reports.filter(
              (r) =>
                (state.lastImportIds || []).includes(r.id) &&
                r.active !== false,
            );
            const preferred = [
              "target",
              "search",
              "placement",
              "product",
              "campaign",
              "business",
            ]
              .map((t) => recent.find((r) => r.type === t))
              .find(Boolean);
            if (preferred) scope = E.scopeKey(preferred.rows[0]);
          }
          page = "analyze";
          tab = "overview";
          periods = null;
          render();
          toast(
            `${saved ? `已保存 ${saved} 份就绪报告。` : ""}${drafts.length || importFailures.length ? `仍有 ${drafts.length + importFailures.length} 份待处理，可返回上传页重试。` : "已进入分析。"}`,
          );
        } catch (err) {
          toast("保存未完成：" + err.message);
          render();
        } finally {
          saving = false;
          if ($("#start-analysis")) $("#start-analysis").disabled = false;
        }
      };
    document.querySelectorAll("[data-fix]").forEach(
      (b) =>
        (b.onclick = () => {
          const i = Number(b.dataset.fix);
          $("#upload-advanced").open = true;
          const d = document.querySelectorAll(".draft")[i];
          if (d) {
            d.open = true;
            d.scrollIntoView({ behavior: "smooth" });
          }
        }),
    );
    document.querySelectorAll("[data-draft]").forEach(
      (el) =>
        (el.onchange = () => {
          const d = drafts[Number(el.dataset.draft)];
          if (el.dataset.meta === "type") {
            d.type = el.value;
            d.userType = true;
          } else if (el.value) d.map[el.dataset.mapField] = el.value;
          else delete d.map[el.dataset.mapField];
          delete d.importError;
          for (const other of drafts)
            if (other !== d && other.signature === d.signature) {
              other.map = { ...d.map };
              other.type = d.type;
              other.userType = d.userType;
              delete other.importError;
            }
          batchValues = batchInput();
          render();
          $("#upload-advanced").open = true;
          document.querySelectorAll(".draft")[Number(el.dataset.draft)].open =
            true;
        }),
    );
    document.querySelectorAll("[data-discard-draft]").forEach(
      (b) =>
        (b.onclick = () => {
          drafts.splice(Number(b.dataset.discardDraft), 1);
          render();
        }),
    );
    document.querySelectorAll("[data-retry-failed]").forEach(
      (b) =>
        (b.onclick = () => {
          const f = importFailures[Number(b.dataset.retryFailed)];
          if (f.input) ingest([f.input]);
          else toast("请重新选择原始文件。");
        }),
    );
    document.querySelectorAll("[data-retry-draft]").forEach(
      (b) =>
        (b.onclick = () => {
          const d = drafts[Number(b.dataset.retryDraft)],
            f = pendingFiles.find((f) => f.id === d.fileId);
          if (f)
            ingest([
              {
                name: d.name,
                size: f.buffer.byteLength,
                arrayBuffer: async () => f.buffer,
              },
            ]);
        }),
    );
    document.querySelectorAll("[data-toggle-report]").forEach(
      (b) =>
        (b.onclick = async () => {
          const r = state.reports.find((r) => r.id === b.dataset.toggleReport);
          r.active = r.active === false;
          await save();
          periods = null;
          render();
        }),
    );
    document.querySelectorAll("[data-original]").forEach(
      (b) =>
        (b.onclick = async () => {
          const f = await S.get("files", b.dataset.original);
          if (f)
            download(
              f.name.split("/").at(-1),
              f.buffer,
              "application/octet-stream",
            );
          else toast("原始文件不可用，请恢复完整备份。");
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
          ) ||
          !(p.a.start > p.b.end || p.b.start > p.a.end)
        ) {
          toast("请选择已结束且互不重叠的有效周期。");
          return;
        }
        periods = p;
        periodNote = "";
        render();
      };
    document.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          filter = "";
          quickFilter = "all";
          if (scope) {
            const now = JSON.parse(scope),
              business = tab === "business";
            if ((now[2] === "业务") !== business) {
              scope =
                scopes().find((k) => {
                  const v = JSON.parse(k);
                  return (
                    v[0] === now[0] &&
                    v[1] === now[1] &&
                    v[3] === now[3] &&
                    (v[2] === "业务") === business
                  );
                }) || scope;
              initPeriods();
            }
          }
          render();
        }),
    );
    for (const [sel, fn] of [
      ["#filter", (v) => (filter = v)],
      ["#quick-filter", (v) => (quickFilter = v)],
      ["#sort-by", (v) => (sortBy = v)],
      ["#search-view", (v) => (searchView = v)],
    ])
      if ($(sel))
        $(sel).onchange = (e) => {
          fn(e.target.value);
          render();
        };
    const openRow = (key) => {
      const row = [...document.querySelectorAll("[data-details-key]")].find(
        (el) => el.dataset.detailsKey === key,
      );
      if (row) row.hidden = !row.hidden;
      return row;
    };
    document.querySelectorAll("[data-row-key]").forEach(
      (row) =>
        (row.onclick = (e) => {
          if (!e.target.closest("button")) openRow(row.dataset.rowKey);
        }),
    );
    document
      .querySelectorAll("[data-expand-row]")
      .forEach((b) => (b.onclick = () => openRow(b.dataset.expandRow)));
    document.querySelectorAll("[data-highlight-type]").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.highlightType;
          if (tab === "search") searchView = "detail";
          quickFilter = "all";
          filter = "";
          render();
          const r = openRow(b.dataset.key);
          r?.scrollIntoView({ behavior: "smooth", block: "center" });
        }),
    );
    document.querySelectorAll("[data-show-search-groups]").forEach(
      (b) =>
        (b.onclick = () => {
          searchView = "detail";
          filter = b.dataset.showSearchGroups;
          render();
        }),
    );
    document.querySelectorAll("[data-record-key]").forEach(
      (b) =>
        (b.onclick = () => {
          const data = moduleData(tab, false),
            g = data.rows.find((g) => g.key === b.dataset.recordKey);
          if (!g) return;
          recordContext = {
            type: tab,
            key: g.key,
            scope,
            row: g.row,
            period: structuredClone(periods),
            snapshot: structuredClone(g.am),
          };
          page = "records";
          render();
        }),
    );
    if ($("#record-form"))
      $("#record-form").onsubmit = async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.target));
        if (v.date > today()) {
          toast("实际调整日期不能在未来。");
          return;
        }
        state.adjustments ??= [];
        state.adjustments.push({
          ...v,
          id: id(),
          context: recordContext ? structuredClone(recordContext) : null,
          executed: true,
          at: new Date().toISOString(),
        });
        await save();
        recordContext = null;
        render();
        toast("已记录你确认做过的操作，未修改亚马逊后台。");
      };
    if ($("#export-excel"))
      $("#export-excel").onclick = () =>
        exportExcel().catch((err) => toast("导出失败：" + err.message));
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
        const old = state.products.find((p) => p.id === editProduct),
          p = {
            ...old,
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
