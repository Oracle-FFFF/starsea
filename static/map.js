/* ============================================================
   星海余烬 · 星图引擎 v0.05
   可缩放星图：银河全景 → 星区 → 星系 → 行星
   - 势力范围（影响图）、航道、星门、探索迷雾
   - 玩家位置标记与跃迁动画
   - 行星由种子确定性生成（视觉 + 档案）
   ============================================================ */
window.STARMAP = (function () {
  "use strict";

  const GAL_W = 2000, GAL_H = 2000;
  const EMBER = { x: 1000, y: 1000, r: 150 };

  /* ---------- 种子随机 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const seededUnit = (...parts) => {
    const rng = mulberry32(hashStr(parts.join("|")));
    return rng();
  };

  /* ---------- 状态 ---------- */
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let data = null;
  let cb = {};
  let cam = { x: GAL_W / 2, y: GAL_H / 2, scale: 0.52 };
  let camTarget = { ...cam };
  let mode = "galaxy";                 // galaxy | system
  let sysCam = { x: 0, y: 0, scale: 1.6 };
  let sysCamTarget = { ...sysCam };
  let selSystemId = null, selPlanetId = null, hoverKey = null;
  let explored = new Set();
  let playerSystemId = null;
  let filters = { territory: true, lanes: true, gates: true, names: true, fog: false };
  let minorSystems = [], allSystems = [], sysById = {}, lanes = [], gates = [];
  let territoryCanvas = null;
  let dragging = false, lastMouse = null, moved = 0, downPos = null;
  let travelAnim = null;
  let t = 0, lastFrame = performance.now();
  let rafId = null;
  let planetCanvasCache = {};
  let planetImgCache = {};

  /* ---------- 星系生成 ---------- */
  const NAME_A = ["苍", "白", "赤", "青", "蓝", "灰", "银", "金", "铜", "铁", "星", "光", "沙", "霜", "风", "火", "雷", "云", "月", "日", "新", "旧", "远", "孤", "双", "三", "九", "龙", "凤", "鹤", "狼", "鲸", "鹿", "雀", "鸦"];
  const NAME_B = ["湾", "港", "门", "谷", "原", "岭", "泉", "礁", "角", "丘", "井", "湖", "岩", "沙", "泽", "川", "垣", "关", "驿", "垒", "窟", "屿", "野", "洲", "滩", "岬"];
  const ECONS = ["agri", "mine", "forge", "trade", "slum", "refuge", "mixed", "mixed", "tech", "mine"];
  const PLANET_TYPES = [
    ["barren", 18], ["gas", 16], ["ice", 13], ["desert", 12], ["metal", 10], ["toxic", 8],
    ["lava", 7], ["ocean", 7], ["jungle", 4], ["rad", 3], ["gaia", 2],
  ];
  const PLANET_CN = {
    gaia: "盖亚", ocean: "海洋", desert: "荒漠", jungle: "丛林", ice: "冰封", lava: "熔岩",
    toxic: "剧毒", rad: "辐射", barren: "荒芜", metal: "金属", gas: "气态",
  };
  const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ"];
  const STAR_COLORS = ["#cfe4ff", "#fff4d6", "#ffd9a8", "#ffc2a0", "#dce8f5"];

  function pickWeighted(rng, table) {
    const total = table.reduce((s, x) => s + x[1], 0);
    let r = rng() * total;
    for (const [val, w] of table) { r -= w; if (r <= 0) return val; }
    return table[0][0];
  }

  function genPlanets(sysId, sysName, forceCount) {
    const rng = mulberry32(hashStr("planets|" + sysId));
    const count = forceCount || (1 + Math.floor(rng() * 5));
    const planets = [];
    for (let i = 0; i < count; i++) {
      const type = pickWeighted(rng, PLANET_TYPES);
      planets.push({
        id: sysId + "-p" + (i + 1),
        name: sysName + " " + ROMAN[i],
        type,
        typeCn: PLANET_CN[type],
        orbit: 0.62 + 0.28 * rng() + i * 0.22,
        angle: rng() * Math.PI * 2,
        size: 0.5 + rng() * 0.7,
        speed: (0.25 + rng() * 0.5) * (rng() > 0.5 ? 1 : -1),
        desc: null,
        generated: true,
      });
    }
    return planets;
  }

  function genMinorSystems(core) {
    const rng = mulberry32(3107);
    const out = [];
    const usedNames = new Set(core.map((s) => s.name));
    const usedPos = core.map((s) => ({ x: s.x, y: s.y }));
    const taken = (x, y) => {
      if (Math.hypot(x - EMBER.x, y - EMBER.y) < EMBER.r + 26) return true;
      if (x < 120 || x > GAL_W - 120 || y < 120 || y > GAL_H - 120) return true;
      return usedPos.some((p) => Math.hypot(p.x - x, p.y - y) < 44);
    };
    const name = () => {
      let n = NAME_A[Math.floor(rng() * NAME_A.length)] + NAME_B[Math.floor(rng() * NAME_B.length)];
      if (usedNames.has(n)) {
        n += ["甲", "乙", "丙", "丁", "戊"][Math.floor(rng() * 5)];
      }
      usedNames.add(n);
      return n;
    };
    for (const f of data.factions) {
      const region = f.homeRegion;
      const count = f.hidden ? 0 : 22 + Math.floor(rng() * 8);
      for (let i = 0; i < count; i++) {
        let x, y, tries = 0;
        do {
          const a = rng() * Math.PI * 2;
          const d = Math.sqrt(rng()) * region.r * 0.85;
          x = region.x + Math.cos(a) * d * 0.85;
          y = region.y + Math.sin(a) * d;
          tries++;
        } while (taken(x, y) && tries < 60);
        if (tries >= 60) continue;
        usedPos.push({ x, y });
        const id = "minor-" + f.id + "-" + i;
        out.push({
          id, name: name(), x, y,
          faction: f.id, tier: "minor",
          economy: ECONS[Math.floor(rng() * ECONS.length)],
          danger: 1 + Math.floor(rng() * 4),
          notes: "",
          planets: genPlanets(id, name()),
          generated: true,
        });
      }
    }
    // 无主星域
    for (let i = 0; i < 46; i++) {
      let x, y, tries = 0;
      do {
        x = 150 + rng() * (GAL_W - 300);
        y = 150 + rng() * (GAL_H - 300);
        tries++;
      } while (taken(x, y) && tries < 80);
      if (tries >= 80) continue;
      usedPos.push({ x, y });
      const id = "minor-rim-" + i;
      const nm = name();
      out.push({
        id, name: nm, x, y,
        faction: "rim", tier: "minor",
        economy: ECONS[Math.floor(rng() * ECONS.length)],
        danger: 1 + Math.floor(rng() * 4),
        notes: "",
        planets: genPlanets(id, nm),
        generated: true,
      });
    }
    return out;
  }

  function autoLanes() {
    // 为每个生成星系连接最近的两个邻居，限距 280
    const added = [];
    for (const s of minorSystems) {
      const near = allSystems
        .filter((o) => o.id !== s.id)
        .map((o) => ({ o, d: Math.hypot(o.x - s.x, o.y - s.y) }))
        .filter((e) => e.d < 280)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const e of near) {
        const pair = [s.id, e.o.id].sort().join("|");
        if (!lanes.some((l) => l.key === pair)) {
          lanes.push({ a: s.id, b: e.o.id, key: pair, auto: true });
          added.push({ a: s.id, b: e.o.id, key: pair, auto: true });
        }
      }
    }
    return added;
  }

  /* ---------- 势力范围 ---------- */
  function buildTerritory() {
    const size = 180;
    const off = document.createElement("canvas");
    off.width = size; off.height = size;
    const octx = off.getContext("2d");
    const img = octx.createImageData(size, size);
    const facs = data.factions.filter((f) => !f.hidden || f.id === "lucent");
    const influence = (sys) => {
      if (sys.tier === "capital") return 340;
      if (sys.tier === "core" || sys.tier === "hub") return 170;
      if (sys.tier === "hidden") return 80;
      return 110;
    };
    // 预计算每个势力的系统列表
    const facSystems = facs.map((f) => ({
      f, sys: allSystems.filter((s) => s.faction === f.id),
    }));
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wx = (px / size) * GAL_W, wy = (py / size) * GAL_H;
        const idx = (py * size + px) * 4;
        let best = null, bestVal = 75;
        for (const { f, sys } of facSystems) {
          if (!sys.length) continue;
          let minVal = Infinity;
          for (const s of sys) {
            const d = Math.hypot(s.x - wx, s.y - wy) - influence(s);
            if (d < minVal) minVal = d;
          }
          if (minVal < bestVal) { bestVal = minVal; best = f; }
        }
        // 烬海
        const de = Math.hypot(EMBER.x - wx, EMBER.y - wy);
        if (de < EMBER.r) {
          img.data[idx] = 60; img.data[idx + 1] = 26; img.data[idx + 2] = 34;
          img.data[idx + 3] = 200 + 55 * (1 - de / EMBER.r);
          continue;
        }
        if (best) {
          const c = hexToRgb(best.color);
          const edge = Math.max(0, Math.min(1, 1 - (bestVal - 0) / 90));
          img.data[idx] = c.r; img.data[idx + 1] = c.g; img.data[idx + 2] = c.b;
          img.data[idx + 3] = Math.round(46 + 92 * edge);
        } else {
          img.data[idx] = 90; img.data[idx + 1] = 100; img.data[idx + 2] = 120;
          img.data[idx + 3] = 26;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    territoryCanvas = off;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 };
  }

  /* ---------- 行星贴图 ---------- */
  const PLANET_PALETTE = {
    gaia: [["#2d7a4f", "#4fae72", "#1d4f6e"], ["#7fc99a", "#b8e3c4", "#e8f4ee"]],
    ocean: [["#163e6e", "#2a6ea8", "#0e2a4a"], ["#7fb8e8", "#c9e6f8", "#ffffff"]],
    desert: [["#8a5a2b", "#c89a52", "#5c3a18"], ["#e8c98a", "#f4e3b8", "#d8a860"]],
    jungle: [["#1d4a2a", "#2f7a3f", "#123420"], ["#57b04a", "#8fce7e", "#3a7a30"]],
    ice: [["#7fa8c9", "#b8d4e8", "#4a6a8a"], ["#e8f4fa", "#ffffff", "#c9e0ee"]],
    lava: [["#5c1a12", "#a83a24", "#2e0d08"], ["#e8623f", "#f4a05e", "#8a2414"]],
    toxic: [["#4a6a2a", "#7a9a4a", "#2a3a12"], ["#c9d86a", "#e8f08a", "#8a9a3a"]],
    rad: [["#3a4a2a", "#6a7a4a", "#1a2412"], ["#b8e86a", "#d8f89a", "#5a7a2a"]],
    barren: [["#5a5f6a", "#8a909c", "#3a3f48"], ["#b8bec8", "#d8dde4", "#7a808a"]],
    metal: [["#4a525e", "#7a8494", "#2a2e38"], ["#b0bcc8", "#d8e0e8", "#6a7684"]],
    gas: [["#8a6a4a", "#c8a06e", "#5c4228"], ["#e8d0a8", "#f8e8cc", "#b08a58"]],
  };

  function planetVisual(planet) {
    if (planetCanvasCache[planet.id]) return planetCanvasCache[planet.id];
    const c = document.createElement("canvas");
    c.width = 96; c.height = 96;
    const g = c.getContext("2d");
    const [dark, light] = PLANET_PALETTE[planet.type] || PLANET_PALETTE.barren;
    const rng = mulberry32(hashStr("vis|" + planet.id));
    const grad = g.createRadialGradient(30, 28, 6, 48, 48, 50);
    grad.addColorStop(0, light[0]);
    grad.addColorStop(0.55, dark[0]);
    grad.addColorStop(1, dark[2]);
    g.fillStyle = grad;
    g.beginPath(); g.arc(48, 48, 46, 0, Math.PI * 2); g.fill();
    // 随机地貌斑点
    const spots = 5 + Math.floor(rng() * 7);
    for (let i = 0; i < spots; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 34;
      const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d, r = 5 + rng() * 13;
      const c2 = rng() > 0.5 ? dark[1 + Math.floor(rng() * 2)] : light[1 + Math.floor(rng() * 2)];
      g.globalAlpha = 0.3 + rng() * 0.4;
      g.fillStyle = c2;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // 气态巨星条带
    if (planet.type === "gas") {
      g.globalAlpha = 0.22;
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? "#f4e4c0" : "#7a5a38";
        g.beginPath();
        g.ellipse(48, 48 + (i - 1.5) * 15, 46, 8, 0.15, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // 极冠
    if (planet.type === "ice" || planet.type === "gaia" || planet.type === "barren") {
      g.fillStyle = "rgba(240,248,255,0.75)";
      g.beginPath(); g.arc(48, 14, 20, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(48, 82, 18, 0, Math.PI * 2); g.fill();
    }
    const url = c.toDataURL();
    planetCanvasCache[planet.id] = url;
    return url;
  }

  /* ---------- 坐标转换 ---------- */
  function worldToScreen(wx, wy) {
    return {
      x: (wx - cam.x) * cam.scale + W / 2,
      y: (wy - cam.y) * cam.scale + H / 2,
    };
  }
  function screenToWorld(sx, sy) {
    return {
      x: (sx - W / 2) / cam.scale + cam.x,
      y: (sy - H / 2) / cam.scale + cam.y,
    };
  }
  function sysWorldToScreen(wx, wy) {
    return {
      x: wx * sysCam.scale + W / 2 + sysCam.x,
      y: wy * sysCam.scale + H / 2 + sysCam.y,
    };
  }
  function sysScreenToWorld(sx, sy) {
    return {
      x: (sx - W / 2 - sysCam.x) / sysCam.scale,
      y: (sy - H / 2 - sysCam.y) / sysCam.scale,
    };
  }

  /* ---------- 渲染 ---------- */
  function visibleBounds() {
    const tl = screenToWorld(0, 0), br = screenToWorld(W, H);
    return { x0: tl.x - 60, y0: tl.y - 60, x1: br.x + 60, y1: br.y + 60 };
  }

  function drawBackground() {
    ctx.fillStyle = "#03050c";
    ctx.fillRect(0, 0, W, H);
    // 深空星尘
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = seededUnit("dust", i) * W, y = seededUnit("dusty", i) * H;
      const tw = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.001 + i * 1.7));
      ctx.fillStyle = "rgba(160,200,255," + (0.05 + 0.1 * tw) + ")";
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();
  }

  function drawTerritory() {
    if (!filters.territory || !territoryCanvas) return;
    const zoom = cam.scale;
    if (zoom > 1.4) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = zoom < 0.35 ? 0.9 : 0.55;
    ctx.drawImage(territoryCanvas, 0, 0, GAL_W, GAL_H);
    ctx.restore();
  }

  function drawLanes() {
    if (!filters.lanes) return;
    const zoom = cam.scale;
    if (zoom < 0.22 || zoom > 3.6) return;
    const bounds = visibleBounds();
    const alpha = Math.min(0.85, Math.max(0.12, (zoom - 0.22) * 1.2));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(122,180,255," + alpha + ")";
    ctx.beginPath();
    for (const lane of lanes) {
      const a = sysById[lane.a], b = sysById[lane.b];
      if (!a || !b) continue;
      if (a.x < bounds.x0 || a.x > bounds.x1 || a.y < bounds.y0 || a.y > bounds.y1) continue;
      if (b.x < bounds.x0 || b.x > bounds.x1 || b.y < bounds.y0 || b.y > bounds.y1) continue;
      const p1 = worldToScreen(a.x, a.y), p2 = worldToScreen(b.x, b.y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawGates() {
    if (!filters.gates) return;
    const zoom = cam.scale;
    if (zoom < 0.16 || zoom > 4) return;
    const bounds = visibleBounds();
    ctx.save();
    for (const gate of gates) {
      const a = sysById[gate.a], b = sysById[gate.b];
      if (!a || !b) continue;
      if (a.x < bounds.x0 || a.x > bounds.x1 || a.y < bounds.y0 || a.y > bounds.y1) continue;
      if (b.x < bounds.x0 || b.x > bounds.x1 || b.y < bounds.y0 || b.y > bounds.y1) continue;
      const p1 = worldToScreen(a.x, a.y), p2 = worldToScreen(b.x, b.y);
      ctx.strokeStyle = "rgba(232,201,90,0.55)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * 22, ny = dx / len * 22;
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mid.x + nx, mid.y + ny, p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(232,201,90,0.9)";
      ctx.font = "11px sans-serif";
      ctx.fillText("✦ " + gate.name, mid.x + nx * 0.4, mid.y + ny * 0.4 - 8);
    }
    ctx.restore();
  }

  function factionOf(sys) {
    if (!sys.faction) return null;
    return data.factions.find((f) => f.id === sys.faction) || null;
  }

  function drawSystems() {
    const zoom = cam.scale;
    const bounds = visibleBounds();
    const showNames = filters.names && zoom > 0.34;
    const coreNames = filters.names && zoom > 0.2 && zoom < 0.34;
    ctx.save();
    for (const sys of allSystems) {
      if (sys.x < bounds.x0 || sys.x > bounds.x1 || sys.y < bounds.y0 || sys.y > bounds.y1) continue;
      const fac = factionOf(sys);
      const color = fac ? fac.color : "#7a8494";
      const isCore = sys.tier !== "minor";
      const isSelected = sys.id === selSystemId;
      const isPlayer = sys.id === playerSystemId;
      const isExplored = explored.has(sys.id);
      const p = worldToScreen(sys.x, sys.y);
      const fogged = filters.fog && !isExplored && sys.tier === "minor" && zoom > 0.8;
      const size = isCore ? (zoom < 0.3 ? 2.2 : zoom < 1.1 ? 3 : 4.2) : (zoom < 0.3 ? 1.4 : zoom < 1.1 ? 2 : 2.8);

      // 微光
      if (zoom > 0.3) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
        glow.addColorStop(0, color + "55");
        glow.addColorStop(1, color + "00");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2); ctx.fill();
      }
      // 主体
      if (fogged) {
        ctx.fillStyle = "rgba(140,160,190,0.5)";
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.9, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.42, 0, Math.PI * 2); ctx.fill();
      }
      // 首都 / 枢纽标记
      if ((sys.tier === "capital" || sys.tier === "hidden") && zoom > 0.16) {
        const fac2 = factionOf(sys);
        ctx.font = (10 + Math.min(6, zoom * 4)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(fac2 ? fac2.flag : "✦", p.x, p.y - size - 5);
      }
      // 玩家位置脉冲
      if (isPlayer && !travelAnim) {
        const pulse = 1 + 0.35 * Math.sin(t * 0.004);
        ctx.strokeStyle = "rgba(232,201,90," + (0.9 - 0.4 * (pulse - 1)) + ")";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, size + 6 * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#e8c95a";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("▲", p.x, p.y + size + 14);
      }
      // 选中
      if (isSelected && !travelAnim) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, size + 5, 0, Math.PI * 2); ctx.stroke();
      }
      // 名称
      if (showNames && (isCore || zoom > 1.1 || isSelected || isPlayer)) {
        ctx.font = (isCore ? 12 : 11) + "px 'Segoe UI','Microsoft YaHei',sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = isSelected || isPlayer ? "#ffffff" : "rgba(200,220,245,0.85)";
        ctx.fillText(sys.name, p.x, p.y + size + 14);
      } else if (coreNames && isCore) {
        ctx.font = "11px 'Segoe UI','Microsoft YaHei',sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(200,220,245,0.8)";
        ctx.fillText(sys.name, p.x, p.y + 10);
      }
    }
    ctx.restore();
  }

  function drawTravelAnim() {
    if (!travelAnim) return;
    const a = sysById[travelAnim.from], b = sysById[travelAnim.to];
    if (!a || !b) return;
    const k = travelAnim.progress;
    const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    const p = worldToScreen(x, y);
    ctx.save();
    ctx.strokeStyle = "rgba(232,201,90,0.5)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    const pa = worldToScreen(a.x, a.y);
    ctx.moveTo(pa.x, pa.y); ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
    glow.addColorStop(0, "rgba(232,201,90,0.95)");
    glow.addColorStop(1, "rgba(232,201,90,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawSystemView() {
    const sys = selSystemId ? sysById[selSystemId] : null;
    if (!sys) return;
    ctx.save();
    // 背景
    ctx.fillStyle = "#03050c";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = seededUnit("sdust", i) * W, y = seededUnit("sdusty", i) * H;
      ctx.fillStyle = "rgba(160,200,255," + (0.04 + 0.08 * (0.5 + 0.5 * Math.sin(t * 0.001 + i))) + ")";
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    const starColor = STAR_COLORS[hashStr("star|" + sys.id) % STAR_COLORS.length];
    const sp = sysWorldToScreen(0, 0);
    // 恒星
    const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 130 * sysCam.scale);
    glow.addColorStop(0, starColor + "ee");
    glow.addColorStop(0.25, starColor + "88");
    glow.addColorStop(1, starColor + "00");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 130 * sysCam.scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 16 * sysCam.scale * 0.5 + 5, 0, Math.PI * 2); ctx.fill();
    // 恒星名
    ctx.font = "14px 'Segoe UI','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(220,235,255,0.9)";
    ctx.fillText(sys.name, sp.x, sp.y + 32 * sysCam.scale + 22);
    // 行星轨道
    const planets = sys.planets || [];
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const r = (i + 1) * 62 + 40;
      const rr = r * sysCam.scale;
      ctx.strokeStyle = "rgba(122,180,255,0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, rr, 0, Math.PI * 2); ctx.stroke();
      const ang = p.angle + t * 0.00012 * (p.speed || 1);
      const px = sp.x + Math.cos(ang) * rr, py = sp.y + Math.sin(ang) * rr * 0.86;
      const pr = Math.max(5, (p.size || 0.8) * 9 * sysCam.scale);
      // 行星贴图（缓存 Image）
      let img = planetImgCache[p.id];
      if (!img) {
        img = new Image();
        img.src = planetVisual(p);
        planetImgCache[p.id] = img;
      }
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.clip();
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, px - pr, py - pr, pr * 2, pr * 2);
      } else {
        const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.2, px, py, pr);
        pg.addColorStop(0, "#9ab8d8");
        pg.addColorStop(1, "#3a4a60");
        ctx.fillStyle = pg;
        ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.stroke();
      const isSel = selPlanetId === p.id;
      if (isSel) {
        ctx.strokeStyle = "#e8c95a";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(px, py, pr + 4, 0, Math.PI * 2); ctx.stroke();
      }
      if (sysCam.scale > 1.7) {
        ctx.font = "11px 'Segoe UI','Microsoft YaHei',sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = isSel ? "#ffffff" : "rgba(200,220,245,0.8)";
        ctx.fillText(p.name + " · " + (p.typeCn || ""), px, py + pr + 13);
      }
    }
    ctx.restore();
  }

  function render() {
    if (mode === "galaxy") {
      drawBackground();
      drawTerritory();
      drawLanes();
      drawGates();
      drawSystems();
      drawTravelAnim();
    } else {
      drawSystemView();
    }
  }

  /* ---------- 交互 ---------- */
  function hitTestSystem(sx, sy) {
    const w = screenToWorld(sx, sy);
    let best = null, bestD = 16 / Math.max(cam.scale, 0.2);
    for (const sys of allSystems) {
      const d = Math.hypot(sys.x - w.x, sys.y - w.y);
      if (d < bestD) { bestD = d; best = sys; }
    }
    return best;
  }
  function hitTestPlanet(sx, sy) {
    const sys = selSystemId ? sysById[selSystemId] : null;
    if (!sys) return null;
    const sp = sysWorldToScreen(0, 0);
    const planets = sys.planets || [];
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const r = (i + 1) * 62 + 40;
      const rr = r * sysCam.scale;
      const ang = p.angle + t * 0.00012 * (p.speed || 1);
      const px = sp.x + Math.cos(ang) * rr, py = sp.y + Math.sin(ang) * rr * 0.86;
      const pr = Math.max(7, (p.size || 0.8) * 9 * sysCam.scale);
      if (Math.hypot(sx - px, sy - py) <= pr + 5) return p;
    }
    return null;
  }

  function canvasPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onWheel(ev) {
    ev.preventDefault();
    const pos = canvasPos(ev);
    const factor = Math.pow(1.0015, -ev.deltaY);
    if (mode === "galaxy") {
      const w = screenToWorld(pos.x, pos.y);
      const scale = Math.min(5, Math.max(0.12, camTarget.scale * factor));
      camTarget.scale = scale;
      camTarget.x = w.x - (pos.x - W / 2) / scale;
      camTarget.y = w.y - (pos.y - H / 2) / scale;
    } else {
      const w = sysScreenToWorld(pos.x, pos.y);
      const scale = Math.min(5.5, Math.max(0.7, sysCamTarget.scale * factor));
      sysCamTarget.scale = scale;
      sysCamTarget.x = (pos.x - W / 2) - w.x * scale;
      sysCamTarget.y = (pos.y - H / 2) - w.y * scale;
    }
  }

  function onMouseDown(ev) {
    dragging = true;
    moved = 0;
    downPos = canvasPos(ev);
    lastMouse = downPos;
    canvas.classList.add("panning");
  }
  function onMouseMove(ev) {
    const pos = canvasPos(ev);
    if (dragging && lastMouse) {
      const dx = pos.x - lastMouse.x, dy = pos.y - lastMouse.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (mode === "galaxy") {
        camTarget.x -= dx / cam.scale;
        camTarget.y -= dy / cam.scale;
      } else {
        sysCamTarget.x += dx;
        sysCamTarget.y += dy;
      }
    }
    lastMouse = pos;
    // 悬停
    const hit = mode === "galaxy" ? hitTestSystem(pos.x, pos.y) : hitTestPlanet(pos.x, pos.y);
    const key = hit ? hit.id : null;
    if (key !== hoverKey) {
      hoverKey = key;
      canvas.style.cursor = hit ? "pointer" : dragging ? "grabbing" : "grab";
      showTooltip(hit, pos);
    } else if (!hit) {
      hideTooltip();
    }
    if (hit && (hoverKey === key)) {
      moveTooltip(pos);
    }
  }
  function onMouseUp(ev) {
    dragging = false;
    canvas.classList.remove("panning");
  }
  function onClick(ev) {
    if (moved > 6) return;
    const pos = canvasPos(ev);
    if (mode === "galaxy") {
      const sys = hitTestSystem(pos.x, pos.y);
      if (sys && cb.onSystemClick) cb.onSystemClick(sys);
    } else {
      const p = hitTestPlanet(pos.x, pos.y);
      if (p && cb.onPlanetClick) cb.onPlanetClick(p);
    }
  }
  function onDblClick(ev) {
    const pos = canvasPos(ev);
    if (mode === "galaxy") {
      const sys = hitTestSystem(pos.x, pos.y);
      if (sys) enterSystem(sys.id);
    } else {
      exitSystem();
    }
  }

  const tooltipEl = () => document.getElementById("map-tooltip");
  function showTooltip(hit, pos) {
    const el = tooltipEl();
    if (!el) return;
    if (!hit) { hideTooltip(); return; }
    if (hit.faction !== undefined) {
      const fac = factionOf(hit);
      const stateText = explored.has(hit.id) ? "" : " · 未勘测";
      el.innerHTML =
        '<div class="tt-name">' + (fac ? '<span style="color:' + fac.color + '">●</span> ' : "") + hit.name + "</div>" +
        '<div class="tt-fac">' + (fac ? fac.name : "无主星域") + " · " + (hit.tier === "capital" ? "首都" : hit.tier === "core" ? "核心" : hit.tier === "hub" ? "枢纽" : hit.tier === "ruin" ? "遗迹带" : hit.tier === "hidden" ? "隐世" : "边缘星系") + stateText + "</div>" +
        (hit.notes ? '<div class="tt-note">' + hit.notes + "</div>" : "");
      el.classList.remove("hidden");
      moveTooltip(pos);
    } else {
      el.innerHTML =
        '<div class="tt-name">' + hit.name + "</div>" +
        '<div class="tt-fac">' + (hit.typeCn || "") + "行星</div>";
      el.classList.remove("hidden");
      moveTooltip(pos);
    }
  }
  function moveTooltip(pos) {
    const el = tooltipEl();
    if (!el || el.classList.contains("hidden")) return;
    const x = Math.min(pos.x + 16, W - 320);
    const y = Math.min(pos.y + 16, H - 120);
    el.style.left = x + "px";
    el.style.top = y + "px";
  }
  function hideTooltip() {
    const el = tooltipEl();
    if (el) el.classList.add("hidden");
  }

  /* ---------- 动画循环 ---------- */
  function loop(now) {
    const dt = now - lastFrame;
    lastFrame = now;
    t += dt;
    // 相机缓动
    cam.x += (camTarget.x - cam.x) * 0.14;
    cam.y += (camTarget.y - cam.y) * 0.14;
    cam.scale += (camTarget.scale - cam.scale) * 0.14;
    sysCam.x += (sysCamTarget.x - sysCam.x) * 0.14;
    sysCam.y += (sysCamTarget.y - sysCam.y) * 0.14;
    sysCam.scale += (sysCamTarget.scale - sysCam.scale) * 0.14;
    if (travelAnim) {
      travelAnim.progress += dt / travelAnim.duration;
      if (travelAnim.progress >= 1) {
        const done = travelAnim.onDone;
        travelAnim = null;
        if (done) done();
      }
    }
    render();
    rafId = requestAnimationFrame(loop);
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width; H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- 公开 API ---------- */
  function init(canvasEl, callbacks) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    cb = callbacks || {};
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("mouseleave", hideTooltip);
    rafId = requestAnimationFrame(loop);
  }

  function loadData(core) {
    data = core;
    lanes = core.lanes.map((l) => ({ a: l[0], b: l[1], key: l.slice().sort().join("|") }));
    gates = core.gates;
    minorSystems = genMinorSystems(core.systems);
    allSystems = core.systems.concat(minorSystems);
    sysById = {};
    allSystems.forEach((s) => { sysById[s.id] = s; });
    autoLanes();
    buildTerritory();
  }

  function setExplored(list) {
    explored = new Set(list || []);
  }
  function setPlayerLocation(id) {
    playerSystemId = id;
  }
  function setFilter(name, on) {
    filters[name] = on;
  }
  function selectSystem(id, opts) {
    selSystemId = id;
    selPlanetId = null;
    if (opts && opts.fly) flyToSystem(id);
  }
  function selectPlanet(planetId) {
    selPlanetId = planetId;
  }
  function flyToSystem(id) {
    const sys = sysById[id];
    if (!sys) return;
    if (mode !== "galaxy") { mode = "galaxy"; }
    const scale = Math.max(cam.scale, 1.05);
    camTarget = { x: sys.x, y: sys.y, scale };
  }
  function goHome() {
    if (!playerSystemId) { resetView(); return; }
    flyToSystem(playerSystemId);
    selectSystem(playerSystemId);
  }
  function resetView() {
    if (mode === "galaxy") {
      camTarget = { x: GAL_W / 2, y: GAL_H / 2, scale: 0.52 };
    } else {
      sysCamTarget = { x: 0, y: 0, scale: 1.6 };
    }
  }
  function zoomStep(dir) {
    if (mode === "galaxy") {
      camTarget.scale = Math.min(5, Math.max(0.12, camTarget.scale * (dir > 0 ? 1.3 : 1 / 1.3)));
    } else {
      sysCamTarget.scale = Math.min(5.5, Math.max(0.7, sysCamTarget.scale * (dir > 0 ? 1.3 : 1 / 1.3)));
    }
  }
  function enterSystem(id) {
    if (!sysById[id]) return;
    selSystemId = id;
    mode = "system";
    sysCam = { x: 0, y: 0, scale: 1.4 };
    sysCamTarget = { x: 0, y: 0, scale: 1.6 };
    selPlanetId = null;
    if (cb.onEnterSystem) cb.onEnterSystem(sysById[id]);
  }
  function exitSystem() {
    mode = "galaxy";
    selPlanetId = null;
    if (cb.onExitSystem) cb.onExitSystem();
  }
  function isSystemMode() { return mode === "system"; }
  function animateTravel(fromId, toId, duration, onDone) {
    travelAnim = { from: fromId, to: toId, progress: 0, duration: duration || 1100, onDone };
    selectSystem(toId);
    flyToSystem(toId);
  }
  function getSystems() { return allSystems; }
  function getSystem(id) { return sysById[id]; }
  function getPlanetVisualUrl(planet) { return planetVisual(planet); }
  function currentScale() { return mode === "galaxy" ? cam.scale : sysCam.scale; }

  return {
    init, loadData, setExplored, setPlayerLocation, setFilter,
    selectSystem, selectPlanet, flyToSystem, goHome, resetView, zoomStep,
    enterSystem, exitSystem, isSystemMode, animateTravel,
    getSystems, getSystem, getPlanetVisualUrl, currentScale,
  };
})();
