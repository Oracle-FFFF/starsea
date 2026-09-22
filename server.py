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
import random
import re
import shutil
import sqlite3
import subprocess
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

VERSION = "0.07"
NODE = shutil.which("node")
NODE_HELPER = BASE_DIR / "llm_proxy.cjs"
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


def planet_core():
    return load_json("planet_core")


def core_planet_of(system_id, planet_id):
    for p in planet_core()["planets"]:
        if p["system"] == system_id and p["planet"] == planet_id:
            return p
    return None


def planet_lorebook_entries():
    """把核心星球档案合并为世界书条目（与编年史同级固定大纲）。"""
    entries = []
    n = 1000
    for p in planet_core()["planets"]:
        n += 1
        regions = "、".join(r["name"] for r in p.get("regions", []))
        entries.append({
            "id": n,
            "category": "planet",
            "title": "星球 · " + p["name"],
            "keys": [p["name"], p.get("system", "")],
            "comment": "核心星球固定大纲（重要势力星球）。",
            "content": "气候：%s\n经济：%s\n政治：%s\n文化：%s\n种族：%s\n资源：%s\n主要登录区域：%s。" % (
                p.get("climate", ""), p.get("economy", ""), p.get("politics", ""),
                p.get("culture", ""), p.get("species", ""), p.get("resources", ""), regions),
            "constant": False, "selective": False, "insertion_order": 900,
            "enabled": True, "position": "before_char", "priority": 8,
        })
    return entries


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
        status = npc.get("status") or {}
        politics = npc.get("politics") or {}
        physio = npc.get("physiology") or {}
        abilities = "；".join(
            "%s（%s级）" % (a.get("name", ""), a.get("level", 3)) for a in (npc.get("abilities") or [])
        )
        quotes = "「" + "」「".join(npc.get("quotes") or []) + "」"
        lines.append(
            "【当前对话对象 NPC】%s（%s，%s，%s）\n"
            "外貌：%s\n生理：%s\n性格：%s\n能力：%s\n政治立场：%s\n"
            "背景：%s\n目标：%s\n对陌生人的态度：%s\n口头禅：%s\n对玩家的开场：%s"
            % (
                npc.get("name"), npc.get("title", ""), npc.get("faction", ""), npc.get("occupation", ""),
                npc.get("appearance", ""), physio.get("speciesNote", "") + " " + physio.get("modifications", ""),
                npc.get("personality", ""), abilities,
                (politics.get("party") or "") + " " + (politics.get("ideology") or ""),
                npc.get("background", ""), npc.get("goals", ""),
                status.get("stance", ""), quotes, npc.get("greeting", ""),
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


def system_proxies():
    """收集系统代理：环境变量 + Windows 注册表（含系统开关关闭但代理工具在跑的情况）。"""
    proxies = {}
    try:
        proxies.update(urllib.request.getproxies())
    except Exception:
        pass
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        try:
            server, _ = winreg.QueryValueEx(key, "ProxyServer")
        except OSError:
            server = ""
        if server:
            url = server if "://" in server else "http://" + server
            proxies.setdefault("http", url)
            proxies.setdefault("https", url)
        winreg.CloseKey(key)
    except Exception:
        pass
    return proxies


def gateway_error(status, body):
    message = "API 返回 %d" % status
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
    if status in (401, 403) or "token" in message.lower() or "key" in message.lower():
        if "quota" in message.lower() or "balance" in message.lower() or "额度" in message or "余额" in message:
            message += "（账户余额/额度不足，请到提供商后台充值后再试）"
        elif status == 401:
            message += "（密钥无效/已过期/与网关不匹配——请核对密钥与接口地址；若确认密钥无误仍报 401，可能是网关节点同步或临时限流，请等几分钟再试，不要连续重试）"
        else:
            message += "（请求被网关拒绝，请核对密钥与接口地址）"
    return RuntimeError(message)


def node_available():
    return bool(NODE) and NODE_HELPER.exists()


def node_llm(api_url, api_key, model, messages, temperature, max_tokens, stream):
    """通过 Node 代理调用上游（Node 的 TLS 指纹可通过部分网关的 WAF）。"""
    payload = {
        "url": normalize_api_base(api_url) + "/chat/completions",
        "api_key": api_key or "",
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "stream": bool(stream),
    }
    proc = subprocess.run(
        [NODE, str(NODE_HELPER)],
        input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        capture_output=True,
        timeout=300,
    )
    lines = [line for line in proc.stdout.decode("utf-8", "replace").splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Node 代理无输出：" + proc.stderr.decode("utf-8", "replace")[:300])
    result = json.loads(lines[-1])
    if not result.get("ok"):
        raise gateway_error(int(result.get("status") or 502), str(result.get("body") or result.get("error") or ""))
    return result.get("content", "")


def node_llm_stream(api_url, api_key, model, messages, temperature, max_tokens):
    payload = {
        "url": normalize_api_base(api_url) + "/chat/completions",
        "api_key": api_key or "",
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "stream": True,
    }
    proc = subprocess.Popen(
        [NODE, str(NODE_HELPER)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    proc.stdin.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    proc.stdin.close()
    for raw_line in proc.stdout:
        line = raw_line.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        kind = obj.get("t")
        if kind == "d":
            yield obj.get("text", "")
        elif kind == "err":
            raise gateway_error(int(obj.get("status") or 502), str(obj.get("message") or ""))
        elif kind == "done":
            break
    try:
        proc.wait(timeout=30)
    except Exception:
        proc.kill()


def build_opener(use_system_proxy=False, proxy_url=""):
    proxies = {}
    if proxy_url:
        url = proxy_url.strip() if "://" in proxy_url.strip() else "http://" + proxy_url.strip()
        proxies["http"] = proxies["https"] = url
    if use_system_proxy:
        proxies.update(system_proxies())
    if not proxies:
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler(proxies))


def llm_call(api_url, api_key, model, messages, temperature=0.8, max_tokens=2048, stream=False, timeout=300,
             use_system_proxy=False, proxy_url=""):
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
    opener = build_opener(use_system_proxy, proxy_url)
    try:
        return opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", "replace")[:800]
        except Exception:
            pass
        raise gateway_error(error.code, body)
    except urllib.error.URLError as error:
        raise RuntimeError("无法连接 API：" + str(getattr(error, "reason", error)) + "（若网络受限，请在设置中开启系统代理或填写代理地址）")


def llm_reply(api_url, api_key, model, messages, temperature, max_tokens, use_system_proxy=False, proxy_url=""):
    if node_available() and not use_system_proxy and not proxy_url:
        return node_llm(api_url, api_key, model, messages, temperature, max_tokens, stream=False)
    response = llm_call(api_url, api_key, model, messages, temperature, max_tokens, stream=False,
                        use_system_proxy=use_system_proxy, proxy_url=proxy_url)
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
        "gaia": "合成食物、奢侈品", "ocean": "净水冰、合成食物", "desert": "稀土矿、流明文物",
        "jungle": "医疗凝胶、奢侈品", "ice": "净水冰、渊髓", "lava": "稀土矿、舰体合金",
        "toxic": "医疗凝胶、稀土矿", "rad": "流明文物、渊髓", "barren": "数据晶片、流明文物",
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
    return llm_reply(api_url, settings.get("api_key", ""), settings.get("model", ""), messages, 0.9, 800,
                     bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""))


# ---------------------------------------------------------------- 星球结构化档案
CLIMATE_TMPL = {
    "gaia": ["温和宜居，四季分明，偶有风暴掠过海岸。", "气候稳定，洋流带来丰沛降水，空气中弥漫植被的气息。"],
    "ocean": ["全球性海洋气候，风暴与洋流是这里的王，雨季长达半年。", "暖湿气流常年环绕，浮城随浪起伏。"],
    "desert": ["白昼酷热、夜晚冰寒，沙暴能把航标埋掉半截。", "极度干燥，昼夜温差撕裂岩石，风声是唯一的常客。"],
    "jungle": ["湿热雨林气候，暴雨每天准时到访两次，雾气终年不散。", "蒸笼般的闷热，植被在雨水的浇灌下疯长。"],
    "ice": ["极寒冰封，暴风雪说来就来，冰壳下却可能有液态海洋。", "永冻与极夜交替，呼气成冰，机器也需要烤火。"],
    "lava": ["熔岩热浪逼人，硫磺云遮蔽天空，地面烫得能煎蛋。", "火山活动频繁，热泉与岩浆河是地表的常态。"],
    "toxic": ["剧毒大气，酸雨常年，过滤穹顶之外寸草难生。", "腐蚀性雾霾随季风漂移，金属暴露一夜就会生锈。"],
    "rad": ["强辐射废土，电离风暴时有发生，仪表盘永远在报警。", "辐射尘随风暴迁徙，避难所之外的地表是生命的禁区。"],
    "barren": ["无大气、无水的荒芜，昼夜温差可达三百度。", "永恒的沉默与灰尘，偶有陨石砸出新坑。"],
    "metal": ["高密度矿核的金属世界，大气稀薄，阳光在矿脉上反光。", "金属荒漠，磁暴频繁，罗盘在这里形同虚设。"],
    "gas": ["气态巨星的风暴带，风速可达音速，采气平台在云顶颠簸。", "永不停歇的云暴，只有轨道平台能安稳立足。"],
}
ECONOMY_TMPL = {
    "tech": ["知识服务与高端制造，专利与数据是硬通货。", "研发与代工并存，实验室的产出比矿脉更值钱。"],
    "agri": ["农业与水产养殖为主，收成决定一切。", "粮食与净水交易撑起本地经济，歉收年人人紧张。"],
    "mine": ["采矿业为支柱，矿工的镐声昼夜不停。", "矿脉是这里的一切，矿价波动牵动每条街。"],
    "forge": ["重工与铸造，高炉的火焰是经济的引擎。", "舰船与义体制造，订单排到明年。"],
    "trade": ["商贸中转，货物流转不息，佣金养活了半城人。", "进出口贸易为主，价格随航线波动。"],
    "military": ["军需经济，驻军与兵站带动周边一切。", "要塞补给为主，商贩围着军营转。"],
    "slum": ["黑市与零工经济，日结工资是常态。", "废品回收与地下交易，什么都按「成色」计价。"],
    "refuge": ["难民安置与救济经济，物资按人头配给。", "以物易物为主，救济站的队永远排到街尾。"],
    "occult": ["朝圣与秘仪相关产业，香火与「圣物」皆有价格。", "教团供养与信徒捐赠，金钱在这里显得可疑。"],
    "ruin": ["盗掘与打捞经济，旧帝国的遗物是唯一的大宗商品。", "废船拆解与文物倒卖，一夜暴富与一夜暴毙并存。"],
    "lux": ["奢靡消费与服务，庄园与度假产业的聚集地。", "高端定制与休闲经济，普通人的钱包在这里不流通。"],
    "mixed": ["农牧、手作与小额贸易混合的自给经济。", "什么都有一点，什么都不算发达。"],
}
POLITICS_TMPL = {
    "white-tower": ["奥瑞利安合众国治下，公民评分与专利法决定秩序。", "议会派员治理，一切纠纷交给数据与听证会。"],
    "crimson": ["绯冠王朝封地，封臣与监工维持着旧帝国的秩序。", "侯领自治，领主的话就是法律。"],
    "blue-tide": ["蓝潮商盟的贸易领地，合同与信用即法律。", "商号共治，账本比官印更权威。"],
    "forge": ["赫菲斯托斯教团辖地，教规即律法，淬炼即审判。", "教士与工务司共治，不合格者「回炉」。"],
    "armada": ["漂泊舰队的游牧领，舰规与长老会维持秩序。", "入伙者皆舰民，议事在甲板上公开进行。"],
    "shackle": ["破枷同盟解放区，革命委员会与公社议事。", "人人一票的公社制，仓库钥匙轮流保管。"],
    "ash": ["灰潮掠团的地盘，强者为尊，抢掠为业。", "掠团割据，谁的炮多谁说了算。"],
    "lucent": ["流明圣所隐修地，静默与守望是唯一的律法。", "守门人代行一切，世俗法律在此失效。"],
    "rim": ["无主星域，当地行会与帮派自治，法律是实力的影子。", "没有官印，只有规矩；规矩由最强的人来定。"],
}
CULTURE_TMPL = {
    "white-tower": ["理性与效率至上，公开答辩与专利听证是最高的社交。", "知识崇拜：书架比神龛更常见，学历比爵位更体面。"],
    "crimson": ["荣耀与仪轨，节庆与处刑同样盛大。", "血统与武勋至上，家族纹章绣在每一件衣裳上。"],
    "blue-tide": ["契约文化：握手不算数，签字才算。", "信用即王权，破产比死亡更可怕。"],
    "forge": ["铸造即祈祷，落锤声就是祷词。", "苦修与工艺并重，伤疤是荣誉的纹章。"],
    "armada": ["归乡歌会与漂流葬，歌声比法律更能凝聚人心。", "四海为家的水手文化，入伙酒一碗，从此是家人。"],
    "shackle": ["解放纪念日与熔炉集会，自由是刻进骨子里的词。", "互助与平等，孩子先吃饭，老人先上船。"],
    "ash": ["灰潮法则挂在嘴边：强者为尊、抢掠为业、出卖为耻。", "刀疤与战利品是地位的象征，吹牛是合法娱乐。"],
    "lucent": ["守望与静默，每日向门行礼三次。", "光与谜：信徒之间以星语问候。"],
    "rim": ["边缘地带的实用主义，不问来路，只问价钱。", "自由散漫，谁的旗都挂，谁的话都听一半。"],
}
SPECIES_TMPL = {
    "white-tower": ["太空裔与母星人为主，少数义体化者担任工程要职。", "各族移民按公民评分混居。"],
    "crimson": ["母星人平民与农奴为主，贵族多为基因雕琢者。", "血统分明的等级社会，深渊裔被视为不祥。"],
    "blue-tide": ["太空裔与母星人，富商多为基因雕琢者。", "各族商人混居，护照比种族更重要。"],
    "forge": ["义体化者为主，肉体被视为待淬炼的原矿。", "义体化者与矿工母星人，改造率全银河最高。"],
    "armada": ["太空裔为主，欢迎一切逃亡者。", "太空裔与各族避难者，舰籍即族籍。"],
    "shackle": ["来自各势力的被解放者，以母星人居多。", "各族平等混居，出身的锁链已熔。"],
    "ash": ["各势力亡命徒的杂居地。", "母星人、深渊裔与义体化者，什么人都收。"],
    "lucent": ["流明后裔与自愿守望的各族。", "少数派的隐修聚落，身份从不外示。"],
    "rim": ["全银河的混居，是星海种族最杂的地方。", "母星人、太空裔与义体化者各占其一。"],
}
REGION_POOL = [
    {"type": "市井", "danger": 2, "tags": ["集市", "平民"], "name": "旧港市集", "desc": "港口边的老市集，鱼腥味与讨价还价声混在一起，小道消息按条卖。"},
    {"type": "商枢", "danger": 1, "tags": ["商会", "仓库"], "name": "商会货栈区", "desc": "商会的仓库连成片，装卸工与记账员各忙各的，货单比命重。"},
    {"type": "政枢", "danger": 2, "tags": ["官署", "安检"], "name": "行政官署区", "desc": "本地官署所在，门口的安检器比官员更不近人情。"},
    {"type": "险地", "danger": 4, "tags": ["帮派", "危险"], "name": "暗巷", "desc": "治安的盲区，帮派的地盘，进来之前先想好怎么出去。"},
    {"type": "废墟", "danger": 3, "tags": ["废墟", "拾荒"], "name": "旧城废墟带", "desc": "旧时代的断壁残垣，拾荒者的金矿，也是失踪者的坟场。"},
    {"type": "工造", "danger": 2, "tags": ["工厂", "工人"], "name": "工业区", "desc": "烟囱与传送带昼夜不停，工人们三班倒，工伤按件赔偿。"},
    {"type": "农业", "danger": 1, "tags": ["农田", "村庄"], "name": "农垦区", "desc": "农田与村庄连成片，收成好的年份连空气都是甜的。"},
    {"type": "宗教", "danger": 1, "tags": ["教会", "朝圣"], "name": "教会区", "desc": "教会与朝圣者的聚集地，钟声与诵经声交替响起。"},
    {"type": "棚户", "danger": 3, "tags": ["棚户", "底层"], "name": "棚户区", "desc": "铁皮与篷布搭成的聚落，挤满了买不起穹顶空气的人。"},
    {"type": "矿区", "danger": 3, "tags": ["矿场", "矿工"], "name": "矿区营地", "desc": "矿场边的营地，矿工们把工资换成酒，再把酒换成勇气。"},
    {"type": "军事", "danger": 3, "tags": ["哨站", "驻军"], "name": "驻军哨站", "desc": "驻军哨站，探照灯扫过每一辆进出车辆，枪口从不睡觉。"},
    {"type": "商枢", "danger": 2, "tags": ["黑市", "走私"], "name": "走私码头", "desc": "官方地图上没有的码头，货物在这里卸下，别问来路。"},
    {"type": "市井", "danger": 2, "tags": ["酒馆", "旅人"], "name": "酒馆街", "desc": "酒馆一家挨一家，旅人在这里交换消息，也交换麻烦。"},
    {"type": "废墟", "danger": 4, "tags": ["遗迹", "禁忌"], "name": "流明遗迹", "desc": "流明族的遗迹残迹，本地人绕着走，外乡人偏要进去看。"},
]
LANDING_SCENE_TMPL = {
    "gaia": "穿梭机穿过云层，降落在一片开阔的接驳坪上。舱门开启，湿润的植被气息扑面而来。",
    "ocean": "水上穿梭机贴着浪尖滑行，最终泊入浮城的气闸。海水拍打着舷梯，咸味钻进舱内。",
    "desert": "着陆架陷进滚烫的沙地，沙尘顺着舱门灌进来。远处，热浪把地平线折成锯齿。",
    "jungle": "舱门打开时，藤蔓几乎要探进机舱。雨林的湿热与虫鸣像一堵墙，瞬间把你包围。",
    "ice": "破冰着陆的声音像一声闷雷。极地的风灌进舱门，呼出的气立刻凝成白雾。",
    "lava": "隔热舷梯放下时，热浪隔着防护服都能感到灼痛。大地在这里是活的，缓缓起伏。",
    "toxic": "气闸循环了三遍才放行。舱外，酸雨在穹顶外壁上敲出细密的沙沙声。",
    "rad": "辐射计在舱门打开的瞬间尖啸起来。你紧了紧防护服，迈向这片泛着绿光的荒原。",
    "barren": "着陆扬起的灰尘缓缓飘散，四周安静得能听见自己面罩里的呼吸声。",
    "metal": "磁力着陆架「咔嗒」一声咬住金属地表，矿脉在星光下泛着冷光。",
    "gas": "（轨道平台）对接臂缓缓收紧，你通过舷梯进入悬浮在云顶的采气平台。",
}


def deterministic_planet_profile(system, planet, seed_key):
    """半随机生成结构化星球档案（按「条目+势力+类型+存档种子」确定）。"""
    ptype = planet.get("type") or "barren"
    fac_id = system.get("faction") or "rim"
    econ = system.get("economy") or "mixed"

    def pick(pool, label):
        return pool[int(_seed_unit(seed_key, label) * len(pool)) % len(pool)]

    n_regions = 2 + int(_seed_unit(seed_key, "nreg") * 3)  # 2-4
    pool = list(REGION_POOL)
    # 按种子洗牌取前 n 个
    order = sorted(range(len(pool)), key=lambda i: _seed_unit(seed_key, "shuffle", i))
    regions = []
    for i, idx in enumerate(order[:n_regions]):
        t = pool[idx]
        regions.append({
            "id": "%s-r%d" % (planet.get("id"), i + 1),
            "name": t["name"],
            "type": t["type"],
            "desc": t["desc"],
            "danger": int(t["danger"]),
            "tags": list(t["tags"]),
        })
    return {
        "climate": pick(CLIMATE_TMPL.get(ptype, CLIMATE_TMPL["barren"]), "climate"),
        "economy": pick(ECONOMY_TMPL.get(econ, ECONOMY_TMPL["mixed"]), "economy"),
        "politics": pick(POLITICS_TMPL.get(fac_id, POLITICS_TMPL["rim"]), "politics"),
        "culture": pick(CULTURE_TMPL.get(fac_id, CULTURE_TMPL["rim"]), "culture"),
        "species": pick(SPECIES_TMPL.get(fac_id, SPECIES_TMPL["rim"]), "species"),
        "resources": RESOURCE_HINT_PLANET.get(ptype, "未知矿藏"),
        "overview": "",
        "regions": regions,
    }


RESOURCE_HINT_PLANET = {
    "gaia": "合成食物、奢侈品", "ocean": "净水冰、合成食物", "desert": "稀土矿、流明文物",
    "jungle": "医疗凝胶、奢侈品", "ice": "净水冰、渊髓", "lava": "稀土矿、舰体合金",
    "toxic": "医疗凝胶、稀土矿", "rad": "流明文物、渊髓", "barren": "数据晶片、流明文物",
    "metal": "舰体合金、义体组件", "gas": "渊髓、超导线圈",
}


def ai_planet_profile(system, planet, settings):
    """AI 生成结构化星球档案（JSON：气候/经济/政治/文化/种族/资源/综述/登录区域）。"""
    api_url = (settings or {}).get("api_url", "")
    if not api_url:
        return None
    master = master_card()["data"]
    prompt = (
        "你是《星海余烬》的世界生成器。为下列行星生成一份结构化档案，必须原创、硬科幻、与设定一致：\n"
        "所属星系：%s（%s）\n行星：%s，类型：%s，所在势力：%s。\n"
        '只输出 JSON（不要任何额外文字）：'
        '{"climate":"1-2句气候","economy":"1-2句经济","politics":"1-2句政治","culture":"1-2句文化",'
        '"species":"1-2句种族构成","resources":"1-2句主要资源","overview":"2-3句综述",'
        '"regions":[{"name":"登录区域名","type":"市井/商枢/政枢/险地/废墟/工造/农业/宗教之一",'
        '"desc":"1句描述","danger":1到5的整数,"tags":["标签1","标签2"]},…共2到4个]}'
        % (system.get("name", ""), system.get("notes", ""), planet.get("name", ""),
           planet.get("type", ""), system.get("faction", "rim"))
    )
    messages = [
        {"role": "system", "content": master.get("system_prompt", "")},
        {"role": "user", "content": prompt},
    ]
    raw = llm_reply(api_url, settings.get("api_key", ""), settings.get("model", ""), messages, 0.85, 900,
                    bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""))
    obj = extract_json_object(raw)
    if not isinstance(obj, dict):
        return None
    for key in ("climate", "economy", "politics", "culture", "species", "resources"):
        if not isinstance(obj.get(key), str) or not obj[key].strip():
            return None
    regions = []
    for i, r in enumerate(obj.get("regions") or []):
        if not isinstance(r, dict) or not str(r.get("name") or "").strip():
            continue
        try:
            danger = max(1, min(5, int(r.get("danger") or 2)))
        except (TypeError, ValueError):
            danger = 2
        regions.append({
            "id": "%s-r%d" % (planet.get("id"), i + 1),
            "name": str(r.get("name"))[:24],
            "type": str(r.get("type") or "市井")[:12],
            "desc": str(r.get("desc") or "")[:200],
            "danger": danger,
            "tags": [str(t)[:12] for t in (r.get("tags") or []) if str(t).strip()][:3],
        })
    if not regions:
        return None
    return {
        "climate": obj["climate"].strip(),
        "economy": obj["economy"].strip(),
        "politics": obj["politics"].strip(),
        "culture": obj["culture"].strip(),
        "species": obj["species"].strip(),
        "resources": obj["resources"].strip(),
        "overview": str(obj.get("overview") or "").strip()[:600],
        "regions": regions[:4],
    }


# ---------------------------------------------------------------- 总故事驱动
def story_context_block(session):
    """为故事驱动拼装上下文：玩家/位置/时间/舰船/最近日志。"""
    state = session.get("state") or {}
    player = state.get("player") or {}
    g = galaxy()
    system = next((s for s in g["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
    ship = current_ship(state)
    parts = [
        "玩家：%s，出身：%s，资金：%d 晶，燃料：%d。" % (
            player.get("name", "旅人"), origin_label(state), int(player.get("credits") or 0), int(state.get("fuel") or 0)),
        "座舰：%s（船体%d/%d，货舱%d）。" % (
            ship.get("name", "旧船"), ship.get("hull", 0), ship.get("hullMax", 0), ship.get("cargoCap", 0)),
        "星历：%d 年，第 %d 天。" % (3107 + (int(state.get("day") or 1) - 1) // 360, int(state.get("day") or 1)),
    ]
    if state.get("location", {}).get("planet"):
        parts.append("玩家已登陆行星地表。")
    if system:
        parts.append("所在星系：%s（%s）" % (system.get("name"), system.get("notes")))
        parts.append("该星系行星：" + "；".join(p.get("name", "") for p in system.get("planets", [])))
    recent_logs = (state.get("log") or [])[-4:]
    if recent_logs:
        parts.append("最近日志：" + "；".join("D%d %s" % (item.get("day", 0), item.get("text", "")) for item in recent_logs))
    return "\n".join(parts)


def story_system_prompt():
    master = master_card()["data"]
    return (
        master.get("system_prompt", "")
        + "\n你是《星海余烬》的总故事驱动（星海之主）。你的职责是：叙述玩家的行程与环境变化、"
        "裁定玩家的自由行动、在世界推进时播报事件，并以行动选项引导玩家。"
        "\n规则：1) 玩家台词与行动完全由玩家决定，你只裁定结果并叙述；2) 叙事克制冷峻、画面感强；"
        "3) 严格遵循世界书设定，不引入现实世界内容；4) 每次播报保持 2-5 句，不过度冗长。"
    )


def story_json_instructions():
    return (
        "输出格式：只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块：\n"
        '{"narration": "2-5句叙事", "choices": ["选项1", "选项2", "选项3"], "advance_hours": 0, '
        '"place": "玩家此刻所处的小地点（如：停泊区酒吧、港务大厅、自己的船舱、市场街），若与上次相同则照写"}\n'
        "advance_hours 为本次行动经过的小时数（0-72 整数）。选项是玩家接下来可以采取的行动，2-3 条。"
    )


def extract_json_object(text):
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except Exception:
                    return None
    return None


def story_fallback(kind, system, state):
    sys_name = (system or {}).get("name", "未知星域")
    notes = (system or {}).get("notes", "")
    if kind == "arrival":
        return {
            "narration": "你抵达了 %s。%s 港口的引航灯在舷窗外缓缓旋转，引导你的船滑入泊位。"
            % (sys_name, notes[:60] + ("…" if len(notes) > 60 else "") if notes else "这是一片陌生的空域，"), 
            "choices": ["逛逛本地市场", "打听最近的传闻", "继续航行"],
            "advance_hours": 1,
        }
    if kind == "action":
        return {
            "narration": "你照做了。星港的喧嚣在舱外起伏，时间在弦流的低鸣中悄悄流逝。",
            "choices": ["继续行动", "打开星图规划航线", "休息片刻"],
            "advance_hours": 6,
        }
    return {
        "narration": "星海深处传来一阵低鸣，像有什么正在苏醒。",
        "choices": ["继续前进", "保持观望"],
        "advance_hours": 0,
    }


def ai_story(kind, session, text, settings):
    g = galaxy()
    state = session.get("state") or {}
    system = next((s for s in g["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
    context = story_context_block(session)
    if kind == "arrival":
        user_text = "【事件】玩家刚刚跃迁抵达 %s。请播报抵达见闻，并给出行动选项。" % ((system or {}).get("name", "未知星域"))
    elif kind == "action":
        user_text = "【玩家行动】%s\n请裁定该行动的经过与结果（可推进时间），并给出后续选项。" % (text or "继续观察")
    else:
        user_text = "【事件】%s\n请播报这一事件及其影响，并给出玩家的应对选项。" % (text or "星海中发生了值得注意的事")
    lore = select_lore(text or "", (system or {}).get("name", ""), "")
    messages = [
        {"role": "system", "content": story_system_prompt()},
        {"role": "system", "content": "【当前局势】\n" + context},
    ]
    if lore:
        messages.append({"role": "system", "content": "【相关世界书】\n" + lore_text(lore)})
    messages.append({"role": "user", "content": user_text + "\n\n" + story_json_instructions()})
    raw = llm_reply(settings.get("api_url"), settings.get("api_key", ""), settings.get("model", ""), messages, 0.85, 900,
                    bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""))
    parsed = extract_json_object(raw)
    if not parsed or not isinstance(parsed.get("narration"), str):
        fallback = story_fallback(kind, system, state)
        fallback["narration"] = raw[:400] if raw and len(raw.strip()) > 4 else fallback["narration"]
        return fallback
    choices = [str(c) for c in parsed.get("choices", []) if isinstance(c, str) and c.strip()][:4]
    hours = parsed.get("advance_hours")
    try:
        hours = max(0, min(96, int(hours)))
    except (TypeError, ValueError):
        hours = 0
    place = str(parsed.get("place") or "").strip()[:40]
    return {"narration": parsed["narration"].strip(), "choices": choices, "advance_hours": hours, "place": place}


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
                    "timeline": g.get("timeline", []),
                    "commodities": g["commodities"],
                    "origins": g["origins"],
                    "ships": g["ships"],
                    "characters": characters()["characters"],
                    "lorebook": lorebook()["entries"] + planet_lorebook_entries(),
                    "planet_core": planet_core()["planets"],
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
                # 角色工坊自定义字段
                stats = config.get("stats") if isinstance(config.get("stats"), dict) else {}
                for key in ("combat", "wit", "charm", "tech", "nav"):
                    try:
                        stats[key] = max(1, min(10, int(stats.get(key, origin.get("stats", {}).get(key, 5)))))
                    except (TypeError, ValueError):
                        stats[key] = int(origin.get("stats", {}).get(key, 5))
                credits = int(config.get("credits")) if isinstance(config.get("credits"), (int, float)) else int(origin.get("credits") or 0)
                profile = config.get("profile") if isinstance(config.get("profile"), dict) else {}
                rep = dict(origin.get("rep") or {})
                faction_choice = str(config.get("faction") or "")
                if faction_choice and any(f["id"] == faction_choice for f in g["factions"]):
                    rep[faction_choice] = (rep.get(faction_choice) or 0) + 10
                cargo = {}
                if isinstance(config.get("cargo"), dict):
                    for item, qty in config["cargo"].items():
                        try:
                            qty = max(0, min(50, int(qty)))
                            if qty:
                                cargo[str(item)] = qty
                        except (TypeError, ValueError):
                            continue
                if origin["id"] == "noble" and "lux" not in cargo:
                    cargo["lux"] = 2
                state = {
                    "player": {
                        "name": player_name,
                        "origin": origin["id"],
                        "origin_label": origin["name"],
                        "credits": max(0, credits),
                        "stats": stats,
                        "rep": rep,
                        "perks": list(origin.get("perks") or []),
                        "title": None,
                        "fame": 0,
                        "profile": profile,
                    },
                    "location": {"system": origin.get("startSystem"), "planet": None},
                    "fleet": [{"id": ship["id"], "name": ship["name"], "hull": ship["hull"], "hullMax": ship["hull"],
                               "shield": ship["shield"], "shieldMax": ship["shield"], "cargoCap": ship["cargo"],
                               "crew": ship["crew"], "speed": ship["speed"], "weapon": ship["weapon"],
                               "fuelCap": ship["fuel"], "custom": False}],
                    "currentShip": 0,
                    "cargo": cargo,
                    "fuel": ship["fuel"],
                    "explored": [origin.get("startSystem")],
                    "planetLog": {},
                    "day": 1,
                    "log": [{"day": 1, "text": "你在%s醒来，旧船的引擎第一次点火。星海就在舷窗之外。" % origin.get("startSystem")}],
                    "settings": {"api_url": "", "api_key": "", "model": "", "temperature": 0.8},
                }
                if origin["id"] == "merchant":
                    state["player"]["credits"] = max(state["player"]["credits"], 1500)
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
                add_message(session_id, "user", message, state["player"].get("name", "旅人"), {"npc": npc_id or ""})
                api_url = settings.get("api_url") or state.get("settings", {}).get("api_url")
                api_key = settings.get("api_key")
                if api_key is None:
                    api_key = state.get("settings", {}).get("api_key", "")
                model = settings.get("model") or state.get("settings", {}).get("model", "")
                temperature = float(settings.get("temperature", 0.8))
                max_tokens = int(settings.get("max_tokens") or 1000)
                reply = llm_reply(api_url, api_key, model, llm_messages, temperature, max_tokens,
                                  bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""))
                meta = {"npc": npc_id or "", "driver": True} if not npc_id else {"npc": npc_id or ""}
                add_message(session_id, "assistant", reply, npc.get("name") if npc else "星海之主", meta)
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
                # 手工星系（服务端数据库里有），或生成星系（由前端提供描述信息）
                system = next((s for s in galaxy()["systems"] if s["id"] == body.get("system_id")), None)
                if system:
                    planet = next((p for p in system.get("planets", []) if p["id"] == body.get("planet_id")), None)
                else:
                    planet = None
                if not system:
                    system = {
                        "id": body.get("system_id"),
                        "name": body.get("system_name") or "未知星系",
                        "notes": body.get("system_notes") or "",
                        "faction": body.get("system_faction") or "rim",
                        "economy": body.get("system_economy") or "mixed",
                        "danger": body.get("system_danger") or 2,
                        "planets": [],
                    }
                if not planet:
                    planet = {
                        "id": body.get("planet_id"),
                        "name": body.get("planet_name") or "未知行星",
                        "type": body.get("planet_type") or "barren",
                        "desc": body.get("planet_desc") or "",
                    }
                settings = body.get("settings") or {}
                # 核心星球：直接返回固定大纲（世界书条目，不调用 AI、不随机）
                core = core_planet_of(system.get("id"), planet.get("id"))
                if core:
                    self.send_json({"ai": False, "source": "core", "profile": core, "core": True})
                    return
                # 边缘星球：AI 生成（失败/未配置则按存档种子半随机生成）
                seed_key = "%s|%s" % (planet.get("id"), body.get("session_id") or "")
                error = None
                profile = None
                ai = False
                if settings.get("api_url"):
                    try:
                        profile = ai_planet_profile(system, planet, settings)
                        ai = bool(profile)
                    except RuntimeError as exc:
                        error = str(exc)
                if not profile:
                    profile = deterministic_planet_profile(system, planet, seed_key)
                    ai = False
                payload = {"ai": ai, "source": "ai" if ai else "generated", "profile": profile, "core": False}
                if error:
                    payload["error"] = error
                self.send_json(payload)
            elif path == "/api/story":
                session_id = body.get("session_id")
                session = get_session(session_id)
                if not session:
                    self.fail("存档不存在", 404)
                    return
                kind = str(body.get("kind") or "action")
                text = str(body.get("text") or "").strip()
                settings = dict(body.get("settings") or {})
                if not settings.get("api_url"):
                    settings.update(session.get("state", {}).get("settings") or {})
                state = session.get("state") or {}
                system = next((s for s in galaxy()["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
                if not settings.get("api_url"):
                    fallback = story_fallback(kind, system, state)
                    self.send_json({"ok": True, "ai": False, "narration": fallback["narration"],
                                    "choices": fallback["choices"], "advance_hours": fallback["advance_hours"]})
                    return
                try:
                    result = ai_story(kind, session, text, settings)
                    self.send_json({"ok": True, "ai": True, "narration": result["narration"],
                                    "choices": result["choices"], "advance_hours": result["advance_hours"]})
                except RuntimeError as error:
                    fallback = story_fallback(kind, system, state)
                    fallback["narration"] += "（星海之主的讯号短暂中断，以上为航迹自动记录。）"
                    self.send_json({"ok": True, "ai": False, "narration": fallback["narration"],
                                    "choices": fallback["choices"], "advance_hours": fallback["advance_hours"]})
            elif path.startswith("/api/sessions/") and path.endswith("/chat/group"):
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
                    settings.update(session.get("state", {}).get("settings") or {})
                state = session["state"]
                participant_ids = [str(x) for x in (body.get("participants") or [])]
                chars = [c for c in characters()["characters"] if c["id"] in participant_ids][:6]
                if not chars:
                    self.fail("群聊需要至少一位参与者")
                    return
                add_message(session_id, "user", message, state["player"].get("name", "旅人"), {"npc": "", "group": True})
                g = galaxy()
                system = next((s for s in g["systems"] if s["id"] == (state.get("location") or {}).get("system")), None)
                contacts = state.get("contacts") or []
                affinity = state.get("affinity") or {}
                master = master_card()["data"]
                prompt_lines = [
                    master.get("system_prompt", ""),
                    "【群聊模式】玩家（%s）在%s对在场所有人说了一句话。在场者：%s。" % (
                        state["player"].get("name", "旅人"),
                        (system.get("name") if system else "未知星域"),
                        "、".join(c["name"] for c in chars)),
                    "规则：每位角色依据其性格、立场与对玩家的态度自行决定是否回应；最多 1-3 人回应，其余保持沉默；每人台词简短生动（1-2 句）。",
                ]
                for c in chars:
                    status = c.get("status") or {}
                    persona = c.get("personality") or {}
                    temperament = persona.get("temperament", "") if isinstance(persona, dict) else str(persona)
                    aff = affinity.get(c["id"], c.get("affinityStart") or 0)
                    rel = "熟人" if c["id"] in contacts else "陌生人"
                    prompt_lines.append(
                        "%s（%s·%s）——性格：%s；对陌生人态度：%s；与玩家：%s（好感%d）。" % (
                            c["name"], c.get("title", ""), c.get("faction", ""),
                            temperament, status.get("stance", ""), rel, int(aff)))
                prompt_lines.append(
                    '输出格式：只输出 JSON：{"lines":[{"name":"回应的角色名","text":"台词"}],"summary":"一句话总结这场群聊（供故事驱动播报）"}。沉默者不要出现在 lines 里。')
                group_messages = [
                    {"role": "system", "content": "\n".join(prompt_lines)},
                    {"role": "user", "content": "【群聊】玩家说：「%s」" % message},
                ]
                result_lines = []
                summary = ""
                if settings.get("api_url"):
                    try:
                        raw = llm_reply(settings.get("api_url"), settings.get("api_key", ""), settings.get("model", ""),
                                        group_messages, 0.9, 700,
                                        bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""))
                        obj = extract_json_object(raw)
                        if isinstance(obj, dict) and isinstance(obj.get("lines"), list) and obj["lines"]:
                            for line in obj["lines"][:3]:
                                if isinstance(line, dict) and str(line.get("name") or "").strip() and str(line.get("text") or "").strip():
                                    result_lines.append({"name": str(line["name"]).strip()[:20], "text": str(line["text"]).strip()[:300]})
                            summary = str(obj.get("summary") or "")[:160]
                    except RuntimeError as error:
                        summary = "（群聊生成失败：%s）" % str(error)[:120]
                if not result_lines:
                    pool = list(chars)
                    random.shuffle(pool)
                    count = random.randint(1, min(2, len(pool)))
                    tmpl = ["「嗯，有道理。」%s点点头。", "「这事儿得看情况。」%s低声说。", "%s笑了笑：「回头细聊。」", "%s没有接话，只是安静地听着。"]
                    for i in range(count):
                        c = pool[i]
                        result_lines.append({"name": c["name"], "text": tmpl[random.randrange(len(tmpl))] % c["name"]})
                    summary = "你在%s与%s聊了几句。" % (
                        (system.get("name") if system else "当地"), "、".join(x["name"] for x in result_lines))
                add_message(session_id, "assistant", json.dumps(result_lines, ensure_ascii=False), "群聊",
                            {"group": True, "lines": result_lines})
                if summary:
                    add_message(session_id, "assistant", summary, "星海之主", {"driver": True, "kind": "group_summary"})
                self.send_json({"lines": result_lines, "summary": summary})
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
                        bool(settings.get("use_system_proxy")), settings.get("proxy_url", ""),
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
        add_message(session_id, "user", message, state["player"].get("name", "旅人"), {"npc": npc_id or ""})
        max_tokens = int(settings.get("max_tokens") or 1000)
        use_node = node_available() and not settings.get("use_system_proxy") and not settings.get("proxy_url")
        upstream = None
        collected = []
        if use_node:
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Connection", "close")
                self.close_connection = True
                self.end_headers()
                try:
                    for delta in node_llm_stream(api_url, api_key, model, llm_messages,
                                                 float(settings.get("temperature", 0.8)), max_tokens):
                        collected.append(delta)
                        self.wfile.write(("data: " + json.dumps({"delta": delta}, ensure_ascii=False) + "\n\n").encode("utf-8"))
                        self.wfile.flush()
                except RuntimeError as error:
                    self.wfile.write(("data: " + json.dumps({"error": str(error)}, ensure_ascii=False) + "\n\ndata: [DONE]\n\n").encode("utf-8"))
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                full = "".join(collected).strip()
                if full:
                    meta = {"npc": npc_id or "", "driver": True} if not npc_id else {"npc": npc_id or ""}
                    add_message(session_id, "assistant", full, npc.get("name") if npc else "星海之主", meta)
                return
            except Exception as error:  # noqa: BLE001
                try:
                    self.wfile.write(("data: " + json.dumps({"error": str(error)}, ensure_ascii=False) + "\n\ndata: [DONE]\n\n").encode("utf-8"))
                    self.wfile.flush()
                except Exception:  # noqa: BLE001
                    pass
                return
        try:
            upstream = llm_call(api_url, api_key, model, llm_messages, float(settings.get("temperature", 0.8)),
                                max_tokens, stream=True, timeout=240, use_system_proxy=bool(settings.get("use_system_proxy")),
                                proxy_url=settings.get("proxy_url", ""))
        except RuntimeError as error:
            self.fail(str(error), 502)
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            # 无 Content-Length，必须靠关闭连接告知客户端正文结束（否则 HTTP/1.1 客户端会一直等）
            self.send_header("Connection", "close")
            self.close_connection = True
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
                meta = {"npc": npc_id or "", "driver": True} if not npc_id else {"npc": npc_id or ""}
                add_message(session_id, "assistant", full, npc.get("name") if npc else "星海之主", meta)
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
