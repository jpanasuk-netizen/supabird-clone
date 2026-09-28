import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_PORT = 8080;
const BUNDLED_PORT = 8082;
const HOUSE_EXE = path.join(process.env.USERPROFILE || "C:\\Users\\jpana", ".local", "bin", "fcc-server.exe");
const BUNDLED_EXE = path.join(ROOT, "fcc", ".venv", "Scripts", "fcc-server.exe");
const CATALOG = path.join(process.env.USERPROFILE || "C:\\Users\\jpana", ".fcc", "codex-model-catalog.json");
const HOUSE_ENV = path.join(process.env.USERPROFILE || "C:\\Users\\jpana", ".fcc", ".env");
const ROUTE_FILE = path.join(ROOT, "data", "fcc-route.json");
const KEY = process.env.FCC_API_KEY || process.env.ANTHROPIC_API_KEY || "local";

let cache = null;

function isNim(s) {
  return /nvidia_nim|\bNIM\b|2b2dcd47-c858-425a-9c04-4cacf2eac9/i.test(String(s || ""));
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => {
      sock.end();
      resolve(true);
    });
    sock.setTimeout(800);
    sock.on("error", () => resolve(false));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function spawnFcc({ house }) {
  const py = path.join(ROOT, "fcc", ".venv", "Scripts", "python.exe");
  const script = path.join(ROOT, "fcc", "spawn.py");
  if (!fs.existsSync(py) || !fs.existsSync(script)) return;
  const args = house ? [script, "--house", "--port", "8080"] : [script, "--port", "8082"];
  const child = spawn(py, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function waitPort(port, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portOpen("127.0.0.1", port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return portOpen("127.0.0.1", port);
}

function catalogSlugs() {
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
    return (data.models || []).map((m) => String(m.slug || "")).filter(Boolean);
  } catch {
    return [];
  }
}

function houseModel() {
  try {
    const lines = fs.readFileSync(HOUSE_ENV, "utf8").split(/\n/);
    const get = (k) => {
      const row = lines.find((l) => l.startsWith(k + "="));
      return row ? row.slice(k.length + 1).trim() : "";
    };
    return { model: get("MODEL"), sonnet: get("MODEL_SONNET") };
  } catch {
    return { model: "", sonnet: "" };
  }
}

function candidates() {
  const slugs = catalogSlugs();
  const house = houseModel();
  const sonnet = slugs.filter((s) => /claude-sonnet-4\.6$/i.test(s) && !isNim(s));
  const kimi = slugs.filter((s) => /kimi-k2\.7-code/i.test(s) && !isNim(s) && !/nvidia/i.test(s));
  const cf = slugs.filter((s) => s.startsWith("cloudflare/@cf/") && !isNim(s));
  const gemini = slugs.filter((s) => s.startsWith("gemini/") && !isNim(s)).slice(0, 4);
  const extra = [];
  if (sonnet.length) extra.push(sonnet[0], `anthropic/${sonnet[0]}`);
  else extra.push("open_router/anthropic/claude-sonnet-4.6");
  extra.push(...kimi, "cloudflare/@cf/moonshotai/kimi-k2.7-code");
  if (house.sonnet && !isNim(house.sonnet)) extra.push(house.sonnet);
  if (house.model && !isNim(house.model)) extra.push(house.model);
  extra.push(...cf.slice(0, 8), ...gemini);
  const seen = new Set();
  const out = [];
  for (const id of extra) {
    if (!id || isNim(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, 16);
}

function textFromMessages(data) {
  const blocks = data && data.content;
  if (typeof blocks === "string") return blocks.trim();
  if (!Array.isArray(blocks)) return String((data && (data.text || data.output_text)) || "").trim();
  return blocks
    .filter((b) => b && b.type === "text" && b.text)
    .map((b) => String(b.text))
    .join("\n")
    .trim();
}

function clipErr(raw) {
  return String(raw || "").replace(/\s+/g, " ").slice(0, 240);
}

function publicErr(raw) {
  if (isNim(raw)) {
    return "Local FCC tried NVIDIA NIM as a fallback and it is not available. NIM is not used for idea generation.";
  }
  return clipErr(raw);
}

async function fccPost(base, model, system, user, maxTokens) {
  const payload = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }]
  });
  const headersList = [
    { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    { "x-api-key": KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
  ];
  let last = "FCC unreachable";
  for (const headers of headersList) {
    try {
      const r = await fetch(`${base}/messages`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(maxTokens > 100 ? 90000 : 20000)
      });
      const raw = await r.text();
      if (isNim(raw)) {
        last = publicErr(raw);
        continue;
      }
      if (r.status >= 400) {
        last = `FCC /messages HTTP ${r.status}: ${publicErr(raw)}`;
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        last = "FCC /messages non-JSON";
        continue;
      }
      const text = textFromMessages(data);
      if (!text) {
        last = "FCC /messages empty text";
        continue;
      }
      return { text, model: data.model || model, base, rawStatus: r.status };
    } catch (err) {
      last = err && err.name === "TimeoutError" ? "FCC timeout" : String(err.message || err);
    }
  }
  throw new Error(last);
}

async function probe(base, model) {
  try {
    const out = await fccPost(base, model, "You reply with one word.", "Reply with the single word OK.", 40);
    return out;
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

async function endpoints() {
  const list = [];
  if (await portOpen("127.0.0.1", HOUSE_PORT)) {
    list.push({ base: `http://127.0.0.1:${HOUSE_PORT}/v1`, source: "house", port: HOUSE_PORT });
  }
  if (await portOpen("127.0.0.1", BUNDLED_PORT)) {
    list.push({ base: `http://127.0.0.1:${BUNDLED_PORT}/v1`, source: "bundled", port: BUNDLED_PORT });
  }
  return list;
}

async function ensureListening() {
  let eps = await endpoints();
  if (eps.length) return eps;
  if (fs.existsSync(HOUSE_EXE)) {
    spawnFcc({ house: true });
    await waitPort(HOUSE_PORT);
  }
  eps = await endpoints();
  if (eps.length) return eps;
  if (fs.existsSync(BUNDLED_EXE)) {
    spawnFcc({ house: false });
    await waitPort(BUNDLED_PORT);
  }
  return endpoints();
}

function saveRoute(route) {
  try {
    fs.mkdirSync(path.dirname(ROUTE_FILE), { recursive: true });
    fs.writeFileSync(ROUTE_FILE, JSON.stringify(route, null, 2), "utf8");
  } catch {
    /* ignore */
  }
  cache = route;
}

function loadRoute() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(ROUTE_FILE, "utf8"));
    return cache;
  } catch {
    return null;
  }
}

export async function resolveFcc(force) {
  if (!force) {
    const cached = loadRoute();
    if (cached && cached.base && cached.model && !isNim(cached.model)) return cached;
  }
  const eps = await ensureListening();
  if (!eps.length) {
    throw new Error("No local Free Claude Code is listening on 127.0.0.1:8080 or :8082. Start house FCC or the bundled fcc/ install.");
  }
  const models = candidates();
  const tried = [];
  for (const ep of eps) {
    for (const model of models) {
      const hit = await probe(ep.base, model);
      if (hit.text) {
        const route = {
          base: ep.base,
          model,
          source: ep.source,
          at: new Date().toISOString()
        };
        saveRoute(route);
        return route;
      }
      tried.push(`${ep.source} ${ep.base} ${model}: ${hit.error || "no text"}`);
    }
  }
  throw new Error(
    "No healthy local FCC model. Sonnet 4.6 is in the catalog but FCC falls through to NVIDIA NIM, which is disabled. Tried: " +
      tried.slice(0, 8).join(" | ")
  );
}

export async function fccComplete(system, user) {
  let route = await resolveFcc(false);
  let last = "FCC generate failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await fccPost(route.base, route.model, system, user, 500);
      return {
        text: out.text,
        model: out.model,
        provider: "fcc",
        fccBase: route.base,
        fccSource: route.source
      };
    } catch (err) {
      last = String(err.message || err);
      if (isNim(last)) {
        cache = null;
        try { fs.unlinkSync(ROUTE_FILE); } catch { /* ignore */ }
        route = await resolveFcc(true);
      }
    }
  }
  throw new Error(last);
}

export function fccRouteStatus() {
  const r = loadRoute();
  return r || { base: "", model: "", source: "unresolved" };
}

export { textFromMessages, isNim };
