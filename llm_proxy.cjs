// llm_proxy.cjs —— 零依赖 Node LLM 代理
// 用途：部分 API 网关（如 hiapi.online）的 WAF 会按 TLS 指纹拦截 Python/curl，
// 而 Node.js 的 TLS 指纹可通过。本脚本由 server.py 自动调用（本机有 node 时）。
// 协议：stdin 读一行 JSON，stdout 输出结果。
//   非流式：{"ok":true,"content":"..."} 或 {"ok":false,"error":"...","status":401,"body":"..."}
//   流式：逐行输出 {"t":"d","text":"..."} ，结束 {"t":"done"} 或 {"t":"err","message":"...","status":n}
const https = require("https");
const http = require("http");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => main().catch((e) => out({ t: "err", message: String(e && e.message || e) })));

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function parseReq() {
  try {
    const req = JSON.parse(input);
    req.messages = req.messages || [];
    return req;
  } catch (e) {
    throw new Error("invalid request json");
  }
}

function doRequest(req, onResponse, onError) {
  const url = new URL(req.url);
  const mod = url.protocol === "https:" ? https : http;
  const body = JSON.stringify({
    model: req.model,
    messages: req.messages,
    temperature: Number(req.temperature ?? 0.8),
    max_tokens: Number(req.max_tokens ?? 1000),
    ...(req.stream ? { stream: true } : {}),
  });
  const headers = { "Content-Type": "application/json" };
  if (req.api_key) headers.Authorization = "Bearer " + req.api_key;
  const r = mod.request(
    { hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname + url.search, method: "POST", headers },
    onResponse
  );
  r.on("error", onError);
  r.setTimeout(300000, () => { r.destroy(new Error("timeout")); });
  r.write(body);
  r.end();
}

// 网关偶发对同一密钥返回 401（节点同步/限流窗口），401/网络错误时最多重试 2 次（间隔 2.5s）
function requestWithRetry(req, attempts, onOk, onFinalError) {
  let left = attempts;
  const tryOnce = () => {
    doRequest(req, (res) => {
      if (res.statusCode === 401 && left > 1) {
        left -= 1;
        res.resume();
        setTimeout(tryOnce, 2500);
        return;
      }
      onOk(res);
    }, (e) => {
      if (left > 1) {
        left -= 1;
        setTimeout(tryOnce, 2500);
        return;
      }
      onFinalError(e);
    });
  };
  tryOnce();
}

function readAll(res, cb) {
  let data = "";
  res.setEncoding("utf8");
  res.on("data", (c) => (data += c));
  res.on("end", () => cb(data));
}

async function main() {
  const req = parseReq();
  if (!req.stream) {
    requestWithRetry(
      req, 3,
      (res) => readAll(res, (data) => {
        if (res.statusCode >= 400) {
          out({ ok: false, error: "API 返回 " + res.statusCode, status: res.statusCode, body: data.slice(0, 800) });
          return;
        }
        try {
          const j = JSON.parse(data);
          let content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (Array.isArray(content)) content = content.map((x) => x.text || "").join("");
          if (typeof content === "string" && content.trim()) out({ ok: true, content });
          else out({ ok: false, error: "模型返回了空内容", status: res.statusCode, body: data.slice(0, 300) });
        } catch (e) {
          out({ ok: false, error: "上游响应解析失败", status: res.statusCode, body: data.slice(0, 300) });
        }
      }),
      (e) => out({ ok: false, error: "无法连接 API：" + e.message })
    );
    return;
  }
  // 流式：解析 SSE，转发 content delta（401 时同样重试）
  requestWithRetry(
    req, 3,
    (res) => {
      if (res.statusCode >= 400) {
        readAll(res, (data) => out({ t: "err", message: "API 返回 " + res.statusCode + "：" + data.slice(0, 300), status: res.statusCode }));
        return;
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (typeof delta === "string" && delta) out({ t: "d", text: delta });
          } catch (e) { /* 跳过无法解析的行 */ }
        }
      });
      res.on("end", () => out({ t: "done" }));
      res.on("error", (e) => out({ t: "err", message: String(e.message) }));
    },
    (e) => out({ t: "err", message: "无法连接 API：" + e.message })
  );
}
