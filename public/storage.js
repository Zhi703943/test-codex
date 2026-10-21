(() => {
  "use strict";
  let database = null;
  const memoryFiles = new Map();
  async function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("amazon-operations-workspace", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("workspace");
        req.result.createObjectStore("files");
      };
      req.onsuccess = () => {
        database = req.result;
        resolve(database);
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function get(store, key) {
    if (!database) return store === "files" ? memoryFiles.get(key) : null;
    return new Promise((resolve, reject) => {
      const req = database.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function put(state, files = []) {
    if (!database) {
      for (const f of files) memoryFiles.set(f.id, f);
      try {
        localStorage.setItem("amazon-workspace-v2", JSON.stringify(state));
      } catch {
        throw Error(
          "浏览器存储不可用或已满，请立即导出备份；本次更改仅在内存中",
        );
      }
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = database.transaction(["workspace", "files"], "readwrite");
      tx.objectStore("workspace").put(state, "state");
      for (const f of files) tx.objectStore("files").put(f, f.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("保存事务中断"));
    });
  }
  function seed() {
    const f = globalThis.AmazonSeed;
    const lists = [
      f.asins.slice(0, 7),
      f.asins.slice(7, 9),
      [],
      f.asins.slice(9),
    ];
    return {
      version: 2,
      reports: [],
      rules: {},
      actions: [],
      events: [
        {
          date: "2026-10-06",
          type: "平台大促",
          scope: "Upelf / US · 历史记录",
          status: "待核实",
          detail: "用户记录 10月6—7日 PD 相关活动，名称、站点及日期仍需核实。",
        },
        {
          date: "2026-10-01",
          type: "变体 / 广告历史",
          scope: "Upelf / US · 历史记录",
          status: "待核实",
          detail:
            "10月初曾讨论混色并入父体，实际日期与当前关系待核实。SB历史依赖较高，混色SP曾较差，紫色合并后SP曾较好，黑色单独投放转化曾下降。紫色CPC曾约$0.57、黑色约$0.78。核心词曾出现CVR上升约1个百分点及位置曝光下降，另一核心词流量转化同时下降；无对应完整窗口，不作为当前结论。",
        },
      ],
      products: f.families.map((p, i) => ({
        id: "legacy-family-" + i,
        brand: "Upelf",
        name: p.name,
        store: "",
        site: "US",
        asins: lists[i].join(", "),
        sku: "",
        spec: p.spec.join("\n"),
        colors:
          i === 0 ? "蓝色、黑色、豆绿色、紫色 RGB 222,160,245（历史资料）" : "",
        pack: i === 0 ? "4件装" : i === 1 ? "新品方向2件装" : "",
        cost: "见历史记录，需核实",
        price: i === 0 ? "历史 $9.98，需核实" : "",
        selling: p.position,
        scenes: p.scene,
        keywords:
          i === 0
            ? "ice packs for lunch boxes\nlunch box ice packs\nice pack for lunch box"
            : "",
        goals:
          i === 0
            ? "历史目标：大词稳定卡位 + 其他精准词扩量，提升自然流量和自然订单"
            : i === 3
              ? "历史目标：20单/天"
              : "待配置",
        issues: p.limit,
        history: p.history,
        variants:
          i === 0
            ? "历史混色 B0G13CGMVP；历史父体 B0GX14WJ8F。子体颜色/父体映射未完整，需核实。"
            : "",
        status: "历史资料 · 待核实",
      })),
      legacy: null,
    };
  }
  function migrate(old) {
    const s = seed();
    s.legacy = old;
    s.actions = old.actions || [];
    s.events.push(...(old.events || []));
    s.products[0].variants +=
      "\n" +
      Object.entries(old.mappings || {})
        .map(([asin, m]) => `${asin}: ${JSON.stringify(m)}`)
        .join("\n");
    if (old.rows?.length) {
      const rows = old.rows.map((r) => ({
        store: r.店铺,
        site: r.站点,
        adType: r.广告类型,
        currency: "USD",
        attribution: r.归因口径,
        start: r.日期,
        end: r.日期,
        campaign: r.广告活动名称,
        campaignId: r.广告活动ID,
        group: r.广告组名称,
        groupId: r.广告组ID,
        target: r.原投放目标,
        term: r["实际搜索词或商品ASIN"],
        match: r.原匹配方式,
        placement: r.广告位置,
        asin: r.广告ASIN,
        purchasedAsin: r.购买ASIN,
        impressions: r.曝光,
        clicks: r.点击,
        spend: r.花费,
        orders: r.订单,
        sales: r.销售额,
      }));
      const dates = rows.map((r) => r.start).sort();
      s.reports.push({
        id: "legacy-report",
        name: "旧版已导入数据（无原始文件）",
        type: "search",
        rows,
        start: dates[0],
        end: dates.at(-1),
        daily: true,
        seq: 0,
        active: true,
        issues: ["旧版仅保存标准化行，无原文件；请重新上传原始报告以完整追溯"],
        importedAt: old.imports?.at(-1)?.at || "旧版迁移",
      });
    }
    return s;
  }
  async function load() {
    let warning = "";
    try {
      await open();
    } catch {
      warning =
        "IndexedDB 不可用：原文件暂存内存，刷新可能丢失。请导出包含原文件的备份。";
    }
    let s = await get("workspace", "state");
    if (!s) {
      try {
        s = JSON.parse(localStorage.getItem("amazon-workspace-v2"));
      } catch {}
    }
    if (!s) {
      let old;
      try {
        old = JSON.parse(localStorage.getItem("upelf-v1"));
      } catch {}
      s = old ? migrate(old) : seed();
    }
    return { state: s, warning };
  }
  async function listFiles() {
    if (!database) return [...memoryFiles.values()];
    return new Promise((resolve, reject) => {
      const req = database.transaction("files").objectStore("files").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  globalThis.WorkspaceStorage = { load, put, get, listFiles, seed, migrate };
})();
