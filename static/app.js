/* ============================================================
   星海余烬 · EMBERS OF THE STAR SEA · 前端主逻辑 v0.05
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------- 状态 ---------------- */
  const S = {
    data: null,
    session: null,
    view: "map",
    chatNpc: null,
    generating: false,
    marketPrices: null,
    marketSystem: null,
    saveTimer: null,
    loreCat: "history",
    loreSel: null,
    mapSystemPanel: null,   // 当前星图面板展示的星系 id
    mapPlanetPanel: null,   // 当前行星面板展示的行星 id
  };
  const LS_KEY = "starsea_ui";
  let UI = Object.assign({ accent: "#35d6c8", autosave: true, aiUrl: "", aiKey: "", aiModel: "", aiTemp: "0.8" }, safeParse(localStorage.getItem(LS_KEY)));
  const LAST_KEY = "starsea_last_session";

  function safeParse(text) { try { return JSON.parse(text) || {}; } catch (e) { return {}; } }
  function saveUI() { localStorage.setItem(LS_KEY, JSON.stringify(UI)); }
  function applyAccent() { document.documentElement.style.setProperty("--accent", UI.accent); }

  /* ---------------- 工具 ---------------- */
  function toast(message, kind) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = "toast" + (kind === "err" ? " err" : kind === "gold" ? " gold" : "");
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 320); }, 3600);
  }
  function facOf(id) { return (S.data.factions || []).find((f) => f.id === id) || null; }
  function sysOf(id) { return (S.data.systems || []).find((s) => s.id === id) || STARMAP.getSystem(id); }
  function facColor(id) { const f = facOf(id); return f ? f.color : "#7a8494"; }
  function facName(id) { const f = facOf(id); return f ? f.name : "无主星域"; }
  function tierLabel(t) {
    return { capital: "首都", core: "核心星域", hub: "自由枢纽", ruin: "遗迹带", hidden: "隐世", minor: "边缘星系" }[t] || "星系";
  }
  function econLabel(e) {
    return { tech: "科技", agri: "农业", mine: "矿业", forge: "重工", trade: "贸易", military: "军事", slum: "贫民", refuge: "避难", occult: "秘教", ruin: "遗迹", lux: "奢靡", mixed: "综合" }[e] || "综合";
  }
  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seededUnit() {
    const h = hashStr(Array.from(arguments).join("|"));
    return ((h % 100000) / 100000);
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString("zh-CN"); }
  function currentSystem() { return sysOf((S.session.state.location || {}).system); }
  function currentShip() {
    const fleet = S.session.state.fleet || [];
    return fleet[Number(S.session.state.currentShip || 0)] || fleet[0] || null;
  }
  function playerState() { return S.session.state; }
  function dangerDots(n) { return "◆".repeat(Math.max(0, Math.min(5, n || 0))) + "◇".repeat(Math.max(0, 5 - Math.min(5, n || 0))); }

  const TYPE_DESC = {
    gaia: "温带宜居世界，植被与海洋覆盖，是银河最珍贵的殖民目标。",
    ocean: "全球海洋世界，渔业与浮城农业发达，风暴与洋流是这里的王。",
    desert: "荒漠世界，沙海之下埋着矿脉与古河床，白天酷热，夜晚冰寒。",
    jungle: "丛林世界，生态繁盛而危险，每走一步都可能有物种把你当作食物或宿主。",
    ice: "冰封世界，冰壳之下或有液态海洋，淡水冰是它的硬通货。",
    lava: "熔岩世界，地表翻涌着岩浆，矿藏丰富，只有义体与疯子能久留。",
    toxic: "剧毒大气，酸雨常年，殖民地蜷缩在过滤穹顶之内。",
    rad: "强辐射废土，生命在缝隙中变异求生，曦光遗物在此格外活跃。",
    barren: "荒芜岩星，没有大气，没有水，只有灰尘与沉默，以及可能的旧基地。",
    metal: "金属世界，高密度矿核，天然的重工业基地与都市化轨道站的载体。",
    gas: "气态巨星，无法登陆，但轨道上的采气平台昼夜运转，产出燃料与稀有气体。",
  };
  const RES_HINT = {
    gaia: "合成食物、奢侈品", ocean: "净水冰、合成食物", desert: "稀土矿、曦光文物",
    jungle: "医疗凝胶、奢侈品", ice: "净水冰、渊髓", lava: "稀土矿、舰体合金",
    toxic: "医疗凝胶、稀土矿", rad: "曦光文物、渊髓", barren: "数据晶片、曦光文物",
    metal: "舰体合金、义体组件", gas: "渊髓、超导线圈",
  };

  const EVENT_FLAVOR = [
    "航道上漂过一艘无人的货船，舱门大开。你放慢速度观望片刻，最终选择不多管闲事。",
    "弦流余波让船壳嗡嗡作响，仪表盘短暂失灵了半分钟。好在一切恢复如常。",
    "一艘灰潮掠团的侦察艇与你并行了一段航程，见你船小货少，悻悻转向。",
    "路过的小行星带里，拾荒者的信标灯一明一灭，像在向你致意。",
    "心网信号断续，断断续续的歌从通讯器里漏出来——是《归乡》的旋律。",
    "远处的星兽群缓缓掠过航道，如一条发光的河横过你的舷窗。",
    "船上的合成食物机吐出一块发霉的蛋白砖，今天注定是凑合的一天。",
    "你与一艘商盟护航舰擦肩而过，对方礼貌地闪了闪舷灯。",
    "航道监测站发来例行问候，顺带提醒：这条航线最近不太平。",
    "一片旧帝国的残骸带横在前方，你关掉主灯，贴着边缘安静地滑了过去。",
  ];

  /* ---------------- 模态 ---------------- */
  function openModal(html) {
    $("#modal-box").innerHTML = html;
    $("#modal-root").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal-root").classList.add("hidden");
  }

  /* ---------------- 存档 ---------------- */
  function queueSave() {
    if (!S.session) return;
    const el = $("#tb-save-state");
    el.textContent = "保存中…";
    el.classList.add("saving");
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => saveNow(), 700);
  }
  async function saveNow() {
    if (!S.session) return;
    try {
      await fetch("/api/sessions/" + S.session.id + "/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: S.session.state }),
      });
      const el = $("#tb-save-state");
      el.textContent = "已同步";
      el.classList.remove("saving");
    } catch (e) {
      const el = $("#tb-save-state");
      el.textContent = "同步失败";
      el.classList.remove("saving");
    }
  }
  async function createSession(playerName, originId) {
    const resp = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { player_name: playerName, origin: originId } }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "创建失败");
    const payload = await resp.json();
    S.session = payload.session;
    localStorage.setItem(LAST_KEY, S.session.id);
    return S.session;
  }
  async function resumeSession(id) {
    const resp = await fetch("/api/sessions/" + id);
    if (!resp.ok) throw new Error("存档读取失败");
    const payload = await resp.json();
    S.session = payload.session;
    localStorage.setItem(LAST_KEY, id);
  }
  async function deleteSession(id) {
    await fetch("/api/sessions/" + id, { method: "DELETE" });
  }
  async function loadSaveList() {
    const resp = await fetch("/api/sessions");
    const payload = await resp.json();
    return payload.sessions || [];
  }

  /* ---------------- 进入游戏 ---------------- */
  function enterGame() {
    $("#title-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    applyAccent();
    syncMapState();
    const loc = S.session.state.location || {};
    STARMAP.setPlayerLocation(loc.system);
    STARMAP.flyToSystem(loc.system);
    STARMAP.selectSystem(loc.system);
    updateTopbar();
    updateChatNpcOptions();
    renderSystemPanel(sysOf(loc.system));
    switchView("map");
    toast("欢迎来到星海，" + S.session.state.player.name + "。", "gold");
    setTimeout(() => toast("提示：点击星图上的星系查看详情，双击进入星系视图，跃迁消耗燃料（渊髓）。"), 1500);
  }
  function syncMapState() {
    const st = S.session.state;
    STARMAP.setExplored(st.explored || []);
    STARMAP.setPlayerLocation((st.location || {}).system);
  }

  /* ---------------- 顶栏 ---------------- */
  function updateTopbar() {
    const st = S.session.state;
    const p = st.player || {};
    const loc = sysOf((st.location || {}).system);
    const ship = currentShip();
    $("#tb-year").textContent = 3107;
    $("#tb-day").textContent = st.day || 1;
    $("#tb-credits").textContent = fmtNum(p.credits);
    $("#tb-fuel").textContent = fmtNum(st.fuel) + "/" + fmtNum(ship ? ship.fuelCap : 0);
    $("#tb-location").textContent = "⌖ " + (loc ? loc.name : "未知坐标") + ((st.location || {}).planet ? " · 地表" : "");
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(view) {
    S.view = view;
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + view));
    if (view === "map") { setTimeout(() => window.dispatchEvent(new Event("resize")), 30); }
    if (view === "characters") renderCharacters();
    if (view === "lorebook") renderLorebook();
    if (view === "fleet") renderFleet();
    if (view === "market") loadMarket(currentSystem().id);
    if (view === "player") renderPlayer();
    if (view === "settings") renderSettings();
    if (view === "chat") { renderChatHistory(); }
  }

  /* ================================================================
     星图面板
     ================================================================ */
  function laneConnected(aId, bId) {
    if (!S.data) return false;
    return S.data.lanes.some((l) => (l[0] === aId && l[1] === bId) || (l[0] === bId && l[1] === aId));
  }
  function findGate(aId, bId) {
    if (!S.data) return null;
    return S.data.gates.find((g) => (g.a === aId && g.b === bId) || (g.a === bId && g.b === aId)) || null;
  }
  function connectedToCurrent(sysId) {
    const cur = (S.session.state.location || {}).system;
    if (!cur || cur === sysId) return false;
    return laneConnected(cur, sysId) || !!findGate(cur, sysId);
  }
  function jumpCost(sysId) {
    const cur = sysOf((S.session.state.location || {}).system);
    const target = sysOf(sysId);
    const gate = findGate(cur.id, sysId);
    if (gate) return gate.cost;
    const dist = Math.hypot(target.x - cur.x, target.y - cur.y);
    return Math.max(1, Math.round(dist / 110));
  }

  function renderSystemPanel(sys) {
    if (!sys) return;
    const panel = $("#map-system-panel");
    S.mapSystemPanel = sys.id;
    S.mapPlanetPanel = null;
    const st = S.session.state;
    const isExplored = (st.explored || []).includes(sys.id);
    const isCurrent = (st.location || {}).system === sys.id;
    const fac = facOf(sys.faction);
    const planets = sys.planets || [];
    const exploredPlanets = planets.filter((p) => st.planetLog[p.id] && st.planetLog[p.id].scanned);
    let actions = "";
    if (connectedToCurrent(sys.id)) {
      const cost = jumpCost(sys.id);
      actions += '<button class="btn btn-primary" id="msp-jump">跃迁至此（消耗 <b id="msp-jump-cost">' + cost + "</b> 渊髓）</button>";
    }
    if (!isExplored && !isCurrent) {
      actions += '<button class="btn" id="msp-survey">🔭 勘测此星系（30 晶）</button>';
    }
    if (!isCurrent && (st.location || {}).system) {
      actions += '<button class="btn btn-ghost" id="msp-back">⌂ 返回当前位置</button>';
    }
    const planetItems = isExplored
      ? planets.map((p) => {
          const logged = st.planetLog[p.id];
          const img = STARMAP.getPlanetVisualUrl(p);
          return (
            '<div class="planet-item" data-planet="' + p.id + '">' +
            '<div class="planet-dot" style="background-image:url(' + img + ');background-size:cover;"></div>' +
            '<div><div class="pi-name">' + esc(p.name) + "</div>" +
            '<div class="pi-type">' + (p.typeCn || "") + " · " + (p.desc ? "档案" : "未详查") + "</div></div>" +
            (logged && logged.scanned ? '<div class="pi-flag">已扫描</div>' : "") +
            "</div>"
          );
        }).join("")
      : '<div class="empty-note">尚未勘测 · 先勘测星系以扫描行星</div>';
    panel.innerHTML =
      '<div class="msp-head">' +
      '<div class="msp-title"><span class="msp-name">' + esc(sys.name) + '</span><button class="msp-close" id="msp-close">✕</button></div>' +
      '<div class="msp-facrow">' +
      '<span class="fac-tag" style="color:' + facColor(sys.faction) + '">' + facName(sys.faction) + "</span>" +
      '<span class="fac-tag" style="color:#8fa3bd">' + tierLabel(sys.tier) + "</span>" +
      '<span class="fac-tag" style="color:#8fa3bd">' + econLabel(sys.economy) + "经济</span>" +
      (isCurrent ? '<span class="fac-tag" style="color:#e8c95a">当前位置</span>' : "") +
      "</div></div>" +
      '<div class="msp-body">' +
      (sys.notes ? '<div class="msp-note">' + esc(sys.notes) + "</div>" : "") +
      '<div class="msp-rows">' +
      '<div class="msp-row"><span>危险度</span><b class="danger-dots">' + dangerDots(sys.danger) + "</b></div>" +
      '<div class="msp-row"><span>探索状态</span><b>' + (isExplored ? "已勘测" : "未勘测") + "</b></div>" +
      '<div class="msp-row"><span>行星数量</span><b>' + planets.length + "</b></div>" +
      '<div class="msp-row"><span>已扫描行星</span><b>' + exploredPlanets.length + "</b></div>" +
      "</div>" +
      '<div class="msp-section-title">行星系统</div>' +
      '<div class="planet-list">' + planetItems + "</div>" +
      (actions ? '<div class="msp-actions">' + actions + "</div>" : "") +
      "</div>";
    panel.classList.remove("hidden");
    if (isCurrent && !(st.explored || []).includes(sys.id)) {
      // 当前位置必然已勘测
    }
    bindSystemPanel(sys);
  }

  function bindSystemPanel(sys) {
    const panel = $("#map-system-panel");
    $("#msp-close").onclick = () => panel.classList.add("hidden");
    const jumpBtn = $("#msp-jump");
    if (jumpBtn) jumpBtn.onclick = () => doJump(sys.id);
    const surveyBtn = $("#msp-survey");
    if (surveyBtn) surveyBtn.onclick = () => doSurvey(sys.id);
    const backBtn = $("#msp-back");
    if (backBtn) backBtn.onclick = () => {
      const cur = (S.session.state.location || {}).system;
      STARMAP.flyToSystem(cur);
      renderSystemPanel(sysOf(cur));
    };
    $$(".planet-item").forEach((el) => {
      el.onclick = () => {
        const planet = (sys.planets || []).find((p) => p.id === el.dataset.planet);
        if (planet) renderPlanetPanel(sys, planet);
      };
    });
  }

  function doJump(targetId) {
    const st = S.session.state;
    const curId = (st.location || {}).system;
    if (curId === targetId) return;
    if (!connectedToCurrent(targetId)) { toast("没有航道或星门通往该星系。", "err"); return; }
    const cost = jumpCost(targetId);
    const ship = currentShip();
    if ((st.fuel || 0) < cost) { toast("渊髓不足，无法跃迁。可在市场购买燃料。", "err"); return; }
    if (ship && ship.hull <= 0) { toast("船体已损毁，请先在舰队面板维修。", "err"); return; }
    st.fuel -= cost;
    const target = sysOf(targetId);
    const fromId = curId;
    $("#map-system-panel").classList.add("hidden");
    STARMAP.animateTravel(fromId, targetId, 1300, () => {
      st.location.system = targetId;
      st.location.planet = null;
      st.day = (st.day || 1) + 1;
      if (!(st.explored || []).includes(targetId)) st.explored.push(targetId);
      rollArrivalEvent(target);
      addLog("跃迁抵达 " + target.name + "。");
      syncMapState();
      updateTopbar();
      renderSystemPanel(target);
      queueSave();
      toast("已抵达 " + target.name + "（星历第 " + st.day + " 天）", "gold");
    });
  }

  function rollArrivalEvent(target) {
    const st = S.session.state;
    const danger = target.danger || 2;
    const r = seededUnit("arrive", st.day, target.id);
    let text = null;
    if (danger >= 4 && r < 0.32) {
      const pick = Math.floor(r * 10) % 3;
      if (pick === 0) {
        const toll = Math.max(30, Math.round((st.player.credits || 0) * 0.08));
        st.player.credits = Math.max(0, (st.player.credits || 0) - toll);
        text = "灰潮掠团的炮艇拦住了你的航路！对方扫了扫你的货舱，收了一笔 " + toll + " 晶的「过路礼」便放行了。";
      } else if (pick === 1) {
        const ship = currentShip();
        if (ship) { ship.hull = Math.max(0, ship.hull - 10); }
        text = "你冲过一片拾荒潮边缘，几只铁蜂啃掉了舱外的信号灯，船体受损 10 点。";
      } else {
        text = "弦啸在身后炸开，你侥幸贴边穿过，船壳被撕出一道口子。";
        const ship = currentShip();
        if (ship) { ship.hull = Math.max(0, ship.hull - 16); }
      }
    } else if (r < 0.5) {
      text = EVENT_FLAVOR[Math.floor(r * 97) % EVENT_FLAVOR.length];
    } else if (r < 0.62) {
      const gain = 20 + Math.floor(seededUnit("loot", st.day, target.id) * 120);
      st.player.credits = (st.player.credits || 0) + gain;
      text = "航路旁漂浮着一只完好的货箱，你打捞上来，里面装着 " + gain + " 晶的物资。";
    }
    if (text) { addLog(text); toast(text); }
  }

  function doSurvey(sysId) {
    const st = S.session.state;
    if ((st.explored || []).includes(sysId)) return;
    if ((st.player.credits || 0) < 30) { toast("勘测需要 30 晶费用。", "err"); return; }
    st.player.credits -= 30;
    st.explored.push(sysId);
    addLog("勘测了 " + sysOf(sysId).name + " 星系。");
    let loot = "";
    const r = seededUnit("survey", sysId, st.day);
    if (r < 0.4) {
      const gain = 15 + Math.floor(r * 200);
      st.player.credits += gain;
      loot = "扫描途中发现一片矿石富集带，折算 " + gain + " 晶。";
    } else if (r < 0.52) {
      st.cargo = st.cargo || {};
      st.cargo.relic = (st.cargo.relic || 0) + 1;
      loot = "在一处残骸里找到一件曦光文物！已收入货舱。";
    }
    if (loot) { addLog(loot); toast(loot, "gold"); }
    syncMapState();
    renderSystemPanel(sysOf(sysId));
    queueSave();
  }

  function renderPlanetPanel(sys, planet) {
    const panel = $("#map-system-panel");
    S.mapPlanetPanel = planet.id;
    const st = S.session.state;
    const isCurrent = (st.location || {}).system === sys.id;
    const landed = (st.location || {}).planet === planet.id;
    const log = st.planetLog[planet.id] || {};
    const img = STARMAP.getPlanetVisualUrl(planet);
    const desc = planet.desc || (TYPE_DESC[planet.type] || "") + " 主要物产预估：" + (RES_HINT[planet.type] || "未知") + "。";
    const lore = log.lore
      ? '<div class="section-card" style="margin-top:14px"><h3>' + (log.ai ? "AI 生成档案" : "自动勘测档案") + '</h3><div class="msp-note" style="white-space:pre-wrap;margin:0">' + esc(log.lore) + "</div></div>"
      : "";
    panel.innerHTML =
      '<div class="msp-head">' +
      '<div class="msp-title"><span class="msp-name">' + esc(planet.name) + '</span><button class="msp-close" id="msp-close">✕</button></div>' +
      '<div class="msp-facrow">' +
      '<span class="fac-tag" style="color:' + facColor(sys.faction) + '">' + esc(sys.name) + "</span>" +
      '<span class="fac-tag" style="color:#8fa3bd">' + (planet.typeCn || "") + "行星</span>" +
      (landed ? '<span class="fac-tag" style="color:#e8c95a">已登陆</span>' : "") +
      "</div></div>" +
      '<div class="msp-body">' +
      '<div class="planet-visual-wrap"><div class="planet-visual" style="background-image:url(' + img + ');background-size:cover;"></div>' +
      '<div class="msp-note" style="margin:0;flex:1">' + esc(desc) + "</div></div>" +
      (log.scanned ? '<div class="msp-row" style="justify-content:flex-start;gap:8px"><span>轨道扫描</span><b style="color:#7ee08a">已完成</b></div>' : '<div class="msp-row" style="justify-content:flex-start;gap:8px"><span>轨道扫描</span><b style="color:#8fa3bd">未进行</b></div>') +
      lore +
      '<div class="msp-actions">' +
      (isCurrent ? (landed
        ? '<button class="btn btn-ghost" id="msp-leave">⇧ 离开地表</button>'
        : (planet.type === "gas"
            ? '<button class="btn" disabled>气态巨星无法登陆</button>'
            : '<button class="btn btn-primary" id="msp-land">⇩ 登陆地表</button>')) : "") +
      '<button class="btn" id="msp-ai">✦ AI 生成详尽档案</button>' +
      '<button class="btn btn-ghost" id="msp-back-sys">↩ 返回星系</button>' +
      "</div></div>";
    panel.classList.remove("hidden");
    $("#msp-close").onclick = () => panel.classList.add("hidden");
    const backBtn = $("#msp-back-sys");
    if (backBtn) backBtn.onclick = () => renderSystemPanel(sys);
    const landBtn = $("#msp-land");
    if (landBtn) landBtn.onclick = () => {
      st.location.planet = planet.id;
      if (!st.planetLog[planet.id]) st.planetLog[planet.id] = {};
      st.planetLog[planet.id].scanned = true;
      addLog("登陆 " + sys.name + " · " + planet.name + "。");
      updateTopbar();
      renderPlanetPanel(sys, planet);
      queueSave();
      toast("你已登上 " + planet.name + " 的地表。", "gold");
    };
    const leaveBtn = $("#msp-leave");
    if (leaveBtn) leaveBtn.onclick = () => {
      st.location.planet = null;
      updateTopbar();
      renderPlanetPanel(sys, planet);
      queueSave();
    };
    const aiBtn = $("#msp-ai");
    if (aiBtn) aiBtn.onclick = () => generatePlanetLore(sys, planet);
    updateBreadcrumb(sys, planet);
  }

  async function generatePlanetLore(sys, planet) {
    const settings = aiSettings();
    if (!settings.api_url) { toast("请先在「设置 → AI 连接」配置接口。", "err"); switchView("settings"); return; }
    const btn = $("#msp-ai");
    if (btn) { btn.disabled = true; btn.textContent = "✦ 正在生成…"; }
    try {
      const resp = await fetch("/api/planet/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_id: sys.id, planet_id: planet.id, settings }),
      });
      const payload = await resp.json();
      const st = S.session.state;
      if (!st.planetLog[planet.id]) st.planetLog[planet.id] = {};
      st.planetLog[planet.id].scanned = true;
      st.planetLog[planet.id].lore = payload.text;
      st.planetLog[planet.id].ai = !!payload.ai;
      queueSave();
      renderPlanetPanel(sys, planet);
      toast(payload.ai ? "AI 档案已生成。" : "已生成自动勘测档案（接入 AI 后可生成叙事档案）。", payload.ai ? "gold" : undefined);
    } catch (e) {
      toast("生成失败：" + e.message, "err");
      if (btn) { btn.disabled = false; btn.textContent = "✦ AI 生成详尽档案"; }
    }
  }

  function updateBreadcrumb(sys, planet) {
    const bc = $("#map-breadcrumb");
    if (!STARMAP.isSystemMode() && !planet) { bc.classList.add("hidden"); return; }
    bc.classList.remove("hidden");
    bc.innerHTML =
      '<span class="bc-item" id="bc-galaxy">银河全景</span>' +
      (sys ? '<span class="bc-sep">›</span><span class="bc-item" id="bc-sys">' + esc(sys.name) + "</span>" : "") +
      (planet ? '<span class="bc-sep">›</span><span class="bc-cur">' + esc(planet.name) + "</span>" : "");
    $("#bc-galaxy").onclick = () => { STARMAP.exitSystem(); STARMAP.resetView(); updateBreadcrumb(null, null); };
    const bs = $("#bc-sys");
    if (bs) bs.onclick = () => { STARMAP.exitSystem(); renderSystemPanel(sys); updateBreadcrumb(null, null); };
  }

  /* ---------------- 星图初始化 ---------------- */
  function initMap() {
    STARMAP.init($("#map-canvas"), {
      onSystemClick: (sys) => { renderSystemPanel(sys); updateBreadcrumb(null, null); },
      onPlanetClick: (planet) => { renderPlanetPanel(sysOf(S.mapSystemPanel || (S.session.state.location || {}).system), planet); },
      onEnterSystem: (sys) => { renderSystemPanel(sys); updateBreadcrumb(sys, null); },
      onExitSystem: () => { updateBreadcrumb(null, null); },
    });
    STARMAP.loadData({
      factions: S.data.factions,
      systems: S.data.systems,
      lanes: S.data.lanes,
      gates: S.data.gates,
    });
    buildLegend();
    wireMapControls();
  }
  function buildLegend() {
    const el = $("#map-legend");
    const rows = S.data.factions.map((f) =>
      '<div class="lg-row"><span class="lg-dot" style="background:' + f.color + ";color:" + f.color + '"></span>' + f.name + "</div>"
    );
    rows.push('<div class="lg-row"><span class="lg-dot" style="background:#7a8494;color:#7a8494"></span>无主星域</div>');
    rows.push('<div class="lg-row"><span class="lg-dot" style="background:#3c1a22;color:#3c1a22"></span>烬海禁区</div>');
    el.innerHTML = rows.join("");
  }
  function wireMapControls() {
    $("#map-zoom-in").onclick = () => STARMAP.zoomStep(1);
    $("#map-zoom-out").onclick = () => STARMAP.zoomStep(-1);
    $("#map-zoom-home").onclick = () => { STARMAP.goHome(); const cur = sysOf((S.session.state.location || {}).system); if (cur) renderSystemPanel(cur); };
    $("#map-zoom-reset").onclick = () => STARMAP.resetView();
    $$("#map-filters .fchip").forEach((chip) => {
      chip.onclick = () => {
        const name = chip.dataset.filter;
        const on = !chip.classList.contains("active");
        chip.classList.toggle("active", on);
        STARMAP.setFilter(name, on);
      };
    });
    const input = $("#map-search-input");
    const results = $("#map-search-results");
    input.oninput = () => {
      const q = input.value.trim();
      if (q.length < 1) { results.classList.add("hidden"); return; }
      const hits = STARMAP.getSystems()
        .filter((s) => s.name.includes(q) || (s.planets || []).some((p) => p.name.includes(q)))
        .slice(0, 8);
      if (!hits.length) { results.innerHTML = '<div class="msr-item">没有匹配的星系</div>'; results.classList.remove("hidden"); return; }
      results.innerHTML = hits.map((s) =>
        '<div class="msr-item" data-id="' + s.id + '"><span style="color:' + facColor(s.faction) + '">● ' + esc(s.name) + "</span>" +
        '<span class="msr-sub">' + facName(s.faction) + " · " + tierLabel(s.tier) + "</span></div>"
      ).join("");
      results.classList.remove("hidden");
      $$("#map-search-results .msr-item").forEach((item) => {
        item.onclick = () => {
          const sys = sysOf(item.dataset.id);
          STARMAP.exitSystem();
          STARMAP.flyToSystem(sys.id);
          STARMAP.selectSystem(sys.id);
          renderSystemPanel(sys);
          results.classList.add("hidden");
          input.value = "";
          updateBreadcrumb(null, null);
        };
      });
    };
    input.onblur = () => setTimeout(() => results.classList.add("hidden"), 200);
    $("#tb-location").onclick = () => {
      switchView("map");
      const cur = (S.session.state.location || {}).system;
      STARMAP.exitSystem();
      STARMAP.flyToSystem(cur);
      renderSystemPanel(sysOf(cur));
    };
  }

  /* ================================================================
     对话
     ================================================================ */
  function updateChatNpcOptions() {
    const sel = $("#chat-npc-select");
    const chars = S.data.characters;
    let html = '<option value="">✦ 星海之主（旁白叙事）</option>';
    S.data.factions.forEach((f) => {
      const group = chars.filter((c) => c.faction === f.id);
      if (!group.length) return;
      html += '<optgroup label="' + f.name + '">';
      group.forEach((c) => { html += '<option value="' + c.id + '">' + esc(c.name) + " · " + esc(c.title) + "</option>"; });
      html += "</optgroup>";
    });
    const rim = chars.filter((c) => c.faction === "rim");
    if (rim.length) {
      html += '<optgroup label="无主星域">';
      rim.forEach((c) => { html += '<option value="' + c.id + '">' + esc(c.name) + " · " + esc(c.title) + "</option>"; });
      html += "</optgroup>";
    }
    sel.innerHTML = html;
    sel.value = S.chatNpc || "";
  }
  function renderChatHistory() {
    const box = $("#chat-messages");
    const msgs = S.session.messages || [];
    if (!msgs.length) {
      box.innerHTML =
        '<div class="lore-empty" style="margin:12vh auto 0;max-width:560px;line-height:2">' +
        '<div style="font-size:30px;color:#35d6c8;text-shadow:0 0 18px rgba(53,214,200,.6);margin-bottom:10px">✦</div>' +
        "星海之主正在等待你的第一句话。<br>" +
        '<span style="font-size:12px;color:#8fa3bd">先到「设置 → AI 连接」接入任意 OpenAI 兼容接口，<br>然后选择与旁白或某位角色对话——你的行动、台词与抉择，将在这片星海中激起涟漪。</span></div>';
      return;
    }
    box.innerHTML = "";
    msgs.forEach((m) => {
      const meta = typeof m.meta === "string" ? safeParse(m.meta) : (m.meta || {});
      const kind = m.role === "user" ? "user" : (m.name === "星海之主" && !meta.npc ? "narrator" : "assistant");
      appendMessage(kind, m.content, m.name);
    });
    scrollChatBottom();
  }
  function appendMessage(kind, text, name) {
    const box = $("#chat-messages");
    const el = document.createElement("div");
    el.className = "msg msg-" + kind;
    let avatar = kind === "user" ? "✦" : kind === "narrator" ? "❋" : "◈";
    let shownName = kind === "user" ? (S.session.state.player.name || "你") : kind === "narrator" ? "星海之主" : (name || "旅人");
    const char = S.data.characters.find((c) => c.name === name);
    if (char) { avatar = "❖"; }
    el.innerHTML =
      '<div class="msg-avatar" style="' + (char ? "--cc:" + facColor(char.faction) + ";" : "") + '">' + avatar + "</div>" +
      '<div class="msg-body"><div class="msg-name">' + esc(shownName) + '</div><div class="msg-bubble">' + esc(text) + "</div></div>";
    box.appendChild(el);
    scrollChatBottom();
    return el;
  }
  function scrollChatBottom() {
    const box = $("#chat-messages");
    box.scrollTop = box.scrollHeight;
  }
  function showTyping() {
    const box = $("#chat-messages");
    const el = document.createElement("div");
    el.className = "msg msg-narrator msg-typing";
    el.id = "chat-typing";
    el.innerHTML =
      '<div class="msg-avatar">❋</div><div class="msg-body"><div class="msg-name">星海之主</div>' +
      '<div class="msg-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>';
    box.appendChild(el);
    scrollChatBottom();
  }
  function aiSettings() {
    const st = S.session.state;
    const merged = Object.assign({}, st.settings || {}, UI);
    return {
      api_url: merged.aiUrl || merged.api_url || "",
      api_key: merged.aiKey || merged.api_key || "",
      model: merged.aiModel || merged.model || "",
      temperature: merged.aiTemp || merged.temperature || 0.8,
    };
  }
  async function sendChat() {
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text || S.generating) return;
    const settings = aiSettings();
    if (!settings.api_url) { toast("尚未配置 AI：请在「设置 → AI 连接」填写 OpenAI 兼容接口地址。", "err"); switchView("settings"); return; }
    S.generating = true;
    $("#chat-send").disabled = true;
    appendMessage("user", text);
    input.value = "";
    autoGrow(input);
    showTyping();
    const npcId = $("#chat-npc-select").value;
    try {
      const resp = await fetch("/api/sessions/" + S.session.id + "/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, character_id: npcId || null, settings }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "请求失败");
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", acc = "";
      let bubble = null;
      const npc = npcId ? S.data.characters.find((c) => c.id === npcId) : null;
      const kind = npc ? "assistant" : "narrator";
      const name = npc ? npc.name : "星海之主";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let obj;
          try { obj = JSON.parse(payload); } catch (e) { continue; }
          if (obj.error) throw new Error(obj.error);
          if (obj.delta) {
            acc += obj.delta;
            if (!bubble) {
              const typing = document.getElementById("chat-typing");
              if (typing) typing.remove();
              bubble = appendMessage(kind, "", name).querySelector(".msg-bubble");
            }
            bubble.textContent = acc;
            scrollChatBottom();
          }
        }
      }
      const typing = document.getElementById("chat-typing");
      if (typing) typing.remove();
      if (!bubble && acc) appendMessage(kind, acc, name);
      if (!acc) toast("模型返回了空内容。", "err");
    } catch (e) {
      const typing = document.getElementById("chat-typing");
      if (typing) typing.remove();
      toast("对话失败：" + e.message, "err");
    } finally {
      S.generating = false;
      $("#chat-send").disabled = false;
    }
  }
  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(140, ta.scrollHeight) + "px";
  }

  /* ================================================================
     角色
     ================================================================ */
  function renderCharacters() {
    const q = ($("#char-search").value || "").trim();
    const fac = $("#char-faction-filter").value;
    const chars = S.data.characters.filter(
      (c) => (!q || c.name.includes(q) || c.title.includes(q) || (c.tags || []).some((t) => t.includes(q))) && (!fac || c.faction === fac)
    );
    const grid = $("#char-grid");
    grid.innerHTML = chars.map((c) => {
      const color = facColor(c.faction);
      const stats = c.stats || {};
      return (
        '<div class="char-card" data-id="' + c.id + '" style="--cc:' + color + '">' +
        '<div class="cc-top"><div class="cc-avatar">' + (c.name || "?").slice(0, 1) + "</div>" +
        '<div><div class="cc-name">' + esc(c.name) + '</div><div class="cc-title">' + esc(c.title) + "</div></div></div>" +
        '<div class="cc-meta"><span class="cc-tag" style="color:' + color + '">' + facName(c.faction) + "</span>" +
        '<span class="cc-tag">' + esc(c.species || "人类") + "</span>" +
        '<span class="cc-tag">' + esc(c.occupation || "") + "</span></div>" +
        '<div class="cc-brief">' + esc(c.personality || "") + "</div>" +
        '<div class="cc-stats"><div class="cc-stat"><b>' + (stats.combat || 0) + "</b>武</div>" +
        '<div class="cc-stat"><b>' + (stats.wit || 0) + "</b>智</div>" +
        '<div class="cc-stat"><b>' + (stats.charm || 0) + "</b>魅</div>" +
        '<div class="cc-stat"><b>' + (stats.tech || 0) + "</b>技</div>" +
        '<div class="cc-stat"><b>' + (stats.nav || 0) + "</b>航</div></div>" +
        "</div>"
      );
    }).join("");
    $$("#char-grid .char-card").forEach((el) => {
      el.onclick = () => showCharacterModal(S.data.characters.find((c) => c.id === el.dataset.id));
    });
  }
  function showCharacterModal(c) {
    const color = facColor(c.faction);
    const stats = c.stats || {};
    const rels = (c.relationships || []).map((r) => {
      const target = S.data.characters.find((x) => x.id === r.target);
      return target ? esc(target.name) + "：" + esc(r.note) : "";
    }).filter(Boolean);
    openModal(
      '<button class="modal-close" data-close-modal>✕</button>' +
      '<div class="cd-head" style="--cc:' + color + '">' +
      '<div class="cd-avatar">' + esc((c.name || "?").slice(0, 1)) + "</div>" +
      '<div><div class="cd-name">' + esc(c.name) + "</div>" +
      '<div class="cd-sub">' + esc(c.title) + " · " + facName(c.faction) + " · " + esc(c.occupation) + "</div>" +
      '<div class="cd-sub">' + esc(c.species || "人类") + " · " + esc(c.sex || "") + " · " + esc(String(c.age || "?")) + "岁 · 故乡：" + esc(c.homeworld || "不明") + "</div>" +
      '<div class="cd-sub" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + (c.tags || []).map((t) => '<span class="cc-tag">' + esc(t) + "</span>").join("") + "</div></div></div>" +
      '<div class="cd-tabs">' +
      '<button class="cd-tab active" data-tab="bio">档案</button>' +
      '<button class="cd-tab" data-tab="rel">关系</button>' +
      '<button class="cd-tab" data-tab="secret">秘闻</button></div>' +
      '<div class="cd-body" id="cd-body"></div>' +
      '<div class="cd-actions"><button class="btn btn-ghost" data-close-modal>关闭</button>' +
      '<button class="btn btn-primary" id="cd-chat">与她/他对话 ▸</button></div>'
    );
    const body = $("#cd-body");
    const showTab = (tab) => {
      $$(".cd-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      if (tab === "bio") {
        body.innerHTML =
          "<p><span class='k'>外貌</span>" + esc(c.appearance || "") + "</p>" +
          "<p><span class='k'>性格</span>" + esc(c.personality || "") + "</p>" +
          "<p><span class='k'>背景</span>" + esc(c.background || "") + "</p>" +
          "<p><span class='k'>目标</span>" + esc(c.goals || "") + "</p>" +
          "<p><span class='k'>开场白</span>「" + esc(c.greeting || "") + "」</p>" +
          '<p><span class="k">五维</span>武力 ' + (stats.combat || 0) + " · 智略 " + (stats.wit || 0) + " · 魅力 " + (stats.charm || 0) + " · 技术 " + (stats.tech || 0) + " · 航术 " + (stats.nav || 0) + "</p>";
      } else if (tab === "rel") {
        body.innerHTML = rels.length ? rels.map((r) => "<p>" + r + "</p>").join("") : '<p class="lore-empty">暂无公开的关系记录</p>';
      } else {
        body.innerHTML = '<div class="cd-secret">✦ 秘闻：' + esc(c.secret || "这位角色把秘密藏得很好。") + "</div>";
      }
    };
    $$(".cd-tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    showTab("bio");
    $("#cd-chat").onclick = () => {
      closeModal();
      switchView("chat");
      $("#chat-npc-select").value = c.id;
      S.chatNpc = c.id;
      toast("已切换对话对象：" + c.name);
    };
    $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
  }

  /* ================================================================
     世界书
     ================================================================ */
  const CAT_NAMES = {
    history: "编年史", faction: "派系", politics: "政治", culture: "文化",
    economy: "经济", tech: "科技", geography: "地理", species: "物种", danger: "星海危险",
  };
  function renderLorebook() {
    const cats = $("#lore-cats");
    const counts = {};
    S.data.lorebook.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });
    cats.innerHTML = Object.keys(CAT_NAMES).map((k) =>
      '<button class="lore-cat' + (S.loreCat === k ? " active" : "") + '" data-cat="' + k + '">' + CAT_NAMES[k] +
      '<span class="n">' + (counts[k] || 0) + "</span></button>"
    ).join("");
    $$(".lore-cat").forEach((b) => {
      b.onclick = () => {
        S.loreCat = b.dataset.cat;
        S.loreSel = null;
        renderLorebook();
      };
    });
    const q = ($("#lore-search").value || "").trim();
    let entries = S.data.lorebook.filter((e) => (q ? (e.title.includes(q) || e.content.includes(q) || (e.keys || []).some((k) => k.includes(q))) : e.category === S.loreCat));
    if (!S.loreSel && entries.length) S.loreSel = entries[0].id;
    const list = $("#lore-list");
    list.innerHTML = entries.map((e) =>
      '<button class="lore-entry' + (S.loreSel === e.id ? " active" : "") + (e.constant ? " constant" : "") + '" data-id="' + e.id + '">' +
      '<span class="le-mark">✦</span>' + esc(e.title) + "</button>"
    ).join("");
    $$(".lore-entry").forEach((b) => {
      b.onclick = () => {
        S.loreSel = Number(b.dataset.id);
        renderLorebook();
      };
    });
    const detail = $("#lore-detail");
    const sel = S.data.lorebook.find((e) => e.id === S.loreSel);
    if (sel) {
      detail.innerHTML =
        '<div class="ld-cat">' + (CAT_NAMES[sel.category] || sel.category) + (sel.constant ? " · 常驻条目" : "") + "</div>" +
        '<div class="ld-title">' + esc(sel.title) + "</div>" +
        '<div class="ld-content">' + esc(sel.content) + "</div>" +
        '<div class="ld-keys">' + (sel.keys || []).map((k) => '<span class="ld-key">' + esc(k) + "</span>").join("") + "</div>";
    } else {
      detail.innerHTML = '<div class="lore-empty">✦ 选择左侧条目阅读世界书<br><span style="font-size:11px">共 ' + S.data.lorebook.length + " 条 · 全部为原创设定</span></div>";
    }
  }

  /* ================================================================
     舰队
     ================================================================ */
  function renderFleet() {
    const st = S.session.state;
    const sys = currentSystem();
    const shipyard = sys && (["capital", "core"].includes(sys.tier) || ["tech", "forge", "trade", "military"].includes(sys.economy));
    $("#fleet-actions").innerHTML =
      '<button class="btn btn-ghost btn-sm" id="fleet-repair">🔧 维修座舰</button>' +
      (st.location.planet ? "" : "");
    const fleet = st.fleet || [];
    let html = '<div class="fleet-grid">' + fleet.map((s, i) => {
      const active = i === Number(st.currentShip || 0);
      return (
        '<div class="ship-card' + (active ? " active" : "") + '">' +
        '<div class="sc-name">' + (s.custom ? "✧" : "➤") + " " + esc(s.name) + "</div>" +
        '<div class="sc-sub">船员 ' + s.crew + " · 速度 " + s.speed + "</div>" +
        '<div class="sc-bars">' +
        barRow("船体", s.hull, s.hullMax) +
        barRow("护盾", s.shield, s.shieldMax) +
        barRow("货舱", cargoUsed(), s.cargoCap) +
        "</div>" +
        '<div class="sc-foot">' +
        (active ? '<span class="fac-tag" style="color:#35d6c8">使用中</span>' : '<button class="btn btn-xs" data-switch="' + i + '">切换座舰</button>') +
        '<span style="font-size:11px;color:#8fa3bd">武装 ' + s.weapon + "</span></div></div>"
      );
    }).join("") + "</div>";
    html += '<div class="section-card"><h3>船舱货物</h3>' + renderCargoList() + "</div>";
    if (shipyard) {
      const owned = new Set(fleet.map((s) => s.id));
      const buyable = S.data.ships.filter((s) => s.cost > 0);
      html +=
        '<div class="section-card"><h3>船坞（' + esc(sys.name) + "）</h3>" +
        '<div class="fleet-grid">' + buyable.map((s) => {
          const have = owned.has(s.id);
          return (
            '<div class="ship-card" style="opacity:' + (have ? 0.55 : 1) + '">' +
            '<div class="sc-name">➤ ' + esc(s.name) + '</div><div class="sc-sub">' + esc(s.desc) + "</div>" +
            '<div class="sc-bars">' + barRow("船体", s.hull, s.hull) + barRow("护盾", s.shield, s.shield) + barRow("货舱", 0, s.cargo) + "</div>" +
            '<div class="sc-foot"><span style="color:#e8c95a;font-size:13px">◈ ' + fmtNum(s.cost) + " 晶</span>" +
            (have ? '<span class="fac-tag" style="color:#7ee08a">已拥有</span>' : '<button class="btn btn-xs btn-primary" data-buy="' + s.id + '">购入</button>') +
            "</div></div>"
          );
        }).join("") + "</div></div>" +
        '<div class="shipyard-note">船坞仅在首都与工业/贸易星系开放。购入的新船自动加入编队。</div>';
    } else {
      html += '<div class="shipyard-note">当前星系没有船坞。前往首都或工业/贸易星系可购买新船。</div>';
    }
    $("#fleet-content").innerHTML = html;
    $$("[data-switch]").forEach((b) => {
      b.onclick = () => {
        st.currentShip = Number(b.dataset.switch);
        updateTopbar();
        renderFleet();
        queueSave();
        toast("已切换座舰。");
      };
    });
    $$("[data-buy]").forEach((b) => {
      b.onclick = () => buyShip(b.dataset.buy);
    });
    $("#fleet-repair").onclick = doRepair;
  }
  function barRow(label, val, max) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
    return (
      '<div class="sc-bar"><span class="sb-label">' + label + '</span><span class="sb-track"><span class="sb-fill" style="width:' + pct + '%"></span></span>' +
      '<span class="sb-val">' + Math.round(val) + "/" + max + "</span></div>"
    );
  }
  function cargoUsed() {
    const st = S.session.state;
    return Object.values(st.cargo || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  function cargoCap() {
    const ship = currentShip();
    return ship ? ship.cargoCap : 0;
  }
  function renderCargoList() {
    const st = S.session.state;
    const used = cargoUsed();
    const cap = cargoCap();
    let html =
      '<div class="sc-bar" style="margin-bottom:10px"><span class="sb-label">占用</span><span class="sb-track"><span class="sb-fill" style="width:' +
      (cap > 0 ? (used / cap) * 100 : 0) + '%"></span></span><span class="sb-val">' + used + "/" + cap + "</span></div>";
    const entries = Object.entries(st.cargo || {}).filter(([, v]) => v > 0);
    if (!entries.length) return html + '<div class="empty-note">货舱空空如也 · 去市场进点货吧</div>';
    html += '<div class="fleet-grid">' + entries.map(([id, v]) => {
      const com = S.data.commodities.find((c) => c.id === id);
      return (
        '<div class="ship-card"><div class="sc-name">' + (com ? com.icon + " " : "") + (com ? com.name : id) + "</div>" +
        '<div class="sc-sub">数量 ' + fmtNum(v) + " 单位</div></div>"
      );
    }).join("") + "</div>";
    return html;
  }
  function buyShip(shipId) {
    const st = S.session.state;
    const ship = S.data.ships.find((s) => s.id === shipId);
    if (!ship) return;
    if ((st.player.credits || 0) < ship.cost) { toast("资金不足。", "err"); return; }
    st.player.credits -= ship.cost;
    st.fleet.push({
      id: ship.id, name: ship.name, hull: ship.hull, hullMax: ship.hull,
      shield: ship.shield, shieldMax: ship.shield, cargoCap: ship.cargo,
      crew: ship.crew, speed: ship.speed, weapon: ship.weapon, fuelCap: ship.fuel, custom: true,
    });
    st.currentShip = st.fleet.length - 1;
    st.fuel = Math.min(st.fuel, ship.fuel);
    addLog("在" + currentSystem().name + "购入 " + ship.name + "。");
    updateTopbar();
    renderFleet();
    queueSave();
    toast("「" + ship.name + "」已加入编队并设为座舰。", "gold");
  }
  function doRepair() {
    const st = S.session.state;
    const ship = currentShip();
    if (!ship) return;
    const hullNeed = ship.hullMax - ship.hull;
    const shieldNeed = ship.shieldMax - ship.shield;
    if (hullNeed <= 0 && shieldNeed <= 0) { toast("座舰状态完好，无需维修。"); return; }
    const cost = Math.round(hullNeed * 2 + shieldNeed * 1.5);
    if ((st.player.credits || 0) < cost) { toast("维修需要 " + fmtNum(cost) + " 晶。", "err"); return; }
    st.player.credits -= cost;
    ship.hull = ship.hullMax;
    ship.shield = ship.shieldMax;
    addLog("维修了座舰「" + ship.name + "」（" + cost + " 晶）。");
    renderFleet();
    queueSave();
    toast("座舰修复如新。");
  }

  /* ================================================================
     市场
     ================================================================ */
  async function loadMarket(systemId) {
    if (!systemId) return;
    S.marketSystem = systemId;
    const st = S.session.state;
    const sys = sysOf(systemId);
    $("#market-title").textContent = sys.name + " · 市场";
    $("#market-sub").textContent = econLabel(sys.economy) + "经济 · 危险度 " + sys.danger + " · 价格随星系与时日波动（星历第 " + st.day + " 天）";
    try {
      const resp = await fetch("/api/market?system=" + encodeURIComponent(systemId) + "&day=" + st.day);
      const payload = await resp.json();
      S.marketPrices = payload.prices;
      renderMarketTable();
    } catch (e) {
      $("#market-content").innerHTML = '<div class="empty-note">市场数据读取失败</div>';
    }
  }
  function renderMarketTable() {
    const st = S.session.state;
    const coms = S.data.commodities;
    let rows = coms.map((c) => {
      const price = S.marketPrices[c.id] || c.base;
      const held = (st.cargo || {})[c.id] || 0;
      return (
        "<tr>" +
        '<td><span class="com-ico">' + c.icon + "</span>" + c.name + '</td>' +
        '<td class="price-cell">' + price + " 晶" + "</td>" +
        '<td style="color:#8fa3bd;font-size:12px">' + esc(c.desc) + "</td>" +
        '<td style="color:#8fa3bd">' + fmtNum(held) + "</td>" +
        '<td style="text-align:right;white-space:nowrap">' +
        '<button class="qty-btn" data-buy="-5" data-c="' + c.id + '" data-p="' + price + '">-5</button> ' +
        '<button class="qty-btn" data-buy="5" data-c="' + c.id + '" data-p="' + price + '">+5</button> ' +
        '<button class="qty-btn" data-buy="1" data-c="' + c.id + '" data-p="' + price + '">+1</button>' +
        "</td></tr>"
      );
    }).join("");
    const marrowPrice = S.marketPrices.marrow || 320;
    const ship = currentShip();
    const fuelRow =
      "<tr>" +
      '<td><span class="com-ico">◇</span>渊髓燃料（补充 ' + esc(ship ? ship.name : "座舰") + "）</td>" +
      '<td class="price-cell">' + marrowPrice + " 晶/单位</td>" +
      '<td style="color:#8fa3bd;font-size:12px">当前 ' + fmtNum(st.fuel) + " / " + (ship ? ship.fuelCap : 0) + "</td>" +
      '<td style="color:#8fa3bd">—</td>' +
      '<td style="text-align:right"><button class="qty-btn" data-fuel="1" data-p="' + marrowPrice + '">+1</button> <button class="qty-btn" data-fuel="10" data-p="' + marrowPrice + '">+10</button></td>' +
      "</tr>";
    $("#market-content").innerHTML =
      '<table class="market-table"><thead><tr><th>商品</th><th>单价</th><th>说明</th><th>持有</th><th style="text-align:right">交易</th></tr></thead>' +
      "<tbody>" + rows + fuelRow + "</tbody></table>" +
      '<div class="market-note">✦ 买入 +n 为购入并装入货舱；-5 为卖出。货舱上限 ' + (ship ? ship.cargoCap : 0) + "（占用 " + cargoUsed() + "）。价格每日随行就市，不同经济类型的星系各有差价——贸易就是你的第一桶金。</div>";
    $$("[data-buy]").forEach((b) => {
      b.onclick = () => tradeCommodity(b.dataset.c, Number(b.dataset.buy), Number(b.dataset.p));
    });
    $$("[data-fuel]").forEach((b) => {
      b.onclick = () => buyFuel(Number(b.dataset.fuel), Number(b.dataset.p));
    });
    $("#market-jump").onclick = () => { switchView("map"); STARMAP.flyToSystem((S.session.state.location || {}).system); renderSystemPanel(currentSystem()); };
  }
  function tradeCommodity(cid, qty, price) {
    const st = S.session.state;
    st.cargo = st.cargo || {};
    const held = st.cargo[cid] || 0;
    const cap = cargoCap();
    if (qty > 0) {
      const cost = qty * price;
      if ((st.player.credits || 0) < cost) { toast("资金不足。", "err"); return; }
      if (cargoUsed() + qty > cap) { toast("货舱空间不足。", "err"); return; }
      st.player.credits = Math.round(st.player.credits - cost);
      st.cargo[cid] = held + qty;
    } else {
      const sell = Math.min(held, -qty);
      if (sell <= 0) { toast("没有可卖出的存货。", "err"); return; }
      st.cargo[cid] = held - sell;
      st.player.credits = Math.round(st.player.credits + sell * price);
    }
    updateTopbar();
    renderMarketTable();
    queueSave();
  }
  function buyFuel(qty, price) {
    const st = S.session.state;
    const ship = currentShip();
    const cost = qty * price;
    if ((st.player.credits || 0) < cost) { toast("资金不足。", "err"); return; }
    if (ship && st.fuel + qty > ship.fuelCap) { toast("燃料舱已满。", "err"); return; }
    st.player.credits = Math.round(st.player.credits - cost);
    st.fuel += qty;
    updateTopbar();
    renderMarketTable();
    queueSave();
  }

  /* ================================================================
     人物面板
     ================================================================ */
  function renderPlayer() {
    const st = S.session.state;
    const p = st.player || {};
    const origin = S.data.origins.find((o) => o.id === p.origin);
    const ship = currentShip();
    $("#player-name-title").textContent = p.name + (p.title ? " · " + p.title : "");
    $("#player-origin-sub").textContent = (origin ? origin.name : "流浪者") + " · 星海中的自由人";
    const stats = p.stats || {};
    const statRows = [["武力", "combat"], ["智略", "wit"], ["魅力", "charm"], ["技术", "tech"], ["航术", "nav"]]
      .map(([label, key]) =>
        '<div class="stat-row"><span class="sr-label">' + label + '</span><span class="sr-track"><span class="sr-fill" style="width:' + (stats[key] || 0) * 10 + '%"></span></span><span class="sr-val">' + (stats[key] || 0) + "</span></div>"
      ).join("");
    const repEntries = Object.entries(p.rep || {});
    const repRows = repEntries.length
      ? repEntries.map(([fid, v]) => {
          const fac = facOf(fid);
          const pct = Math.min(50, Math.abs(v) * 0.5);
          const color = fac ? fac.color : "#8fa3bd";
          const fillStyle =
            "width:" + pct + "%;" + (v >= 0 ? "left:50%;" : "left:" + (50 - pct) + "%;") + "background:" + color + ";";
          return (
            '<div class="rep-row"><span class="rr-name">' + (fac ? fac.name : fid) + "</span>" +
            '<span class="rr-track"><span class="rr-fill" style="' + fillStyle + '"></span></span>' +
            '<span class="rr-val" style="color:' + (v >= 0 ? "#7ee08a" : "#e08a7e") + '">' + (v > 0 ? "+" : "") + v + "</span></div>"
          );
        }).join("")
      : '<div class="empty-note">尚未与任何势力建立声望</div>';
    const log = (st.log || []).slice().reverse();
    const sysNames = {};
    STARMAP.getSystems().forEach((s) => { sysNames[s.id] = s.name; });
    const localize = (text) => {
      let t = String(text || "");
      Object.keys(sysNames).forEach((id) => { t = t.split(id).join(sysNames[id]); });
      return t;
    };
    const logHtml = log.map((l) => '<div class="log-item"><span class="li-day">D' + l.day + "</span><span class='li-text'>" + esc(localize(l.text)) + "</span></div>").join("");
    const debtHtml = p.debt
      ? '<div class="row"><span>蓝潮贷款</span><b style="color:#e08a7e">欠 ' + fmtNum(p.debt) + " 晶</b></div>" +
        '<div style="text-align:right;margin-top:8px"><button class="btn btn-xs" id="player-pay-debt">还款（全部）</button></div>'
      : "";
    $("#player-content").innerHTML =
      '<div class="player-layout">' +
      '<div class="pcard"><h3>五维属性</h3>' + statRows +
      "<h3 style='margin-top:18px'>阵营声望</h3>" + repRows + "</div>" +
      '<div class="pcard"><h3>身份档案</h3>' +
      '<div class="row"><span>出身</span><b>' + (origin ? origin.icon + " " + origin.name : "流浪者") + "</b></div>" +
      '<div class="row"><span>资金</span><b style="color:#e8c95a">◈ ' + fmtNum(p.credits) + "</b></div>" +
      '<div class="row"><span>座舰</span><b>' + (ship ? ship.name : "无") + "</b></div>" +
      '<div class="row"><span>当前坐标</span><b>' + (currentSystem() ? currentSystem().name : "未知") + "</b></div>" +
      '<div class="row"><span>已勘测星系</span><b>' + (st.explored || []).length + " 个</b></div>" +
      '<div class="row"><span>航行天数</span><b>' + st.day + " 天</b></div>" +
      debtHtml + "</div>" +
      '<div class="pcard"><h3>出身特权</h3><div class="perk-list">' +
      (origin ? origin.perks.map((pk) => '<div class="perk-item">' + esc(pk) + "</div>").join("") : "") +
      "</div></div>" +
      '<div class="pcard" style="grid-column:1/-1"><h3>航程日志</h3><div class="log-list">' + (logHtml || '<div class="empty-note">尚无记录</div>') + "</div></div>" +
      "</div>";
    const pay = $("#player-pay-debt");
    if (pay) pay.onclick = () => {
      if ((p.credits || 0) < p.debt) { toast("资金不足以还清贷款。", "err"); return; }
      p.credits -= p.debt;
      delete p.debt;
      renderPlayer();
      queueSave();
      toast("贷款已结清，蓝潮的账本上你的名字正闪闪发光。", "gold");
    };
  }
  function addLog(text) {
    const st = S.session.state;
    st.log = st.log || [];
    st.log.push({ day: st.day || 1, text });
    if (st.log.length > 200) st.log = st.log.slice(-200);
  }

  /* ================================================================
     设置
     ================================================================ */
  function renderSettings() {
    const st = S.session.state;
    const s = aiSettings();
    const accents = ["#35d6c8", "#e8c95a", "#57b04a", "#8f5fd0", "#e04b3f", "#3f7fe0", "#d98a2b"];
    $("#settings-content").innerHTML =
      '<div class="settings-stack">' +
      '<div class="pcard"><h3>✦ AI 连接（OpenAI 兼容接口）</h3>' +
      '<div class="form-grid2">' +
      formRow("接口地址", '<input id="set-api-url" placeholder="例如 https://api.openai.com/v1">', "填写到 /v1 一级即可，任意支持 /chat/completions 的服务均可。") +
      formRow("模型名称", '<input id="set-model" placeholder="例如 gpt-4o-mini / deepseek-chat / glm-4-flash">', "配置后，对话面板与「AI 生成星球档案」即可使用。") +
      formRow("API 密钥", '<input id="set-api-key" type="password" placeholder="sk-…">', "仅保存在本机存档与浏览器本地，不会上传到别处。") +
      formRow("温度", '<input id="set-temp" type="number" step="0.1" min="0" max="2" value="' + (s.temperature || 0.8) + '">', "预设引擎（文风/防抢话/导演系统）将在后续版本接入。") +
      "</div>" +
      '<div class="form-actions"><button class="btn btn-primary" id="set-test">测试连接</button>' +
      '<button class="btn btn-ghost" id="set-save-ai">保存配置</button>' +
      '<span id="set-test-result" style="font-size:12px;color:#8fa3bd"></span></div></div>' +
      '<div class="settings-grid2">' +
      '<div class="pcard"><h3>✦ 界面</h3>' +
      '<div class="form-row"><label>主题色</label><div class="accent-row">' +
      accents.map((a) => '<div class="accent-dot' + (UI.accent === a ? " active" : "") + '" data-accent="' + a + '" style="background:' + a + ";color:" + a + '"></div>').join("") +
      "</div></div>" +
      '<div class="form-row"><label><input type="checkbox" id="set-autosave" style="width:auto;margin-right:8px"' + (UI.autosave ? " checked" : "") + ">自动存档（改动后 0.7 秒同步）</label></div>" +
      '<div class="form-row"><label>星图迷雾（未勘测的偏远星系仅显示信号）</label>' +
      '<label class="fchip" id="set-fog" style="width:max-content">点击切换：关闭</label></div>' +
      "</div>" +
      '<div class="pcard"><h3>✦ 数据</h3>' +
      '<div class="form-actions" style="flex-wrap:wrap">' +
      '<button class="btn" id="set-clear-chat">清空当前对话上下文</button>' +
      '<button class="btn btn-danger" id="set-clear-saves">删除全部存档</button></div>' +
      '<div class="form-row" style="margin-top:12px"><div class="hint">存档保存在本地 runtime/starsea.db。删除后不可恢复。</div></div></div>' +
      "</div>" +
      '<div class="pcard"><h3>✦ 关于</h3><div class="about-box">' +
      "<b>《星海余烬 · EMBERS OF THE STAR SEA》</b> v" + (S.data.meta.version) + "<br>" +
      "余烬纪元 · 星历 " + (S.data.meta.year) + " · " + esc(S.data.meta.desc) + "<br><br>" +
      "<b>本版内容：</b>可缩放星图（银河→星区→星系→行星）、八大势力与势力范围、54 颗手工星系 + 约 260 颗生成星系、40 位原创角色、80 条原创世界书、8 种出身、舰队与贸易、行星勘测与 AI 档案生成、基础 LLM 对话。<br><br>" +
      "<b>技术：</b>零第三方依赖（Python 标准库 + 原生 JS/Canvas），角色卡与世界书结构兼容酒馆 spec v2。<br><br>" +
      "<b>世界观均为原创</b>：受《沙丘》《星球大战》《银河英雄传说》《群星》《无人深空》《Kenshi》等作品气质启发，但所有势力、人物、事件与术语均为本作原创。" +
      "</div></div></div>";
    $("#set-api-url").value = s.api_url || "";
    $("#set-api-key").value = s.api_key || "";
    $("#set-model").value = s.model || "";
    $("#set-temp").value = s.temperature || 0.8;
    $$(".accent-dot").forEach((d) => {
      d.onclick = () => {
        UI.accent = d.dataset.accent;
        saveUI();
        applyAccent();
        renderSettings();
      };
    });
    $("#set-save-ai").onclick = () => {
      st.settings = st.settings || {};
      st.settings.api_url = $("#set-api-url").value.trim();
      st.settings.api_key = $("#set-api-key").value.trim();
      st.settings.model = $("#set-model").value.trim();
      st.settings.temperature = Number($("#set-temp").value || 0.8);
      UI.aiUrl = st.settings.api_url; UI.aiKey = st.settings.api_key; UI.aiModel = st.settings.model; UI.aiTemp = st.settings.temperature;
      saveUI();
      queueSave();
      toast("AI 配置已保存。", "gold");
    };
    $("#set-test").onclick = async () => {
      const cfg = { api_url: $("#set-api-url").value.trim(), api_key: $("#set-api-key").value.trim(), model: $("#set-model").value.trim() };
      if (!cfg.api_url || !cfg.model) { toast("请先填写接口地址与模型名称。", "err"); return; }
      $("#set-test-result").textContent = "正在测试…";
      try {
        const resp = await fetch("/api/test-connection", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
        });
        const payload = await resp.json();
        if (payload.ok) { $("#set-test-result").innerHTML = '<span style="color:#7ee08a">✓ 连接正常（' + payload.latency + 's）</span>'; }
        else { $("#set-test-result").innerHTML = '<span style="color:#e08a7e">✗ ' + esc(payload.error || "失败") + "</span>"; }
      } catch (e) {
        $("#set-test-result").innerHTML = '<span style="color:#e08a7e">✗ ' + esc(e.message) + "</span>";
      }
    };
    $("#set-autosave").onchange = (ev) => { UI.autosave = ev.target.checked; saveUI(); };
    $("#set-fog").onclick = (ev) => {
      const chip = ev.currentTarget;
      const on = chip.classList.toggle("active");
      chip.textContent = "点击切换：" + (on ? "开启" : "关闭");
      const mapChip = $('.fchip[data-filter="fog"]');
      if (mapChip) mapChip.classList.toggle("active", on);
      STARMAP.setFilter("fog", on);
    };
    $("#set-clear-chat").onclick = async () => {
      try {
        await fetch("/api/sessions/" + S.session.id + "/messages", { method: "DELETE" });
        S.session.messages = [];
        renderChatHistory();
        toast("对话上下文已清空。");
      } catch (e) { toast("操作失败：" + e.message, "err"); }
    };
    $("#set-clear-saves").onclick = async () => {
      openModal(
        '<button class="modal-close" data-close-modal>✕</button>' +
        '<div class="modal-title">⚠ 删除全部存档</div>' +
        '<div class="msp-note">此操作将删除本机所有存档与聊天记录，且无法恢复。确定继续吗？</div>' +
        '<div class="modal-actions"><button class="btn btn-ghost" data-close-modal>取消</button>' +
        '<button class="btn btn-danger" id="confirm-clear">确定删除</button></div>'
      );
      $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
      $("#confirm-clear").onclick = async () => {
        const list = await loadSaveList();
        for (const s of list) { await deleteSession(s.id).catch(() => {}); }
        closeModal();
        toast("全部存档已删除。", "gold");
      };
    };
  }
  function formRow(label, inputHtml, hint) {
    return '<div class="form-row"><label>' + label + "</label>" + inputHtml + (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>";
  }

  /* ================================================================
     标题界面
     ================================================================ */
  async function refreshSaveList() {
    const listEl = $("#save-list");
    const list = await loadSaveList();
    if (!list.length) { listEl.innerHTML = ""; $("#btn-continue").classList.add("hidden"); return; }
    $("#btn-continue").classList.remove("hidden");
    listEl.innerHTML = '<div style="font-size:11px;color:#5b6c86;letter-spacing:.3em;margin-bottom:6px">— 存档 —</div>' +
      list.slice(0, 6).map((s) =>
        '<button class="save-item" data-load="' + s.id + '"><span class="si-name">' + esc(s.title) + "</span>" +
        '<span class="si-meta">' + esc(s.player_name || "") + " · " + (s.location ? sysOf(s.location).name : "?") + "</span>" +
        '<span class="si-del" data-del="' + s.id + '" title="删除存档">✕</span></button>'
      ).join("");
    $$("[data-load]").forEach((el) => {
      el.onclick = async () => {
        try {
          await resumeSession(el.dataset.load);
          enterGame();
        } catch (e) { toast("读取失败：" + e.message, "err"); }
      };
    });
    $$("[data-del]").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        await deleteSession(el.dataset.del);
        refreshSaveList();
        toast("存档已删除。");
      };
    });
  }
  function openNewGameModal() {
    const origins = S.data.origins;
    let selected = "nameless";
    openModal(
      '<button class="modal-close" data-close-modal>✕</button>' +
      '<div class="modal-title">✦ 开启新的航程</div>' +
      '<div class="form-row"><label>你的名字</label><input id="ng-name" placeholder="无名旅人" maxlength="16"></div>' +
      '<div class="form-row"><label>选择出身</label></div>' +
      '<div class="origin-grid" id="ng-grid">' +
      origins.map((o) =>
        '<div class="origin-card' + (o.id === selected ? " selected" : "") + '" data-id="' + o.id + '">' +
        '<div class="oc-name">' + o.icon + " " + esc(o.name) + "</div>" +
        '<div class="oc-desc">' + esc(o.desc) + "</div>" +
        '<div class="oc-meta">◈ ' + fmtNum(o.credits) + " 晶 · 起始：" + esc(sysOf(o.startSystem) ? sysOf(o.startSystem).name : "") + "</div></div>"
      ).join("") + "</div>" +
      '<div class="modal-actions"><button class="btn btn-ghost" data-close-modal>返回</button>' +
      '<button class="btn btn-primary" id="ng-start">✦ 出发</button></div>'
    );
    $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
    $$("#ng-grid .origin-card").forEach((el) => {
      el.onclick = () => {
        selected = el.dataset.id;
        $$("#ng-grid .origin-card").forEach((x) => x.classList.toggle("selected", x.dataset.id === selected));
      };
    });
    $("#ng-start").onclick = async () => {
      const name = ($("#ng-name").value || "").trim() || "无名旅人";
      try {
        await createSession(name, selected);
        closeModal();
        enterGame();
        const origin = S.data.origins.find((o) => o.id === selected);
        toast("出身：" + (origin ? origin.name : "") + " · " + (origin ? origin.perks[0] : ""), "gold");
      } catch (e) {
        toast("创建存档失败：" + e.message, "err");
      }
    };
  }

  /* ================================================================
     背景星空
     ================================================================ */
  function initBgStars() {
    const canvas = $("#bg-stars");
    const ctx = canvas.getContext("2d");
    let stars = [];
    function size() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = [];
      for (let i = 0; i < 220; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.3 + 0.3,
          p: Math.random() * Math.PI * 2,
          s: 0.0004 + Math.random() * 0.0012,
          b: 0.25 + Math.random() * 0.6,
        });
      }
    }
    size();
    window.addEventListener("resize", size);
    let t = 0;
    function tick() {
      t++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const st of stars) {
        const a = st.b * (0.55 + 0.45 * Math.sin(t * st.s * 100 + st.p));
        ctx.fillStyle = "rgba(180,210,255," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    tick();
  }

  /* ================================================================
     启动
     ================================================================ */
  async function boot() {
    initBgStars();
    applyAccent();
    try {
      const resp = await fetch("/api/bootstrap");
      if (!resp.ok) throw new Error("bootstrap " + resp.status);
      S.data = await resp.json();
    } catch (e) {
      toast("无法连接游戏服务器，请确认 server.py 已启动。", "err");
      return;
    }
    $("#title-version").textContent = S.data.meta.version;
    $("#tb-version").textContent = S.data.meta.version;
    $("#title-year").textContent = S.data.meta.year;
    $("#tb-year").textContent = S.data.meta.year;
    // 角色筛选
    const facSel = $("#char-faction-filter");
    facSel.innerHTML = '<option value="">全部势力</option>' +
      S.data.factions.map((f) => '<option value="' + f.id + '">' + f.name + "</option>").join("") +
      '<option value="rim">无主星域</option>';
    facSel.onchange = renderCharacters;
    $("#char-search").oninput = () => { if (S.view === "characters") renderCharacters(); };
    $("#lore-search").oninput = () => { if (S.view === "lorebook") renderLorebook(); };
    initMap();
    // 事件绑定
    $$(".nav-btn[data-view]").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
    $("#tb-brand").onclick = () => switchView("map");
    $("#btn-quick-settings").onclick = () => switchView("settings");
    $("#btn-to-title").onclick = async () => {
      await saveNow();
      $("#app").classList.add("hidden");
      $("#title-screen").classList.remove("hidden");
      refreshSaveList();
    };
    $("#btn-new-game").onclick = openNewGameModal;
    $("#btn-continue").onclick = () => { /* 存档列表已展示 */ };
    $("#btn-title-settings").onclick = () => {
      // 标题界面设置：简化 AI 配置模态
      openModal(
        '<button class="modal-close" data-close-modal>✕</button>' +
        '<div class="modal-title">✦ AI 连接设置</div>' +
        '<div class="form-row"><label>接口地址</label><input id="ts-api-url" value="' + esc(UI.aiUrl || "") + '" placeholder="https://api.openai.com/v1"></div>' +
        '<div class="form-row"><label>API 密钥</label><input id="ts-api-key" type="password" value="' + esc(UI.aiKey || "") + '"></div>' +
        '<div class="form-row"><label>模型名称</label><input id="ts-model" value="' + esc(UI.aiModel || "") + '"></div>' +
        '<div class="form-row"><div class="hint">保存在浏览器本地，进入游戏后也会写入存档。</div></div>' +
        '<div class="modal-actions"><button class="btn btn-ghost" data-close-modal>关闭</button><button class="btn btn-primary" id="ts-save">保存</button></div>'
      );
      $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
      $("#ts-save").onclick = () => {
        UI.aiUrl = $("#ts-api-url").value.trim();
        UI.aiKey = $("#ts-api-key").value.trim();
        UI.aiModel = $("#ts-model").value.trim();
        saveUI();
        closeModal();
        toast("AI 配置已保存。", "gold");
      };
    };
    $("#chat-send").onclick = sendChat;
    $("#chat-input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendChat(); }
    });
    $("#chat-input").addEventListener("input", (ev) => autoGrow(ev.target));
    $("#chat-npc-select").onchange = (ev) => { S.chatNpc = ev.target.value || null; };
    $("#chat-clear").onclick = async () => {
      try {
        await fetch("/api/sessions/" + S.session.id + "/messages", { method: "DELETE" });
        S.session.messages = [];
        renderChatHistory();
        toast("对话上下文已清空。");
      } catch (e) { toast("操作失败：" + e.message, "err"); }
    };
    $("#chat-goto-settings").onclick = () => switchView("settings");
    $("#modal-root").addEventListener("click", (ev) => {
      if (ev.target.hasAttribute("data-close-modal")) closeModal();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeModal();
        $("#map-system-panel").classList.add("hidden");
        if (STARMAP.isSystemMode()) { STARMAP.exitSystem(); updateBreadcrumb(null, null); }
      }
    });
    // 恢复或标题（支持深链 #s=<存档id>&v=<面板>，便于调试与截图）
    await refreshSaveList();
    const hashParams = {};
    (location.hash || "").replace(/^#/, "").split("&").forEach((kv) => {
      const [k, v] = kv.split("=");
      if (k) hashParams[k] = decodeURIComponent(v || "");
    });
    let resumed = false;
    if (hashParams.s) {
      try {
        await resumeSession(hashParams.s);
        resumed = true;
      } catch (e) { resumed = false; }
    }
    if (!resumed) {
      const lastId = localStorage.getItem(LAST_KEY);
      if (lastId) {
        try {
          await resumeSession(lastId);
          resumed = true;
        } catch (e) { /* 存档可能已删 */ }
      }
    }
    if (resumed) {
      enterGame();
      if (hashParams.v && ["map", "chat", "characters", "lorebook", "fleet", "market", "player", "settings"].includes(hashParams.v)) {
        switchView(hashParams.v);
      }
      return;
    }
    $("#title-screen").classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
