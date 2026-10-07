// Free X data path for Trends Desk — OpenCLI → twitter-cli → fixtures. No paid API required.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const WIN_NODE_DIR = "/mnt/c/Users/jpana/AppData/Local/hermes/node";
const OPENCLI_NODE = join(WIN_NODE_DIR, "node.exe");
const OPENCLI_MAIN = join(WIN_NODE_DIR, "node_modules/@jackwener/opencli/dist/src/main.js");
const FIXTURE_DIR = "fixtures";

const STOP = new Set("the a an of to in on for and or is are at by with from as after over says say new its it this that be was were has have will into about than more amid just just my our your their we you i me us they them he she his her not no yes via http https www com".split(" "));

function run(bin, args, timeoutMs = 120000, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: cwd || undefined });
    let out = "", err = "";
    const t = setTimeout(() => { try { p.kill(); } catch {} reject(new Error("OpenCLI timed out after " + Math.round(timeoutMs / 1000) + "s")); }, timeoutMs);
    p.stdout.on("data", (c) => { out += c; });
    p.stderr.on("data", (c) => { err += c; });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

function parseJsonBlob(text) {
  const t = String(text || "").trim();
  if (!t) throw new Error("empty OpenCLI output");
  const starts = [];
  for (let i = 0; i < t.length; i++) if (t[i] === "[" || t[i] === "{") starts.push(i);
  for (const i of starts) {
    try { return JSON.parse(t.slice(i)); } catch {}
  }
  throw new Error("OpenCLI did not return JSON");
}

export function opencliAvailable() {
  return existsSync(OPENCLI_NODE) && existsSync(OPENCLI_MAIN);
}

export async function opencli(args, timeoutMs = 120000) {
  if (!opencliAvailable()) throw new Error("OpenCLI not installed (expected under Hermes node).");
  // Windows node.exe must be launched with cwd on the Windows filesystem and relative
  // script paths. Absolute /mnt/c/... args get rewritten to \\wsl.localhost\... and break.
  const r = await run("./node.exe", ["./node_modules/@jackwener/opencli/dist/src/main.js", ...args], timeoutMs, WIN_NODE_DIR);
  if (r.code !== 0) {
    const msg = (r.err || r.out || "opencli failed").replace(/\s+/g, " ").trim().slice(0, 400);
    throw new Error(msg || `opencli exit ${r.code}`);
  }
  return parseJsonBlob(r.out);
}

function score(p) {
  const likes = Number(p.likes) || 0;
  const rts = Number(p.retweets) || 0;
  const views = Number(String(p.views || "").replace(/,/g, "")) || 0;
  return likes + rts * 3 + Math.log10(views + 1) * 50;
}

function statusUrl(p) {
  if (p.url && /\/status\//.test(p.url)) return p.url.replace("https://twitter.com/", "https://x.com/");
  if (p.id && p.author) return `https://x.com/${String(p.author).replace(/^@/, "")}/status/${p.id}`;
  if (p.id) return `https://x.com/i/status/${p.id}`;
  return "";
}

function toks(s) {
  return new Set(String(s || "").toLowerCase().replace(/[^a-z0-9$%\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, "")));
}

function titleFrom(p) {
  let t = String(p.text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (t.length > 110) {
    const cut = t.slice(0, 110);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : cut).trim() + "…";
  }
  return t || `@${p.author || "unknown"} post`;
}

function engLabel(p) {
  const bits = [];
  if (p.likes != null) bits.push(`${Number(p.likes).toLocaleString()} likes`);
  if (p.retweets != null) bits.push(`${Number(p.retweets).toLocaleString()} reposts`);
  if (p.views) bits.push(`${Number(String(p.views).replace(/,/g, "")).toLocaleString()} views`);
  return bits.join(", ");
}

function ideaFrom(p) {
  const t = String(p.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (/launch|introduc|ship|releas|announc/i.test(t)) return `This drop is moving for a reason — ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`;
  if (/AI|Claude|GPT|Gemini|OpenAI|Anthropic/i.test(t)) return `The AI timeline is loud on this one. Worth a clear take, not another hype pile-on.`;
  return `Hot take worth a reply: people are actually engaging with this, not just scrolling past.`;
}

/** Cluster posts into up to 5 trend cards (same markdown shape as the Grok reports). */
export function synthesizeReport(topic, posts, sourceLabel = "OpenCLI") {
  const ranked = [...(posts || [])].map((p) => ({ ...p, _s: score(p), _u: statusUrl(p), _tok: toks(p.text) }))
    .filter((p) => p._u && (p.text || "").trim())
    .sort((a, b) => b._s - a._s);

  const clusters = [];
  for (const p of ranked) {
    let best = -1, bs = 0;
    clusters.forEach((c, i) => {
      let inter = 0;
      for (const w of p._tok) if (c.tok.has(w)) inter++;
      const m = Math.min(p._tok.size, c.tok.size) || 1;
      const s = inter / m;
      if (s > bs) { bs = s; best = i; }
    });
    if (best >= 0 && bs >= 0.28) {
      clusters[best].posts.push(p);
      for (const w of p._tok) clusters[best].tok.add(w);
    } else if (clusters.length < 5) {
      clusters.push({ posts: [p], tok: new Set(p._tok) });
    }
  }
  while (clusters.length < Math.min(5, ranked.length)) {
    const left = ranked.find((p) => !clusters.some((c) => c.posts.includes(p)));
    if (!left) break;
    clusters.push({ posts: [left], tok: new Set(left._tok) });
  }

  const focus = topic.focus ? `, focused on ${topic.focus}` : "";
  let md = `From recent X posts via ${sourceLabel} (free session, no API credits), top engagement around ${topic.desc}${focus}.\n\n`;
  if (!clusters.length) {
    md += `### No live hits for “${topic.name}”\n- Why: OpenCLI search returned nothing useful right now. Try again in a minute, or broaden the column description.\n- Idea: Re-run once the timeline warms up.\n`;
    return md;
  }
  clusters.slice(0, 5).forEach((c, i) => {
    const head = c.posts[0];
    const alts = c.posts.slice(1, 3);
    const why = `@${head.author || "?"} is pulling ${engLabel(head) || "solid engagement"}. `
      + String(head.text || "").replace(/\s+/g, " ").trim().slice(0, 220)
      + (alts.length ? ` Related chatter from ${alts.map((p) => "@" + p.author).join(", ")}.` : "");
    const urls = [...new Set([head._u, ...alts.map((p) => p._u)].filter(Boolean))];
    md += `### ${titleFrom(head)}\n`;
    md += `- Why: ${why}\n`;
    md += `- Posts: ${urls.join(" ")}\n`;
    md += `- Idea: ${ideaFrom(head)}\n\n`;
  });
  return md.trim() + "\n";
}

export async function searchPosts(query, limit = 20) {
  const q = String(query || "").trim();
  if (!q) return [];
  const data = await opencli(["twitter", "search", q, "--product", "top", "--limit", String(limit), "-f", "json"], 120000);
  return Array.isArray(data) ? data : (data.tweets || data.results || []);
}

export async function threadPosts(tweetIdOrUrl, limit = 30) {
  const id = String(tweetIdOrUrl || "").replace(/^.*status\//, "").replace(/\D.*$/, "") || String(tweetIdOrUrl);
  const data = await opencli(["twitter", "thread", id, "--limit", String(limit), "--top-by-engagement", "8", "-f", "json"], 120000);
  return Array.isArray(data) ? data : [];
}

export function fixtureReport(topic) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  // Prefer a recent real report for this topic so the UI stays useful offline
  try {
    const files = readdirSync("reports").filter((f) => f.startsWith(topic.id + "-") && f.endsWith(".md")).sort().reverse();
    if (files[0]) {
      const body = readFileSync(join("reports", files[0]), "utf8");
      return `# Fixture (cached last good run: ${files[0]})\n\n` + body.replace(/^From the last day[^\n]*/m, `Cached report for ${topic.name} — live free session unavailable, showing last good run.`);
    }
  } catch {}
  const sample = `Offline fixture for ${topic.name} (OpenCLI unreachable). Sample structure only.\n\n`
    + `### Sample trend in ${topic.desc}\n`
    + `- Why: This is a placeholder card so the desk stays usable with no API key and no browser session. Connect OpenCLI (logged-in Chrome) for live posts.\n`
    + `- Posts: https://x.com/i/status/0\n`
    + `- Idea: Wire OpenCLI and hit Run again for live data.\n`;
  try { writeFileSync(join(FIXTURE_DIR, `${topic.id}-sample.md`), sample); } catch {}
  return sample;
}

export async function runTopicFree(topic) {
  const focus = (topic.focus || "").trim();
  const desc = (topic.desc || topic.name || "").trim();
  const query = (focus && !desc.toLowerCase().includes(focus.toLowerCase()) ? `${desc} ${focus}` : desc).replace(/\s+/g, " ").trim().slice(0, 180);
  const posts = await searchPosts(query, 24);
  if (!posts.length) throw new Error("OpenCLI search returned no posts");
  return synthesizeReport(topic, posts, "OpenCLI");
}

export async function findRepliesFree(trend, ctx) {
  const q = String(trend || "").slice(0, 120);
  const posts = await searchPosts(q, 8);
  const top = [...posts].map((p) => ({ ...p, _s: score(p), _u: statusUrl(p) }))
    .filter((p) => p._u).sort((a, b) => b._s - a._s).slice(0, 3);
  const out = [];
  for (const p of top) {
    let replies = [];
    try {
      const th = await threadPosts(p.id || p._u, 25);
      replies = th.filter((x) => x.in_reply_to || (x.id && x.id !== p.id))
        .filter((x) => String(x.text || "").trim())
        .sort((a, b) => score(b) - score(a))
        .slice(0, 3)
        .map((x) => ({
          author: "@" + String(x.author || "").replace(/^@/, ""),
          url: statusUrl(x),
          text: String(x.text || "").slice(0, 1000),
          engagement: engLabel(x),
        }))
        .filter((x) => x.url);
    } catch {}
    out.push({
      author: "@" + String(p.author || "").replace(/^@/, ""),
      url: p._u,
      text: String(p.text || "").slice(0, 400),
      engagement: engLabel(p),
      replies,
    });
  }
  return out;
}

export function draftFree(text) {
  const first = String(text || "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) || "this trend";
  const clean = first.replace(/\*\*/g, "").slice(0, 180);
  let draft = `Worth watching: ${clean}`;
  if (draft.length > 240) draft = draft.slice(0, 237) + "…";
  return draft;
}

let sessionCache = null;
export async function detectSession(hasKey) {
  if (sessionCache && Date.now() - sessionCache.t < 45e3) return { ...sessionCache, hasKey: !!hasKey };
  let mode = "fixture", label = "fixture/mock · offline sample", detail = "";
  if (opencliAvailable()) {
    try {
      // Light probe: adapter help is free; full search happens on Run
      mode = "opencli";
      label = "free session (OpenCLI) · no API key needed";
      detail = "OpenCLI ready (Chrome session)";
    } catch (e) {
      detail = String(e.message || e).slice(0, 120);
    }
  }
  if (mode === "fixture" && hasKey) {
    mode = "xai";
    label = "xAI API key (paid path)";
  }
  sessionCache = { t: Date.now(), mode, label, detail, opencli: opencliAvailable() };
  return { ...sessionCache, hasKey: !!hasKey };
}

export function invalidateSessionCache() { sessionCache = null; }

// ---- LIVE reply (Post reply button only). Always a reply to one tweet: OpenCLI opens
// x.com/compose/post?in_reply_to=<id> in the logged-in Chrome session, in the background.
export function replyCommandArgs(tweetUrl, text) {
  return ["twitter", "reply", String(tweetUrl), String(text), "--window", "background", "-f", "json"];
}

export async function postReplyFree(tweetUrl, text) {
  const data = await opencli(replyCommandArgs(tweetUrl, text), 180000);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || String(row.status || "").toLowerCase() !== "success") {
    throw new Error((row && row.message) || "OpenCLI did not confirm the reply.");
  }
  return row;
}
