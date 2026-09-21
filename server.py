# -*- coding: utf-8 -*-
"""
《星海余烬 · EMBERS OF THE STAR SEA》v0.05 本地服务器（零第三方依赖）。

仅使用 Python 标准库：
  - 静态文件 + API 服务（http.server）
  - 存档（sqlite3）
  - LLM 代理（urllib，OpenAI 兼容 /chat/completions，支持流式转发）
  - 市场行情 / AI 星球生成

启动：python server.py [--port 8090] [--host 127.0.0.1]
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
DATA_DIR = BASE_DIR / "data"
DB_PATH = BASE_DIR / "runtime" / "starsea.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

VERSION = "0.05"
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}

# ---------------------------------------------------------------- 数据加载
_data_cache = {}


def load_json(name):
    if name not in _data_cache:
        path = DATA_DIR / (name + ".json")
        with open(path, "r", encoding="utf-8") as fh:
            _data_cache[name] = json.load(fh)
    return _data_cache[name]


def galaxy():
    return load_json("galaxy_core")


def characters():
    return load_json("characters")


def lorebook():
    return load_json("lorebook")


def master_card():
    return load_json("master_card")


# ---------------------------------------------------------------- 数据库
_conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
_conn.row_factory = sqlite3.Row
_db_lock = threading.Lock()


def db_execute(sql, params=()):
    with _db_lock:
        cur = _conn.execute(sql, params)
        _conn.commit()
        return cur


def db_query(sql, params=()):
    with _db_lock:
        cur = _conn.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def init_db():
    db_execute(
        """CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created REAL NOT NULL,
            updated REAL NOT NULL,
            config TEXT NOT NULL,
            state TEXT NOT NULL
        )"""
    )
    db_execute(
        """CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT DEFAULT '',
            content TEXT NOT NULL,
            meta TEXT DEFAULT '',
            created REAL NOT NULL
        )"""
    )


def get_session(session_id, with_messages=False):
    row = db_query("SELECT * FROM sessions WHERE id=?", (session_id,))
    if not row:
        return None
    session = dict(row[0])
    session["config"] = json.loads(session["config"])
    session["state"] = json.loads(session["state"])
    if with_messages:
        session["messages"] = db_query(
            "SELECT id, role, name, content, meta, created FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,),
        )
    return session


def list_sessions():
    rows = db_query("SELECT id, title, created, updated FROM sessions ORDER BY updated DESC")
    for row in rows:
        try:
            state = json.loads(db_query("SELECT state FROM sessions WHERE id=?", (row["id"],))[0]["state"])
            row["player_name"] = (state.get("player") or {}).get("name") or "旅人"
            row["location"] = (state.get("location") or {}).get("system") or "?"
        except Exception:
            row["player_name"] = "旅人"
            row["location"] = "?"
    return rows


def save_state(session_id, state):
    db_execute(
        "UPDATE sessions SET state=?, updated=? WHERE id=?",
        (json.dumps(state, ensure_ascii=False), time.time(), session_id),
    )


def add_message(session_id, role, content, name="", meta=None):
    db_execute(
        "INSERT INTO messages (session_id, role, name, content, meta, created) VALUES (?,?,?,?,?,?)",
        (session_id, role, name, content, json.dumps(meta or {}, ensure_ascii=False), time.time()),
    )
    db_execute("UPDATE sessions SET updated=? WHERE id=?", (time.time(), session_id))


def clear_messages(session_id):
    db_execute("DELETE FROM messages WHERE session_id=?", (session_id,))


# ---------------------------------------------------------------- 市场行情
ECONOMY_FACTOR = {
    "tech": {"coil": 0.88, "cyber": 0.92, "chip": 0.86, "ore": 1.18, "alloy": 1.12},
    "agri": {"food": 0.82, "water": 0.88, "lux": 1.15, "med": 1.08},
    "mine": {"ore": 0.78, "alloy": 0.85, "water": 1.1, "food": 1.12},
    "forge": {"alloy": 0.8, "cyber": 0.86, "weapon": 0.9, "ore": 1.05, "food": 1.15},
    "trade": {"chip": 0.92, "lux": 0.94},
    "military": {"weapon": 0.85, "med": 1.1, "lux": 1.2, "food": 1.08},
    "slum": {"food": 1.22, "med": 1.25, "lux": 0.9, "weapon": 1.12, "chip": 0.95},
    "ruin": {"relic": 0.72, "weapon": 1.2, "med": 1.18, "alloy": 0.92},
    "occult": {"relic": 0.7, "chip": 1.25, "lux": 1.15},
    "refuge": {"food": 1.18, "med": 1.2, "water": 1.12, "lux": 0.88},
    "lux": {"lux": 0.82, "food": 1.2, "water": 1.15},
    "mixed": {},
}


def _seed_unit(*parts):
    h = hashlib.md5("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return ((int(h[:8], 16) % 100000) / 100000.0)


def market_prices(system_id, day):
    g = galaxy()
    system = next((s for s in g["systems"] if s["id"] == system_id), None)
    economy = (system or {}).get("economy", "mixed")
    danger = (system or {}).get("danger", 2) or 2
    prices = {}
    for com in g["commodities"]:
        unit = _seed_unit(system_id, day, com["id"])
        wave = 1.0 + 0.08 * _seed_unit("wave", day // 3, com["id"]) - 0.04
        econ = ECONOMY_FACTOR.get(economy, {}).get(com["id"], 1.0)
        risk = 1.0 + 0.06 * (danger - 2)
        price = round(com["base"] * (0.74 + 0.62 * unit) * econ * risk * wave, 1)
        prices[com["id"]] = price
    return prices


# ---------------------------------------------------------------- 世界书选取
def select_lore(recent_text, location_text, npc_faction, limit=14):
    entries = lorebook()["entries"]
    text = " ".join([str(recent_text or ""), str(location_text or ""), str(npc_faction or "")]).lower()
    picked = []
    for entry in entries:
        hit = any((key or "").lower() in text for key in entry.get("keys", []))
        if not hit and not entry.get("constant"):
            continue
        picked.append(entry)
    picked.sort(key=lambda e: -(int(e.get("priority") or 10)))
    core = [e for e in picked if e.get("constant")]
    extra = [e for e in picked if not e.get("constant")]
    chosen = (core[:8] + extra[: limit - len(core[:8])])[:limit]
    return chosen


def lore_text(entries):
    parts = []
    for entry in entries:
        parts.append("【%s】%s" % (entry["title"], entry["content"]))
    return "\n".join(parts)


# ---------------------------------------------------------------- 提示词组装
def origin_label(state):
    g = galaxy()
    oid = ((state.get("player") or {}).get("origin") or "")
    origin = next((o for o in g["origins"] if o["id"] == oid), None)
    return origin["name"] if origin else "流浪者"


def current_ship(state):
    fleet = state.get("fleet") or []
    idx = int(state.get("currentShip") or 0)
    if 0 <= idx < len(fleet):
        return fleet[idx]
    return {}


def system_block(system):
    if not system:
        return ""
    planets = "；".join(
        "%s（%s）" % (p.get("name", ""), p.get("desc", "")) for p in system.get("planets", [])
    )
    return "当前位置：%s（%s，危险度%d）。行星：%s" % (
        system.get("name", ""),
        system.get("notes", ""),
        system.get("danger", 2),
        planets,
    )


def build_system_prompt(session, npc, lore_entries):
    state = session.get("state") or {}
    player = state.get("player") or {}
    g = galaxy()
    ship = current_ship(state)
    system = next((s for s in g["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
    master = master_card()["data"]
    lines = [
        master.get("system_prompt", ""),
        "【你的身份】%s——%s" % (master.get("name", ""), master.get("description", "")),
        "【叙事规则】" + master.get("creator_notes", ""),
        "【时代背景】星历3107年·余烬纪元。%s" % master.get("scenario", ""),
        "【玩家角色】%s，身份：%s，舰船：%s，资金：%d晶。%s"
        % (
            player.get("name", "旅人"),
            origin_label(state),
            ship.get("name", "旧船"),
            int(player.get("credits") or 0),
            "当前声望：" + "，".join("%s=%d" % (k, v) for k, v in (player.get("rep") or {}).items()) if (player.get("rep") or {}) else "暂无阵营声望",
        ),
    ]
    if system:
        lines.append(system_block(system))
        planets = system.get("planets") or []
        landed = (state.get("location") or {}).get("planet")
        if landed:
            planet = next((p for p in planets if p["id"] == landed), None)
            if planet:
                lines.append("玩家当前已登陆行星：%s（%s）" % (planet.get("name"), planet.get("desc")))
    if npc:
        lines.append(
            "【当前对话对象 NPC】%s（%s，%s，%s）\n外貌：%s\n性格：%s\n背景：%s\n目标：%s\n对玩家的开场：%s"
            % (
                npc.get("name"), npc.get("title", ""), npc.get("faction", ""), npc.get("occupation", ""),
                npc.get("appearance", ""), npc.get("personality", ""), npc.get("background", ""),
                npc.get("goals", ""), npc.get("greeting", ""),
            )
        )
    if lore_entries:
        lines.append("【世界书（相关设定）】\n" + lore_text(lore_entries))
    lines.append(
        "【输出要求】用中文以第二人称叙事；你扮演所有 NPC（按角色卡设定），玩家台词与行动完全由玩家决定，"
        "不得替玩家说话或行动；回复以场景描写推进，结尾停在需要玩家回应的节点；"
        "不输出任何标签、代码块或解释，直接输出正文。"
    )
    return "\n\n".join(lines)


# ---------------------------------------------------------------- LLM 调用
def normalize_api_base(url):
    url = (url or "").strip().rstrip("/")
    if url.endswith("/chat/completions"):
        url = url[: -len("/chat/completions")]
    return url


def llm_call(api_url, api_key, model, messages, temperature=0.8, max_tokens=2048, stream=False, timeout=300):
    url = normalize_api_base(api_url) + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }
    if stream:
        payload["stream"] = True
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key.strip()
    req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", "replace")[:800]
        except Exception:
            pass
        message = "API 返回 %d" % error.code
        try:
            detail = json.loads(body)
            err = detail.get("error") or {}
            if isinstance(err, dict):
                message += "：" + str(err.get("message") or err.get("code") or "")
            elif isinstance(err, str):
                message += "：" + err
            elif detail.get("message"):
                message += "：" + str(detail["message"])
        except Exception:
            if body:
                message += "：" + body[:200]
        raise RuntimeError(message)
    except urllib.error.URLError as error:
        raise RuntimeError("无法连接 API：" + str(getattr(error, "reason", error)))


def llm_reply(api_url, api_key, model, messages, temperature, max_tokens):
    response = llm_call(api_url, api_key, model, messages, temperature, max_tokens, stream=False)
    try:
        payload = json.loads(response.read().decode("utf-8"))
        content = payload["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                str(item.get("text") or "") if isinstance(item, dict) else str(item) for item in content
            )
        if not isinstance(content, str) or not content.strip():
            raise ValueError("模型返回了空内容")
        return content.strip()
    finally:
        response.close()


def extract_sse_delta(line):
    line = line.strip()
    if not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if not data or data == "[DONE]":
        return None
    try:
        obj = json.loads(data)
        delta = obj.get("choices", [{}])[0].get("delta", {})
        content = delta.get("content")
        if isinstance(content, str) and content:
            return content
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- 星球生成
PLANET_TYPE_INFO = {
    "gaia": "温带宜居世界，植被与海洋覆盖，是银河最珍贵的殖民目标。",
    "ocean": "全球海洋世界，渔业与浮城农业发达，风暴与洋流是这里的王。",
    "desert": "荒漠世界，沙海之下埋着矿脉与古河床，白天酷热，夜晚冰寒。",
    "jungle": "丛林世界，生态繁盛而危险，每走一步都可能有物种把你当作食物或宿主。",
    "ice": "冰封世界，冰壳之下或有液态海洋，淡水冰是它的硬通货。",
    "lava": "熔岩世界，地表翻涌着岩浆，矿藏丰富，只有义体与疯子能久留。",
    "toxic": "剧毒大气，酸雨常年，殖民地蜷缩在过滤穹顶之内。",
    "rad": "强辐射废土，生命在缝隙中变异求生，曦光遗物在此格外活跃。",
    "barren": "荒芜岩星，没有大气，没有水，只有灰尘与沉默，以及可能的旧基地。",
    "metal": "金属世界，高密度矿核，天然的重工业基地与都市化轨道站的载体。",
    "gas": "气态巨星，无法登陆，但轨道上的采气平台昼夜运转，产出燃料与稀有气体。",
}


def planet_fallback_lore(system, planet):
    info = PLANET_TYPE_INFO.get(planet.get("type", "barren"), "")
    unit = _seed_unit(planet.get("id", ""))
    population = ["荒无人烟", "数千人的哨站", "数万人的小殖民地", "数十万人的定居带", "数百万人的都会圈"][int(unit * 5) % 5]
    resources = next((c["name"] for c in galaxy()["commodities"] if c["id"] == planet.get("type", "barren")), None)
    resource_hint = {
        "gaia": "合成食物、奢侈品", "ocean": "净水冰、合成食物", "desert": "稀土矿、曦光文物",
        "jungle": "医疗凝胶、奢侈品", "ice": "净水冰、渊髓", "lava": "稀土矿、舰体合金",
        "toxic": "医疗凝胶、稀土矿", "rad": "曦光文物、渊髓", "barren": "数据晶片、曦光文物",
        "metal": "舰体合金、义体组件", "gas": "渊髓、超导线圈",
    }
    return (
        "【自动勘测档案 · %s】\n%s\n人口规模：%s。\n主要物产：%s。\n"
        "地表注记：这是由星图终端自动生成的初步档案，内容基于行星类型与轨道扫描。"
        "连接 AI 后可在星球面板中生成更详尽的叙事档案。"
        % (planet.get("name", "未知"), info, population, resource_hint.get(planet.get("type", "barren"), "未知"))
    )


def ai_planet_lore(system, planet, settings):
    api_url = (settings or {}).get("api_url", "")
    if not api_url:
        return None
    master = master_card()["data"]
    prompt = (
        "你是《星海余烬》的世界生成器。为下列行星撰写一份 200-300 字的原创探索档案，"
        "包含：地理风貌、殖民现状、主要物产、当地势力或传闻、至少一处可供冒险的看点。"
        "必须原创，符合余烬纪元科幻基调，不得引用现实作品。\n"
        "所属星系：%s（%s）\n行星：%s，类型：%s。\n直接输出档案正文，不要标题前缀。"
        % (system.get("name", ""), system.get("notes", ""), planet.get("name", ""), planet.get("type", ""))
    )
    messages = [
        {"role": "system", "content": master.get("system_prompt", "")},
        {"role": "user", "content": prompt},
    ]
    return llm_reply(api_url, settings.get("api_key", ""), settings.get("model", ""), messages, 0.9, 800)


# ---------------------------------------------------------------- HTTP 服务
class Handler(BaseHTTPRequestHandler):
    server_version = "STARSEA/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 安静一点
        pass

    # ---- 工具
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def route_path(self):
        path = self.path.split("?", 1)[0]
        return path

    def fail(self, message, status=400):
        self.send_json({"error": message}, status)

    # ---- 路由
    def do_GET(self):
        path = self.route_path()
        try:
            if path == "/" or path == "/index.html":
                html = (TEMPLATE_DIR / "index.html").read_text(encoding="utf-8")
                self.send_text(html, ctype="text/html; charset=utf-8")
            elif path.startswith("/static/"):
                rel = path[len("/static/"):]
                file_path = (STATIC_DIR / rel).resolve()
                if not str(file_path).startswith(str(STATIC_DIR.resolve())) or not file_path.is_file():
                    self.fail("资源不存在", 404)
                    return
                ext = file_path.suffix.lower()
                if ext not in MIME:
                    self.fail("不支持的文件类型", 415)
                    return
                body = file_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", MIME[ext])
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)
            elif path == "/api/health":
                self.send_json({"ok": True, "title": "星海余烬", "version": VERSION, "db": str(DB_PATH.name)})
            elif path == "/api/bootstrap":
                g = galaxy()
                self.send_json({
                    "meta": g["meta"],
                    "factions": g["factions"],
                    "systems": g["systems"],
                    "lanes": g["lanes"],
                    "gates": g["gates"],
                    "commodities": g["commodities"],
                    "origins": g["origins"],
                    "ships": g["ships"],
                    "characters": characters()["characters"],
                    "lorebook": lorebook()["entries"],
                    "master_card": master_card()["data"],
                    "version": VERSION,
                })
            elif path == "/api/sessions":
                self.send_json({"sessions": list_sessions()})
            elif path.startswith("/api/sessions/") and path.count("/") == 3:
                session_id = path.split("/")[3]
                session = get_session(session_id, with_messages=True)
                if not session:
                    self.fail("存档不存在", 404)
                    return
                self.send_json({"session": session})
            elif path == "/api/market":
                query = dict(pair.split("=", 1) for pair in (self.path.split("?", 1)[1].split("&") if "?" in self.path else []) if "=" in pair)
                system_id = query.get("system", "")
                day = int(query.get("day", "1") or "1")
                prices = market_prices(system_id, day)
                system = next((s for s in galaxy()["systems"] if s["id"] == system_id), None)
                self.send_json({"system": system_id, "day": day, "prices": prices, "economy": (system or {}).get("economy", "mixed")})
            else:
                self.fail("接口不存在", 404)
        except Exception as error:  # noqa: BLE001
            self.fail("服务器错误：" + str(error), 500)

    def do_POST(self):
        path = self.route_path()
        body = {}
        try:
            body = self.read_body()
            if path == "/api/sessions":
                g = galaxy()
                config = body.get("config") or {}
                player_name = str(config.get("player_name") or "").strip() or "无名旅人"
                origin = next((o for o in g["origins"] if o["id"] == config.get("origin")), None) or g["origins"][-1]
                ship = next((s for s in g["ships"] if s["id"] == origin["ship"]), g["ships"][0])
                state = {
                    "player": {
                        "name": player_name,
                        "origin": origin["id"],
                        "origin_label": origin["name"],
                        "credits": int(origin.get("credits") or 0),
                        "stats": dict(origin.get("stats") or {}),
                        "rep": dict(origin.get("rep") or {}),
                        "perks": list(origin.get("perks") or []),
                        "title": None,
                    },
                    "location": {"system": origin.get("startSystem"), "planet": None},
                    "fleet": [{"id": ship["id"], "name": ship["name"], "hull": ship["hull"], "hullMax": ship["hull"],
                               "shield": ship["shield"], "shieldMax": ship["shield"], "cargoCap": ship["cargo"],
                               "crew": ship["crew"], "speed": ship["speed"], "weapon": ship["weapon"],
                               "fuelCap": ship["fuel"], "custom": False}],
                    "currentShip": 0,
                    "cargo": {},
                    "fuel": ship["fuel"],
                    "explored": [origin.get("startSystem")],
                    "planetLog": {},
                    "day": 1,
                    "log": [{"day": 1, "text": "你在%s醒来，旧船的引擎第一次点火。星海就在舷窗之外。" % origin.get("startSystem")}],
                    "settings": {"api_url": "", "api_key": "", "model": "", "temperature": 0.8},
                }
                if origin["id"] == "noble":
                    state["cargo"] = {"lux": 2}
                if origin["id"] == "merchant":
                    state["player"]["credits"] = 1500
                    state["player"]["debt"] = 2000
                session_id = uuid.uuid4().hex[:12]
                now = time.time()
                db_execute(
                    "INSERT INTO sessions (id, title, created, updated, config, state) VALUES (?,?,?,?,?,?)",
                    (session_id, "%s的星海征途" % player_name, now, now,
                     json.dumps(config, ensure_ascii=False), json.dumps(state, ensure_ascii=False)),
                )
                greeting = master_card()["data"].get("first_mes", "")
                add_message(session_id, "assistant", greeting, "星海之主", {"kind": "greeting"})
                self.send_json({"session": get_session(session_id, with_messages=True)})
            elif path.startswith("/api/sessions/") and path.endswith("/chat"):
                session_id = path.split("/")[3]
                session = get_session(session_id)
                if not session:
                    self.fail("存档不存在", 404)
                    return
                message = str(body.get("message") or "").strip()
                if not message:
                    self.fail("消息不能为空")
                    return
                settings = dict(body.get("settings") or {})
                if not settings.get("api_url"):
                    self.fail("尚未配置 AI：请先打开「设置 → AI 连接」填写 OpenAI 兼容接口地址", 400)
                    return
                g = galaxy()
                state = session["state"]
                npc_id = body.get("character_id")
                npc = next((c for c in characters()["characters"] if c["id"] == npc_id), None) if npc_id else None
                history = db_query(
                    "SELECT role, name, content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 24",
                    (session_id,),
                )[::-1]
                system_id = (state.get("location") or {}).get("system")
                system = next((s for s in g["systems"] if s["id"] == system_id), None)
                recent = " ".join([m["content"] for m in history[-3:]] + [message])
                lore = select_lore(
                    recent,
                    "%s %s %s" % (system.get("name", "") if system else "", system.get("notes", "") if system else "", npc.get("faction", "") if npc else ""),
                    npc.get("faction", "") if npc else "",
                )
                system_prompt = build_system_prompt(session, npc, lore)
                llm_messages = [{"role": "system", "content": system_prompt}]
                for item in history:
                    role = "assistant" if item["role"] == "assistant" else "user"
                    content = item["content"]
                    llm_messages.append({"role": role, "content": content})
                llm_messages.append({"role": "user", "content": message})
                add_message(session_id, "user", message, state["player"].get("name", "旅人"))
                api_url = settings.get("api_url") or state.get("settings", {}).get("api_url")
                api_key = settings.get("api_key")
                if api_key is None:
                    api_key = state.get("settings", {}).get("api_key", "")
                model = settings.get("model") or state.get("settings", {}).get("model", "")
                temperature = float(settings.get("temperature", 0.8))
                reply = llm_reply(api_url, api_key, model, llm_messages, temperature, 2048)
                add_message(session_id, "assistant", reply, npc.get("name") if npc else "星海之主", {"npc": npc_id or ""})
                self.send_json({"reply": reply, "lore_used": [e["title"] for e in lore]})
            elif path.startswith("/api/sessions/") and path.endswith("/chat/stream"):
                self.stream_chat(path, body)
            elif path.startswith("/api/sessions/") and path.endswith("/state"):
                session_id = path.split("/")[3]
                session = get_session(session_id)
                if not session:
                    self.fail("存档不存在", 404)
                    return
                state = body.get("state")
                if not isinstance(state, dict):
                    self.fail("状态数据无效")
                    return
                save_state(session_id, state)
                self.send_json({"ok": True})
            elif path.startswith("/api/sessions/") and path.endswith("/rename"):
                session_id = path.split("/")[3]
                title = str(body.get("title") or "").strip()
                if not title:
                    self.fail("名称不能为空")
                    return
                if not db_query("SELECT id FROM sessions WHERE id=?", (session_id,)):
                    self.fail("存档不存在", 404)
                    return
                db_execute("UPDATE sessions SET title=? WHERE id=?", (title, session_id))
                self.send_json({"ok": True})
            elif path == "/api/planet/generate":
                system = next((s for s in galaxy()["systems"] if s["id"] == body.get("system_id")), None)
                if not system:
                    self.fail("星系不存在", 404)
                    return
                planet = next((p for p in system.get("planets", []) if p["id"] == body.get("planet_id")), None)
                if not planet:
                    self.fail("行星不存在", 404)
                    return
                settings = body.get("settings") or {}
                try:
                    ai_text = ai_planet_lore(system, planet, settings)
                except RuntimeError as error:
                    self.send_json({"text": planet_fallback_lore(system, planet) + "\n（AI 生成失败：%s）" % error, "ai": False})
                    return
                if ai_text:
                    self.send_json({"text": ai_text, "ai": True})
                else:
                    self.send_json({"text": planet_fallback_lore(system, planet), "ai": False})
            elif path == "/api/test-connection":
                settings = body or {}
                if not settings.get("api_url"):
                    self.fail("请填写 API 地址")
                    return
                started = time.time()
                try:
                    reply = llm_reply(
                        settings.get("api_url"), settings.get("api_key", ""), settings.get("model", ""),
                        [{"role": "user", "content": "请只回复四个字：连接正常"}], 0.2, 32,
                    )
                    self.send_json({"ok": True, "latency": round(time.time() - started, 2), "sample": reply[:60]})
                except RuntimeError as error:
                    self.send_json({"ok": False, "error": str(error)})
            else:
                self.fail("接口不存在", 404)
        except RuntimeError as error:
            self.fail(str(error), 502)
        except Exception as error:  # noqa: BLE001
            self.fail("服务器错误：" + str(error), 500)

    def stream_chat(self, path, body):
        """流式对话：把上游 SSE 原样转发给前端。"""
        session_id = path.split("/")[3]
        session = get_session(session_id)
        if not session:
            self.fail("存档不存在", 404)
            return
        message = str(body.get("message") or "").strip()
        settings = dict(body.get("settings") or {})
        api_url = settings.get("api_url") or session["state"].get("settings", {}).get("api_url")
        api_key = settings.get("api_key")
        if api_key is None:
            api_key = session["state"].get("settings", {}).get("api_key", "")
        model = settings.get("model") or session["state"].get("settings", {}).get("model", "")
        if not api_url:
            self.fail("尚未配置 AI：请先打开「设置 → AI 连接」填写 OpenAI 兼容接口地址", 400)
            return
        g = galaxy()
        state = session["state"]
        npc_id = body.get("character_id")
        npc = next((c for c in characters()["characters"] if c["id"] == npc_id), None) if npc_id else None
        history = db_query(
            "SELECT role, name, content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 24",
            (session_id,),
        )[::-1]
        system = next((s for s in g["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
        recent = " ".join([m["content"] for m in history[-3:]] + [message])
        lore = select_lore(recent, system.get("name", "") if system else "", npc.get("faction", "") if npc else "")
        system_prompt = build_system_prompt(session, npc, lore)
        llm_messages = [{"role": "system", "content": system_prompt}]
        for item in history:
            llm_messages.append({"role": "assistant" if item["role"] == "assistant" else "user", "content": item["content"]})
        llm_messages.append({"role": "user", "content": message})
        add_message(session_id, "user", message, state["player"].get("name", "旅人"))
        upstream = None
        collected = []
        try:
            upstream = llm_call(api_url, api_key, model, llm_messages, float(settings.get("temperature", 0.8)), 2048, stream=True)
        except RuntimeError as error:
            self.fail(str(error), 502)
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            chunk = bytearray()
            for raw in upstream:
                chunk.extend(raw)
                while b"\n" in chunk:
                    line_bytes, chunk = chunk.split(b"\n", 1)
                    line = line_bytes.decode("utf-8", "replace")
                    if line.startswith("data:"):
                        delta = extract_sse_delta(line)
                        if delta:
                            collected.append(delta)
                            self.wfile.write(("data: " + json.dumps({"delta": delta}, ensure_ascii=False) + "\n\n").encode("utf-8"))
                            self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            full = "".join(collected).strip()
            if full:
                add_message(session_id, "assistant", full, npc.get("name") if npc else "星海之主", {"npc": npc_id or ""})
            else:
                # 上游没有按 SSE 格式返回（某些中转直接返回 JSON），退化为整体读取
                payload = json.loads(upstream.read().decode("utf-8"))
                content = payload["choices"][0]["message"]["content"]
                add_message(session_id, "assistant", content, npc.get("name") if npc else "星海之主", {"npc": npc_id or ""})
                self.wfile.write(("data: " + json.dumps({"delta": content}, ensure_ascii=False) + "\n\ndata: [DONE]\n\n").encode("utf-8"))
                self.wfile.flush()
        except Exception as error:  # noqa: BLE001
            try:
                self.wfile.write(("data: " + json.dumps({"error": str(error)}, ensure_ascii=False) + "\n\ndata: [DONE]\n\n").encode("utf-8"))
                self.wfile.flush()
            except Exception:  # noqa: BLE001
                pass
        finally:
            if upstream is not None:
                try:
                    upstream.close()
                except Exception:  # noqa: BLE001
                    pass

    def do_PATCH(self):
        path = self.route_path()
        try:
            body = self.read_body()
            if path.startswith("/api/sessions/") and path.endswith("/rename"):
                session_id = path.split("/")[3]
                title = str(body.get("title") or "").strip()
                if not title:
                    self.fail("名称不能为空")
                    return
                if not db_query("SELECT id FROM sessions WHERE id=?", (session_id,)):
                    self.fail("存档不存在", 404)
                    return
                db_execute("UPDATE sessions SET title=? WHERE id=?", (title, session_id))
                self.send_json({"ok": True})
            else:
                self.fail("接口不存在", 404)
        except Exception as error:  # noqa: BLE001
            self.fail("服务器错误：" + str(error), 500)

    def do_DELETE(self):
        path = self.route_path()
        try:
            if path.startswith("/api/sessions/") and path.count("/") == 3:
                session_id = path.split("/")[3]
                db_execute("DELETE FROM messages WHERE session_id=?", (session_id,))
                cur = db_execute("DELETE FROM sessions WHERE id=?", (session_id,))
                if cur.rowcount == 0:
                    self.fail("存档不存在", 404)
                    return
                self.send_json({"ok": True, "id": session_id})
            elif path.startswith("/api/sessions/") and path.endswith("/messages"):
                session_id = path.split("/")[3]
                if not db_query("SELECT id FROM sessions WHERE id=?", (session_id,)):
                    self.fail("存档不存在", 404)
                    return
                clear_messages(session_id)
                self.send_json({"ok": True})
            else:
                self.fail("接口不存在", 404)
        except Exception as error:  # noqa: BLE001
            self.fail("服务器错误：" + str(error), 500)


def main():
    parser = argparse.ArgumentParser(description="星海余烬本地服务器")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print("=" * 56)
    print("  《星海余烬 · EMBERS OF THE STAR SEA》 v%s" % VERSION)
    print("  本地地址: http://%s:%d" % (args.host, args.port))
    print("  存档文件: %s" % DB_PATH)
    print("  按 Ctrl+C 停止服务器")
    print("=" * 56)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n再见，星海旅人。")
        sys.exit(0)


if __name__ == "__main__":
    main()
