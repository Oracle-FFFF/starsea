/* ============================================================
   星海余烬 · EMBERS OF THE STAR SEA · 前端主逻辑 v0.06
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
    mapSystemPanel: null,
    mapPlanetPanel: null,
    driverBusy: false,
    chatTab: "narrator",
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
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 320); }, 3800);
  }
  function facOf(id) { return (S.data.factions || []).find((f) => f.id === id) || null; }
  function facFull(f) { return f ? (f.name + (f.en ? "（" + f.en + "）" : "")) : "无主星域"; }
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
  function currentYear() { return 3107 + Math.floor(((S.session.state.day || 1) - 1) / 360); }
  function currentSystem() { return sysOf((S.session.state.location || {}).system); }
  function currentShip() {
    const fleet = S.session.state.fleet || [];
    return fleet[Number(S.session.state.currentShip || 0)] || fleet[0] || null;
  }
  function playerState() { return S.session.state; }
  function dangerDots(n) { return "◆".repeat(Math.max(0, Math.min(5, n || 0))) + "◇".repeat(Math.max(0, 5 - Math.min(5, n || 0))); }
  function addLog(text) {
    const st = S.session.state;
    st.log = st.log || [];
    st.log.push({ day: Math.round(st.day || 1), text });
    if (st.log.length > 240) st.log = st.log.slice(-240);
  }

  const TYPE_DESC = {
    gaia: "温带宜居世界，植被与海洋覆盖，是银河最珍贵的殖民目标。",
    ocean: "全球海洋世界，渔业与浮城农业发达，风暴与洋流是这里的王。",
    desert: "荒漠世界，沙海之下埋着矿脉与古河床，白天酷热，夜晚冰寒。",
    jungle: "丛林世界，生态繁盛而危险，每走一步都可能有物种把你当作食物或宿主。",
    ice: "冰封世界，冰壳之下或有液态海洋，淡水冰是它的硬通货。",
    lava: "熔岩世界，地表翻涌着岩浆，矿藏丰富，只有义体与疯子能久留。",
    toxic: "剧毒大气，酸雨常年，殖民地蜷缩在过滤穹顶之内。",
    rad: "强辐射废土，生命在缝隙中变异求生，流明遗物在此格外活跃。",
    barren: "荒芜岩星，没有大气，没有水，只有灰尘与沉默，以及可能的旧基地。",
    metal: "金属世界，高密度矿核，天然的重工业基地与都市化轨道站的载体。",
    gas: "气态巨星，无法登陆，但轨道上的采气平台昼夜运转，产出燃料与稀有气体。",
  };
  const RES_HINT = {
    gaia: "合成食物、奢侈品", ocean: "净水冰、合成食物", desert: "稀土矿、流明文物",
    jungle: "医疗凝胶、奢侈品", ice: "净水冰、渊髓", lava: "稀土矿、舰体合金",
    toxic: "医疗凝胶、稀土矿", rad: "流明文物、渊髓", barren: "数据晶片、流明文物",
    metal: "舰体合金、义体组件", gas: "渊髓、超导线圈",
  };

  const EVENT_FLAVOR = [
    "航道上漂过一艘无人的货船，舱门大开。你放慢速度观望片刻，最终选择不多管闲事。",
    "弦流余波让船壳嗡嗡作响，仪表盘短暂失灵了半分钟。好在一切恢复如常。",
    "一艘灰潮侦察艇与你并行了一段航程，见你船小货少，悻悻转向。",
    "路过的小行星带里，拾荒者的信标灯一明一灭，像在向你致意。",
    "心网信号断续，断断续续的歌从通讯器里漏出来——是《归乡》的旋律。",
    "远处的星兽群缓缓掠过航道，如一条发光的河横过你的舷窗。",
    "船上的合成食物机吐出一块发霉的蛋白砖，今天注定是凑合的一天。",
    "你与一艘商盟护航舰擦肩而过，对方礼貌地闪了闪舷灯。",
    "航道监测站发来例行问候，顺带提醒：这条航线最近不太平。",
    "一片旧帝国的残骸带横在前方，你关掉主灯，贴着边缘安静地滑了过去。",
  ];

  /* ---------------- 事件与支线任务模板 ---------------- */
  function maybeLootCargo(st) {
    const r = seededUnit("cargoloot", Math.round(st.day), st.location.system);
    if (r < 0.25) {
      st.cargo = st.cargo || {};
      const cid = ["food", "water", "ore", "chip", "alloy"][Math.floor(r * 40) % 5];
      st.cargo[cid] = (st.cargo[cid] || 0) + 2;
      return "另外还有 2 单位货物被塞进了货舱。";
    }
    return "";
  }
  function rollEventChoice(ev, choiceIdx) {
    const st = S.session.state;
    const choice = ev.choices[choiceIdx];
    let result = "";
    if (choice.quest) {
      const q = choice.quest;
      st.quests = st.quests || [];
      const exist = st.quests.find((x) => x.id === q.id);
      if (!exist) {
        st.quests.push({ id: q.id, title: q.title, type: q.type, target: q.target, n: q.n || 1, reward: q.reward, progress: 0, from: (st.location || {}).system });
        result = "任务已接取：「" + q.title + "」。可在人物面板查看进度。";
      } else {
        result = "这个任务已经在你的清单里了。";
      }
    } else if (choice.effect) {
      result = choice.effect(st);
    } else {
      result = choice.note || "你做出了选择。";
    }
    driverAdd("event", result);
    updateTopbar();
    queueSave();
  }

  const EVENT_POOL = [
    {
      id: "drift-cargo", weight: 3, title: "✦ 漂流货箱",
      desc: "航标附近漂浮着一只完好的货箱，应答器已经沉默。打捞它或许有收获，也可能惹上麻烦。",
      choices: [
        { text: "打捞货箱", effect: (st) => {
            const gain = 40 + Math.floor(seededUnit("drift", Math.round(st.day)) * 180);
            st.player.credits += gain;
            const extra = maybeLootCargo(st);
            return "你花了一个小时把货箱拖进气闸。里面装着价值 " + gain + " 晶的零件。" + extra;
          } },
        { text: "保持距离离开", note: "你让船缓缓绕开。有些箱子，宁可不要。" },
      ],
    },
    {
      id: "distress", weight: 2, title: "✦ 求救信号",
      desc: "通讯器里挤进一段断断续续的求救信号，坐标指向一条废弃航道。",
      choices: [
        { text: "前往救援", effect: (st) => {
            const ok = seededUnit("rescue", Math.round(st.day)) < 0.6 + (st.player.stats.combat || 0) * 0.02;
            if (ok) {
              const gain = 60 + Math.floor(seededUnit("rescue2", Math.round(st.day)) * 120);
              st.player.credits += gain;
              st.player.fame = (st.player.fame || 0) + 1;
              const sys = sysOf((st.location || {}).system);
              if (sys && sys.faction !== "rim") { st.player.rep = st.player.rep || {}; st.player.rep[sys.faction] = (st.player.rep[sys.faction] || 0) + 3; }
              return "你赶到时救生舱氧气只剩四分钟。获救的船主塞给你 " + gain + " 晶，并坚持把你的船号记进港务的恩人簿。";
            }
            const ship = currentShip();
            if (ship) ship.hull = Math.max(0, ship.hull - 8);
            return "那是一个陷阱。伏击者的磁轨炮擦过船壳，你拼尽全力才逃出来。船体受损 8 点。";
          } },
        { text: "转发给附近巡逻队", effect: (st) => {
            st.player.fame = (st.player.fame || 0) + 0.5;
            return "你转发信号后继续航行。巡逻队回电：已出动。你做了正确而安全的选择。";
          } },
      ],
    },
    {
      id: "stowaway", weight: 2, title: "✦ 偷渡客",
      desc: "你在货舱巡检时发现一个藏身的偷渡客——瘦小的孩子，眼里全是惊恐。",
      choices: [
        { text: "收留他，顺路载一程", effect: (st) => {
            st.player.fame = (st.player.fame || 0) + 1;
            return "你让他睡在备用舱。夜里，他把一块糖放在你的控制台上——那是他全部的财产。";
          } },
        { text: "交给港务处", effect: (st) => {
            st.player.credits += 25;
            return "港务处给了 25 晶的安置补偿。孩子被带走时没有回头。";
          } },
        { text: "在下一个港口放他走", note: "你在下一个港口放下了他。他跑进人群前，回头朝你的船鞠了一躬。" },
      ],
    },
    {
      id: "merchant-haul", weight: 2, title: "✦ 货运委托",
      desc: null, // 动态生成
      choices: [
        { text: "接下委托", quest: null },
        { text: "婉拒", note: "你摇了摇头。船期属于自己，你不想被一纸运单拴住。" },
      ],
    },
    {
      id: "survey-order", weight: 2, title: "✦ 勘测委托",
      desc: null,
      choices: [
        { text: "接下委托", quest: null },
        { text: "婉拒", note: "你把委托书推了回去。深空测绘的油水大，风险更大。" },
      ],
    },
    {
      id: "relic-whisper", weight: 1, title: "✦ 遗物的低语",
      desc: "你放在舱里的流明文物突然自己亮了起来，投出一小段缓缓旋转的光纹。",
      choices: [
        { text: "凑近观察光纹", effect: (st) => {
            st.player.fame = (st.player.fame || 0) + 1;
            return "光纹里是一个你从未见过的坐标。它只出现了一瞬，却像烙进了你的记忆。";
          } },
        { text: "把它锁进铅箱", note: "你把它锁了起来。有些光，看见一次就够了。" },
      ],
    },
    {
      id: "grey-patrol", weight: 1, title: "✦ 灰潮巡哨",
      desc: "一支灰潮巡哨艇拦住了去路，探照灯把你的船壳照得雪亮。",
      choices: [
        { text: "交「过路礼」保平安", effect: (st) => {
            const toll = Math.min(st.player.credits, 30 + Math.floor(seededUnit("toll", Math.round(st.day)) * 70));
            st.player.credits -= toll;
            st.player.rep = st.player.rep || {};
            st.player.rep.ash = (st.player.rep.ash || 0) + 2;
            return "你付了 " + toll + " 晶。领头的哨长点点头：「懂规矩。下次报我的名。」";
          } },
        { text: "全速冲过去", effect: (st) => {
            const ok = seededUnit("dash", Math.round(st.day)) < 0.4 + (currentShip() ? currentShip().speed / 400 : 0);
            if (ok) return "你的船一头扎进碎片带，甩掉了追兵。引擎过热警报响了整整十分钟。";
            const ship = currentShip();
            if (ship) ship.hull = Math.max(0, ship.hull - 14);
            return "对方的曳光弹咬上了船尾，你带着 14 点船体损伤逃出生天。";
          } },
      ],
    },
    {
      id: "broker-rolodex", weight: 1, title: "✦ 掮客的通讯录",
      desc: "一个油滑的掮客凑上来，低声说：「大人物的联系方式，星海里最贵的货。看你有缘——便宜卖你一条。」",
      choices: [
        { text: "花 120 晶买一条", effect: (st) => {
            if ((st.player.credits || 0) < 120) return "你摸了摸口袋——还差一点。掮客耸耸肩走开了。";
            st.player.credits -= 120;
            const famous = S.data.characters.filter((c) => isFamous(c) && !contactOf(c.id));
            if (!famous.length) return "掮客翻了翻他的旧册子，摇摇头：「你要找的人，我这没有。」钱没退。";
            const pick = famous[Math.floor(seededUnit("rolodex", Math.round(st.day)) * famous.length)];
            addContact(pick.id);
            return "掮客递来一张皱巴巴的纸条。你取得了 " + pick.name + " 的联系方式。";
          } },
        { text: "不需要", note: "你摆摆手。掮客识趣地退进人群。" },
      ],
    },
  ];

  function randomEvent() {
    // 按权重取一个事件，生成动态描述/任务
    const pool = EVENT_POOL.slice();
    const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
    let r = seededUnit("evpick", Math.round(S.session.state.day), (S.session.state.location || {}).system) * total;
    let ev = pool[0];
    for (const e of pool) { r -= e.weight || 1; if (r <= 0) { ev = e; break; } }
    const st = S.session.state;
    const copy = JSON.parse(JSON.stringify(ev));
    if (copy.id === "merchant-haul") {
      const targets = S.data.systems.filter((s) => s.id !== (st.location || {}).system && s.tier !== "minor");
      const t = targets[Math.floor(seededUnit("haul", Math.round(st.day)) * targets.length)] || S.data.systems[1];
      const reward = 200 + Math.floor(seededUnit("haulr", Math.round(st.day)) * 300);
      copy.desc = "本地商人在星港拦下你：一批急需的货物要运往 " + t.name + "，报酬 " + reward + " 晶，限 30 天内送达。";
      copy.choices[0].quest = { id: "haul-" + Math.round(st.day) + "-" + t.id, title: "货运：运抵 " + t.name, type: "transport", target: t.id, reward, n: 1 };
    }
    if (copy.id === "survey-order") {
      const n = 2 + Math.floor(seededUnit("survn", Math.round(st.day)) * 3);
      const reward = n * 60;
      copy.desc = "星图学会需要有人勘测 " + n + " 个未勘测星系，酬劳 " + reward + " 晶。他们看中了你的船。";
      copy.choices[0].quest = { id: "survey-" + Math.round(st.day), title: "勘测 " + n + " 个未勘测星系", type: "survey", target: null, reward, n };
    }
    return copy;
  }

  /* ---------------- 总故事驱动 ---------------- */
  function driverAdd(kind, text, meta) {
    // 持久化：驱动播报存入存档 state.driverFeed（关闭重开不丢失）
    const st = S.session.state;
    st.driverFeed = st.driverFeed || [];
    const last = st.driverFeed[st.driverFeed.length - 1];
    if (last && last.text === text && last.kind === kind) return null; // 去重：避免刷新后重复入列
    st.driverFeed.push({ kind, text, day: Math.round(st.day || 1), ai: !!(meta && meta.ai), at: Date.now() });
    if (st.driverFeed.length > 200) st.driverFeed = st.driverFeed.slice(-200);
    queueSave();
    const feed = $("#sd-feed");
    if (!feed) return;
    const el = document.createElement("div");
    el.className = "sd-msg sd-" + kind;
    const label = { narrator: "星海之主", event: "事件", big: "银河大事", action: "行动" }[kind] || "记录";
    const src = meta && meta.ai ? " · AI" : " · 本地";
    el.innerHTML =
      '<div class="sd-meta"><span>' + label + src + "</span><span>" +
      (meta && meta.time ? meta.time : "星历 " + currentYear() + " · 第 " + Math.round(st.day || 1) + " 天") + "</span></div>" +
      '<div class="sd-text">' + esc(text) + "</div>";
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
    // 联动：对话面板的星海之主子面板实时同步（与地图驱动器统一）
    if (S.view === "chat" && (S.chatTab || "narrator") === "narrator") renderChatHistory();
    return el;
  }
  function renderDriverFeed() {
    // 读取存档中的驱动播报并渲染（重开存档后恢复）
    const feed = $("#sd-feed");
    if (!feed) return;
    feed.innerHTML = "";
    const items = S.session.state.driverFeed || [];
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "sd-msg sd-" + (item.kind || "event");
      const label = { narrator: "星海之主", event: "事件", big: "银河大事", action: "行动" }[item.kind] || "记录";
      el.innerHTML =
        '<div class="sd-meta"><span>' + label + (item.ai ? " · AI" : "") + '</span><span>第 ' + (item.day || 1) + " 天</span></div>" +
        '<div class="sd-text">' + esc(item.text || "") + "</div>";
      feed.appendChild(el);
    });
    feed.scrollTop = feed.scrollHeight;
  }
  function driverTyping() {
    const feed = $("#sd-feed");
    const el = document.createElement("div");
    el.className = "sd-msg sd-narrator";
    el.id = "sd-typing";
    el.innerHTML = '<div class="sd-meta"><span>星海之主</span></div><div class="sd-text"><span class="sd-typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span></div>';
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
  }
  function driverDone() {
    const t = document.getElementById("sd-typing");
    if (t) t.remove();
  }
  function driverChoices(choices) {
    if (!choices || !choices.length) return;
    const feed = $("#sd-feed");
    const wrap = document.createElement("div");
    wrap.className = "sd-choices";
    choices.forEach((text) => {
      const b = document.createElement("button");
      b.className = "sd-choice";
      b.textContent = "▸ " + text;
      b.onclick = () => {
        driverAdd("action", "你选择： " + text);
        wrap.remove();
        driverAction(text, true);
      };
      wrap.appendChild(b);
    });
    feed.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;
  }
  async function driverCall(kind, text) {
    const settings = aiSettings();
    try {
      const resp = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: S.session.id, kind, text, settings }),
      });
      const payload = await resp.json();
      if (payload.ai && !payload.narration) throw new Error("empty");
      return payload;
    } catch (e) {
      return { ai: false, narration: kind === "arrival" ? "你抵达了新的空域。引航灯在舷窗外缓缓旋转。" : "你照做了。时间在星港的喧嚣中悄悄流逝。", choices: ["继续行动", "打开星图规划航线"], advance_hours: kind === "arrival" ? 1 : 3 };
    }
  }
  function applyPlace(place) {
    const st = S.session.state;
    if (!place || place === st.location.place) return;
    st.location.place = place;
    addLog("来到了 " + place + "。");
    refreshAllSurfaces();
    queueSave();
    // 地点联动：换地方后有小概率触发当地事件
    if (seededUnit("placeev", place, Math.round(st.day)) < 0.22) {
      driverAddEventCard(randomEvent());
    }
  }
  async function driverNarrateArrival(system) {
    if (S.driverBusy) return;
    S.driverBusy = true;
    driverTyping();
    const payload = await driverCall("arrival", "");
    driverDone();
    driverAdd("narrator", payload.narration, { ai: payload.ai });
    driverChoices(payload.choices);
    applyPlace(payload.place);
    advanceTime(payload.advance_hours || 0, true);
    S.driverBusy = false;
  }
  async function driverAction(text, fromChoice) {
    if (S.driverBusy && fromChoice) return;
    const input = $("#sd-input");
    const actionText = text || (input ? input.value.trim() : "");
    if (!actionText) return;
    if (!fromChoice) {
      driverAdd("action", actionText);
      if (input) input.value = "";
    }
    S.driverBusy = true;
    driverTyping();
    const payload = await driverCall("action", actionText);
    driverDone();
    driverAdd("narrator", payload.narration, { ai: payload.ai });
    driverChoices(payload.choices);
    applyPlace(payload.place);
    advanceTime(payload.advance_hours || 0, false);
    S.driverBusy = false;
  }
  function advanceTime(hours, silent) {
    if (!hours) return;
    const st = S.session.state;
    const before = currentYear();
    st.day = Math.max(1, (st.day || 1) + hours / 24);
    const after = currentYear();
    updateTopbar();
    if (!silent && hours >= 20) {
      driverAdd("event", "又一天过去了。舱外，星海沉默地流动。");
    }
    if (after > before) checkTimeline();
    queueSave();
  }
  function driverAddEventCard(ev) {
    const feed = $("#sd-feed");
    const el = document.createElement("div");
    el.className = "event-card";
    el.innerHTML = '<div class="ev-title">' + esc(ev.title) + "</div>" +
      '<div class="ev-desc">' + esc(ev.desc) + "</div>";
    const wrap = document.createElement("div");
    wrap.className = "sd-choices";
    (ev.choices || []).forEach((choice) => {
      const b = document.createElement("button");
      b.className = "sd-choice";
      b.textContent = "▸ " + choice.text;
      b.onclick = () => { el.remove(); rollEventChoice(ev, ev.choices.indexOf(choice)); };
      wrap.appendChild(b);
    });
    el.appendChild(wrap);
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
  }

  /* ---------------- 时间线（银河大事件） ---------------- */
  const TIMELINE_KEYS = { 3120: "black-tide", 3140: "gate-awake", 3200: "lumen-call" };
  function checkTimeline() {
    const st = S.session.state;
    const year = currentYear();
    st.timelineFired = st.timelineFired || [];
    for (const ev of S.data.timeline || []) {
      if (ev.year > year || st.timelineFired.includes(ev.year)) continue;
      st.timelineFired.push(ev.year);
      const effects = ev.effects || {};
      Object.keys(effects).forEach((fid) => {
        st.player.rep = st.player.rep || {};
        st.player.rep[fid] = (st.player.rep[fid] || 0) + effects[fid];
      });
      driverAdd("big", "【星历 " + ev.year + "】" + ev.title + " —— " + ev.desc);
      toast("银河大事：星历 " + ev.year + " · " + ev.title, "gold");
      const key = TIMELINE_KEYS[ev.year];
      if (key) evaluateUnlocks("event:" + key);
    }
    updateTopbar();
    queueSave();
  }

  /* ---------------- 社交判定 ---------------- */
  function charUnlocked(c) {
    const st = S.session.state;
    st.unlocked = st.unlocked || [];
    return c.visibility === "public" || st.unlocked.includes(c.id);
  }
  function isFamous(c) {
    return !!(c.status && c.status.fame >= 60);
  }
  function inParty(cid) {
    return ((S.session.state.party) || []).includes(cid);
  }
  function effLocation(c) {
    return inParty(c.id) ? (S.session.state.location || {}).system : c.location;
  }
  function isNearbyChar(c) {
    return effLocation(c) === (S.session.state.location || {}).system;
  }
  function contactOf(cid) {
    return ((S.session.state.contacts) || []).includes(cid);
  }
  function addContact(cid) {
    const st = S.session.state;
    st.contacts = st.contacts || [];
    if (!st.contacts.includes(cid)) {
      st.contacts.push(cid);
      const c = S.data.characters.find((x) => x.id === cid);
      if (c) driverAdd("event", "通讯录更新：你取得了 " + c.name + (c.en ? "（" + c.en + "）" : "") + " 的联系方式。");
      queueSave();
    }
  }
  function knownChar(c) {
    // 情报页可见性：附近 / 知名 / 已取得联系方式 / 小队 / 已解锁
    if (charUnlocked(c) && c.visibility !== "public") return true;
    if (c.visibility !== "public") return false;
    if (isNearbyChar(c) || isFamous(c) || contactOf(c.id) || inParty(c.id)) return true;
    return false;
  }
  function evaluateUnlocks(reason) {
    const st = S.session.state;
    st.unlocked = st.unlocked || [];
    let newUnlocks = [];
    for (const c of S.data.characters) {
      if (st.unlocked.includes(c.id)) continue;
      const u = c.unlock || {};
      let hit = false;
      if (u.type === "visit" && reason === "visit" && u.system === (st.location || {}).system) hit = true;
      else if (u.type === "rep" && u.faction && ((st.player.rep || {})[u.faction] || 0) >= (u.min || 30)) hit = true;
      else if (u.type === "event" && reason === "event:" + u.event) hit = true;
      if (hit) {
        st.unlocked.push(c.id);
        newUnlocks.push(c);
      }
    }
    if (newUnlocks.length) {
      newUnlocks.forEach((c) => {
        toast("情报解锁：你听说了「" + c.name + "」的名字。", "gold");
        driverAdd("event", "情报更新：星海中多了一个值得注意的名字——" + c.name + (c.en ? "（" + c.en + "）" : "") + "。" + (c.title ? "头衔：" + c.title + "。" : ""));
      });
      updateChatNpcOptions();
      if (S.view === "characters") renderCharacters();
    }
    return newUnlocks.length;
  }
  function playerStatusScore(st) {
    const p = st.player || {};
    const rep = p.rep || {};
    const maxRep = Math.max(0, ...Object.values(rep).map((v) => Number(v) || 0));
    let score = (p.fame || 0) / 25 + maxRep / 12;
    if (p.title) score += 0.8;
    if (p.origin === "noble") score += 0.6;
    return score;
  }
  function refusalChance(c) {
    const tier = (c.status && c.status.tier) || 3;
    const gap = tier - playerStatusScore(S.session.state) - 1;
    if (gap <= 0) return 0.03;
    if (gap === 1) return 0.28;
    return Math.min(0.85, 0.3 + gap * 0.16);
  }
  function affinityOf(cid) {
    const st = S.session.state;
    st.affinity = st.affinity || {};
    if (st.affinity[cid] === undefined) {
      const c = S.data.characters.find((x) => x.id === cid);
      st.affinity[cid] = c ? (c.affinityStart || 0) : 0;
    }
    return st.affinity[cid];
  }
  function chatModeFor(cid) {
    if (!cid) return "narrator";
    const c = S.data.characters.find((x) => x.id === cid);
    if (!c) return "narrator";
    if (inParty(cid) || isNearbyChar(c)) return "near";
    if (contactOf(cid)) return "comms";
    return "none";
  }
  function groupParticipants() {
    return S.data.characters.filter((c) => charUnlocked(c) && (inParty(c.id) || isNearbyChar(c)));
  }
  function chatTabOf(m) {
    const meta = typeof m.meta === "string" ? safeParse(m.meta) : (m.meta || {});
    if (meta.group) return "group";
    if (meta.driver) return "narrator";
    if (meta.npc) return meta.npc;
    return "narrator";
  }
  function updateChatModeBadge() {
    // 兼容旧调用：改用 tab 信息条
    updateChatTabInfo();
  }
  function updateChatTabInfo() {
    const bar = $("#chat-tab-info");
    const badge = $("#chat-mode-badge");
    const input = $("#chat-input");
    if (!bar) return;
    const tab = S.chatTab || "narrator";
    if (input) input.placeholder = tab === "group"
      ? "对身边的人说话…（Enter 发送，Shift+Enter 换行）"
      : "你的行动、台词或指令……（Enter 发送，Shift+Enter 换行）";
    if (tab === "narrator") {
      const s = aiSettings();
      if (badge) { badge.textContent = "故事驱动"; badge.className = "chat-mode-badge"; }
      bar.innerHTML = '<span class="cc-tag">✦ 星海之主 · 旁白与总故事驱动</span>' +
        (s.api_url ? '<span class="cc-tag" style="color:#7ee08a">AI：' + esc(s.model || "") + "</span>" : '<span class="cc-tag" style="color:#e08a7e">本地模板</span>');
      return;
    }
    if (tab === "group") {
      const parts = groupParticipants();
      if (badge) { badge.textContent = "群聊模式"; badge.className = "chat-mode-badge near"; }
      bar.innerHTML = '<span class="cc-tag" style="color:#7ee08a">在场者（可能回应）</span>' +
        (parts.length ? parts.map((c) => '<span class="cc-tag">' + esc(c.name) + "</span>").join("") : '<span class="cc-tag">身边暂时没有人</span>') +
        '<span class="cc-tag" style="color:#8fa3bd">有人会回应，也可能有人不理睬——星海之主会同步摘记</span>';
      return;
    }
    const c = S.data.characters.find((x) => x.id === tab);
    if (!c) { bar.innerHTML = ""; if (badge) badge.textContent = ""; return; }
    const mode = chatModeFor(tab);
    const aff = affinityOf(tab);
    if (badge) {
      badge.textContent = mode === "near" ? (inParty(tab) ? "小队同行 · 实时" : "近身 · 实时对话") : "远程通讯（2 晶/次）";
      badge.className = "chat-mode-badge " + (mode === "near" ? "near" : "comms");
      if (aff > 0) badge.textContent += " · 好感 +" + aff;
    }
    const status = c.status || {};
    const temperament = (c.personality && c.personality.temperament) ? c.personality.temperament : (typeof c.personality === "string" ? c.personality : "");
    bar.innerHTML =
      '<span class="cc-tag" style="color:' + facColor(c.faction) + '">' + facName(c.faction) + "</span>" +
      '<span class="cc-tag">' + esc(c.title) + "</span>" +
      '<span class="cc-tag">地位 ' + (status.tier || "?") + " 阶</span>" +
      '<span class="cc-tag">好感 ' + (aff > 0 ? "+" : "") + aff + "</span>" +
      (charUnlocked(c) ? '<span class="cc-tag">' + esc(c.species || "") + "</span>" : '<span class="rumor-tag">情报不足</span>') +
      '<span class="cc-tag" style="color:#8fa3bd">' + esc(String(temperament).slice(0, 32)) + "</span>" +
      '<button class="btn btn-xs btn-ghost" id="dossier-toggle" style="margin-left:auto">档案' + (S.dossierOpen ? " ▾" : " ▸") + "</button>";
    const toggle = $("#dossier-toggle");
    if (toggle) toggle.onclick = () => {
      S.dossierOpen = !S.dossierOpen;
      renderDossier(tab);
      updateChatTabInfo();
    };
    if (S.dossierOpen) renderDossier(tab);
    else { const d = $("#chat-dossier"); if (d) d.classList.add("hidden"); }
  }
  function renderDossier(tab) {
    const box = $("#chat-dossier");
    if (!box) return;
    const c = S.data.characters.find((x) => x.id === tab);
    if (!c || tab === "narrator" || tab === "group") { box.classList.add("hidden"); return; }
    const status = c.status || {};
    const appearance = c.appearance || {};
    const personality = c.personality || {};
    const physio = c.physiology || {};
    const politics = c.politics || {};
    const aff = affinityOf(tab);
    const item = (k, v, full) =>
      '<div class="cd-item' + (full ? " full" : "") + '"><span class="k">' + k + '</span><span class="v">' + esc(v || "—") + "</span></div>";
    box.innerHTML =
      '<div class="cd-name-row">' + esc(c.name + (c.en ? "（" + c.en + "）" : "")) + " · " + esc(c.title || "") + "</div>" +
      '<div class="cd-grid" style="padding:8px 14px 10px">' +
      item("性别 / 年龄", (c.sex || "?") + " · " + (c.age || "?") + " 岁") +
      item("种族 / 势力", (c.species || "?") + " · " + facName(c.faction)) +
      item("职业 / 故乡", (c.occupation || "?") + " · " + (c.homeworld || "?")) +
      item("地位 / 声望", (status.tier || "?") + " 阶 · 声望 " + (status.fame || 0) + " · 好感 " + (aff > 0 ? "+" : "") + aff) +
      item("外貌", (appearance.height || "") + " · " + (appearance.build || "") + " · " + (appearance.hair || "") + " · " + (appearance.eyes || ""), true) +
      item("特征与衣着", (appearance.features || "") + " · " + (appearance.style || ""), true) +
      item("生理", (physio.speciesNote || "") + "（改造：" + (physio.modifications || "无") + " · 健康：" + (physio.health || "—") + "）", true) +
      item("能力", (c.abilities || []).map((a) => a.name + " Lv." + (a.level || 1)).join("、") || "—", true) +
      item("装备", (c.equipment || []).filter(Boolean).join("、") || "—", true) +
      item("喜好", (personality.likes || []).join("、") || "—", true) +
      item("厌恶 / 恐惧", (personality.dislikes || []).join("、") + "｜" + (personality.fears || []).join("、"), true) +
      item("习惯", (personality.habits || []).join("、") || "—", true) +
      item("性格", personality.temperament || "—", true) +
      item("政治立场", (politics.party || "—") + " · " + (politics.ideology || ""), true) +
      item("目标", ((c.goals && c.goals.short) || "—") + " → " + ((c.goals && c.goals.long) || ""), true) +
      item("口头禅", (c.quotes || []).map((x) => "「" + x + "」").join("　") || "—", true) +
      "</div>";
    box.classList.remove("hidden");
  }

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
    S.session.state.player.fame = S.session.state.player.fame || 0;
    localStorage.setItem(LAST_KEY, S.session.id);
    return S.session;
  }
  async function resumeSession(id) {
    const resp = await fetch("/api/sessions/" + id);
    if (!resp.ok) throw new Error("存档读取失败");
    const payload = await resp.json();
    S.session = payload.session;
    S.session.state.player.fame = S.session.state.player.fame || 0;
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
    updateAiStatus();
    renderDriverFeed();
    renderSystemPanel(sysOf(loc.system));
    switchView("map");
    const startSys = sysOf(loc.system);
    const wake = "你在 " + (startSys ? startSys.name : "未知星域") + " 醒来。旧船的引擎第一次点火，星海就在舷窗之外。";
    // 醒来播报每份存档只入列一次（刷新页面不重复）
    if (!(S.session.state.driverFeed || []).some((e) => e.text === wake)) driverAdd("narrator", wake);
    toast("欢迎来到星海，" + S.session.state.player.name + "。", "gold");
    setTimeout(() => toast("提示：左侧是总故事驱动。跃迁到达、事件与银河大事都会在这里播报，你也可以直接向星海之主描述行动。"), 1400);
    checkTimeline();
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
    $("#tb-year").textContent = currentYear();
    $("#tb-day").textContent = Math.round(st.day || 1);
    $("#tb-credits").textContent = fmtNum(p.credits);
    $("#tb-fuel").textContent = fmtNum(Math.round(st.fuel)) + "/" + fmtNum(ship ? ship.fuelCap : 0);
    $("#tb-location").textContent = "⌖ " + (loc ? loc.name : "未知坐标") +
      ((st.location || {}).place ? " · " + (st.location || {}).place : "") +
      ((st.location || {}).planet ? " · 地表" : "");
  }
  function refreshAllSurfaces() {
    updateTopbar();
    renderChatTabs();
    updateChatTabInfo();
    if (S.view === "chat") renderChatHistory();
    if (S.view === "characters") renderCharacters();
    if (S.view === "player") renderPlayer();
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(view) {
    S.view = view;
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + view));
    if (view === "map") {
      setTimeout(() => {
        STARMAP.refresh();
        const cur = (S.session.state.location || {}).system;
        if (cur) STARMAP.flyToSystem(cur);
      }, 60);
    }
    if (view === "characters") renderCharacters();
    if (view === "lorebook") renderLorebook();
    if (view === "fleet") renderFleet();
    if (view === "market") loadMarket(currentSystem().id);
    if (view === "player") renderPlayer();
    if (view === "settings") renderSettings();
    if (view === "chat") { renderChatTabs(); renderChatHistory(); updateChatTabInfo(); }
  }

  /* ================================================================
     星图面板
     ================================================================ */
  function laneConnected(aId, bId) {
    if (!S.data) return false;
    return STARMAP.isLaneConnected(aId, bId);
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
      '<span class="fac-tag" style="color:' + facColor(sys.faction) + '">' + (fac ? facFull(fac) : "无主星域") + "</span>" +
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
    const firstVisit = !(st.explored || []).includes(targetId);
    $("#map-system-panel").classList.add("hidden");
    STARMAP.animateTravel(fromId, targetId, 1300, () => {
      st.location.system = targetId;
      st.location.planet = null;
      st.location.place = "星港停泊区";
      st.day = (st.day || 1) + 1;
      if (firstVisit) st.explored.push(targetId);
      rollArrivalEvent(target, firstVisit);
      addLog("跃迁抵达 " + target.name + "。");
      syncMapState();
      updateTopbar();
      renderSystemPanel(target);
      evaluateUnlocks("visit");
      checkTimeline();
      checkQuestCompletion();
      refreshAllSurfaces();
      if (firstVisit) {
        driverNarrateArrival(target);
      } else {
        driverAdd("narrator", "你再次停靠在 " + target.name + " 的泊位。熟悉的航道，熟悉的光。");
      }
      queueSave();
      toast("已抵达 " + target.name + "（星历第 " + Math.round(st.day) + " 天）", "gold");
    });
  }

  function maybeNpcApproach(target, firstVisit) {
    const st = S.session.state;
    const candidates = S.data.characters.filter((c) => {
      if (effLocation(c) !== target.id) return false;
      if (!charUnlocked(c)) return false;
      if (inParty(c.id)) return false;
      if (contactOf(c.id) && !firstVisit) return false;
      return true;
    });
    if (!candidates.length) return;
    const chance = firstVisit ? 0.6 : 0.18;
    if (seededUnit("approach", Math.floor(st.day), target.id) > chance) return;
    const c = candidates[Math.floor(seededUnit("approach2", Math.floor(st.day), target.id) * candidates.length)];
    const feed = $("#sd-feed");
    const el = document.createElement("div");
    el.className = "event-card";
    el.innerHTML = '<div class="ev-title">✦ ' + esc(c.name) + " 向你搭话</div>" +
      '<div class="ev-desc">' + esc(c.title) + "：「" + esc(c.greeting || "你看起来面生。") + "」</div>";
    const wrap = document.createElement("div");
    wrap.className = "sd-choices";
    [
      ["回应对方", () => {
        addContact(c.id);
        st.affinity = st.affinity || {};
        if (st.affinity[c.id] === undefined) st.affinity[c.id] = c.affinityStart || 0;
        st.affinity[c.id] = Math.min(100, st.affinity[c.id] + 5);
        driverAdd("event", "你与 " + c.name + " 攀谈了几句。TA 把联系方式给了你，好感 +5。");
        updateChatNpcOptions();
        queueSave();
      }],
      ["点头致意，继续赶路", () => { driverAdd("event", "你点头致意，继续赶路。"); }],
    ].forEach(([text, fn]) => {
      const b = document.createElement("button");
      b.className = "sd-choice";
      b.textContent = "▸ " + text;
      b.onclick = () => { el.remove(); fn(); };
      wrap.appendChild(b);
    });
    el.appendChild(wrap);
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
  }

  function rollArrivalEvent(target, firstVisit) {
    const st = S.session.state;
    const danger = target.danger || 2;
    const r = seededUnit("arrive", Math.floor(st.day), target.id);
    let text = null;
    if (danger >= 4 && r < 0.3) {
      const pick = Math.floor(r * 10) % 3;
      if (pick === 0) {
        const toll = Math.max(30, Math.round((st.player.credits || 0) * 0.08));
        st.player.credits = Math.max(0, (st.player.credits || 0) - toll);
        text = "灰潮的炮艇拦住了你的航路！对方扫了扫你的货舱，收了一笔 " + toll + " 晶的「过路礼」便放行了。";
      } else if (pick === 1) {
        const ship = currentShip();
        if (ship) ship.hull = Math.max(0, ship.hull - 10);
        text = "你冲过一片拾荒潮边缘，几只铁蜂啃掉了舱外的信号灯，船体受损 10 点。";
      } else {
        text = "弦啸在身后炸开，你侥幸贴边穿过，船壳被撕出一道口子。";
        const ship = currentShip();
        if (ship) ship.hull = Math.max(0, ship.hull - 16);
      }
    } else if (r < 0.5) {
      text = EVENT_FLAVOR[Math.floor(r * 97) % EVENT_FLAVOR.length];
    } else if (r < 0.6) {
      const gain = 20 + Math.floor(seededUnit("loot", Math.floor(st.day), target.id) * 120);
      st.player.credits = (st.player.credits || 0) + gain;
      text = "航路旁漂浮着一只完好的货箱，你打捞上来，里面装着 " + gain + " 晶的物资。";
    }
    if (text) { addLog(text); driverAdd("event", text); }
    // 事件卡（到达新地点时概率触发）
    if (firstVisit && seededUnit("evroll", Math.floor(st.day), target.id) < 0.55) {
      driverAddEventCard(randomEvent());
    } else if (seededUnit("evroll2", Math.floor(st.day), target.id) < 0.12) {
      driverAddEventCard(randomEvent());
    }
    maybeNpcApproach(target, firstVisit);
  }

  function doSurvey(sysId) {
    const st = S.session.state;
    if ((st.explored || []).includes(sysId)) return;
    if ((st.player.credits || 0) < 30) { toast("勘测需要 30 晶费用。", "err"); return; }
    st.player.credits -= 30;
    st.explored.push(sysId);
    addLog("勘测了 " + sysOf(sysId).name + " 星系。");
    let loot = "";
    const r = seededUnit("survey", sysId, Math.floor(st.day));
    if (r < 0.4) {
      const gain = 15 + Math.floor(r * 200);
      st.player.credits += gain;
      loot = "扫描途中发现一片矿石富集带，折算 " + gain + " 晶。";
    } else if (r < 0.52) {
      st.cargo = st.cargo || {};
      st.cargo.relic = (st.cargo.relic || 0) + 1;
      loot = "在一处残骸里找到一件流明文物！已收入货舱。";
    }
    if (loot) { addLog(loot); driverAdd("event", loot); }
    (st.quests || []).forEach((q) => { if (q.type === "survey") q.progress += 1; });
    checkQuestCompletion();
    syncMapState();
    renderSystemPanel(sysOf(sysId));
    queueSave();
    updateTopbar();
  }

  function checkQuestCompletion() {
    const st = S.session.state;
    if (!st.quests || !st.quests.length) return;
    const done = [];
    st.quests = st.quests.filter((q) => {
      let complete = false;
      if (q.type === "transport" && q.target === (st.location || {}).system) complete = true;
      if (q.type === "survey" && q.progress >= q.n) complete = true;
      if (complete) done.push(q);
      return !complete;
    });
    done.forEach((q) => {
      st.player.credits = (st.player.credits || 0) + (q.reward || 0);
      st.player.fame = (st.player.fame || 0) + 1;
      addLog("完成委托：「" + q.title + "」，获得 " + q.reward + " 晶。");
      driverAdd("event", "✦ 委托完成：「" + q.title + "」。报酬 " + q.reward + " 晶已汇入你的账户。");
      toast("委托完成，+" + q.reward + " 晶", "gold");
    });
    if (done.length) { updateTopbar(); queueSave(); }
  }

  function corePlanetOf(sys, planet) {
    return (S.data.planet_core || []).find((p) => p.system === sys.id && p.planet === planet.id) || null;
  }
  function planetProfileOf(sys, planet) {
    const core = corePlanetOf(sys, planet);
    if (core) return { profile: core, source: "core", core: true };
    const log = S.session.state.planetLog[planet.id] || {};
    if (log.profile) return { profile: log.profile, source: log.source || "generated", core: false, ai: !!log.ai };
    return null;
  }
  function profileBlock(sys, planet, found) {
    const p = found.profile;
    const badge = found.core
      ? '<span class="fac-tag" style="color:#e8c95a">世界书 · 固定大纲</span>'
      : found.ai
        ? '<span class="fac-tag" style="color:#7ee08a">AI 生成 · 已存入本存档</span>'
        : '<span class="fac-tag" style="color:#7fb8e8">自动生成 · 已存入本存档</span>';
    const items = [
      ["气候", p.climate], ["经济", p.economy], ["政治", p.politics],
      ["文化", p.culture], ["种族", p.species], ["资源", p.resources],
    ];
    let html =
      '<div class="section-card" style="margin-top:14px"><h3 style="display:flex;align-items:center;gap:8px">行星档案 ' + badge + "</h3>" +
      '<div class="cd-grid">' +
      items.map(([k, v]) => '<div class="cd-item"><span class="k">' + k + '</span><span class="v">' + esc(v || "—") + "</span></div>").join("") +
      (p.overview ? '<div class="cd-item full"><span class="k">综述</span><span class="v">' + esc(p.overview) + "</span></div>" : "") +
      "</div></div>";
    // 登录区域
    const st = S.session.state;
    const isCurrent = (st.location || {}).system === sys.id;
    const landedRegion = (st.planetLog[planet.id] || {}).landedRegion;
    html += '<div class="section-card"><h3>可登录区域（选择具体登陆地点）</h3><div class="region-list">' +
      (p.regions || []).map((r) => {
        const here = landedRegion === r.id;
        const gas = planet.type === "gas";
        return (
          '<div class="region-item">' +
          '<div class="ri-main"><div class="ri-name">' + esc(r.name) + " <span class='ri-type'>" + esc(r.type || "区域") + "</span>" +
          '<span class="danger-dots" style="margin-left:6px">' + dangerDots(r.danger || 2) + "</span></div>" +
          '<div class="ri-desc">' + esc(r.desc || "") + "</div>" +
          '<div class="ri-tags">' + (r.tags || []).map((t) => "<span class='cc-tag'>" + esc(t) + "</span>").join("") + "</div></div>" +
          (here
            ? '<span class="fac-tag" style="color:#e8c95a">已在此登陆</span>'
            : gas
              ? '<span class="fac-tag" style="color:#8fa3bd">气态巨星无法登陆</span>'
              : isCurrent
                ? '<button class="btn btn-xs btn-primary" data-land-region="' + r.id + '">⇩ 登陆此处</button>'
                : '<span class="fac-tag" style="color:#8fa3bd">需先抵达本星系</span>') +
          "</div>"
        );
      }).join("") + "</div></div>";
    return html;
  }

  function renderPlanetPanel(sys, planet) {
    const panel = $("#map-system-panel");
    S.mapPlanetPanel = planet.id;
    const st = S.session.state;
    const isCurrent = (st.location || {}).system === sys.id;
    const landed = (st.location || {}).planet === planet.id;
    const img = STARMAP.getPlanetVisualUrl(planet);
    const desc = planet.desc || (TYPE_DESC[planet.type] || "") + " 主要物产预估：" + (RES_HINT[planet.type] || "未知") + "。";
    const found = planetProfileOf(sys, planet);
    const log = st.planetLog[planet.id] || {};
    panel.innerHTML =
      '<div class="msp-head">' +
      '<div class="msp-title"><span class="msp-name">' + esc(planet.name) + '</span><button class="msp-close" id="msp-close">✕</button></div>' +
      '<div class="msp-facrow">' +
      '<span class="fac-tag" style="color:' + facColor(sys.faction) + '">' + esc(sys.name) + "</span>" +
      '<span class="fac-tag" style="color:#8fa3bd">' + (planet.typeCn || "") + "行星</span>" +
      (landed ? '<span class="fac-tag" style="color:#e8c95a">已登陆</span>' : "") +
      (log.scanned ? '<span class="fac-tag" style="color:#7ee08a">已勘测</span>' : "") +
      "</div></div>" +
      '<div class="msp-body">' +
      '<div class="planet-visual-wrap"><div class="planet-visual" style="background-image:url(' + img + ');background-size:cover;"></div>' +
      '<div class="msp-note" style="margin:0;flex:1">' + esc(desc) + "</div></div>" +
      (found ? profileBlock(sys, planet, found)
        : '<div class="section-card" style="margin-top:14px"><h3>未建立档案</h3>' +
          '<div class="msp-note" style="margin:0">这颗行星尚未建立结构化档案。生成后（气候/经济/政治/文化/种族/资源 + 登录区域）将存入当前存档，同存档不重复生成，不同存档各自独立。</div>' +
          '<div class="msp-actions"><button class="btn btn-primary" id="msp-ai">✦ 生成行星档案</button></div></div>') +
      '<div class="msp-actions">' +
      (landed ? '<button class="btn btn-ghost" id="msp-leave">⇧ 离开地表</button>' : "") +
      '<button class="btn btn-ghost" id="msp-back-sys">↩ 返回星系</button>' +
      "</div></div>";
    panel.classList.remove("hidden");
    $("#msp-close").onclick = () => panel.classList.add("hidden");
    const backBtn = $("#msp-back-sys");
    if (backBtn) backBtn.onclick = () => renderSystemPanel(sys);
    const leaveBtn = $("#msp-leave");
    if (leaveBtn) leaveBtn.onclick = () => {
      st.location.planet = null;
      updateTopbar();
      renderPlanetPanel(sys, planet);
      queueSave();
    };
    const aiBtn = $("#msp-ai");
    if (aiBtn) aiBtn.onclick = () => generatePlanetLore(sys, planet);
    $$("[data-land-region]").forEach((b) => {
      b.onclick = () => {
        const region = (found.profile.regions || []).find((r) => r.id === b.dataset.landRegion);
        if (region) landingTransition(sys, planet, region);
      };
    });
    updateBreadcrumb(sys, planet);
  }

  const LANDING_SCENE_TMPL = {
    gaia: "穿梭机穿过云层，降落在一片开阔的接驳坪上。舱门开启，湿润的植被气息扑面而来。",
    ocean: "水上穿梭机贴着浪尖滑行，最终泊入浮城的气闸。海水拍打着舷梯，咸味钻进舱内。",
    desert: "着陆架陷进滚烫的沙地，沙尘顺着舱门灌进来。远处，热浪把地平线折成锯齿。",
    jungle: "舱门打开时，藤蔓几乎要探进机舱。雨林的湿热与虫鸣像一堵墙，瞬间把你包围。",
    ice: "破冰着陆的声音像一声闷雷。极地的风灌进舱门，呼出的气立刻凝成白雾。",
    lava: "隔热舷梯放下时，热浪隔着防护服都能感到灼痛。大地在这里是活的，缓缓起伏。",
    toxic: "气闸循环了三遍才放行。舱外，酸雨在穹顶外壁上敲出细密的沙沙声。",
    rad: "辐射计在舱门打开的瞬间尖啸起来。你紧了紧防护服，迈向这片泛着绿光的荒原。",
    barren: "着陆扬起的灰尘缓缓飘散，四周安静得能听见自己面罩里的呼吸声。",
    metal: "磁力着陆架「咔嗒」一声咬住金属地表，矿脉在星光下泛着冷光。",
    gas: "对接臂缓缓收紧，你通过舷梯进入悬浮在云顶的采气平台。",
  };
  const LANDING_EVENTS = [
    {
      id: "guide", title: "✦ 向导揽客",
      desc: "刚走出接驳坪，几个向导就围了上来，拍着胸脯保证带你「安全穿过这片地界」。",
      choices: [
        { text: "雇佣一名向导（20 晶）", effect: (st) => {
            if ((st.player.credits || 0) < 20) return "你摸了摸口袋——还不够向导的开价。他们一哄而散。";
            st.player.credits -= 20;
            st.player.fame = (st.player.fame || 0) + 0.5;
            return "向导带你抄了近路，顺口讲了不少本地的门道。你觉得自己对这地方没那么陌生了。";
          } },
        { text: "婉拒，自己走", note: "你谢绝了向导，独自走进陌生的街巷。路要自己走，麻烦也是。" },
      ],
    },
    {
      id: "market-riot", title: "✦ 集市骚动",
      desc: "前方集市突然一阵骚动，有人尖叫，货摊被撞翻，人群像潮水一样涌来。",
      choices: [
        { text: "挤过去看看", effect: (st) => {
            const r = seededUnit("riot", Math.round(st.day), (st.location || {}).system);
            if (r < 0.5) {
              const gain = 10 + Math.floor(r * 60);
              st.player.credits += gain;
              return "混乱中你捡起一只被撞落的钱袋，里面装着 " + gain + " 晶。";
            }
            st.player.credits = Math.max(0, st.player.credits - 15);
            return "你被推挤的人群撞了个趔趄，回过神时口袋少了 15 晶。";
          } },
        { text: "绕道而行", note: "你拐进小巷绕开了骚动。有些热闹，不看也罢。" },
      ],
    },
    {
      id: "inspection", title: "✦ 例行稽查",
      desc: "两名穿制服的稽查员拦住了你，要求检查随行物品与入境许可。",
      choices: [
        { text: "配合检查", effect: (st) => {
            st.player.fame = (st.player.fame || 0) + 0.5;
            return "你配合完成了检查。稽查员核对无误后放行，还提醒你注意当地的宵禁时间。";
          } },
        { text: "塞 30 晶「加快流程」", effect: (st) => {
            if ((st.player.credits || 0) < 30) return "你没能掏出那笔钱。稽查员多看了你几眼，还是放行了。";
            st.player.credits -= 30;
            return "钱递过去，流程果然快了。稽查员收好晶币，连箱子都没打开。";
          } },
      ],
    },
    {
      id: "miner-sos", title: "✦ 矿工的求救",
      desc: "一个满身煤灰的矿工拦住你，说塌方堵住了矿道，里面还有人。",
      choices: [
        { text: "帮忙救人", effect: (st) => {
            const ok = seededUnit("mine", Math.round(st.day), (st.location || {}).system) < 0.55 + (st.player.stats.tech || 0) * 0.03;
            if (ok) {
              st.player.fame = (st.player.fame || 0) + 1;
              const gain = 30 + Math.floor(seededUnit("mine2", Math.round(st.day)) * 90);
              st.player.credits += gain;
              return "你用船上的切割器破开了碎石。获救的矿工们凑了 " + gain + " 晶塞给你。";
            }
            const ship = currentShip();
            if (ship) ship.hull = Math.max(0, ship.hull - 6);
            return "救人时一块碎石砸坏了你的护甲，船体受损 6 点——但人救出来了。";
          } },
        { text: "报警后离开", note: "你报了警，把位置告诉了赶来的救援队，然后继续赶路。" },
      ],
    },
    {
      id: "ground-tremor", title: "✦ 地面震动",
      desc: "脚下的地面忽然震动起来，货架摇晃，一只杯子从桌上摔碎。",
      choices: [
        { text: "观察震源方向", effect: (st) => {
            const r = seededUnit("quake", Math.round(st.day), (st.location || {}).system);
            if (r < 0.45) {
              const gain = 20 + Math.floor(r * 80);
              st.player.credits += gain;
              return "震动过后，你在裂缝里发现了一处裸露的矿脉，顺手采了些样品，折算 " + gain + " 晶。";
            }
            return "你记下了震源方向。本地人见怪不怪，说「这里的地，每七天抖一次」。";
          } },
        { text: "找掩体躲避", note: "你躲进坚固的门廊下。震动很快过去，只有灰尘缓缓飘落。" },
      ],
    },
    {
      id: "scav-stall", title: "✦ 拾荒者摊位",
      desc: "路边有个拾荒者摆的摊子，货物五花八门，标价低得可疑。",
      choices: [
        { text: "挑件便宜货（10 晶）", effect: (st) => {
            if ((st.player.credits || 0) < 10) return "你翻看了一番，还是放下了——先顾好眼前的路费。";
            st.player.credits -= 10;
            st.cargo = st.cargo || {};
            const cid = ["food", "chip", "med", "ore", "alloy"][Math.floor(seededUnit("stall", Math.round(st.day)) * 5)];
            st.cargo[cid] = (st.cargo[cid] || 0) + 1;
            return "你花 10 晶买下了一件来路不明的小玩意，塞进了货舱。";
          } },
        { text: "只看不买", note: "你看了看就走了。便宜货背后的故事，往往更贵。" },
      ],
    },
  ];
  function rollLandingEvent(planet, region) {
    const st = S.session.state;
    const log = st.planetLog[planet.id] || {};
    log.visitedRegions = log.visitedRegions || [];
    const firstHere = !log.visitedRegions.includes(region.id);
    if (firstHere) log.visitedRegions.push(region.id);
    // 当地 NPC 遭遇（该系统内的已知角色，首次到访该区域时概率更高）
    const sysId = (st.location || {}).system;
    const locals = S.data.characters.filter((c) => effLocation(c) === sysId && charUnlocked(c) && !inParty(c.id));
    if (locals.length && (firstHere ? seededUnit("npcland", sysId, region.id, Math.round(st.day)) < 0.5 : seededUnit("npcland2", sysId, region.id, Math.round(st.day)) < 0.15)) {
      const c = locals[Math.floor(seededUnit("npcland3", sysId, region.id, Math.round(st.day)) * locals.length)];
      const feed = $("#sd-feed");
      const el = document.createElement("div");
      el.className = "event-card";
      el.innerHTML = '<div class="ev-title">✦ 在' + esc(region.name) + "遇见 " + esc(c.name) + "</div>" +
        '<div class="ev-desc">' + esc(c.title) + "也在这一带出没：" + esc(c.greeting || "「你看起来面生。」") + "</div>";
      const wrap = document.createElement("div");
      wrap.className = "sd-choices";
      [
        ["上前交谈", () => {
          addContact(c.id);
          st.affinity = st.affinity || {};
          if (st.affinity[c.id] === undefined) st.affinity[c.id] = c.affinityStart || 0;
          st.affinity[c.id] = Math.min(100, st.affinity[c.id] + 5);
          driverAdd("event", "你与 " + c.name + " 交谈了几句，取得了 TA 的联系方式，好感 +5。");
          updateChatNpcOptions();
          queueSave();
        }],
        ["远远绕开", () => { driverAdd("event", "你压了压帽檐，绕开了对方。有些人，还是等准备好了再见面。" ); }],
      ].forEach(([text, fn]) => {
        const b = document.createElement("button");
        b.className = "sd-choice";
        b.textContent = "▸ " + text;
        b.onclick = () => { el.remove(); fn(); };
        wrap.appendChild(b);
      });
      el.appendChild(wrap);
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
      return;
    }
    // 通用登陆事件
    if (seededUnit("landev", sysId, region.id, Math.round(st.day)) < 0.7) {
      const pool = LANDING_EVENTS.slice();
      const ev = pool[Math.floor(seededUnit("landev2", sysId, region.id, Math.round(st.day)) * pool.length)];
      const copy = JSON.parse(JSON.stringify(ev));
      const feed = $("#sd-feed");
      const el = document.createElement("div");
      el.className = "event-card";
      el.innerHTML = '<div class="ev-title">' + esc(copy.title) + "</div><div class='ev-desc'>" + esc(copy.desc) + "</div>";
      const wrap = document.createElement("div");
      wrap.className = "sd-choices";
      copy.choices.forEach((choice) => {
        const b = document.createElement("button");
        b.className = "sd-choice";
        b.textContent = "▸ " + choice.text;
        b.onclick = () => {
          el.remove();
          const result = choice.effect ? choice.effect(st) : (choice.note || "你做出了选择。");
          driverAdd("event", result);
          updateTopbar();
          queueSave();
        };
        wrap.appendChild(b);
      });
      el.appendChild(wrap);
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
    }
  }
  function landingTransition(sys, planet, region) {
    const st = S.session.state;
    st.location.planet = planet.id;
    if (!st.planetLog[planet.id]) st.planetLog[planet.id] = {};
    st.planetLog[planet.id].scanned = true;
    st.planetLog[planet.id].landedRegion = region.id;
    addLog("登陆 " + sys.name + " · " + planet.name + "（" + region.name + "）。");
    // 地点联动：登陆点同步为当前地点，聊天面板/群聊在场者随之刷新
    st.location.place = region.name;
    refreshAllSurfaces();
    // 过场：消耗时间 + 场景叙事
    advanceTime(6, true);
    const scene = LANDING_SCENE_TMPL[planet.type] || LANDING_SCENE_TMPL.barren;
    driverAdd("narrator", scene + "\n你选择了「" + region.name + "」作为登陆点。");
    rollLandingEvent(planet, region);
    updateTopbar();
    renderPlanetPanel(sys, planet);
    queueSave();
    toast("你已登陆 " + planet.name + " · " + region.name + "（航行 +6 小时）", "gold");
  }

  async function generatePlanetLore(sys, planet) {
    const settings = aiSettings();
    const btn = $("#msp-ai");
    if (btn) { btn.disabled = true; btn.textContent = "✦ 正在生成…"; }
    try {
      const resp = await fetch("/api/planet/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: S.session.id,
          system_id: sys.id,
          planet_id: planet.id,
          system_name: sys.name || "",
          system_notes: sys.notes || "",
          system_faction: sys.faction || "rim",
          system_economy: sys.economy || "mixed",
          system_danger: sys.danger || 2,
          planet_name: planet.name || "",
          planet_type: planet.type || "barren",
          planet_desc: planet.desc || "",
          settings,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast("档案生成失败：" + (payload.error || ("HTTP " + resp.status)), "err");
        if (btn) { btn.disabled = false; btn.textContent = "✦ 生成行星档案"; }
        return;
      }
      const st = S.session.state;
      if (!st.planetLog[planet.id]) st.planetLog[planet.id] = {};
      st.planetLog[planet.id].scanned = true;
      st.planetLog[planet.id].profile = payload.profile;
      st.planetLog[planet.id].source = payload.source || "generated";
      st.planetLog[planet.id].ai = !!payload.ai;
      queueSave();
      renderPlanetPanel(sys, planet);
      if (payload.ai) {
        toast("AI 档案已生成并存入本存档。", "gold");
      } else {
        toast(payload.error
          ? "AI 生成失败（" + payload.error.slice(0, 60) + "）——已按势力/类型生成确定性档案并存入本存档。"
          : "已生成确定性档案并存入本存档（接入 AI 后可获得更生动的版本）。", payload.error ? "err" : undefined);
      }
    } catch (e) {
      toast("生成失败：" + e.message, "err");
      if (btn) { btn.disabled = false; btn.textContent = "✦ 生成行星档案"; }
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
      '<div class="lg-row"><span class="lg-dot" style="background:' + f.color + ";color:" + f.color + '"></span>' + esc(f.name) + " " + esc(f.en || "") + "</div>"
    );
    rows.push('<div class="lg-row"><span class="lg-dot" style="background:#7a8494;color:#7a8494"></span>无主星域</div>');
    rows.push('<div class="lg-row"><span class="lg-dot" style="background:#3c1a22;color:#3c1a22"></span>烬海禁区</div>');
    el.innerHTML = rows.join("");
  }
  function wireMapControls() {
    $("#map-zoom-in").onclick = () => STARMAP.zoomStep(1);
    $("#map-zoom-out").onclick = () => STARMAP.zoomStep(-1);
    $("#map-zoom-locate").onclick = () => {
      STARMAP.exitSystem();
      STARMAP.goHome();
      const cur = sysOf((S.session.state.location || {}).system);
      if (cur) renderSystemPanel(cur);
      toast("已定位到当前位置：" + (cur ? cur.name : "未知"));
    };
    $("#map-zoom-home").onclick = () => { STARMAP.goHome(); const cur = sysOf((S.session.state.location || {}).system); if (cur) renderSystemPanel(cur); };
    $("#map-zoom-reset").onclick = () => STARMAP.resetView();
    const toggle = (btnId, chipName) => {
      const btn = $("#" + btnId);
      if (!btn) return;
      btn.onclick = () => {
        const chip = $('.fchip[data-filter="' + chipName + '"]');
        const on = !btn.classList.contains("toggle-on");
        btn.classList.toggle("toggle-on", on);
        btn.classList.toggle("toggle-off", !on);
        if (chip) chip.classList.toggle("active", on);
        STARMAP.setFilter(chipName, on);
      };
    };
    toggle("map-toggle-lanes", "lanes");
    toggle("map-toggle-territory", "territory");
    $$("#map-filters .fchip").forEach((chip) => {
      chip.onclick = () => {
        const name = chip.dataset.filter;
        const on = !chip.classList.contains("active");
        chip.classList.toggle("active", on);
        STARMAP.setFilter(name, on);
        const btn = name === "lanes" ? $("#map-toggle-lanes") : name === "territory" ? $("#map-toggle-territory") : null;
        if (btn) { btn.classList.toggle("toggle-on", on); btn.classList.toggle("toggle-off", !on); }
      };
    });
    const input = $("#map-search-input");
    const results = $("#map-search-results");
    input.oninput = () => {
      const q = input.value.trim();
      if (q.length < 1) { results.classList.add("hidden"); return; }
      const hits = STARMAP.getSystems()
        .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || (s.planets || []).some((p) => p.name.toLowerCase().includes(q.toLowerCase())))
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
    // 故事驱动
    $("#sd-collapse").onclick = () => {
      const d = $("#story-driver");
      d.classList.toggle("collapsed");
      $("#sd-collapse").textContent = d.classList.contains("collapsed") ? "＋" : "－";
    };
    $("#sd-send").onclick = () => driverAction(null, false);
    $("#sd-input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); driverAction(null, false); }
    });
  }

  /* ================================================================
     对话
     ================================================================ */
  function updateChatNpcOptions() {
    // 兼容旧调用：重建会话子面板
    renderChatTabs();
  }
  function renderChatTabs() {
    const el = $("#chat-tabs");
    if (!el) return;
    const msgs = S.session.messages || [];
    const order = [];
    const add = (id) => { if (id && !order.includes(id)) order.push(id); };
    add("narrator");
    if (groupParticipants().length) add("group");
    // 角色排序：小队 > 身边 > 通讯录 > 知名
    const rank = (c) => (inParty(c.id) ? 0 : isNearbyChar(c) ? 1 : contactOf(c.id) ? 2 : 3);
    S.data.characters.filter((c) => knownChar(c)).sort((a, b) => rank(a) - rank(b)).forEach((c) => add(c.id));
    msgs.forEach((m) => add(chatTabOf(m)));
    if (!order.includes(S.chatTab)) S.chatTab = "narrator";
    el.innerHTML = order.map((id) => {
      let label = "", sub = "";
      if (id === "narrator") { label = "✦ 星海之主"; sub = "旁白 · 故事驱动"; }
      else if (id === "group") { label = "◈ 群聊"; sub = "身边 · 当前星系"; }
      else {
        const c = S.data.characters.find((x) => x.id === id);
        if (!c) return "";
        label = c.name + (c.en ? "（" + c.en + "）" : "");
        sub = inParty(id) ? "小队" : isNearbyChar(c) ? "身边" : contactOf(id) ? "通讯" : "知名";
      }
      return '<button class="chat-tab' + (S.chatTab === id ? " active" : "") + '" data-tab="' + id + '">' +
        esc(label) + '<span class="ct-sub">' + esc(sub) + "</span></button>";
    }).join("");
    $$("#chat-tabs .chat-tab").forEach((b) => {
      b.onclick = () => {
        S.chatTab = b.dataset.tab;
        renderChatTabs();
        renderChatHistory();
        updateChatTabInfo();
      };
    });
  }
  function renderChatHistory() {
    const box = $("#chat-messages");
    if (!box) return;
    const tab = S.chatTab || "narrator";
    const st = S.session.state;
    const msgs = (S.session.messages || []).filter((m) => chatTabOf(m) === tab);
    box.innerHTML = "";
    // 星海之主 tab：故事驱动播报（driverFeed）与旁白会话合并为同一条时间线（与地图驱动器统一）
    if (tab === "narrator") {
      const chatMsgs = msgs.filter((m) => {
        const meta = typeof m.meta === "string" ? safeParse(m.meta) : (m.meta || {});
        return !meta.driver;
      });
      const items = [];
      chatMsgs.forEach((m) => items.push({ t: Number(m.created || 0), type: "chat", m }));
      (st.driverFeed || []).forEach((d) => items.push({ t: Number(d.at || 0), type: "driver", d }));
      items.sort((a, b) => a.t - b.t);
      if (!items.length) {
        box.innerHTML =
          '<div class="lore-empty" style="margin:12vh auto 0;max-width:560px;line-height:2">' +
          '<div style="font-size:30px;color:#35d6c8;text-shadow:0 0 18px rgba(53,214,200,.6);margin-bottom:10px">✦</div>' +
          "星海之主正在等待你的第一句话。<br>" +
          '<span style="font-size:12px;color:#8fa3bd">此处与星图页的故事驱动是同一个面板——<br>你的行动、抵达播报与群聊摘记都会同步出现在这里。</span></div>';
        return;
      }
      items.forEach((item) => {
        if (item.type === "driver") { appendDriverMessage(item.d.text, item.d.kind); return; }
        if (item.m.role === "user") { appendMessage("user", item.m.content, (st.player || {}).name); return; }
        appendMessage("narrator", item.m.content, item.m.name || "星海之主");
      });
      scrollChatBottom();
      return;
    }
    if (!msgs.length) {
      if (tab === "group") {
        box.innerHTML = '<div class="lore-empty" style="margin-top:12vh">◈ 群聊<br><span style="font-size:12px;color:#8fa3bd">与身边（当前星系）的人一起说话——有人会回应，也有人不理睬。</span></div>';
      } else {
        const c = S.data.characters.find((x) => x.id === tab);
        box.innerHTML = '<div class="lore-empty" style="margin-top:12vh">与 ' + esc(c ? c.name : "对方") + ' 的会话尚未开始<br><span style="font-size:12px;color:#8fa3bd">点击上方「档案」可查看 TA 的完整信息</span></div>';
      }
      return;
    }
    msgs.forEach((m) => {
      const meta = typeof m.meta === "string" ? safeParse(m.meta) : (m.meta || {});
      if (m.role === "user") { appendMessage("user", m.content, (st.player || {}).name); return; }
      if (meta.driver) { appendDriverMessage(m.content, meta.kind); return; }
      if (meta.group) { appendGroupBlock(m); return; }
      const kind = m.name === "星海之主" ? "narrator" : "assistant";
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
    el.innerHTML =
      '<div class="msg-avatar" style="' + (char ? "--cc:" + facColor(char.faction) + ";" : "") + '">' + avatar + "</div>" +
      '<div class="msg-body"><div class="msg-name">' + esc(shownName) + '</div><div class="msg-bubble">' + esc(text) + "</div></div>";
    box.appendChild(el);
    scrollChatBottom();
    return el;
  }
  function appendDriverMessage(text, kind) {
    const box = $("#chat-messages");
    const el = document.createElement("div");
    el.className = "msg-driver";
    const label = kind === "group_summary" ? "群聊摘记" : "故事驱动播报";
    el.innerHTML = '<div class="md-meta">' + label + "</div>" + esc(text);
    box.appendChild(el);
    scrollChatBottom();
  }
  function appendGroupBlock(m) {
    const box = $("#chat-messages");
    const el = document.createElement("div");
    el.className = "msg msg-assistant";
    let lines = [];
    try { lines = JSON.parse(m.content || "[]"); } catch (e) { lines = []; }
    if (!Array.isArray(lines) || !lines.length) {
      try { lines = safeParse(m.meta).lines || []; } catch (e) { lines = []; }
    }
    el.innerHTML =
      '<div class="msg-avatar">◈</div><div class="msg-body"><div class="msg-name">群聊</div><div class="msg-group-block">' +
      (lines.length
        ? lines.map((l) => '<div class="msg-group-line"><span class="gl-name">' + esc(l.name || "?") + '</span><span class="gl-text">' + esc(l.text || "") + "</span></div>").join("")
        : esc(m.content || "")) +
      "</div></div>";
    box.appendChild(el);
    scrollChatBottom();
  }
  function appendRefuse(text) {
    const box = $("#chat-messages");
    const el = document.createElement("div");
    el.className = "msg msg-narrator";
    el.innerHTML = '<div class="msg-avatar">❋</div><div class="msg-body"><div class="msg-name">星海之主</div><div class="msg-refuse">' + esc(text) + "</div></div>";
    box.appendChild(el);
    scrollChatBottom();
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
      max_tokens: merged.max_tokens || merged.maxTokens || 1000,
      use_system_proxy: !!merged.use_system_proxy,
      proxy_url: merged.proxyUrl || merged.proxy_url || "",
    };
  }
  function updateAiStatus() {
    const s = aiSettings();
    const text = s.api_url
      ? "AI 已连接 · " + (s.model || "未知模型") + " · 跃迁到达、时间推进与银河大事都会在这里播报"
      : "未接入 AI（当前为本地模板叙事）· 到「设置 → AI 连接」填写接口并点击「保存配置」";
    const foot = $("#sd-foot");
    if (foot) foot.textContent = text;
    const chatFoot = $("#chat-foot");
    if (chatFoot) chatFoot.textContent = s.api_url
      ? "AI 已连接 · " + (s.model || "") + " · 对话、故事驱动与星球档案均已启用"
      : "未配置 AI：故事驱动使用本地模板；对话、群聊与 AI 星球档案需在「设置 → AI 连接」接入接口";
  }
  async function sendChat() {
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text || S.generating) return;
    const tab = S.chatTab || "narrator";
    if (tab === "group") { input.value = ""; autoGrow(input); return sendGroupChat(text); }
    const settings = aiSettings();
    if (!settings.api_url) { toast("尚未配置 AI：请在「设置 → AI 连接」填写 OpenAI 兼容接口地址。", "err"); switchView("settings"); return; }
    const st = S.session.state;
    const npcId = tab === "narrator" ? null : tab;
    // 社交判定：知识边界 → 联系方式 → 距离 → 地位门槛
    if (npcId) {
      const c = S.data.characters.find((x) => x.id === npcId);
      if (!charUnlocked(c)) { toast("你还不知道这个人……", "err"); return; }
      const mode = chatModeFor(npcId);
      if (mode === "none") {
        appendRefuse("你与 " + c.name + " 之间没有可供使用的通讯渠道。" + (isFamous(c) ? "TA 是知名人物，但联系方式需要先在星海中取得。" : ""));
        return;
      }
      if (mode === "comms") {
        if ((st.player.credits || 0) < 2) { toast("通讯费用不足（2 晶/次）。", "err"); return; }
        st.player.credits -= 2;
        updateTopbar();
      }
      const chance = refusalChance(c);
      if (Math.random() < chance) {
        const lines = [
          c.name + "没有理会你的通讯。以你目前的声名，还敲不开这扇门。",
          c.name + "的随从挡在了前面：「" + (c.title || "大人") + "现在不见客。」",
          "通讯接通了三秒，随即被挂断——" + c.name + "似乎不认为你值得占用这段时间。",
        ];
        appendRefuse(lines[Math.floor(Math.random() * lines.length)] + "（提升声望或好感后再试）");
        queueSave();
        return;
      }
    }
    S.generating = true;
    $("#chat-send").disabled = true;
    appendMessage("user", text);
    st.messages = st.messages || [];
    st.messages.push({ role: "user", name: st.player.name, content: text, meta: { npc: npcId || "" } });
    input.value = "";
    autoGrow(input);
    showTyping();
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
      else if (npcId) {
        st.messages = st.messages || [];
        st.messages.push({ role: "assistant", name, content: acc, meta: { npc: npcId } });
        renderChatTabs();
      } else {
        // 旁白回复：并入总故事驱动（与地图驱动器统一）
        driverAdd("narrator", acc, { ai: true });
      }
      if (npcId) {
        // 好感 +1（上限 100）；面对面交谈自动交换联系方式；里程碑联动播报
        st.affinity = st.affinity || {};
        if (st.affinity[npcId] === undefined) {
          const c = S.data.characters.find((x) => x.id === npcId);
          st.affinity[npcId] = c ? (c.affinityStart || 0) : 0;
        }
        const before = st.affinity[npcId];
        st.affinity[npcId] = Math.min(100, st.affinity[npcId] + 1);
        if (chatModeFor(npcId) === "near") addContact(npcId);
        [10, 20, 30, 50].forEach((milestone) => {
          if (before < milestone && st.affinity[npcId] >= milestone) {
            const c = S.data.characters.find((x) => x.id === npcId);
            if (c) driverAdd("event", "你与 " + c.name + " 的关系更近了一步（好感 " + milestone + "）。");
          }
        });
        refreshAllSurfaces();
        queueSave();
      }
    } catch (e) {
      const typing = document.getElementById("chat-typing");
      if (typing) typing.remove();
      toast("对话失败：" + e.message, "err");
    } finally {
      S.generating = false;
      $("#chat-send").disabled = false;
    }
  }
  async function sendGroupChat(text) {
    const st = S.session.state;
    const participants = groupParticipants().slice(0, 6);
    if (!participants.length) { toast("身边没有可以群聊的人。", "err"); return; }
    const settings = aiSettings();
    S.generating = true;
    $("#chat-send").disabled = true;
    appendMessage("user", text);
    st.messages = st.messages || [];
    st.messages.push({ role: "user", name: st.player.name, content: text, meta: { group: true } });
    showTyping();
    try {
      const resp = await fetch("/api/sessions/" + S.session.id + "/chat/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, participants: participants.map((c) => c.id), settings }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload.error || "群聊失败");
      const typing = document.getElementById("chat-typing");
      if (typing) typing.remove();
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      st.messages.push({ role: "assistant", name: "群聊", content: JSON.stringify(lines), meta: { group: true, lines } });
      if (payload.summary) {
        st.messages.push({ role: "assistant", name: "星海之主", content: payload.summary, meta: { driver: true, kind: "group_summary" } });
        driverAdd("event", "【群聊摘记】" + payload.summary);
      }
      renderChatTabs();
      renderChatHistory();
      queueSave();
    } catch (e) {
      const typing = document.getElementById("chat-typing");
      if (typing) typing.remove();
      toast("群聊失败：" + e.message, "err");
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
     情报（角色）
     ================================================================ */
  function renderCharacters() {
    const q = ($("#char-search").value || "").trim();
    const fac = $("#char-faction-filter").value;
    const st = S.session.state;
    const cat = S.charCat || "all";
    // 分类 chips
    const cats = [
      ["all", "全部已知"],
      ["near", "身边·小队"],
      ["famous", "知名人物"],
      ["rumor", "传闻·已解锁"],
    ];
    $("#char-cats").innerHTML = cats.map(([id, label]) =>
      '<label class="fchip' + (cat === id ? " active" : "") + '" data-cat="' + id + '"><i class="fdot"></i>' + label + "</label>"
    ).join("");
    $$("#char-cats .fchip").forEach((chip) => {
      chip.onclick = () => {
        S.charCat = chip.dataset.cat;
        renderCharacters();
      };
    });
    const chars = S.data.characters.filter((c) => {
      if (!knownChar(c)) return false;
      if (cat === "near" && !(isNearbyChar(c) || inParty(c.id))) return false;
      if (cat === "famous" && !isFamous(c)) return false;
      if (cat === "rumor" && charUnlocked(c) && c.visibility === "public") return false;
      if (!q) return (!fac || c.faction === fac);
      const full = (c.name + " " + (c.en || "") + " " + c.title + " " + (c.tags || []).join(" "));
      return full.toLowerCase().includes(q.toLowerCase()) && (!fac || c.faction === fac);
    });
    const grid = $("#char-grid");
    grid.innerHTML = chars.map((c) => {
      const color = facColor(c.faction);
      const unlocked = charUnlocked(c);
      const rumor = !unlocked;
      const stats = c.stats || {};
      const badges = [];
      if (inParty(c.id)) badges.push('<span class="cc-tag" style="color:#7ee08a;border-color:#7ee08a">小队</span>');
      else if (isNearbyChar(c)) badges.push('<span class="cc-tag" style="color:#7ee08a">附近</span>');
      if (isFamous(c)) badges.push('<span class="cc-tag" style="color:#e8c95a">知名</span>');
      if (unlocked && !inParty(c.id) && !isNearbyChar(c) && contactOf(c.id)) badges.push('<span class="cc-tag" style="color:#7fb8e8">通讯录</span>');
      if (unlocked && isFamous(c) && !contactOf(c.id) && !isNearbyChar(c.id) && !inParty(c.id)) badges.push('<span class="cc-tag" style="color:#e08a7e">无联系方式</span>');
      const nameHtml = unlocked
        ? esc(c.name) + (c.en ? '<br><span style="font-size:11px;color:#8fa3bd;font-weight:400">' + esc(c.en) + "</span>" : "")
        : esc(c.name);
      const titleHtml = unlocked ? esc(c.title) : "传闻中的存在";
      const brief = unlocked
        ? (c.personality && c.personality.temperament ? c.personality.temperament : c.personality)
        : "✦ " + ((c.unlock && c.unlock.hint) || "关于这个人的一切，都笼罩在迷雾里。");
      const metaTags = unlocked
        ? '<span class="cc-tag" style="color:' + color + '">' + facName(c.faction) + "</span>" +
          '<span class="cc-tag">' + esc(c.species || "人类") + "</span>" +
          '<span class="cc-tag">' + esc(c.occupation || "") + "</span>"
        : '<span class="rumor-tag">传闻</span><span class="cc-tag" style="color:' + color + '">' + facName(c.faction) + "</span>";
      return (
        '<div class="char-card' + (rumor ? " rumor" : "") + ((st.unlocked || []).includes(c.id) && c.visibility !== "public" ? " unlocked-new" : "") + '" data-id="' + c.id + '" style="--cc:' + color + '">' +
        '<div class="cc-top"><div class="cc-avatar">' + esc((c.name || "?").slice(0, 1)) + "</div>" +
        '<div><div class="cc-name">' + nameHtml + '</div><div class="cc-title">' + titleHtml + "</div></div></div>" +
        '<div class="cc-meta">' + metaTags + badges.join("") + "</div>" +
        '<div class="cc-brief"' + (rumor ? ' style="color:#d8b26a"' : "") + ">" + esc(brief) + "</div>" +
        (unlocked
          ? '<div class="cc-stats"><div class="cc-stat"><b>' + (stats.combat || 0) + "</b>武</div>" +
            '<div class="cc-stat"><b>' + (stats.wit || 0) + "</b>智</div>" +
            '<div class="cc-stat"><b>' + (stats.charm || 0) + "</b>魅</div>" +
            '<div class="cc-stat"><b>' + (stats.tech || 0) + "</b>技</div>" +
            '<div class="cc-stat"><b>' + (stats.nav || 0) + "</b>航</div></div>"
          : "") +
        "</div>"
      );
    }).join("") || '<div class="empty-note">这里没有你认识的人。去星海中闯荡，情报自会找上门。</div>';
    $$("#char-grid .char-card").forEach((el) => {
      el.onclick = () => {
        const c = S.data.characters.find((x) => x.id === el.dataset.id);
        if (charUnlocked(c)) showCharacterModal(c);
        else showRumorModal(c);
      };
    });
  }
  function showRumorModal(c) {
    const color = facColor(c.faction);
    openModal(
      '<button class="modal-close" data-close-modal>✕</button>' +
      '<div class="cd-head" style="--cc:' + color + '">' +
      '<div class="cd-avatar" style="filter:blur(2px)">' + esc((c.name || "?").slice(0, 1)) + "</div>" +
      '<div><div class="cd-name">' + esc(c.name) + ' <span class="rumor-tag">传闻</span></div>' +
      '<div class="cd-sub">' + facName(c.faction) + " · 情报不足</div></div></div>" +
      '<div class="msp-note">你只是隐约听说过这个名字。关于此人的一切：外貌、立场、行踪——都还没有进入你的情报网。' +
      (c.unlock && c.unlock.hint ? "<br><br>✦ 线索：" + esc(c.unlock.hint) : "") + "</div>" +
      '<div class="modal-actions"><button class="btn btn-ghost" data-close-modal>关闭</button></div>'
    );
    $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
  }
  function showCharacterModal(c) {
    const color = facColor(c.faction);
    const stats = c.stats || {};
    const status = c.status || {};
    const politics = c.politics || {};
    const physio = c.physiology || {};
    const appearance = c.appearance || {};
    const personality = c.personality || {};
    const rels = (c.relationships || []).map((r) => {
      const target = S.data.characters.find((x) => x.id === r.target);
      return target ? (target.name + "：" + (r.note || "")) : "";
    }).filter(Boolean);
    const aff = affinityOf(c.id);
    const met = S.session.state.affinity && S.session.state.affinity[c.id] !== undefined;
    openModal(
      '<button class="modal-close" data-close-modal>✕</button>' +
      '<div class="cd-head" style="--cc:' + color + '">' +
      '<div class="cd-avatar">' + esc((c.name || "?").slice(0, 1)) + "</div>" +
      '<div><div class="cd-name">' + esc(c.name) + (c.en ? ' <span style="font-size:13px;color:#8fa3bd">' + esc(c.en) + "</span>" : "") + "</div>" +
      '<div class="cd-sub">' + esc(c.title) + " · " + facName(c.faction) + " · " + esc(c.occupation) + "</div>" +
      '<div class="cd-sub">' + esc(c.species || "人类") + " · " + esc(c.sex || "") + " · " + esc(String(c.age || "?")) + "岁 · 故乡：" + esc(c.homeworld || "不明") + "</div>" +
      '<div class="cd-sub" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
      '<span class="cc-tag" style="color:' + color + '">地位 ' + (status.tier || "?") + " 阶</span>" +
      '<span class="cc-tag">声望 ' + (status.fame || 0) + "</span>" +
      (met ? '<span class="cc-tag" style="color:#7ee08a">好感 ' + (aff > 0 ? "+" : "") + aff + "</span>" : '<span class="cc-tag">尚未谋面</span>') +
      (c.tags || []).map((t) => '<span class="cc-tag">' + esc(t) + "</span>").join("") +
      "</div></div></div>" +
      '<div class="cd-tabs">' +
      '<button class="cd-tab active" data-tab="bio">档案</button>' +
      '<button class="cd-tab" data-tab="ab">能力</button>' +
      '<button class="cd-tab" data-tab="rel">关系</button>' +
      '<button class="cd-tab" data-tab="arc">命运线</button>' +
      '<button class="cd-tab" data-tab="secret">秘闻</button></div>' +
      '<div class="cd-body" id="cd-body"></div>' +
      '<div class="cd-actions">' +
      '<span id="cd-party-slot" style="margin-right:auto"></span>' +
      '<button class="btn btn-ghost" data-close-modal>关闭</button>' +
      (chatModeFor(c.id) === "none"
        ? '<button class="btn" disabled title="需要先取得联系方式">未取得联系方式</button>'
        : '<button class="btn btn-primary" id="cd-chat">尝试联系 ▸</button>') +
      "</div>"
    );
    const body = $("#cd-body");
    const showTab = (tab) => {
      $$(".cd-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      if (tab === "bio") {
        body.innerHTML =
          '<div class="cd-quotes">' + (c.quotes || []).map((q2) => "「" + esc(q2) + "」").join("　") + "</div>" +
          '<div class="cd-grid">' +
          '<div class="cd-item full"><span class="k">外貌</span><span class="v">' + esc(appearance.height || "") + " · " + esc(appearance.build || "") + " · " + esc(appearance.hair || "") + " · " + esc(appearance.eyes || "") + "<br>" + esc(appearance.features || "") + " · " + esc(appearance.style || "") + "</span></div>" +
          '<div class="cd-item full"><span class="k">性格</span><span class="v">' + esc(personality.temperament || "") + "<br>特质：" + (personality.traits || []).map((t) => esc(t)).join("、") + "<br>说话方式：" + esc(personality.speech || "") + "<br>喜好：" + (personality.likes || []).map((t) => esc(t)).join("、") + "<br>厌恶：" + (personality.dislikes || []).map((t) => esc(t)).join("、") + "<br>恐惧：" + (personality.fears || []).map((t) => esc(t)).join("、") + "<br>小习惯：" + (personality.habits || []).map((t) => esc(t)).join("、") + "</span></div>" +
          '<div class="cd-item full"><span class="k">生理</span><span class="v">' + esc(physio.speciesNote || "") + "<br>改造：" + esc(physio.modifications || "无") + " · 健康：" + esc(physio.health || "—") + " · 寿命：" + esc(physio.lifespan || "—") + "</span></div>" +
          '<div class="cd-item full"><span class="k">政治</span><span class="v">派系：' + esc(politics.party || "—") + " · 主张：" + esc(politics.ideology || "—") + "<br>盟友：" + (politics.allies || []).map((t) => esc(t)).join("、") + " · 对手：" + (politics.rivals || []).map((t) => esc(t)).join("、") + "</span></div>" +
          '<div class="cd-item full"><span class="k">背景</span><span class="v">' + esc(c.background || "") + "</span></div>" +
          '<div class="cd-item"><span class="k">近期目标</span><span class="v">' + esc((c.goals && c.goals.short) || c.goals || "") + "</span></div>" +
          '<div class="cd-item"><span class="k">终身目标</span><span class="v">' + esc((c.goals && c.goals.long) || "") + "</span></div>" +
          '<div class="cd-item"><span class="k">五维</span><span class="v">武力 ' + (stats.combat || 0) + " · 智略 " + (stats.wit || 0) + " · 魅力 " + (stats.charm || 0) + " · 技术 " + (stats.tech || 0) + " · 航术 " + (stats.nav || 0) + "</span></div>" +
          '<div class="cd-item"><span class="k">开场白</span><span class="v">「' + esc(c.greeting || "") + "」</span></div>" +
          "</div>";
      } else if (tab === "ab") {
        const abs = c.abilities || [];
        body.innerHTML = abs.length
          ? '<div class="cd-item" style="margin-bottom:8px"><span class="k">能力</span></div>' +
            abs.map((a) => '<div class="ability-row"><span class="ab-name">' + esc(a.name) + '</span><span class="ab-lv">Lv.' + (a.level || 1) + '</span><span class="ab-desc">' + esc(a.desc || "") + "</span></div>").join("")
          : '<p class="lore-empty">没有公开的能力记录</p>';
      } else if (tab === "rel") {
        body.innerHTML = rels.length ? rels.map((r) => "<p>" + esc(r) + "</p>").join("") : '<p class="lore-empty">暂无公开的关系记录</p>';
      } else if (tab === "arc") {
        const curY = currentYear();
        const arcs = (c.arc || []).slice().sort((a, b) => a.year - b.year);
        body.innerHTML =
          '<div class="cd-item" style="margin-bottom:8px"><span class="k">命运线（星历）</span></div>' +
          '<div class="arc-list">' +
          (arcs.length ? arcs.map((a) =>
            '<div class="arc-item' + (a.year > curY ? " future" : "") + '"><span class="arc-year">' + a.year + "</span>" + esc(a.event) + (a.year > curY ? '<span style="color:#5b6c86;font-size:10px">（未来）</span>' : "") + "</div>"
          ).join("") : '<p class="lore-empty">命运尚未展开</p>') + "</div>";
      } else {
        body.innerHTML = '<div class="cd-secret">✦ 秘闻：' + esc((c.secrets || ["这位角色把秘密藏得很好。"])[0]) + "</div>" +
          ((c.secrets || []).slice(1).map((s) => '<div class="cd-secret" style="margin-top:8px">✦ ' + esc(s) + "</div>").join(""));
      }
    };
    $$(".cd-tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    showTab("bio");
    const cdChat = $("#cd-chat");
    if (cdChat) cdChat.onclick = () => {
      closeModal();
      S.chatTab = c.id;
      switchView("chat");
      renderChatTabs();
      renderChatHistory();
      updateChatTabInfo();
      toast("已切换到 " + c.name + " 的会话子面板。" + (chatModeFor(c.id) === "comms" ? "（远程通讯，2 晶/次）" : ""));
    };
    // 小队（同行者）邀请
    const partySlot = $("#cd-party-slot");
    if (partySlot) {
      const st = S.session.state;
      const aff = affinityOf(c.id);
      if (inParty(c.id)) {
        partySlot.innerHTML = '<button class="btn btn-ghost" id="cd-party">⇤ 离开小队</button>';
      } else if (!isNearbyChar(c)) {
        partySlot.innerHTML = '<button class="btn" disabled title="TA 不在你身边">同行需在身边</button>';
      } else if (aff < 10) {
        partySlot.innerHTML = '<button class="btn" disabled title="好感不足">好感 ' + aff + '/10 可邀请同行</button>';
      } else {
        partySlot.innerHTML = '<button class="btn" id="cd-party" style="border-color:#57b04a;color:#7ee08a">⇥ 邀请同行</button>';
      }
      const pbtn = $("#cd-party");
      if (pbtn && !pbtn.disabled) pbtn.onclick = () => {
        st.party = st.party || [];
        if (inParty(c.id)) {
          st.party = st.party.filter((x) => x !== c.id);
          driverAdd("event", c.name + " 向你道别，离开了你的小队。");
          toast(c.name + " 离开了小队。");
        } else {
          st.party.push(c.id);
          addContact(c.id);
          driverAdd("event", c.name + " 加入了你的小队！从此 TA 将与你同行，无论你跃迁到哪里。");
          toast(c.name + " 加入了小队。", "gold");
        }
        updateChatNpcOptions();
        closeModal();
        queueSave();
      };
    }
    $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
  }

  /* ================================================================
     世界书
     ================================================================ */
  const CAT_NAMES = {
    history: "编年史", faction: "派系", politics: "政治", culture: "文化",
    economy: "经济", tech: "科技", geography: "地理", species: "物种", danger: "星海危险", planet: "星球档案",
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
    // 选中项不在当前列表时回退到首条（避免切分类后正文与列表脱节）
    if (S.loreSel && !entries.some((e) => e.id === S.loreSel)) S.loreSel = null;
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
    $("#fleet-actions").innerHTML = '<button class="btn btn-ghost btn-sm" id="fleet-repair">🔧 维修座舰</button>';
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
    $("#market-sub").textContent = econLabel(sys.economy) + "经济 · 危险度 " + sys.danger + " · 价格随星系与时日波动（星历第 " + Math.round(st.day) + " 天）";
    try {
      const resp = await fetch("/api/market?system=" + encodeURIComponent(systemId) + "&day=" + Math.round(st.day));
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
      '<td style="color:#8fa3bd;font-size:12px">当前 ' + fmtNum(Math.round(st.fuel)) + " / " + (ship ? ship.fuelCap : 0) + "</td>" +
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
    $("#player-origin-sub").textContent = (origin ? origin.name : "流浪者") + " · 星海中的自由人 · 声名 " + Math.round(p.fame || 0);
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
    const metIds = Object.keys(st.affinity || {}).filter((cid) => st.affinity[cid] !== undefined && st.affinity[cid] !== null);
    const affinityRows = metIds.length
      ? metIds.map((cid) => {
          const c = S.data.characters.find((x) => x.id === cid);
          if (!c) return "";
          const v = st.affinity[cid];
          return (
            '<div class="rep-row"><span class="rr-name">' + esc(c.name) + "</span>" +
            '<span class="rr-track"><span class="rr-fill" style="width:' + Math.min(50, Math.abs(v) * 0.5) + "%;" + (v >= 0 ? "left:50%;" : "left:" + (50 - Math.min(50, Math.abs(v) * 0.5)) + "%;") + 'background:#7ee08a"></span></span>' +
            '<span class="rr-val" style="color:' + (v >= 0 ? "#7ee08a" : "#e08a7e") + '">' + (v > 0 ? "+" : "") + v + "</span></div>"
          );
        }).join("")
      : '<div class="empty-note">还没有结识任何人</div>';
    const log = (st.log || []).slice().reverse();
    const sysNames = {};
    STARMAP.getSystems().forEach((s) => { sysNames[s.id] = s.name; });
    const localize = (text) => {
      let t = String(text || "");
      Object.keys(sysNames).forEach((id) => { t = t.split(id).join(sysNames[id]); });
      return t;
    };
    const logHtml = log.slice(0, 30).map((l) => '<div class="log-item"><span class="li-day">D' + l.day + "</span><span class='li-text'>" + esc(localize(l.text)) + "</span></div>").join("");
    const debtHtml = p.debt
      ? '<div class="row"><span>蓝潮贷款</span><b style="color:#e08a7e">欠 ' + fmtNum(p.debt) + " 晶</b></div>" +
        '<div style="text-align:right;margin-top:8px"><button class="btn btn-xs" id="player-pay-debt">还款（全部）</button></div>'
      : "";
    const quests = st.quests || [];
    const questHtml = quests.length
      ? quests.map((q) =>
          '<div class="perk-item">✦ ' + esc(q.title) + (q.type === "survey" ? "（进度 " + q.progress + "/" + q.n + "）" : "") +
          ' <span style="color:#e8c95a">' + q.reward + " 晶</span></div>"
        ).join("")
      : '<div class="empty-note">暂无委托在身 · 星海中的机会常常自己找上门</div>';
    const partyList = (st.party || []).map((cid) => S.data.characters.find((x) => x.id === cid)).filter(Boolean);
    const contactList = (st.contacts || []).map((cid) => S.data.characters.find((x) => x.id === cid)).filter((c) => c && !inParty(c.id));
    const partyHtml = partyList.length
      ? partyList.map((c) => '<div class="perk-item">✦ ' + esc(c.name) + " · " + esc(c.title) + ' <span style="color:#7ee08a">同行中</span></div>').join("")
      : '<div class="empty-note">还没有同行者 · 好感足够时可在角色档案里邀请同行</div>';
    const contactHtml = contactList.length
      ? contactList.map((c) => '<div class="perk-item">✦ ' + esc(c.name) + (isNearbyChar(c) ? ' <span style="color:#7ee08a">附近</span>' : ' <span style="color:#7fb8e8">可通讯</span>') + "</div>").join("")
      : '<div class="empty-note">通讯录空空如也 · 与身边人交谈、接受搭话或从掮客处购买</div>';
    $("#player-content").innerHTML =
      '<div class="player-layout">' +
      '<div class="pcard"><h3>五维属性</h3>' + statRows +
      "<h3 style='margin-top:18px'>阵营声望</h3>" + repRows + "</div>" +
      '<div class="pcard"><h3>身份档案</h3>' +
      '<div class="row"><span>出身</span><b>' + (origin ? origin.icon + " " + origin.name : "流浪者") + "</b></div>" +
      (p.profile && p.profile.sex ? '<div class="row"><span>性别/年龄</span><b>' + esc(p.profile.sex) + " · " + esc(String(p.profile.age || "?")) + "岁</b></div>" : "") +
      (p.profile && p.profile.height ? '<div class="row"><span>身高/体重</span><b>' + esc(String(p.profile.height)) + "cm · " + esc(String(p.profile.weight)) + "kg</b></div>" : "") +
      '<div class="row"><span>资金</span><b style="color:#e8c95a">◈ ' + fmtNum(p.credits) + "</b></div>" +
      '<div class="row"><span>声名</span><b>' + Math.round(p.fame || 0) + "</b></div>" +
      '<div class="row"><span>座舰</span><b>' + (ship ? ship.name : "无") + "</b></div>" +
      '<div class="row"><span>当前坐标</span><b>' + (currentSystem() ? currentSystem().name : "未知") + "</b></div>" +
      '<div class="row"><span>已勘测星系</span><b>' + (st.explored || []).length + " 个</b></div>" +
      '<div class="row"><span>航行天数</span><b>' + Math.round(st.day) + " 天</b></div>" +
      debtHtml + "</div>" +
      '<div class="pcard"><h3>出身特权</h3><div class="perk-list">' +
      (origin ? origin.perks.map((pk) => '<div class="perk-item">' + esc(pk) + "</div>").join("") : "") +
      "</div></div>" +
      '<div class="pcard"><h3>小队（同行者）</h3><div class="perk-list">' + partyHtml + "</div></div>" +
      '<div class="pcard"><h3>通讯录</h3><div class="perk-list">' + contactHtml + "</div></div>" +
      '<div class="pcard"><h3>结识之人（好感）</h3>' + affinityRows + "</div>" +
      '<div class="pcard"><h3>委托与支线</h3><div class="perk-list">' + questHtml + "</div></div>" +
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
      formRow("模型名称", '<input id="set-model" placeholder="例如 gpt-4o-mini / deepseek-chat / glm-4-flash">', "配置后，对话面板、故事驱动与「AI 生成星球档案」即可使用。") +
      formRow("API 密钥", '<div class="eye-wrap"><input id="set-api-key" type="password" placeholder="sk-…"><button class="eye-btn" id="set-key-eye" title="显示/隐藏密钥">👁</button></div>', "仅保存在本机存档与浏览器本地，不会上传到别处。") +
      formRow("温度", '<input id="set-temp" type="number" step="0.1" min="0" max="2" value="' + (s.temperature || 0.8) + '">', "预设引擎（文风/防抢话/导演系统）将在后续版本接入。") +
      formRow("最大输出（tokens）", '<input id="set-maxtok" type="number" step="100" min="100" max="8000" value="' + (s.max_tokens || 1000) + '">', "回复越长越慢；本网关较慢，建议 800-1200。") +
      formRow("代理地址（可选）", '<input id="set-proxy" placeholder="例如 http://127.0.0.1:7897">', "本机网络受限时填写本地代理（Clash/Mihomo 等）。") +
      "</div>" +
      '<div class="form-row"><label><input type="checkbox" id="set-sysproxy" style="width:auto;margin-right:8px"' + (s.use_system_proxy ? " checked" : "") + ">使用系统代理（环境变量 / 系统代理设置）</label></div>" +
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
      "<b>本版内容：</b>可缩放星图（银河→星区→星系→行星，势力发光云团随缩放溶解）、八大势力、54 颗手工星系 + 约 260 颗星表命名星系、40 位原创角色（含传闻与隐藏情报）、80 条原创世界书、总故事驱动（跃迁到达/时间推进/银河大事件至 3607 年）、事件与支线委托、社交判定（距离/好感/声望门槛）、8 种出身、舰队与贸易。<br><br>" +
      "<b>技术：</b>零第三方依赖（Python 标准库 + 原生 JS/Canvas），角色卡与世界书结构兼容酒馆 spec v2。<br><br>" +
      "<b>世界观均为原创</b>：受《沙丘》《星球大战》《银河英雄传说》《群星》《无人深空》《Kenshi》等作品气质启发，但所有势力、人物、事件与术语均为本作原创。" +
      "</div></div></div>";
    $("#set-api-url").value = s.api_url || "";
    $("#set-api-key").value = s.api_key || "";
    $("#set-model").value = s.model || "";
    $("#set-temp").value = s.temperature || 0.8;
    $("#set-maxtok").value = s.max_tokens || 1000;
    $("#set-proxy").value = s.proxy_url || "";
    $("#set-sysproxy").checked = !!s.use_system_proxy;
    // 密钥可视切换（校对输入用）
    const eyeBtn = $("#set-key-eye");
    if (eyeBtn) eyeBtn.onclick = () => {
      const input = $("#set-api-key");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eyeBtn.textContent = show ? "🙈" : "👁";
    };
    $$(".accent-dot").forEach((d) => {
      d.onclick = () => {
        UI.accent = d.dataset.accent;
        saveUI();
        applyAccent();
        renderSettings();
      };
    });
    const saveAiFieldsFromForm = () => {
      st.settings = st.settings || {};
      st.settings.api_url = $("#set-api-url").value.trim();
      st.settings.api_key = $("#set-api-key").value.trim();
      st.settings.model = $("#set-model").value.trim();
      st.settings.temperature = Number($("#set-temp").value || 0.8);
      st.settings.max_tokens = Number($("#set-maxtok").value || 1000);
      st.settings.proxy_url = $("#set-proxy").value.trim();
      st.settings.use_system_proxy = !!$("#set-sysproxy").checked;
      UI.aiUrl = st.settings.api_url; UI.aiKey = st.settings.api_key; UI.aiModel = st.settings.model; UI.aiTemp = st.settings.temperature;
      UI.maxTokens = st.settings.max_tokens;
      UI.proxyUrl = st.settings.proxy_url; UI.use_system_proxy = st.settings.use_system_proxy;
      saveUI();
      queueSave();
      updateAiStatus();
    };
    $("#set-save-ai").onclick = () => {
      saveAiFieldsFromForm();
      toast("AI 配置已保存。", "gold");
    };
    $("#set-test").onclick = async () => {
      // 测试前先保存表单内容（避免"测试成功但没保存"导致其它功能提示未配置）
      saveAiFieldsFromForm();
      const cfg = aiSettings();
      if (!cfg.api_url || !cfg.model) { toast("请先填写接口地址与模型名称。", "err"); return; }
      $("#set-test-result").textContent = "正在测试…";
      try {
        const resp = await fetch("/api/test-connection", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
        });
        const payload = await resp.json();
        if (payload.ok) { $("#set-test-result").innerHTML = '<span style="color:#7ee08a">✓ 连接正常（' + payload.latency + 's）· 配置已保存</span>'; }
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
    const step1 = () => {
      openModal(
        '<button class="modal-close" data-close-modal>✕</button>' +
        '<div class="modal-title">✦ 开启新的航程 · 选择出身预设</div>' +
        '<div class="form-row"><div class="hint">出身预设会为你填好角色工坊的全部字段——你仍然可以逐项修改。</div></div>' +
        '<div class="origin-grid" id="ng-grid">' +
        origins.map((o) =>
          '<div class="origin-card' + (o.id === selected ? " selected" : "") + '" data-id="' + o.id + '">' +
          '<div class="oc-name">' + o.icon + " " + esc(o.name) + "</div>" +
          '<div class="oc-desc">' + esc(o.desc) + "</div>" +
          '<div class="oc-meta">◈ ' + fmtNum(o.credits) + " 晶 · 起始：" + esc(sysOf(o.startSystem) ? sysOf(o.startSystem).name : "") + "</div></div>"
        ).join("") + "</div>" +
        '<div class="modal-actions"><button class="btn btn-ghost" data-close-modal>返回</button>' +
        '<button class="btn btn-primary" id="ng-next">下一步：角色工坊 ▸</button></div>'
      );
      $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
      $$("#ng-grid .origin-card").forEach((el) => {
        el.onclick = () => {
          selected = el.dataset.id;
          $$("#ng-grid .origin-card").forEach((x) => x.classList.toggle("selected", x.dataset.id === selected));
        };
      });
      $("#ng-next").onclick = () => step2(selected);
    };
    const step2 = (originId) => {
      const origin = S.data.origins.find((o) => o.id === originId) || origins[0];
      const st0 = origin.stats || {};
      const totalStats = () => ["combat", "wit", "charm", "tech", "nav"].reduce((s, k) => s + (Number(document.getElementById("cw-" + k) ? document.getElementById("cw-" + k).value : 0) || 0), 0);
      const statRow = (label, key) =>
        '<div class="stat-row"><span class="sr-label">' + label + '</span>' +
        '<input type="range" class="cw-range" id="cw-' + key + '" min="1" max="10" value="' + (st0[key] || 5) + '">' +
        '<span class="sr-val" id="cwv-' + key + '">' + (st0[key] || 5) + "</span></div>";
      const sel = (label, id, options, value) =>
        '<div class="form-row"><label>' + label + '</label><select id="' + id + '">' +
        options.map((o) => '<option value="' + o + '"' + (o === value ? " selected" : "") + ">" + o + "</option>").join("") + "</select></div>";
      const factionDefault = origin.id === "noble" ? "crimson" : origin.id === "slave" ? "shackle" : origin.id === "merchant" ? "blue-tide" : origin.id === "seeker" ? "white-tower" : "";
      openModal(
        '<button class="modal-close" data-close-modal>✕</button>' +
        '<div class="modal-title">✦ 角色工坊 <span style="font-size:12px;color:#8fa3bd">预设：' + esc(origin.name) + " · 全部可改</span></div>" +
        '<div class="ccw-scroll">' +
        '<h4 class="ccw-sec">基础信息</h4><div class="ccw-grid2">' +
        '<div class="form-row"><label>名字</label><input id="cw-name" maxlength="16" placeholder="无名旅人"></div>' +
        sel("性别", "cw-sex", ["男", "女", "其他"], "男") +
        '<div class="form-row"><label>年龄</label><input id="cw-age" type="number" min="14" max="120" value="22"></div>' +
        sel("身体构造（物种）", "cw-species", ["母星人", "太空裔", "深渊裔", "基因雕琢者", "义体化者"], "母星人") +
        "</div>" +
        '<h4 class="ccw-sec">外貌</h4><div class="ccw-grid2">' +
        '<div class="form-row"><label>身高（cm）</label><input id="cw-height" type="number" min="140" max="230" value="175"></div>' +
        '<div class="form-row"><label>体重（kg）</label><input id="cw-weight" type="number" min="40" max="160" value="65"></div>' +
        sel("发色", "cw-hair", ["黑色", "棕色", "金色", "红色", "银色", "白色", "蓝色", "紫色"], "黑色") +
        sel("瞳色", "cw-eyes", ["黑色", "棕色", "蓝色", "绿色", "灰色", "金色", "紫色", "异色"], "黑色") +
        sel("脸型", "cw-face", ["清秀", "方正", "圆润", "瘦削", "英挺", "柔和"], "清秀") +
        sel("身材", "cw-build", ["纤瘦", "匀称", "健壮", "魁梧", "丰腴"], "匀称") +
        '<div class="form-row ccw-full"><label>长相描述</label><textarea id="cw-look" rows="2">普普通通的一张脸，混进人群就再也找不到。</textarea></div>' +
        "</div>" +
        '<h4 class="ccw-sec">身世与志向</h4><div class="ccw-grid2">' +
        '<div class="form-row ccw-full"><label>背景故事</label><textarea id="cw-bg" rows="3">' + esc(origin.desc) + "</textarea></div>" +
        '<div class="form-row"><label>家族</label><input id="cw-family" value="' + (origin.id === "noble" ? "没落的旧贵族旁支" : "普通星港人家") + '"></div>' +
        '<div class="form-row"><label>喜好</label><input id="cw-likes" value="在星港看船来船往"></div>' +
        '<div class="form-row"><label>愿望</label><input id="cw-wishes" value="在星海中活下来，找到属于自己的位置"></div>' +
        '<div class="form-row"><label>势力倾向</label><select id="cw-faction"><option value="">无（自由之身）</option>' +
        S.data.factions.map((f) => '<option value="' + f.id + '"' + (f.id === factionDefault ? " selected" : "") + ">" + f.name + "</option>").join("") +
        "</select></div>" +
        "</div>" +
        '<h4 class="ccw-sec">行囊与资金</h4><div class="ccw-grid2">' +
        '<div class="form-row"><label>启动资金（晶）</label><input id="cw-credits" type="number" min="0" max="3000" value="' + (origin.credits || 250) + '"></div>' +
        '<div class="form-row ccw-full"><label>行囊（勾选携带）</label><div class="ccw-checks">' +
        '<label><input type="checkbox" id="cw-c-med" checked> 医疗凝胶 ×2</label>' +
        '<label><input type="checkbox" id="cw-c-food" checked> 合成食物 ×3</label>' +
        '<label><input type="checkbox" id="cw-c-water"> 净水冰 ×3</label>' +
        '<label><input type="checkbox" id="cw-c-chip"> 数据晶片 ×1</label>' +
        "</div></div>" +
        "</div>" +
        '<h4 class="ccw-sec">能力（五维合计 ≤ 30）</h4><div class="ccw-stats" id="cw-stats">' +
        statRow("武力", "combat") + statRow("智略", "wit") + statRow("魅力", "charm") + statRow("技术", "tech") + statRow("航术", "nav") +
        '<div class="ccw-total">当前合计：<b id="cw-total">' + ["combat", "wit", "charm", "tech", "nav"].reduce((s, k) => s + (st0[k] || 5), 0) + "</b> / 30</div>" +
        "</div>" +
        "</div>" +
        '<div class="modal-actions"><button class="btn btn-ghost" id="cw-back">◂ 返回选择出身</button>' +
        '<button class="btn btn-primary" id="cw-start">✦ 扬帆起航</button></div>'
      );
      $$("[data-close-modal]").forEach((el) => (el.onclick = closeModal));
      if ((location.hash || "").includes("wizard3")) {
        setTimeout(() => { const sc = document.querySelector(".ccw-scroll"); if (sc) sc.scrollTop = sc.scrollHeight; }, 300);
      }
      $$(".cw-range").forEach((r) => {
        r.oninput = () => {
          document.getElementById("cwv-" + r.id.slice(3)).textContent = r.value;
          document.getElementById("cw-total").textContent = totalStats();
        };
      });
      $("#cw-back").onclick = () => step1();
      $("#cw-start").onclick = async () => {
        const stats = {};
        let sum = 0;
        ["combat", "wit", "charm", "tech", "nav"].forEach((k) => { stats[k] = Number(document.getElementById("cw-" + k).value) || 5; sum += stats[k]; });
        if (sum > 30) { toast("五维合计不能超过 30，请重新分配。", "err"); return; }
        const cargo = {};
        if ($("#cw-c-med").checked) cargo.med = 2;
        if ($("#cw-c-food").checked) cargo.food = 3;
        if ($("#cw-c-water").checked) cargo.water = 3;
        if ($("#cw-c-chip").checked) cargo.chip = 1;
        const config = {
          player_name: ($("#cw-name").value || "").trim() || "无名旅人",
          origin: originId,
          credits: Math.max(0, Number($("#cw-credits").value || 0)),
          stats,
          cargo,
          faction: $("#cw-faction").value,
          profile: {
            sex: $("#cw-sex").value,
            age: Number($("#cw-age").value || 22),
            height: Number($("#cw-height").value || 175),
            weight: Number($("#cw-weight").value || 65),
            species: $("#cw-species").value,
            hair: $("#cw-hair").value,
            eyes: $("#cw-eyes").value,
            face: $("#cw-face").value,
            build: $("#cw-build").value,
            look: ($("#cw-look").value || "").trim(),
            background: ($("#cw-bg").value || "").trim(),
            family: ($("#cw-family").value || "").trim(),
            likes: ($("#cw-likes").value || "").trim(),
            wishes: ($("#cw-wishes").value || "").trim(),
          },
        };
        try {
          const resp = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config }),
          });
          if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "创建失败");
          const payload = await resp.json();
          S.session = payload.session;
          S.session.state.player.fame = 0;
          localStorage.setItem(LAST_KEY, S.session.id);
          closeModal();
          enterGame();
          toast("出身：" + origin.name + " · 角色已按你的工坊设定生成。", "gold");
        } catch (e) {
          toast("创建存档失败：" + e.message, "err");
        }
      };
    };
    if ((location.hash || "").includes("wizard2")) step2(selected);
    else step1();
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
    const facSel = $("#char-faction-filter");
    facSel.innerHTML = '<option value="">全部势力</option>' +
      S.data.factions.map((f) => '<option value="' + f.id + '">' + f.name + "</option>").join("") +
      '<option value="rim">无主星域</option>';
    facSel.onchange = renderCharacters;
    $("#char-search").oninput = () => { if (S.view === "characters") renderCharacters(); };
    $("#lore-search").oninput = () => { if (S.view === "lorebook") renderLorebook(); };
    initMap();
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
    $("#btn-title-settings").onclick = () => {
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
    $("#chat-clear").onclick = async () => {
      try {
        await fetch("/api/sessions/" + S.session.id + "/messages", { method: "DELETE" });
        S.session.messages = [];
        S.chatTab = "narrator";
        renderChatTabs();
        renderChatHistory();
        toast("全部会话记录已清空（故事驱动播报保留在存档中）。");
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
    await refreshSaveList();
    const hashParams = {};
    (location.hash || "").replace(/^#/, "").split("&").forEach((kv) => {
      const idx = kv.indexOf("=");
      if (idx === -1) { if (kv) hashParams[kv] = true; return; }
      hashParams[kv.slice(0, idx)] = decodeURIComponent(kv.slice(idx + 1) || "");
    });
    if (hashParams.wizard) {
      $("#title-screen").classList.remove("hidden");
      openNewGameModal();
      return;
    }
    let resumed = false;
    if (hashParams.s) {
      try { await resumeSession(hashParams.s); resumed = true; } catch (e) { resumed = false; }
    }
    if (!resumed) {
      const lastId = localStorage.getItem(LAST_KEY);
      if (lastId) {
        try { await resumeSession(lastId); resumed = true; } catch (e) { /* 存档可能已删 */ }
      }
    }
    if (resumed) {
      enterGame();
      // 深链参数需在切换视图之前生效（否则聊天子面板渲染错误）
      if (hashParams.tab) S.chatTab = hashParams.tab;
      if (hashParams.dossier) S.dossierOpen = true;
      if (hashParams.v && ["map", "chat", "characters", "lorebook", "fleet", "market", "player", "settings"].includes(hashParams.v)) {
        switchView(hashParams.v);
      }
      if (hashParams.m) {
        const m = hashParams.m.split("=");
        const c = S.data.characters.find((x) => x.id === m[1]);
        if (c && charUnlocked(c)) { switchView("characters"); showCharacterModal(c); }
        else if (c) { switchView("characters"); showRumorModal(c); }
      }
      if (hashParams.seq) {
        // 调试用：依次切换视图（复现切页问题）
        let delay = 900;
        hashParams.seq.split(",").forEach((v) => {
          setTimeout(() => switchView(v), delay);
          delay += 1400;
        });
      }
      if (hashParams.p) {
        // 调试用：直接打开行星面板 p=sysId:planetId
        const parts = hashParams.p.split(":");
        const psys = sysOf(parts[0]);
        const planet = psys && (psys.planets || []).find((x) => x.id === parts[1]);
        if (psys && planet) { renderSystemPanel(psys); renderPlanetPanel(psys, planet); }
        if (hashParams.pscroll) {
          setTimeout(() => {
            const body = document.querySelector("#map-system-panel .msp-body");
            if (body) body.scrollTop = body.scrollHeight;
          }, 500);
        }
      }
      if (hashParams.lore) {
        S.loreCat = hashParams.lore;
        switchView("lorebook");
      }
      return;
    }
    $("#title-screen").classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
