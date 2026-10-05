// Secondary source for the trends desk. xAI stays primary.
// AgentReach order: twitter-cli, then OpenCLI, then bird.
// Instagram: OpenCLI profile + recent posts, then Jina Reader when the Chrome session is blocked.
import { spawn } from "node:child_process";
import path from "node:path";
import { accessSync, constants } from "node:fs";

const STATUS_URL = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/status\/\d+|[A-Za-z0-9_]{1,15}\/status\/\d+)/;
const IG_USER = /^[A-Za-z0-9._]{1,30}$/;

export function isCreditBlock(e) {
  const st = Number(e?.status || e?.statusCode || 0);
  const m = String(e?.message || e || "");
  if (st === 401 || st === 403 || st === 429) return true;
  return /credit|spend|billing|fund|balance|quota|insufficient|payment/i.test(m);
}

// auto: xAI when the key works, AgentReach when it does not.
// only: never call xAI. off: xAI or stop.
export function chooseBackend({ reach = "auto", hasKey = false, creditBlocked = false } = {}) {
  const mode = reach || "auto";
  if (mode === "only") return "reach";
  if (mode === "off") return hasKey ? "xai" : "stop";
  if (hasKey && !creditBlocked) return "xai";
  return "reach";
}

export function parseHandleList(raw) {
  const names = String(raw || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
  if (names.length > 8) throw new Error("8 Instagram usernames max.");
  for (const n of names) {
    if (!IG_USER.test(n)) throw new Error("Instagram username looks wrong: " + n.slice(0, 40));
  }
  return names;
}

export function which(cmd) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        accessSync(full, constants.X_OK);
        return full;
      } catch { /* next */ }
    }
  }
  return "";
}

export function runCmd(bin, args, { timeout = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(bin + " timed out"));
    }, timeout);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > 1_500_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(clip((err || out || bin + " exit " + code).trim())));
      else resolve(out);
    });
  });
}

export function cliBlocked(raw) {
  const s = String(raw || "");
  if (s.trim().startsWith("<")) return true;
  return /navigation rejected|rate limit|too many requests|captcha|make sure you are logged in|returned html/i.test(s);
}

function clip(s) {
  return String(s || "").replace(/\s+/g, " ").slice(0, 280);
}

function present(v) {
  if (v === undefined || v === null || v === "") return null;
  return v;
}

export function engagementOf(o) {
  const bits = [];
  for (const [key, label] of [["likes", "likes"], ["views", "views"], ["retweets", "reposts"], ["comments", "comments"]]) {
    const v = present(o?.[key]);
    if (v === null) continue;
    bits.push(label + " " + v);
  }
  return bits.join(" · ");
}

function statusUrl(o) {
  const url = String(o.url || o.link || "").trim();
  const id = String(o.id || o.rest_id || "");
  if (STATUS_URL.test(url)) return url.split("?")[0];
  if (/^\d{6,}$/.test(id)) {
    const author = String(o.author || o.screen_name || "").replace(/^@/, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(author)) return `https://x.com/${author}/status/${id}`;
    return `https://x.com/i/status/${id}`;
  }
  return "";
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["items", "posts", "tweets", "data", "results", "output", "rows"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function tryJson(text) {
  const s = text.trim();
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const slice = s.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
    if (end <= 0) return null;
    try { return JSON.parse(slice.slice(0, end + 1)); } catch { return null; }
  }
}

// Flat YAML list of maps. Enough for `twitter --json` failures and `opencli -f yaml`.
export function parseLooseYaml(text) {
  const items = [];
  let cur = null;
  for (const line of String(text || "").split(/\n/)) {
    if (/^\s*---\s*$/.test(line)) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && !/^\s/.test(line)) {
      if (cur) items.push(cur);
      cur = {};
      const rest = item[1];
      const kv = rest.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (kv) cur[kv[1]] = unquote(kv[2]);
      continue;
    }
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv && cur) cur[kv[1]] = unquote(kv[2]);
  }
  if (cur) items.push(cur);
  return items;
}

function unquote(v) {
  let s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  if (s === "null" || s === "~" || s === "") return "";
  return s;
}

export function postsFromText(raw) {
  const text = String(raw || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!text) return [];
  const parsed = tryJson(text);
  if (!parsed && cliBlocked(text)) throw new Error("backend returned a blocked page");
  const list = parsed ? asList(parsed).length ? asList(parsed) : (parsed.author || parsed.username || parsed.caption ? [parsed] : []) : parseLooseYaml(text);
  const out = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const textBody = String(o.text || o.full_text || o.caption || "").trim();
    const author = String(o.author || o.screen_name || o.username || "").replace(/^@/, "").trim();
    const url = statusUrl(o);
    if (!textBody && !url) continue;
    out.push({
      author,
      text: textBody,
      url,
      likes: present(o.likes),
      views: present(o.views),
      retweets: present(o.retweets),
      comments: present(o.comments),
      date: String(o.date || o.created_at || ""),
      type: String(o.type || ""),
      engagement: engagementOf(o)
    });
  }
  return out;
}

export function reportFromPosts(posts, backend) {
  const rows = (posts || []).filter((p) => p && p.url && p.text).slice(0, 5);
  if (!rows.length) throw new Error("Reach found no posts.");
  const lines = [`Source: AgentReach via ${backend}. xAI credits were not used.`, ""];
  for (const p of rows) {
    const flat = p.text.replace(/\s+/g, " ").trim();
    const who = p.author ? "@" + p.author.replace(/^@/, "") : "post";
    lines.push("### " + (who + ": " + flat).replace(/#/g, "").slice(0, 140));
    lines.push("- Why: " + flat.slice(0, 500));
    lines.push("- Posts: " + p.url);
    if (p.engagement) lines.push("- Engagement: " + p.engagement);
  }
  return lines.join("\n") + "\n";
}

export function reportSource(md) {
  const m = String(md || "").match(/^Source:\s*AgentReach via (.+?)\./);
  return m ? "reach:" + m[1].trim() : "xai";
}

export async function searchX(query, deps = {}) {
  const q = String(query || "").replace(/[\u0000\r\n]+/g, " ").trim().slice(0, 180);
  if (!q) throw new Error("empty query");
  const limit = Math.min(10, Math.max(1, Number(deps.limit) || 5));
  const whichFn = deps.which || which;
  const run = deps.run || runCmd;
  const errors = [];
  if (whichFn("twitter")) {
    try {
      const raw = await run("twitter", ["search", q, "--json", "--max", String(limit)]);
      const posts = postsFromText(raw).filter((p) => p.url && p.text);
      if (posts.length) return { backend: "twitter-cli", posts: posts.slice(0, limit) };
      errors.push("twitter-cli returned no posts");
    } catch (e) {
      errors.push("twitter-cli: " + clip(e.message));
    }
  }
  if (whichFn("opencli")) {
    try {
      const raw = await run("opencli", ["twitter", "search", q, "--limit", String(limit), "-f", "json"]);
      const posts = postsFromText(raw).filter((p) => p.url && p.text);
      if (posts.length) return { backend: "opencli", posts: posts.slice(0, limit) };
      errors.push("opencli twitter returned no posts");
    } catch (e) {
      errors.push("opencli twitter: " + clip(e.message));
    }
  }
  for (const bin of ["bird", "birdx"]) {
    if (!whichFn(bin)) continue;
    try {
      const raw = await run(bin, ["search", q, "-n", String(limit), "--json"]);
      const posts = postsFromText(raw).filter((p) => p.url && p.text);
      if (posts.length) return { backend: bin, posts: posts.slice(0, limit) };
      errors.push(bin + " returned no posts");
    } catch (e) {
      errors.push(bin + ": " + clip(e.message));
    }
  }
  throw new Error(errors.join(" · ") || "No Twitter backend installed. Install OpenCLI or twitter-cli (AgentReach).");
}

export async function threadReplies(url, deps = {}) {
  const whichFn = deps.which || which;
  const run = deps.run || runCmd;
  if (!whichFn("opencli")) return [];
  if (!STATUS_URL.test(String(url || ""))) return [];
  const raw = await run("opencli", ["twitter", "thread", url, "--limit", "12", "-f", "json"]);
  const id = (String(url).match(/status\/(\d+)/) || [])[1];
  const statusId = (u) => (String(u).match(/status\/(\d+)/) || [])[1] || "";
  return postsFromText(raw)
    .filter((p) => p.url && p.text && statusId(p.url) !== id)
    .slice(0, 3);
}

function firstObject(raw) {
  const text = String(raw || "");
  if (cliBlocked(text)) throw new Error("opencli instagram blocked");
  const parsed = tryJson(text);
  const list = parsed ? asList(parsed) : parseLooseYaml(text);
  const o = list[0] || (parsed && !Array.isArray(parsed) ? parsed : null);
  if (!o || typeof o !== "object") throw new Error("instagram profile unreadable");
  return o;
}

export function parseJinaInstagram(text, username) {
  const body = String(text || "");
  const followers = (body.match(/([\d][\d.,]*\s*[KMB]?)\s+followers/i) || [])[1]?.replace(/\s+/g, "") || null;
  const following = (body.match(/([\d][\d.,]*\s*[KMB]?)\s+following/i) || [])[1]?.replace(/\s+/g, "") || null;
  const posts = [];
  const idx = body.search(/recent posts/i);
  if (idx >= 0) {
    for (const line of body.slice(idx).split(/\n/).slice(1)) {
      const t = line.replace(/^[-*#>\s]+/, "").trim();
      if (!t || /^recent posts/i.test(t)) continue;
      if (t.length < 8) continue;
      posts.push({ author: username, text: t.slice(0, 300), url: "", date: "", engagement: "" });
      if (posts.length >= 5) break;
    }
  }
  const title = (body.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || username;
  return { username, name: title, followers, following, postsCount: null, bio: "", verified: "", posts, backend: "jina" };
}

function jinaChallenge(text) {
  const s = String(text || "").toLowerCase();
  return (s.includes("warning:") && s.includes("requiring captcha")) || s.includes("just a moment") || s.includes("attention required");
}

export function instagramLoginWall(text) {
  const s = String(text || "").toLowerCase();
  return s.includes("log into instagram") || (s.includes("mobile number, username or email") && s.includes("password"));
}

export async function instagramAccount(username, deps = {}) {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!IG_USER.test(user)) throw new Error("bad instagram username");
  const whichFn = deps.which || which;
  const run = deps.run || runCmd;
  const fetchFn = deps.fetch || globalThis.fetch;
  let opencliError = "";
  if (whichFn("opencli")) {
    try {
      const profileRaw = await run("opencli", ["instagram", "profile", user, "-f", "json"]);
      const profile = firstObject(profileRaw);
      let posts = [];
      try {
        const postsRaw = await run("opencli", ["instagram", "user", user, "--limit", "5", "-f", "json"]);
        posts = postsFromText(postsRaw).filter((p) => p.text).slice(0, 5);
      } catch { /* profile counts still count */ }
      return {
        backend: "opencli",
        username: String(profile.username || user),
        name: String(profile.name || ""),
        followers: present(profile.followers),
        following: present(profile.following),
        postsCount: present(profile.posts),
        bio: String(profile.bio || "").slice(0, 200),
        verified: String(profile.verified || ""),
        posts
      };
    } catch (e) {
      opencliError = clip(e.message);
    }
  }
  const res = await fetchFn("https://r.jina.ai/https://instagram.com/" + user, {
    headers: { Accept: "application/json, text/plain", "User-Agent": "BlueJayTrends/1.0" },
    signal: AbortSignal.timeout(25000)
  });
  const raw = await res.text();
  if (!res.ok) throw new Error("Jina HTTP " + res.status + (opencliError ? " after OpenCLI: " + opencliError : ""));
  let content = raw;
  try {
    const j = JSON.parse(raw);
    content = j.data?.content || j.content || raw;
  } catch { /* plain text */ }
  if (jinaChallenge(content)) throw new Error("Jina Reader returned a challenge page");
  if (instagramLoginWall(content)) {
    throw new Error("Jina Reader got Instagram's login wall, so follower counts were not read. Log into instagram.com in Chrome for OpenCLI, or retry Jina from that machine.");
  }
  const parsed = parseJinaInstagram(content, user);
  if (parsed.followers == null && !parsed.posts.length) {
    throw new Error("Instagram profile was empty" + (opencliError ? " (OpenCLI: " + opencliError + ")" : ""));
  }
  parsed.opencliNote = opencliError;
  return parsed;
}

export function reachBackends(whichFn = which) {
  return {
    twitterCli: Boolean(whichFn("twitter")),
    opencli: Boolean(whichFn("opencli")),
    bird: Boolean(whichFn("bird") || whichFn("birdx")),
    jina: true
  };
}
