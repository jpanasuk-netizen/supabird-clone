// Zero-dep static + generate proxy. Binds 127.0.0.1:4747 only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  apiPayloadForPost,
  beginLogin,
  finishLogin,
  hydrateXApp,
  loadXStore,
  logoutX,
  postToX,
  saveXCredentials,
  xCallbackError,
  xPublicStatus
} from "./x-oauth.mjs";
import { fccComplete, fccRouteStatus, resolveFcc } from "./fcc-resolve.mjs";
import {
  queueLocal,
  readCommandCenter,
  recordFailed,
  recordPostResults,
  saveDraft
} from "./x-sync.mjs";
import { armIngestTimer, ingestStatus, runIngest } from "./x-ingest.mjs";
import { fileURLToPath } from "node:url";
import { handleHousexProxy, isHousexProxyPath, resolveHousexBase } from "./housex-proxy.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(ROOT, ".env"));
loadDotEnv(path.join(ROOT, ".env.local"));

const HOST = "127.0.0.1";
const PORT = 4747;
const VYCE_BASE = "https://vyceai.com/v1";
const VYCE_MODEL = "gpt-6-luna";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

function fccVersion() {
  const p = path.join(ROOT, "fcc", "VERSION");
  if (!fs.existsSync(p)) return { version: "missing", commit: "" };
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  return { version: lines[0] || "unknown", commit: lines[1] || "" };
}

function fccUpdateStatus() {
  const p = path.join(ROOT, "fcc", "update-status.json");
  if (!fs.existsSync(p)) return { action: "unchecked", message: "no update check yet" };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { action: "check-failed", message: "update-status.json unreadable" };
  }
}

function fccPython() {
  const venv = path.join(ROOT, "fcc", ".venv", "Scripts", "python.exe");
  return fs.existsSync(venv) ? venv : "python";
}

function kickFccUpdate() {
  const script = path.join(ROOT, "fcc", "update.py");
  if (!fs.existsSync(script)) return fccUpdateStatus();
  const child = spawn(fccPython(), [script], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return fccUpdateStatus();
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function clipErr(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .slice(0, 280);
}

function textFromMessages(data) {
  const blocks = data && data.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && b.type === "text" && b.text)
    .map((b) => String(b.text))
    .join("\n")
    .trim();
}

function textFromChat(data) {
  const choice = data && data.choices && data.choices[0];
  const msg = choice && choice.message;
  const content = msg && msg.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && part.type === "text" ? part.text : typeof part === "string" ? part : ""))
      .join("")
      .trim();
  }
  return String(data && (data.text || data.output_text) || "").trim();
}

function promptFor(kind, input) {
  const topic = String(input.topic || "your craft").trim();
  const niche = String(input.niche || "your niche").trim();
  const creators = String(input.creators || "creators you actually read").trim();
  const draft = String(input.draft || "").trim();
  const mode = String(input.mode || "voice");
  const clip = String(input.url || "a video already shot").trim();
  if (kind === "ideas") {
    return {
      system: "You write X (Twitter) post ideas. No fake follower counts. No income claims. Do not offer to post. Plain, specific, American English.",
      user: `Write 5 distinct X post ideas for topic "${topic}" in niche "${niche}". Pacing inspired by ${creators}, not copied sentences. Number them 1-5. Each idea is a ready-to-post draft, not a title.`
    };
  }
  if (kind === "machine") {
    return {
      system: "You are a content machine for X. Return real drafts, not templates. No fake metrics. Nothing gets posted.",
      user: `Topic: ${topic}\nNiche: ${niche}\nFavorite creators (pacing only): ${creators}\nWrite 7 posts for one week. Number them 1-7. Mix hooks, proof, and one soft ask. Ready to paste.`
    };
  }
  if (kind === "rewrite") {
    const how =
      mode === "short"
        ? "Shorten under 220 characters. Keep the claim."
        : mode === "remix"
          ? "Remix: hot take, then a receipt, then one next action."
          : "Rewrite in a plain specific voice. Cut vibe words. End on a next action.";
    return {
      system: "You rewrite X drafts. Do not invent stats. Do not post.",
      user: `${how}\n\nDraft:\n${draft || "(empty)"}`
    };
  }
  if (kind === "video") {
    return {
      system: "You turn a video into X posts. Do not upload or publish. No fake view counts.",
      user: `Clip reference: ${clip}\nWrite: (1) a 3-line hook post, (2) a still+claim+ask post, (3) a 4-post thread outline. Ready to paste.`
    };
  }
  return null;
}

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

async function customComplete(system, user, custom) {
  const base = normalizeBase(custom.baseUrl);
  const model = String(custom.model || "").trim();
  const key = String(custom.apiKey || "").trim();
  if (!base || !model || !key) {
    throw new Error("Custom provider is not set (need base URL, model id, and API key)");
  }
  const payload = JSON.stringify({
    model,
    max_tokens: 1200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: payload,
    signal: AbortSignal.timeout(90000)
  });
  const raw = await r.text();
  if (r.status >= 400) {
    throw new Error(`Custom /chat/completions HTTP ${r.status}: ${clipErr(raw)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Custom /chat/completions non-JSON");
  }
  const text = textFromChat(data);
  if (!text) throw new Error("Custom /chat/completions empty text");
  return { text, model: (data.model || model), provider: "custom" };
}

function parseIdeas(text) {
  const rows = text
    .split(/\n+/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  const parts = rows.length >= 3 ? rows : text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((t) => ({ text: t }));
}

function normalizeProvider(value) {
  const provider = String(value || "fcc").toLowerCase();
  if (provider === "custom" || provider === "vyce") return provider;
  return "fcc";
}

function readSettings() {
  const provider = normalizeProvider(process.env.PROVIDER || "fcc");
  const key = String(process.env.CUSTOM_API_KEY || "");
  const vyceKey = String(process.env.VYCE_API_KEY || "");
  const route = fccRouteStatus();
  return {
    provider,
    fccBase: route.base || "http://127.0.0.1:8080/v1",
    fccModel: route.model || "",
    fccSource: route.source || "unresolved",
    customBase: String(process.env.CUSTOM_BASE_URL || ""),
    customModel: String(process.env.CUSTOM_MODEL || ""),
    hasCustomKey: Boolean(key),
    customKeyHint: key ? `set (${key.slice(-4)})` : "",
    vyceBase: VYCE_BASE,
    vyceModel: VYCE_MODEL,
    hasVyceKey: Boolean(vyceKey),
    vyceKeyHint: vyceKey ? `set (${vyceKey.slice(-4)})` : ""
  };
}

function writeEnvLocal(input) {
  const provider = normalizeProvider(input.provider);
  const customBase = String(input.customBase || input.baseUrl || "").trim();
  const customModel = String(input.customModel || input.model || "").trim();
  const incomingKey = String(input.customKey || input.apiKey || "");
  const keepKey = incomingKey || String(process.env.CUSTOM_API_KEY || "");
  const incomingVyce = String(input.vyceKey || "");
  const keepVyce = provider === "fcc" ? "" : (incomingVyce || String(process.env.VYCE_API_KEY || ""));
  if (provider === "vyce" && !keepVyce) {
    const err = new Error("VYCE key is not set");
    err.status = 400;
    throw err;
  }
  const route = fccRouteStatus();
  const housex = String(process.env.HOUSEX_API_URL || "").trim();
  const lines = [
    "# gitignored. Do not commit.",
    `PROVIDER=${provider}`,
    `FCC_BASE_URL=${route.base || "http://127.0.0.1:8080/v1"}`,
    `FCC_MODEL=${route.model || ""}`,
    "ANTHROPIC_API_KEY=local",
    `CUSTOM_BASE_URL=${customBase}`,
    `CUSTOM_MODEL=${customModel}`,
    keepKey ? `CUSTOM_API_KEY=${keepKey}` : "# CUSTOM_API_KEY=",
    keepVyce ? `VYCE_API_KEY=${keepVyce}` : "# VYCE_API_KEY=",
    `VYCE_MODEL=${VYCE_MODEL}`
  ];
  if (housex) lines.push(`HOUSEX_API_URL=${housex}`);
  fs.writeFileSync(path.join(ROOT, ".env.local"), lines.join("\n") + "\n", "utf8");
  process.env.PROVIDER = provider;
  process.env.CUSTOM_BASE_URL = customBase;
  process.env.CUSTOM_MODEL = customModel;
  if (keepKey) process.env.CUSTOM_API_KEY = keepKey;
  else delete process.env.CUSTOM_API_KEY;
  if (keepVyce) process.env.VYCE_API_KEY = keepVyce;
  else delete process.env.VYCE_API_KEY;
}

async function complete(input, prompt) {
  const provider = normalizeProvider(input.provider || process.env.PROVIDER || "fcc");
  if (provider === "custom") {
    const supplied = input.custom && typeof input.custom === "object" ? input.custom : null;
    return customComplete(prompt.system, prompt.user, {
      baseUrl: supplied ? supplied.baseUrl : process.env.CUSTOM_BASE_URL,
      model: supplied ? supplied.model : process.env.CUSTOM_MODEL,
      apiKey: supplied ? supplied.apiKey : process.env.CUSTOM_API_KEY
    });
  }
  if (provider === "vyce") {
    const supplied = input.vyce && typeof input.vyce === "object" ? input.vyce : null;
    const key = String((supplied && supplied.apiKey) || process.env.VYCE_API_KEY || "").trim();
    if (!key) throw new Error("VYCE key is not set");
    const out = await customComplete(prompt.system, prompt.user, {
      baseUrl: VYCE_BASE,
      model: VYCE_MODEL,
      apiKey: key
    });
    return { ...out, model: VYCE_MODEL, provider: "vyce" };
  }
  return fccComplete(prompt.system, prompt.user);
}

async function handleGenerate(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let input;
  try {
    input = JSON.parse(body || "{}");
  } catch {
    json(res, 400, { error: "Bad JSON" });
    return;
  }
  const kind = String(input.kind || "");
  const prompt = promptFor(kind, input);
  if (!prompt) {
    json(res, 400, { error: "Unknown kind" });
    return;
  }
  try {
    const out = await complete(input, prompt);
    json(res, 200, {
      text: out.text,
      model: out.model,
      provider: out.provider,
      fccBase: out.fccBase,
      fccSource: out.fccSource,
      ideas: kind === "ideas" || kind === "machine" ? parseIdeas(out.text) : undefined
    });
  } catch (err) {
    json(res, 503, { error: String(err.message || err) });
  }
}

async function handleSettings(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let input;
  try {
    input = JSON.parse(body || "{}");
  } catch {
    json(res, 400, { error: "Bad JSON" });
    return;
  }
  try {
    writeEnvLocal(input);
  } catch (err) {
    json(res, err.status || 400, { error: String(err.message || err) });
    return;
  }
  json(res, 200, { ok: true, settings: readSettings() });
}

const PUBLIC = path.join(ROOT, "public");
// X Trends Desk bridge. The desk (127.0.0.1:3489, in WSL) may read /api/health and save drafts
// via /api/x/drafts from the browser; nothing else is opened cross-origin. Drafts never post.
const TRENDS_DESK = "http://127.0.0.1:3489";
const TRENDS_ORIGINS = new Set(["http://127.0.0.1:3489", "http://localhost:3489"]);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  const origin = req.headers.origin || "";
  if (TRENDS_ORIGINS.has(origin) && (url.pathname === "/api/health" || url.pathname === "/api/x/drafts")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" }).end();
      return;
    }
  }
  if (isHousexProxyPath(url.pathname)) {
    await handleHousexProxy(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/trends/summary") {
    try {
      const r = await fetch(TRENDS_DESK + "/api/summary", { signal: AbortSignal.timeout(4000) });
      json(res, r.status, await r.json());
    } catch {
      json(res, 502, { ok: false, error: "X Trends Desk offline" });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/generate") {
    await handleGenerate(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    await handleSettings(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/settings") {
    json(res, 200, { ok: true, settings: readSettings(), fcc: fccVersion(), fccUpdate: fccUpdateStatus() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    const ver = fccVersion();
    const route = fccRouteStatus();
    json(res, 200, {
      ok: true,
      fcc: route.base || "unresolved",
      model: route.model || "",
      fccSource: route.source || "unresolved",
      port: PORT,
      provider: String(process.env.PROVIDER || "fcc"),
      vyceModel: VYCE_MODEL,
      vyceWhenKeySet: Boolean(String(process.env.VYCE_API_KEY || "").trim()),
      fccVersion: ver.version,
      fccCommit: ver.commit,
      fccUpdate: fccUpdateStatus(),
      xIngest: ingestStatus(ROOT),
      housex: resolveHousexBase("", process.env.HOUSEX_API_URL)
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/x/status") {
    json(res, 200, hydrateXApp(ROOT));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/credentials") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      json(res, 200, { ok: true, x: saveXCredentials(ROOT, JSON.parse(raw || "{}")) });
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/x/login") {
    try {
      const loc = beginLogin(ROOT);
      res.writeHead(302, { Location: loc });
      res.end();
    } catch (err) {
      const msg = encodeURIComponent(String(err.message || err));
      res.writeHead(302, { Location: `/#/signin?posting=1&need=client&error=${msg}` });
      res.end();
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/callback/x") {
    const xErr = xCallbackError(url.searchParams);
    if (xErr) {
      const q = new URLSearchParams();
      q.set("error", url.searchParams.get("error") || "access_denied");
      q.set("oauth_error", url.searchParams.get("error_description") || xErr);
      res.writeHead(302, { Location: `/#/dashboard?${q}` });
      res.end();
      return;
    }
    try {
      await finishLogin(ROOT, url.searchParams);
      res.writeHead(302, { Location: "/#/dashboard?syncing=1" });
      res.end();
      runIngest(ROOT, "signin").catch((err) => {
        console.error("X ingest after sign-in", String(err.message || err));
      });
    } catch (err) {
      console.error("X callback failed", String(err.message || err));
      const q = new URLSearchParams({ oauth_error: String(err.message || err) });
      res.writeHead(302, { Location: `/#/dashboard?${q}` });
      res.end();
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/logout") {
    json(res, 200, { ok: true, x: logoutX(ROOT) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/preview") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const input = JSON.parse(raw || "{}");
      const items = Array.isArray(input.thread) && input.thread.length ? input.thread : [input];
      json(res, 200, {
        x: xPublicStatus(loadXStore(ROOT)),
        thread: items.map((item) => apiPayloadForPost({ ...input, ...item }))
      });
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/post") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      const input = JSON.parse(raw || "{}");
      const out = await postToX(ROOT, input);
      recordPostResults(ROOT, out);
      const posted = (out.posts || []).filter((p) => p.id);
      if (posted.length) {
        let ingest;
        try {
          ingest = await runIngest(ROOT, "post");
        } catch (err) {
          ingest = { ok: false, reason: "post", error: String(err.message || err), lastSync: ingestStatus(ROOT).lastSync };
        }
        json(res, 200, {
          ...out,
          ingest: {
            reason: "post",
            ok: Boolean(ingest.ok),
            lastSync: ingest.lastSync || null,
            overlap: Boolean(ingest.overlap),
            error: ingest.error || null
          }
        });
        return;
      }
      json(res, 200, out);
    } catch (err) {
      try {
        const input = JSON.parse(raw || "{}");
        recordFailed(ROOT, input, err.message || err);
      } catch {
        /* ignore */
      }
      json(res, 401, { error: String(err.message || err) });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/x/stats") {
    const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("sync") === "1";
    if (refresh) {
      const out = await runIngest(ROOT, "refresh");
      json(res, out.ok ? 200 : 401, out);
      return;
    }
    json(res, 200, { ok: true, summary: readCommandCenter(ROOT), ingest: ingestStatus(ROOT) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/x/ingest") {
    json(res, 200, ingestStatus(ROOT));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/sync") {
    const out = await runIngest(ROOT, "refresh");
    json(res, out.ok ? 200 : 401, out);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/x/engage") {
    const summary = readCommandCenter(ROOT);
    json(res, 200, {
      ok: true,
      lastSync: summary.lastSync,
      ingest: ingestStatus(ROOT),
      mentions: summary.mentions || [],
      error: summary.lastSync && summary.lastSync.error
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/drafts") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      json(res, 200, { ok: true, draft: saveDraft(ROOT, JSON.parse(raw || "{}")) });
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/x/queue") {
    let raw = "";
    for await (const c of req) raw += c;
    try {
      json(res, 200, { ok: true, item: queueLocal(ROOT, JSON.parse(raw || "{}")) });
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
    return;
  }
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  const abs = path.resolve(PUBLIC, file.replace(/^\/+/, ""));
  if (!abs.startsWith(PUBLIC)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(abs, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(abs)] || "application/octet-stream" }).end(buf);
  });
});

server.listen(PORT, HOST, async () => {
  const ver = fccVersion();
  const x = hydrateXApp(ROOT);
  const housex = resolveHousexBase("", process.env.HOUSEX_API_URL);
  console.log(`Blue Jay http://${HOST}:${PORT}/#/housex`);
  console.log(`HouseX API ${housex.base || "http://127.0.0.1:8787/v1"}`);
  console.log("env HOUSEX_API_URL");
  console.log(`VYCE ${VYCE_MODEL} for AI when key set`);
  console.log(`bundled FCC pin ${ver.version} ${ver.commit}`);
  console.log(`X @${x.expectedUsername} client=${x.hasClientId ? "yes *" + x.clientIdHint : "missing"} signedIn=${x.signedIn}`);
  kickFccUpdate();
  const ingest = armIngestTimer(ROOT);
  console.log(`X ingest timer armed=${ingest.armed} every ${ingest.intervalMs}ms next=${ingest.nextRunAt}`);
  resolveFcc(false).catch((err) => console.error(String(err.message || err)));
});
