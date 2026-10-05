// X Trends Desk v2 on http://127.0.0.1:3489  (node trends-ui.mjs, run from ~/xai-test)
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { SpaceXAI } from "@xai-official/sdk";
import { xSearch } from "@xai-official/sdk/tools";

const PORT = 3489, KEYFILE = ".xai-key", DIR = "reports", TOPICS_F = "topics.json", SET_F = "settings.json", USAGE_F = "usage.jsonl", REPLIES_F = "replies.json";
const BLUEJAY = "http://127.0.0.1:4747";
mkdirSync(DIR, { recursive: true });
const getKey = () => (existsSync(KEYFILE) ? readFileSync(KEYFILE, "utf8").trim() : "") || process.env.XAI_API_KEY || "";
const keySource = () => (existsSync(KEYFILE) && readFileSync(KEYFILE, "utf8").trim() ? "file" : process.env.XAI_API_KEY ? "env" : "");
const loadJ = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const KNOWN_MODELS = ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning"];
let topics = loadJ(TOPICS_F, [
  { id: "law", name: "⚖️ Law", desc: "legal news, court rulings, Supreme Court, lawsuits, legal commentary, regulation" },
  { id: "finance", name: "💵 Finance", desc: "markets, stocks, the Fed, interest rates, crypto, earnings, economy" },
]);
let settings = { model: "grok-4.7", auto: false, every: 60, focus: "", daily: true, dailyAt: "06:00", dailyDone: "", lastMuse: null, ...loadJ(SET_F, {}) };
const saveTopics = () => writeFileSync(TOPICS_F, JSON.stringify(topics, null, 1));
const saveSettings = () => writeFileSync(SET_F, JSON.stringify(settings, null, 1));
if (!existsSync(TOPICS_F)) saveTopics();

// Plain-words errors. Never echo anything key-shaped.
function friendly(e) {
  const st = e?.status, m = String(e?.message || e).replace(/xai-[A-Za-z0-9_-]{6,}/g, "xai-•••").slice(0, 300);
  if (st === 401) return "Your API key was rejected (401). Paste a fresh key from console.x.ai.";
  if (st === 403) return /credit|spend|billing|fund|balance/i.test(m) ? "Your team has no credits (403). Add credits in console.x.ai, or use a key from the team that has them." : "Access denied (403): " + m;
  if (st === 404 || /model.*(not found|does not exist|invalid)/i.test(m)) return `Model "${settings.model}" isn't available to you. Pick another model.`;
  if (st === 429) return "Rate limited or out of quota (429). Wait a bit and try again.";
  if (st >= 500) return `xAI server error (${st}). Try again in a minute.`;
  if (e?.name === "TimeoutError") return "The request timed out. Try again.";
  if (e?.name === "APIConnectionError" || /fetch failed|ENOTFOUND|ECONN|EAI_AGAIN/i.test(m)) return "Couldn't reach the xAI API. Check your internet connection.";
  return m;
}
const client = () => new SpaceXAI({ apiKey: getKey() });

async function runTopic(t) {
  const from = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const r = await client().responses.create({
    model: settings.model,
    tools: [xSearch({ from_date: from })],
    input: `Search X posts from the last 24 hours about ${t.desc}${settings.focus ? ", focused on " + settings.focus : ""}.
Find the top 5 topics getting the most engagement right now. For each give exactly:
### <topic in one line>
- Why: 2 sentences on why people are talking about it
- Posts: 1-2 example X post links (full https://x.com/... URLs)
- Sources: any news/source links you found (full URLs), or omit this line
- Idea: one reply or post I could write, plain and punchy
Only use what you actually found. Don't make up numbers.`,
  });
  const f = `${t.id}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`;
  writeFileSync(`${DIR}/${f}`, r.toText());
  runs[t.id].usage = recordUsage("run", t.id, r.usage);
  return f;
}

// ---- Usage / cost meter. Dollars only from the API's own cost field; otherwise an estimate
// from official prices (USD per 1M tokens, <200k prompt tier; >=200k tier is exactly 2x for all of these)
// https://docs.x.ai/developers/pricing  (fetched 2026-10-03). X Search tool fees ($5 per 1k posts fetched) not estimated.
const PRICES = { "grok-4.7": [2, 0.5, 6], "grok-4.6": [2, 0.5, 6], "grok-4.5": [2, 0.3, 6], "grok-4.3": [1.25, 0.2, 2.5],
  "grok-4.20-0309-reasoning": [1.25, 0.2, 2.5], "grok-4.20-0309-non-reasoning": [1.25, 0.2, 2.5], "grok-4.20-multi-agent-0309": [1.25, 0.2, 2.5] };
const PRICE_NOTE = "Estimate from official xAI prices (docs.x.ai/developers/pricing, fetched 2026-10-03), per 1M tokens: " +
  Object.entries(PRICES).map(([m, p]) => `${m} in $${p[0]} / cached $${p[1]} / out $${p[2]}`).join("; ") + ". 2x at 200k+ prompt tokens. Reasoning billed as output. X Search fees ($5 per 1k posts fetched) not included.";
let usageCache = null;
function estCost(r) {
  const p = PRICES[r.model]; if (!p) return null;
  const x = r.in >= 200000 ? 2 : 1, out = Math.max(r.out, (r.total || 0) - r.in);
  return (((r.in - r.cached) * p[0] + r.cached * p[1] + out * p[2]) * x) / 1e6;
}
function recordUsage(kind, topic, u) {
  const row = { ts: Date.now(), kind, topic, model: settings.model, in: u?.input_tokens || 0, cached: u?.input_tokens_details?.cached_tokens || 0,
    out: u?.output_tokens || 0, reasoning: u?.output_tokens_details?.reasoning_tokens || 0, total: u?.total_tokens || 0,
    sources: u?.num_sources_used || 0, tools: u?.num_server_side_tools_used || 0, tool_details: u?.server_side_tool_usage_details || null,
    cost_usd: typeof u?.cost_usd === "number" ? u.cost_usd : null };
  try { appendFileSync(USAGE_F, JSON.stringify(row) + "\n"); } catch {}
  usageCache = null; return row;
}
function usageSummary() {
  if (usageCache) return usageCache;
  const rows = (existsSync(USAGE_F) ? readFileSync(USAGE_F, "utf8") : "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const today = ctDate(Date.now()), agg = (rs) => rs.reduce((a, r) => {
    a.n++; a.tok += r.total || r.in + r.out + r.reasoning; a.in += r.in; a.out += r.out; a.reasoning += r.reasoning; a.sources += r.sources;
    if (r.cost_usd != null) a.api += r.cost_usd; else { const e = estCost(r); if (e != null) a.est += e; }
    return a; }, { n: 0, tok: 0, in: 0, out: 0, reasoning: 0, sources: 0, api: 0, est: 0 });
  const last = rows[rows.length - 1] || null;
  return (usageCache = { last: last && { ...agg([last]), kind: last.kind, topic: last.topic, ts: last.ts }, today: agg(rows.filter((r) => ctDate(r.ts) === today)), total: agg(rows), note: PRICE_NOTE });
}

// ---- Time helpers (America/Chicago)
const ctDate = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ctMin = (t) => { const [h, m] = new Date(t).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number); return (h % 24) * 60 + m; };
const ctStr = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
const atLabel = (hm) => { const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "AM" : "PM"}`; };

// ---- Report parsing + rising/fading (local fuzzy title match, no API)
const readR = (f) => readFileSync(`${DIR}/${f}`, "utf8");
function parseReport(md) {
  const parts = md.split(/^### /m); parts.shift();
  return parts.map((p, i) => {
    const n = p.indexOf("\n"), title = (n < 0 ? p : p.slice(0, n)).replace(/\*\*/g, "").trim(), b = n < 0 ? "" : p.slice(n + 1);
    const field = (k) => (b.match(new RegExp("^\\s*[-*]\\s*\\**" + k + "\\**:\\**\\s*(.+)$", "mi")) || [])[1]?.trim() || "";
    return { rank: i + 1, title, why: field("Why"), idea: field("Idea"), links: [...new Set((b.match(/https?:\/\/[^\s)<>,\]]+/g) || []).map((u) => u.replace(/[.;:]+$/, "")))] };
  });
}
const STOP = new Set("the a an of to in on for and or is are at by with from as after over says say new its it this that be was were has have will into about than more amid just".split(" "));
const toks = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9$%\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, "")));
function sim(a, b) { let i = 0; for (const w of a) if (b.has(w)) i++; const m = Math.min(a.size, b.size); return m && (i >= 2 || m === 1) ? i / m : 0; }
const diffCache = new Map();
function diffFor(f) {
  const all = listReports(), key = f + "|" + all.length;
  if (diffCache.has(key)) return diffCache.get(key);
  const me = all.find((r) => r.f === f); if (!me) return null;
  const older = all.filter((r) => r.topic === me.topic && r.t < me.t), day = ctDate(me.t);
  const prevDay = older.find((r) => ctDate(r.t) < day), prev = prevDay || older[0];
  const cur = parseReport(readR(f));
  let out = { prev: null, basis: "", tags: cur.map(() => ({ tag: "" })), fading: [] };
  if (prev) {
    const old = parseReport(readR(prev.f)), used = new Set();
    out = { prev: prev.f, prevT: prev.t, basis: prevDay ? "previous day" : "previous run", fading: [], tags: cur.map((c) => {
      const ct = toks(c.title); let best = -1, bs = 0;
      old.forEach((o, j) => { if (used.has(j)) return; const s = sim(ct, toks(o.title)); if (s > bs) { bs = s; best = j; } });
      if (best < 0 || bs < 0.5) return { tag: "NEW" };
      used.add(best); const was = old[best].rank;
      if (was < c.rank) out.fading.push({ title: c.title, was, now: c.rank });
      return { tag: was > c.rank ? "RISING" : was < c.rank ? "FADING" : "STEADY", was };
    }) };
    old.forEach((o, j) => { if (!used.has(j)) out.fading.push({ title: o.title, was: o.rank, now: null }); });
  }
  diffCache.set(key, out); return out;
}
function summary() {
  const all = listReports();
  return topics.map((t) => {
    const L = all.find((r) => r.topic === t.id); if (!L) return { id: t.id, name: t.name, latest: null, trends: [], fading: [] };
    const d = diffFor(L.f) || { tags: [], fading: [] };
    return { id: t.id, name: t.name, latest: L, basis: d.basis, trends: parseReport(readR(L.f)).map((x, i) => ({ ...x, ...(d.tags[i] || {}) })), fading: d.fading };
  });
}

// ---- Muse handoff over the local Connecture bus (hermes-aibus). Key read at send time, never logged or returned.
function museText(label) {
  const firstSentence = (s) => { let t = ((s || "").match(/^.*?[a-z0-9)\u201d"'%][.!?](?=\s+[A-Z\u201c"]|\s*$)/) || [s || ""])[0].trim(); if (t.length > 240) t = t.slice(0, 240).replace(/\s+\S*$/, "") + "…"; return t; };
  let s = `X Trends Desk ${label} hot topics (${ctStr(Date.now())})\n`;
  for (const c of summary()) {
    if (!c.latest) continue;
    s += `\n${c.name} (as of ${ctStr(c.latest.t)})\n`;
    c.trends.slice(0, 5).forEach((x, i) => { s += `${i + 1}. ${x.title}${x.tag && x.tag !== "STEADY" ? ` [${x.tag}]` : ""}\n   ${firstSentence(x.why)}\n`; });
  }
  return s + "\nUse for Machine Room / Shorts topics. Draft only, Jeremy gates publishing.";
}
async function sendToMuse(label) {
  let k;
  try { k = JSON.parse(readFileSync(`${process.env.AIBUS_DIR || homedir() + "/aibus"}/bus_keys.json`, "utf8")).keys[0].key; } catch { throw new Error("Couldn't read the bus key file (~/aibus/bus_keys.json)."); }
  const text = museText(label);
  for (const b of [process.env.AIBUS_URL, "http://127.0.0.1:8789", "http://127.0.0.1:8787"].filter(Boolean)) {
    try { if (!(await fetch(b + "/health", { signal: AbortSignal.timeout(1500) })).ok) continue; } catch { continue; }
    const r = await fetch(b + "/v1/messages", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json", authorization: "Bearer " + k },
      body: JSON.stringify({ from: "Leo-Bot", to: "leo-muse", topic: "trends/" + ctDate(Date.now()), text, mid: "trends-desk-" + Date.now() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`The bus refused the message (${r.status}${j.error ? ": " + j.error : ""}).`);
    settings.lastMuse = { id: j.id, ts: Date.now(), label }; saveSettings();
    console.log(new Date().toISOString(), "sent hot topics to leo-muse, bus msg", j.id);
    return j.id;
  }
  throw new Error("The Connecture bus is offline (tried :8789 and :8787).");
}

// ---- Reply finder: real replies only, verbatim, via X search
let replies = loadJ(REPLIES_F, []), repliesVer = 1;
const saveReplies = () => { writeFileSync(REPLIES_F, JSON.stringify(replies, null, 1)); repliesVer++; };
for (const e of replies) if (e.status === "running") { e.status = "error"; e.error = "Interrupted by a restart."; }
const isStatus = (u) => /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(u || "");
const clip = (v, n) => String(v ?? "").slice(0, n);
function extractJson(t) { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b < a) throw new Error("Grok didn't return usable results. Try again."); return JSON.parse(t.slice(a, b + 1)); }
async function findReplies(e, ctx) {
  try {
    const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const r = await client().responses.create({ model: settings.model, tools: [xSearch({ from_date: from })],
      input: `Trend: ${e.trend}\nContext: ${clip(ctx, 800)}\n
Use X search. Step 1: find the 3 biggest recent X posts about this trend (most likes/reposts/views). Step 2: for each of those posts, find the replies real people posted under it, and pick up to 3 of the best hot-take replies (sharp, opinionated, high engagement).
RULES: Quote replies VERBATIM, exactly as posted. Only include a reply you actually retrieved from X search, with its real status URL. Never write, paraphrase, summarize or invent a reply. If you could not retrieve real replies for a post, give it an empty replies list. Include engagement numbers only if search returned them, else "".
Return ONLY this JSON, no prose: {"posts":[{"author":"@handle","url":"https://x.com/handle/status/ID","text":"first ~200 chars of the post","engagement":"","replies":[{"author":"@handle","url":"https://x.com/handle/status/ID","text":"verbatim reply","engagement":""}]}]}` });
    e.usage = recordUsage("replies", e.topic, r.usage);
    const j = extractJson(r.toText());
    e.posts = (Array.isArray(j.posts) ? j.posts : []).filter((p) => isStatus(p.url)).slice(0, 3).map((p) => ({
      author: clip(p.author, 40), url: p.url, text: clip(p.text, 400), engagement: clip(p.engagement, 80),
      replies: (Array.isArray(p.replies) ? p.replies : []).filter((x) => isStatus(x.url) && String(x.text || "").trim() && x.url !== p.url).slice(0, 3)
        .map((x) => ({ author: clip(x.author, 40), url: x.url, text: clip(x.text, 1000), engagement: clip(x.engagement, 80) })) }));
    e.status = "done";
  } catch (err) { e.status = "error"; e.error = err instanceof SyntaxError ? "Grok's answer wasn't valid JSON. Try again." : friendly(err); }
  saveReplies();
}

// Server-side run queue (one at a time) + auto-refresh timer
const runs = {}, queue = []; let working = false, lastError = "", nextRun = null, timer = null;
function enqueue(ids) {
  if (!getKey()) return "Enter your API key first.";
  for (const id of ids) {
    if (!topics.find((t) => t.id === id)) continue;
    const s = (runs[id] ||= {});
    if (s.status === "queued" || s.status === "running") continue;
    Object.assign(s, { status: "queued", error: "" }); queue.push(id);
  }
  pump(); return "";
}
async function pump() {
  if (working) return; working = true;
  while (queue.length) {
    const id = queue.shift(), t = topics.find((x) => x.id === id), s = runs[id];
    if (!t) { delete runs[id]; continue; }
    s.status = "running";
    try { s.file = await runTopic(t); s.status = "done"; lastError = ""; if (daily) daily.ok++; console.log(new Date().toISOString(), "ran", id, "->", s.file); }
    catch (e) { s.status = "error"; s.error = lastError = friendly(e); console.log(new Date().toISOString(), "run failed", id, s.error); }
  }
  working = false;
  if (daily) { const d = daily; daily = null;
    if (d.ok) sendToMuse(atLabel(settings.dailyAt)).catch((e) => { lastError = "Daily run done, but Muse send failed: " + e.message; console.log(lastError); });
    else lastError = "Daily run failed, so nothing was sent to Muse. " + lastError; }
}
// Daily scheduled run (America/Chicago). Fires within 90 min after the set time, once per day.
let daily = null;
function nextDaily() {
  if (!settings.daily) return null;
  const [h, m] = settings.dailyAt.split(":").map(Number), now = Date.now(), cur = ctMin(now), target = h * 60 + m;
  const mins = settings.dailyDone !== ctDate(now) && cur < target + 90 ? Math.max(0, target - cur) : 1440 - cur + target;
  return now - (now % 60e3) + mins * 60e3;
}
setInterval(() => {
  if (!settings.daily || daily) return;
  const now = Date.now(), [h, m] = settings.dailyAt.split(":").map(Number), cur = ctMin(now), target = h * 60 + m;
  if (settings.dailyDone === ctDate(now) || cur < target || cur >= target + 90) return;
  settings.dailyDone = ctDate(now); saveSettings();
  daily = { ok: 0 }; const err = enqueue(topics.map((t) => t.id));
  if (err) { daily = null; lastError = "Daily run skipped: " + err; }
  console.log(new Date().toISOString(), "daily run", err || "queued");
}, 30e3);
function arm() {
  clearTimeout(timer); timer = null; nextRun = null;
  if (!settings.auto) return;
  const ms = Math.max(30, +settings.every || 60) * 60e3;
  nextRun = Date.now() + ms;
  timer = setTimeout(() => { enqueue(topics.map((t) => t.id)); arm(); }, ms);
}
arm();

let modelCache = null;
async function models() {
  if (modelCache && Date.now() - modelCache.t < 36e5) return modelCache.list;
  let list = KNOWN_MODELS;
  if (getKey()) try { // free metadata call, no tokens
    const r = await client().models.language.list();
    const ids = (r.models || r.data || []).map((m) => m.id).filter(Boolean);
    if (ids.length) list = [...new Set(["grok-4.7", ...ids, ...KNOWN_MODELS])];
  } catch {}
  modelCache = { t: Date.now(), list }; return list;
}

function listReports(q) {
  let out = readdirSync(DIR).filter((f) => /^[\w.-]+\.md$/.test(f)).map((f) => {
    const m = f.match(/^(.+?)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.md$/);
    return { f, topic: m ? m[1] : f.replace(/\.md$/, ""), t: m ? Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}Z`) : statSync(`${DIR}/${f}`).mtimeMs };
  });
  if (q) { q = q.toLowerCase(); out = out.filter((r) => r.f.toLowerCase().includes(q) || readFileSync(`${DIR}/${r.f}`, "utf8").toLowerCase().includes(q)); }
  return out.sort((a, b) => b.t - a.t);
}
function state() {
  const all = listReports(), latest = {};
  for (const r of all) if (!latest[r.topic]) latest[r.topic] = r;
  return { ok: true, hasKey: !!getKey(), keySource: keySource(), settings, topics, runs, latest, lastRun: all[0]?.t || null, nextRun, nextDaily: nextDaily(), lastError,
    usage: usageSummary(), repliesVer, repliesBusy: replies.filter((e) => e.status === "running").length };
}

const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>X Trends Desk</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#07090d;--p:#0f141c;--p2:#151c27;--b:#1f2937;--t:#e7ecf2;--m:#8b98a9;--a:#1d9bf0;--g:#3fb950;--r:#f85149;--y:#d29922}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font:15px/1.5 system-ui,"Segoe UI",sans-serif;background:radial-gradient(1200px 500px at 10% -10%,#0f2338 0,transparent 60%),var(--bg);color:var(--t);display:grid;grid-template-rows:auto 1fr auto}
header{display:flex;gap:10px 14px;align-items:center;padding:12px 22px;border-bottom:1px solid var(--b);flex-wrap:wrap;background:#0a0e14cc;backdrop-filter:blur(6px)}
h1{font-size:19px;margin:0 10px 0 0;letter-spacing:.2px;white-space:nowrap}h1 b{color:var(--a)}
.grp{display:flex;gap:8px;align-items:center;padding:4px 8px;border:1px solid var(--b);border-radius:12px;background:var(--p)}
.grp label{color:var(--m);font-size:13px;white-space:nowrap}
input,button,select,textarea{font:inherit;border-radius:8px;border:1px solid #2a3647;background:var(--p2);color:var(--t);padding:7px 11px}
input:focus,textarea:focus,select:focus{outline:2px solid #1d9bf055;border-color:var(--a)}
button{cursor:pointer;background:var(--a);border-color:var(--a);font-weight:600;white-space:nowrap}button:hover{filter:brightness(1.12)}button:disabled{opacity:.5;cursor:default}
.sm{padding:4px 10px;font-size:13px;background:var(--p2);border-color:#2a3647;font-weight:500}.sm.pri{background:#1d9bf022;border-color:#1d9bf088;color:#8ecdf8}.ghost{background:transparent;border-color:transparent;color:var(--m)}.ghost:hover{color:var(--t);background:var(--p2)}
#key{width:300px}#model{width:200px}#focus{width:300px}.sp{flex:1}
.ok{color:var(--g)}.bad{color:var(--r)}.muted{color:var(--m);font-size:13px}
main{display:grid;grid-template-columns:1fr 420px;grid-template-rows:minmax(0,1fr) auto;gap:18px;padding:18px 22px;min-height:0}
#rp{grid-column:1/-1;max-height:38vh}#rp h2 .meta{font-size:12.5px}.rlist{overflow:auto;padding:12px 14px;display:grid;gap:12px}
.rent{background:var(--p2);border:1px solid var(--b);border-radius:12px;padding:10px 12px}.rh{display:flex;gap:8px;align-items:center}.rh b{flex:1}
.rposts{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:10px;margin-top:8px}.rpost{border:1px solid var(--b);border-radius:10px;padding:8px 10px;background:#0c1219}.op{font-size:13px;color:var(--m);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
blockquote{margin:6px 0;padding:6px 10px;border-left:3px solid var(--a);background:#1d9bf00d;border-radius:0 8px 8px 0;font-size:14px;white-space:pre-wrap}.by{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--m);margin-top:4px;white-space:normal}
.tag{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;vertical-align:2px;letter-spacing:.5px}.tag.NEW{background:#3fb95022;color:#56d364;border:1px solid #3fb95066}.tag.RISING{background:#d2992222;color:#e3b341;border:1px solid #d2992266}.tag.FADING{background:#8b98a91a;color:#8b98a9;border:1px solid #8b98a955}
details.fade{margin-top:12px;color:var(--m);font-size:13px;background:var(--p2);border:1px dashed var(--b);border-radius:10px;padding:6px 12px}details.fade summary{cursor:pointer}details.fade ul{margin:6px 0;padding-left:18px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--r);margin-right:6px}.dot.on{background:var(--g)}a.btnl{display:inline-flex;align-items:center;border:1px solid #2a3647;border-radius:8px;color:var(--t);text-decoration:none}
input[type=time]{padding:5px 8px;color-scheme:dark}#cost{font-size:13px;cursor:help}#cost b{color:var(--t);font-weight:600}
#cols{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(460px,1fr);gap:18px;overflow-x:auto;min-height:0}
.col,aside{background:var(--p);border:1px solid var(--b);border-radius:14px;display:flex;flex-direction:column;min-height:0}
.col h2,aside h2{margin:0;padding:12px 14px;font-size:17px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--b)}
.col h2 .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{color:var(--m);font-size:12.5px;font-weight:400}
.out{overflow:auto;padding:14px;flex:1}.empty{color:var(--m);padding:30px;text-align:center}
.err{margin:10px 14px 0;padding:9px 12px;border-radius:9px;background:#f8514918;border:1px solid #f8514955;color:#ffaba8;font-size:14px}
.intro{color:var(--m);font-size:13.5px;margin-bottom:10px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:12px}
.card{position:relative;background:var(--p2);border:1px solid var(--b);border-radius:12px;padding:12px 14px 10px 46px}
.card:hover{border-color:#2f4058}.rank{position:absolute;left:12px;top:12px;width:24px;height:24px;border-radius:50%;background:#1d9bf022;color:#8ecdf8;font-weight:700;font-size:13px;display:grid;place-items:center}
.card h3{margin:0 0 6px;font-size:15.5px;line-height:1.35}.card p,.card .li{margin:3px 0;font-size:14px}.card h4{margin:8px 0 2px;font-size:14px}
.lab{display:inline-block;min-width:58px;color:var(--m);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
a{color:#6cb6ff;text-decoration:none}a:hover{text-decoration:underline}a.lnk{display:inline-block;margin:1px 4px 1px 0;padding:0 7px;border-radius:999px;background:#1d9bf014;border:1px solid #1d9bf033;font-size:12.5px}
.acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.dr textarea{width:100%;margin-top:8px;resize:vertical;background:#0b1118}.drbar{display:flex;gap:10px;align-items:center;margin-top:4px}.drbar .muted{flex:1}.cnt{font-size:12px;color:var(--m)}.cnt.over{color:var(--r)}
aside .tools{display:flex;gap:8px;padding:10px 14px}aside .tools input{flex:1}
#hist{list-style:none;margin:0;padding:0 8px 10px;overflow:auto;flex:1}#hist li{display:flex;align-items:center;gap:2px;border-radius:8px}#hist li:hover{background:var(--p2)}
#hist li a{flex:1;display:flex;justify-content:space-between;gap:8px;padding:6px 8px;cursor:pointer;color:var(--t)}#hist li a span{color:var(--m);font-size:12.5px;white-space:nowrap}
footer{display:flex;gap:18px;align-items:center;padding:6px 22px;border-top:1px solid var(--b);font-size:13px;color:var(--m);background:#0a0e14}footer #sErr{color:#ffaba8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spin{display:inline-block;width:11px;height:11px;border:2px solid #1d9bf055;border-top-color:var(--a);border-radius:50%;animation:s 1s linear infinite;vertical-align:-1px}@keyframes s{to{transform:rotate(360deg)}}
#ov{position:fixed;inset:0;background:#000a;display:none;place-items:center;z-index:9}#ov.on{display:grid}
#dlg{width:min(1400px,92vw);max-height:88vh;display:flex;flex-direction:column;background:var(--p);border:1px solid #2a3647;border-radius:14px;box-shadow:0 20px 80px #000}
#dlg .hd{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--b)}#dlg .hd b{flex:1}#dlg .bd{overflow:auto;padding:16px}
.form{display:grid;gap:10px;max-width:640px}.form input{width:100%}
#toast{position:fixed;bottom:44px;left:50%;transform:translate(-50%,20px);opacity:0;transition:.2s;background:#1d9bf0;color:#fff;padding:8px 16px;border-radius:10px;font-weight:600;pointer-events:none;z-index:10}#toast.show{opacity:1;transform:translate(-50%,0)}#toast.bad{background:#b62324}
@media(max-width:1700px){main{grid-template-columns:1fr 340px}#cols{grid-auto-columns:minmax(420px,1fr)}.cards{grid-template-columns:1fr}}
@media(max-width:1100px){body{height:auto;display:block}main{grid-template-columns:1fr}#cols{grid-auto-flow:row;grid-auto-columns:auto}.col{max-height:80vh}aside{max-height:60vh}#key,#focus{width:100%}}
</style></head><body>
<header><h1>📈 X Trends <b>Desk</b></h1>
<div class=grp><input id=key type=password autocomplete=off placeholder="Paste your xAI API key"><button onclick="saveKey()">Save key</button></div>
<div class=grp><label for=model>Model</label><input id=model list=mlist spellcheck=false onchange="setS({model:this.value.trim()})"><datalist id=mlist></datalist></div>
<div class=grp><input id=focus placeholder="Optional focus: SEC, crypto law, bankruptcy…"><button id=runall onclick="runT('all')">▶ Run all</button></div>
<div class=grp><label><input type=checkbox id=auto onchange="setS({auto:this.checked,every:+every.value})"> Auto-refresh</label>
<select id=every onchange="setS({auto:auto.checked,every:+this.value})"><option value=30>every 30m</option><option value=60>every 1h</option><option value=180>every 3h</option><option value=360>every 6h</option></select>
<label><input type=checkbox id=daily onchange="setS({daily:this.checked})"> Daily</label><input type=time id=dailyAt onchange="setS({dailyAt:this.value})">
<label>Last <b id=last class=ok>—</b> · Next <b id=next>off</b></label></div>
<div class=grp id=cost><label>Usage</label><span>last <b id=uLast>—</b></span><span>today <b id=uToday>—</b></span><span>total <b id=uTotal>—</b></span></div>
<span class=sp></span><button class=sm onclick="muse()">📨 Send to Muse now</button><a id=bjl class="sm btnl" href="http://127.0.0.1:4747/#/trends" target=_blank rel=noopener><span class=dot id=bjdot></span><span id=bjt>Blue Jay</span></a><button class="sm pri" onclick="addDlg()">＋ Add column</button></header>
<main><div id=cols></div>
<aside><h2>🗂 Report history <span class=sp></span><span id=hcount class=meta></span></h2>
<div class=tools><input id=q placeholder="Search reports (topic, words, @handle)…" oninput="clearTimeout(hist.t);hist.t=setTimeout(hist,250)"></div><ul id=hist></ul></aside>
<section id=rp class=col><h2>💬 Replies <span class=meta>Real replies found by Grok X search, quoted verbatim. Open the links to confirm. Nothing is ever posted.</span><span class=sp></span><span id=rpc class=meta></span></h2><div class=rlist id=rlist><div class=empty>Hit “💬 Get replies” on any trend card.</div></div></section></main>
<footer><span id=sKey>…</span><span>Model: <b id=sModel></b></span><span id=sRun>Idle</span><span id=sMuse></span><span id=sErr></span><span>Times in CT</span></footer>
<div id=ov onclick="if(event.target===this)closeDlg()"><div id=dlg><div class=hd><b id=dt></b><span id=da></span><button class="sm ghost" onclick="closeDlg()">✕</button></div><div class=bd id=db></div></div></div>
<div id=toast></div>
<script>
let S={topics:[],runs:{},latest:{},settings:{}},shown={},cards=[],tkey='',first=1,RL=[],rVer=0,bjUp=false;const BJ='http://127.0.0.1:4747';
const fmtTok=n=>n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n||0);
const money=u=>u.api?' · $'+u.api.toFixed(u.api<1?4:2)+' API':u.est?' · ≈$'+u.est.toFixed(u.est<1?3:2)+' est':'';
const IDEA=/^\s*[-*]\s*\**Idea\**:\**\s*(.+)$/mi;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CT=t=>t?new Date(t).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT':'—';
async function api(p,o){try{const r=await fetch(p,o===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)});return await r.json().catch(()=>({ok:false,error:'Server error '+r.status}))}catch(e){return{ok:false,error:'The dashboard server is not reachable. Restart X Trends Desk.'}}}
function toast(m,bad){const t=$('toast');t.textContent=m;t.className='show'+(bad?' bad':'');clearTimeout(toast.t);toast.t=setTimeout(()=>t.className='',bad?5000:1800)}
async function copy(s){try{await navigator.clipboard.writeText(s)}catch(e){const a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}toast('Copied')}
function shortUrl(u){const m=u.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^\/]+)\/status/);return m?'@'+m[1]+' on X':u.replace(/^https?:\/\/(www\.)?/,'').replace(/[\/?#].*$/,'')}
function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
 .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,t,u)=>'<a class=lnk href="'+u+'" target=_blank rel=noopener>'+t+'</a>')
 .replace(/(^|[\s(,])(https?:\/\/[^\s)<,]+)/g,(_,p,u)=>{let tail='';while(/[.;:]$/.test(u)){tail=u.slice(-1)+tail;u=u.slice(0,-1)}return p+'<a class=lnk href="'+u+'" target=_blank rel=noopener title="'+u+'">'+esc(shortUrl(u.replace(/&amp;/g,'&')))+'</a>'+tail}).replace(/<\/a>\s*,\s*(?=<a )/g,'</a> ')}
const LI=/^([-*•]|\d+[.)])\s+/;
function body(t){return t.split('\n').map(l=>{l=l.trim();if(!l)return'';if(/^#{1,2} /.test(l))return'<h4>'+inline(l.replace(/^#+ /,''))+'</h4>';const li=LI.test(l);l=inline(l.replace(LI,'')).replace(/^(?:<b>)?([A-Z][A-Za-z ]{1,14}):(?:<\/b>)?\s*/,'<span class=lab>$1</span> ');return li?'<div class=li>'+l+'</div>':'<p>'+l+'</p>'}).join('')}
function render(md,el,topic,f){const parts=md.split(/^### /m),intro=parts.shift().trim();let h=intro?'<div class=intro>'+body(intro)+'</div>':'';h+='<div class=cards>';
 parts.forEach((p,i)=>{const n=p.indexOf('\n'),title=(n<0?p:p.slice(0,n)).trim(),b=n<0?'':p.slice(n+1).trim(),k=cards.push({title:title,body:b,topic:topic||''})-1;
  h+='<article class=card><div class=rank>'+(i+1)+'</div><h3>'+inline(title)+'</h3>'+body(b)+'<div class=acts><button class=sm onclick="copyCard('+k+')">⧉ Copy</button><button class="sm pri" onclick="draft(this,'+k+')">✍ Draft X post</button><button class=sm onclick="getReplies('+k+')">💬 Get replies</button><button class=sm onclick="toBJ('+k+')">🐦 Send to Blue Jay</button></div><div class=dr></div></article>'});
 el.innerHTML=h+'</div>';
 if(f)api('/api/diff?f='+encodeURIComponent(f)).then(d=>{if(!d.ok||!d.prev)return;const cs=el.querySelectorAll('.card');(d.tags||[]).forEach((t,i)=>{if(cs[i]&&t.tag&&t.tag!=='STEADY')cs[i].querySelector('h3').insertAdjacentHTML('beforeend','<span class="tag '+t.tag+'" title="'+(t.was?'was #'+t.was:'not in ')+' '+d.basis+'">'+t.tag+'</span>')});
  if(d.fading.length)el.insertAdjacentHTML('beforeend','<details class=fade><summary>📉 Fading vs '+esc(d.basis)+' ('+d.fading.length+')</summary><ul>'+d.fading.map(x=>'<li>'+esc(x.title)+' <span class=muted>#'+x.was+(x.now?' → #'+x.now:' → gone')+'</span></li>').join('')+'</ul></details>')})}
async function draft(b,k){const box=b.closest('.card').querySelector('.dr');b.disabled=true;box.innerHTML='<p class=muted><span class=spin></span> Asking Grok for a draft…</p>';const j=await api('/api/draft',{text:cards[k].title+'\n'+cards[k].body});b.disabled=false;
 if(!j.ok){box.innerHTML='<div class=err style="margin:8px 0 0">'+esc(j.error)+'</div>';return}
 box.innerHTML='<textarea rows=4></textarea><div class=drbar><span class=cnt></span><span class=muted>Draft only. Nothing is posted.</span><button class="sm pri">⧉ Copy draft</button></div>';
 const ta=box.querySelector('textarea'),c=box.querySelector('.cnt'),u=()=>{c.textContent=ta.value.length+'/280';c.className='cnt'+(ta.value.length>280?' over':'')};ta.value=j.text;ta.oninput=u;u();box.querySelector('button').onclick=()=>copy(ta.value)}
function tname(id){const t=S.topics.find(x=>x.id===id);return t?t.name:id}
function cols(){const k=JSON.stringify(S.topics);if(k===tkey)return;tkey=k;shown={};
 $('cols').innerHTML=S.topics.map(t=>'<section class=col id="c-'+t.id+'"><h2><span class=nm title="'+esc(t.desc)+'">'+esc(t.name)+'</span><span class=meta></span><button class=sm onclick="runT(\''+t.id+'\')">▶ Run</button><button class="sm ghost" title="Remove column" onclick="rmT(\''+t.id+'\')">✕</button></h2><div class=err hidden></div><div class=out><div class=empty>Not run yet. Hit Run.</div></div></section>').join('')||'<div class=empty>No columns. Add one.</div>'}
async function tick(){const j=await api('/api/state');if(j.ok===false){$('sErr').textContent=j.error;return}S=j;cols();
 $('sKey').innerHTML=S.hasKey?'<span class=ok>● Key saved'+(S.keySource==='env'?' (from env)':'')+'</span>':'<span class=bad>● No API key — paste one above</span>';
 $('key').placeholder=S.hasKey?'Key saved ✓ (paste a new one to replace)':'Paste your xAI API key';
 if(document.activeElement!==$('model'))$('model').value=S.settings.model;$('sModel').textContent=S.settings.model;
 $('auto').checked=S.settings.auto;$('every').value=S.settings.every;if(first){$('focus').value=S.settings.focus||'';first=0}
 $('last').textContent=CT(S.lastRun);const nx=[S.settings.auto&&S.nextRun,S.nextDaily].filter(Boolean).sort((a,b)=>a-b)[0];$('next').textContent=nx?CT(nx)+(nx===S.nextDaily?' (daily)':''):'off';
 $('daily').checked=S.settings.daily;if(document.activeElement!==$('dailyAt'))$('dailyAt').value=S.settings.dailyAt;
 const U=S.usage||{};if(U.total){$('uLast').textContent=U.last?fmtTok(U.last.tok)+money(U.last):'—';$('uToday').textContent=fmtTok(U.today.tok)+money(U.today);$('uTotal').textContent=fmtTok(U.total.tok)+money(U.total);
  $('cost').title='Tokens from each API response (input / output / reasoning / X sources). Today: '+fmtTok(U.today.in)+' in, '+fmtTok(U.today.out)+' out, '+fmtTok(U.today.reasoning)+' reasoning, '+U.today.sources+' sources over '+U.today.n+' calls. "API" = cost the API itself returned. '+U.note}
 $('sMuse').textContent=S.settings.lastMuse?'Muse: sent bus msg #'+S.settings.lastMuse.id+' '+CT(S.settings.lastMuse.ts):'';
 if(S.repliesVer!==rVer){rVer=S.repliesVer;loadReplies()}
 let busy=0;
 for(const t of S.topics){const c=$('c-'+t.id);if(!c)continue;const r=S.runs[t.id]||{},m=c.querySelector('.meta'),e=c.querySelector('.err'),L=S.latest[t.id];
  if(r.status==='running'){busy++;m.innerHTML='<span class=spin></span> searching X…'}else if(r.status==='queued'){busy++;m.textContent='queued'}else m.textContent=(L?CT(L.t):'')+(r.usage?' · '+fmtTok(r.usage.total||r.usage.in+r.usage.out)+' tok'+money({api:r.usage.cost_usd||0,est:0}):'');
  e.hidden=r.status!=='error';if(r.status==='error')e.textContent=r.error;
  if(L&&shown[t.id]!==L.f){shown[t.id]=L.f;fetch('/api/report?f='+encodeURIComponent(L.f)).then(x=>x.text()).then(md=>render(md,c.querySelector('.out'),t.id,L.f))}
  else if(!L&&shown[t.id]){shown[t.id]=0;c.querySelector('.out').innerHTML='<div class=empty>Not run yet. Hit Run.</div>'}}
 $('sRun').innerHTML=busy?'<span class=spin></span> '+busy+' running/queued':'Idle';$('sErr').textContent=S.lastError||'';$('runall').disabled=busy>0;
 if(busy!==tick.b){tick.b=busy;hist()}}
async function runT(id){const j=await api('/api/run',{topic:id,focus:$('focus').value});if(!j.ok)toast(j.error,1);tick()}
async function saveKey(){const k=$('key').value.trim();if(!k)return;const j=await api('/api/key',{key:k});$('key').value='';j.ok?toast('Key saved on this PC'):toast(j.error,1);tick();loadModels()}
async function setS(o){const j=await api('/api/settings',o);j.ok?toast('Saved'):toast(j.error,1);tick()}
async function loadModels(){const j=await api('/api/models');if(j.models)$('mlist').innerHTML=j.models.map(m=>'<option value="'+esc(m)+'">').join('')}
async function hist(){const q=$('q').value.trim(),j=await api('/api/reports?q='+encodeURIComponent(q));if(!j.reports)return;$('hcount').textContent=j.reports.length+(q?' match':' saved');
 $('hist').innerHTML=j.reports.length?j.reports.slice(0,300).map(r=>'<li><a onclick="view(\''+r.f+'\')"><b>'+esc(tname(r.topic))+'</b><span>'+CT(r.t)+'</span></a><button class="sm ghost" title="Download .md" onclick="dl(\''+r.f+'\')">⤓</button><button class="sm ghost" title="Delete" onclick="del(\''+r.f+'\')">🗑</button></li>').join(''):'<li class=muted style="padding:8px">'+(q?'No reports match.':'No reports yet.')+'</li>'}
function dlg(title,actions,html){$('dt').textContent=title;$('da').innerHTML=actions;$('db').innerHTML=html;$('ov').className='on'}
function closeDlg(){$('ov').className=''}
async function view(f){const md=await (await fetch('/api/report?f='+encodeURIComponent(f))).text();dlg(f,'<button class=sm onclick="dl(\''+f+'\')">⤓ Download .md</button> <button class=sm onclick="del(\''+f+'\')">🗑 Delete</button>','');render(md,$('db'),f.replace(/-\d{4}-\d\d-\d\dT.*$/,''),f)}
function dl(f){location.href='/api/report?dl=1&f='+encodeURIComponent(f)}
async function del(f){if(!confirm('Delete '+f+'? This can\'t be undone.'))return;const j=await api('/api/delete',{f});if(!j.ok)return toast(j.error,1);toast('Deleted');closeDlg();hist();tick()}
function addDlg(){dlg('Add a topic column','','<div class=form><input id=an placeholder="Name, e.g. 🪙 Crypto, 🤖 AI, 🏠 Real estate" maxlength=40><input id=ad placeholder="What to search for (optional), e.g. bitcoin, ETFs, stablecoin bills, exchange news" maxlength=300><div><button onclick="addT()">Add column</button></div><p class=muted>Saved to topics.json. Run all includes every column.</p></div>');setTimeout(()=>$('an').focus(),50)}
async function addT(){const j=await api('/api/topics',{action:'add',name:$('an').value,desc:$('ad').value});if(!j.ok)return toast(j.error,1);closeDlg();toast('Column added');tick()}
async function rmT(id){if(!confirm('Remove the "'+tname(id)+'" column? Its saved reports stay in history.'))return;const j=await api('/api/topics',{action:'remove',id});j.ok?tick():toast(j.error,1)}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDlg();if(e.key==='Enter'&&e.target.id==='key')saveKey();if(e.key==='Enter'&&(e.target.id==='an'||e.target.id==='ad'))addT()});
async function getReplies(k){const c=cards[k],cs=RL.filter(e=>e.usage&&e.usage.cost_usd).map(e=>e.usage.cost_usd);if(cs.length&&!confirm('Get replies runs a deep X search. Recent ones cost about $'+(cs.reduce((a,b)=>a+b,0)/cs.length).toFixed(2)+' each (from the API). Continue?'))return;$('rp').scrollIntoView({behavior:'smooth',block:'end'});const j=await api('/api/replies',{topic:c.topic,title:c.title,text:c.body});if(!j.ok)return toast(j.error,1);toast('Searching X for real replies…');tick()}
async function loadReplies(){const j=await api('/api/replies');if(!j.replies)return;RL=j.replies;$('rpc').textContent=RL.length?RL.length+' saved':'';
 const lk=(u,t)=>'<a class=lnk href="'+esc(u)+'" target=_blank rel=noopener>'+esc(t||shortUrl(u))+'</a>';
 $('rlist').innerHTML=RL.length?RL.map((e,ei)=>'<div class=rent><div class=rh><b>'+esc(tname(e.topic))+' › '+esc(e.trend)+'</b><span class=meta>'+(e.status==='running'?'<span class=spin></span> searching X for real replies…':CT(e.ts)+(e.usage?' · '+fmtTok(e.usage.total||e.usage.in+e.usage.out)+' tok':''))+'</span><button class=sm onclick="copyR('+ei+')">⧉ Copy</button><button class="sm ghost" title="Delete" onclick="delR(\''+e.id+'\')">🗑</button></div>'
  +(e.status==='error'?'<div class=err style="margin:8px 0 0">'+esc(e.error)+'</div>':'')
  +(e.status==='done'?(e.posts.length?'<div class=rposts>'+e.posts.map((p,pi)=>'<div class=rpost><div class=op>Original post '+lk(p.url,p.author)+'<span>'+esc(p.engagement||'')+'</span><span class=sp></span><button class=sm onclick="bjTarget('+ei+','+pi+',-1)">🐦 Blue Jay</button></div>'+(p.text?'<p style="margin:4px 0;font-size:13.5px">'+esc(p.text)+'</p>':'')
   +(p.replies.length?p.replies.map((x,xi)=>'<blockquote>'+esc(x.text)+'<div class=by>'+lk(x.url,x.author)+'<span>'+esc(x.engagement||'')+'</span><span class=sp></span><button class=sm onclick="copy(RL['+ei+'].posts['+pi+'].replies['+xi+'].text)">⧉ Copy</button><button class=sm onclick="bjTarget('+ei+','+pi+','+xi+')">🐦 Blue Jay</button></div></blockquote>').join(''):'<p class=muted>No replies found.</p>')+'</div>').join('')+'</div>':'<p class=muted>No replies found.</p>'):'')+'</div>').join(''):'<div class=empty>Hit “💬 Get replies” on any trend card.</div>'}
function copyR(ei){const e=RL[ei];copy(e.trend+'\n'+(e.posts||[]).map(p=>'\nOriginal: '+(p.author||'')+' '+p.url+'\n'+(p.replies.length?p.replies.map(x=>'> '+x.text+'\n  — '+(x.author||'')+' '+x.url+(x.engagement?' ('+x.engagement+')':'')).join('\n'):'No replies found.')).join('\n'))}
async function delR(id){if(!confirm('Delete this replies entry?'))return;const j=await api('/api/replies/delete',{id:id});j.ok?tick():toast(j.error,1)}
async function bjCheck(){try{const r=await fetch(BJ+'/api/health',{signal:AbortSignal.timeout(2500)});bjUp=r.ok}catch(e){bjUp=false}$('bjdot').className='dot'+(bjUp?' on':'');$('bjt').textContent=bjUp?'Blue Jay':'Blue Jay offline'}
async function bj(text,extra){if(!bjUp)await bjCheck();if(!bjUp)return toast('Blue Jay offline. Start it with start.cmd first.',1);
 try{const r=await fetch(BJ+'/api/x/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({localId:'trends-'+Date.now(),text:text,at:new Date().toISOString(),source:'trends-desk'},extra||{}))});const j=await r.json();j.ok?toast('Saved as a Blue Jay draft (not posted)'):toast(j.error||'Blue Jay error',1)}catch(e){bjUp=false;toast('Blue Jay offline. Start it with start.cmd first.',1)}}
function copyCard(k){copy(cards[k].title+'\n'+cards[k].body)}
function toBJ(k){const c=cards[k],m=c.body.match(IDEA);bj((m?m[1]:c.title).trim(),{trend:c.title,topic:c.topic})}
function bjTarget(ei,pi,xi){const e=RL[ei],p=e.posts[pi],x=xi<0?p:p.replies[xi];bj('Re: '+e.trend+'\n\nReply target: '+x.url,{trend:e.trend,topic:e.topic,replyTo:x.url,replyToAuthor:x.author||'',replyToText:x.text||''})}
async function muse(){if(!confirm('Send the latest hot topics from every column to Muse (leo-muse) on the Connecture bus?'))return;const j=await api('/api/muse',{label:'latest'});j.ok?toast('Sent to Muse · bus msg #'+j.id):toast(j.error,1);tick()}
tick();loadModels();bjCheck();setInterval(tick,3000);setInterval(bjCheck,30000);
</script></body></html>`;

const body = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 2e5) req.destroy(); }); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch { res({}); } }); });
const json = (res, o, c = 200) => { res.writeHead(c, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const goodFile = (f) => /^[\w.-]+\.md$/.test(f || "") && existsSync(`${DIR}/${f}`);

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname, post = req.method === "POST";
  if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page); }
  // Local-only guard: block DNS-rebinding and cross-site form posts
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) return json(res, { ok: false, error: "bad host" }, 403);
  if (post && !(req.headers["content-type"] || "").startsWith("application/json")) return json(res, { ok: false, error: "json only" }, 415);
  try {
    if (p === "/api/state" || p === "/api/status") return json(res, state());
    if (p === "/api/models") return json(res, { ok: true, models: await models() });
    if (p === "/api/diff") { const f = u.searchParams.get("f"); return goodFile(f) ? json(res, { ok: true, ...diffFor(f) }) : json(res, { ok: false, error: "Report not found." }, 404); }
    if (p === "/api/summary") return json(res, { ok: true, columns: summary(), replies: replies.slice(0, 30), bluejay: BLUEJAY, generated: Date.now() });
    if (p === "/api/replies" && !post) return json(res, { ok: true, replies, ver: repliesVer });
    if (p === "/api/reports") return json(res, { ok: true, reports: listReports((u.searchParams.get("q") || "").slice(0, 100)) });
    if (p === "/api/report") {
      const f = u.searchParams.get("f");
      if (!goodFile(f)) { res.writeHead(404); return res.end("not found"); }
      const h = { "content-type": u.searchParams.get("dl") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8" };
      if (u.searchParams.get("dl")) h["content-disposition"] = `attachment; filename="${f}"`;
      res.writeHead(200, h); return res.end(readFileSync(`${DIR}/${f}`, "utf8"));
    }
    if (!post) { res.writeHead(404); return res.end(); }
    const b = await body(req);
    if (p === "/api/key") {
      const key = String(b.key || "").trim();
      if (!/^xai-[A-Za-z0-9_-]{10,}$/.test(key)) return json(res, { ok: false, error: "That doesn't look like an xAI key (should start with xai-)." }, 400);
      writeFileSync(KEYFILE, key, { mode: 0o600 }); try { chmodSync(KEYFILE, 0o600); } catch {}
      modelCache = null; lastError = ""; return json(res, { ok: true });
    }
    if (p === "/api/settings") {
      if (b.model !== undefined) { if (!/^[\w.:-]{1,64}$/.test(b.model)) return json(res, { ok: false, error: "Model name looks wrong." }, 400); settings.model = b.model; }
      if (b.auto !== undefined) settings.auto = !!b.auto;
      if (b.every !== undefined) { if (![30, 60, 180, 360].includes(+b.every)) return json(res, { ok: false, error: "Bad interval." }, 400); settings.every = +b.every; }
      if (b.auto !== undefined || b.every !== undefined) arm();
      if (b.daily !== undefined) settings.daily = !!b.daily;
      if (b.dailyAt !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.dailyAt)) return json(res, { ok: false, error: "Use a time like 06:00." }, 400); settings.dailyAt = b.dailyAt; }
      saveSettings(); return json(res, { ok: true, settings });
    }
    if (p === "/api/topics") {
      if (b.action === "add") {
        const name = String(b.name || "").trim().slice(0, 40), desc = String(b.desc || "").trim().slice(0, 300);
        if (!name) return json(res, { ok: false, error: "Give the column a name." }, 400);
        if (topics.length >= 12) return json(res, { ok: false, error: "12 columns max." }, 400);
        let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "topic", n = 2, base = id;
        while (topics.some((t) => t.id === id)) id = `${base}-${n++}`;
        topics.push({ id, name, desc: desc || name.replace(/[^\p{L}\p{N}\s&/-]/gu, "").trim() + " news and discussion" });
      } else if (b.action === "remove") topics = topics.filter((t) => t.id !== b.id);
      else return json(res, { ok: false, error: "Unknown action." }, 400);
      saveTopics(); return json(res, { ok: true, topics });
    }
    if (p === "/api/run") {
      if (b.focus !== undefined) { settings.focus = String(b.focus).slice(0, 200); saveSettings(); }
      const ids = b.topic === "all" ? topics.map((t) => t.id) : [b.topic];
      if (b.topic !== "all" && !topics.find((t) => t.id === b.topic)) return json(res, { ok: false, error: "Unknown column." }, 400);
      const err = enqueue(ids); return json(res, err ? { ok: false, error: err } : { ok: true });
    }
    if (p === "/api/draft") { // DRAFT ONLY: returns text, never posts anywhere
      if (!getKey()) return json(res, { ok: false, error: "Enter your API key first." });
      try {
        const r = await client().responses.create({ model: settings.model, input: `Write one short, punchy X post (under 240 characters) about this trend. Plain, confident voice. No hashtags, at most one emoji. Return only the post text.\n\nTrend:\n${String(b.text || "").slice(0, 1500)}` });
        recordUsage("draft", "", r.usage);
        return json(res, { ok: true, text: r.toText().trim().replace(/^"(.*)"$/s, "$1") });
      } catch (e) { return json(res, { ok: false, error: (lastError = friendly(e)) }); }
    }
    if (p === "/api/replies") { // finds REAL existing replies; never writes or posts any
      if (!getKey()) return json(res, { ok: false, error: "Enter your API key first." });
      if (replies.filter((e) => e.status === "running").length >= 2) return json(res, { ok: false, error: "Two reply searches are already running. Wait for one to finish." });
      const title = clip(b.title, 300).trim(); if (!title) return json(res, { ok: false, error: "Missing trend." }, 400);
      const e = { id: "r" + Date.now().toString(36), ts: Date.now(), topic: clip(b.topic, 40), trend: title, status: "running", posts: [] };
      replies.unshift(e); replies = replies.slice(0, 60); saveReplies(); findReplies(e, b.text || "");
      return json(res, { ok: true, id: e.id });
    }
    if (p === "/api/replies/delete") { const n = replies.length; replies = replies.filter((e) => e.id !== b.id); if (n === replies.length) return json(res, { ok: false, error: "Not found." }, 404); saveReplies(); return json(res, { ok: true }); }
    if (p === "/api/muse") {
      try { return json(res, { ok: true, id: await sendToMuse(clip(b.label || "latest", 30)) }); }
      catch (e) { return json(res, { ok: false, error: (lastError = e.message) }); }
    }
    if (p === "/api/delete") {
      if (!goodFile(b.f)) return json(res, { ok: false, error: "Report not found." }, 404);
      unlinkSync(`${DIR}/${b.f}`); return json(res, { ok: true });
    }
    res.writeHead(404); res.end();
  } catch (e) { json(res, { ok: false, error: friendly(e) }, 500); }
}).listen(PORT, "127.0.0.1", () => console.log(`X Trends Desk on http://127.0.0.1:${PORT}`));
