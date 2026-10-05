const KEY = "supabird-local-v1";
const LINKS = [
  ["dashboard", "Dashboard"],
  ["housex", "HouseX"],
  ["stats", "Stats"],
  ["ideas", "IdeasLab"],
  ["x-gpt", "X-GPT"],
  ["content-machine", "Content Machine"],
  ["video-to-post", "Video-to-Post"],
  ["compose", "Post"],
  ["settings", "Settings"],
  ["coach", "X Coach"],
  ["engage", "Engage"],
  ["collections", "Collections"],
  ["calendar", "Calendar"],
  ["library", "My Library"],
  ["trends", "Trends"]
];
const EMPTY = {
  profile: { name: "Jeremy", xHandle: "Jasper_Black", niche: "AI tools", voice: "plain, specific, no hype" },
  ideas: [],
  library: [],
  calendar: [],
  collections: [
    { id: "hooks", name: "Hooks that stop the scroll" },
    { id: "proof", name: "Proof / receipts" },
    { id: "asks", name: "Soft asks" }
  ],
  coach: { posts: 1, impressions: 500, replies: 5, retweets: 10 },
  settings: {
    provider: "fcc",
    customBase: "",
    customModel: "",
    customKey: "",
    vyceKey: ""
  }
};

function uid() { return Math.random().toString(36).slice(2, 10); }
function load() {
  try {
    const raw = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "null") };
    raw.settings = { ...EMPTY.settings, ...(raw.settings || {}) };
    return raw;
  } catch { return structuredClone(EMPTY); }
}
function save(next) { localStorage.setItem(KEY, JSON.stringify(next)); return next; }

function providerName(value) {
  if (value === "custom" || value === "vyce") return value;
  return "fcc";
}

function providerPayload() {
  const s = state.settings || EMPTY.settings;
  const provider = providerName(s.provider);
  if (provider === "custom") {
    return {
      provider,
      custom: {
        baseUrl: s.customBase,
        model: s.customModel,
        apiKey: s.customKey
      }
    };
  }
  if (provider === "vyce") return { provider, vyce: { apiKey: s.vyceKey } };
  return { provider };
}

async function generateFromProxy(payload) {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, ...providerPayload() })
  });
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw new Error(data.error || `Generate failed HTTP ${r.status}`);
  if (!data.text) throw new Error("Empty model text");
  return data;
}

function setBusy(form, on, msg) {
  const btn = form.querySelector("button[type=submit]");
  if (btn) btn.disabled = !!on;
  let n = form.querySelector("#note");
  if (!n) {
    n = document.createElement("p");
    n.id = "note";
    form.appendChild(n);
  }
  n.className = on ? "muted" : (msg && msg.startsWith("FCC") || (msg && msg.toLowerCase().includes("fail")) || (msg && msg.toLowerCase().includes("error")) || (msg && msg.toLowerCase().includes("timeout")) ? "warn" : "ok");
  if (!on && msg && /fcc|fail|error|timeout|unreachable|empty|not set/i.test(msg)) n.className = "warn";
  n.textContent = on ? "Calling the selected model…" : (msg || "");
}

const root = document.getElementById("root");
let state = load();
if (!state.profile.xHandle) {
  state = save({ ...state, profile: { ...state.profile, xHandle: "Jasper_Black" } });
}

function hashParts() {
  const raw = (location.hash || "").replace(/^#\/?/, "") || "home";
  const i = raw.indexOf("?");
  const name = (i >= 0 ? raw.slice(0, i) : raw) || "home";
  const q = new URLSearchParams(i >= 0 ? raw.slice(i + 1) : "");
  return { name, q };
}

let view = hashParts().name;

window.addEventListener("hashchange", () => {
  view = hashParts().name;
  render();
});

function go(name, query) {
  location.hash = "#/" + name + (query ? "?" + query : "");
}

function pluginConnected(x, summary) {
  if (x && (x.pluginConnected || x.userId || x.username)) return true;
  const p = summary && summary.profile;
  return Boolean(p && (p.id || p.username));
}

function appOAuth(x) {
  return Boolean(x && (x.signedIn || x.appOAuth || x.hasToken));
}

function oauthErrorFromHash() {
  const q = hashParts().q;
  return q.get("oauth_error") || q.get("error_description") || q.get("error") || "";
}

function paintSessionBanner(x, banner, login) {
  if (!banner) return;
  const rawErr = oauthErrorFromHash();
  const expectedGap = /missing valid authorization|not signed in/i.test(rawErr);
  const err = expectedGap && !appOAuth(x) ? "" : rawErr;
  const handle = (x && (x.username || x.expectedUsername)) || "Jasper_Black";
  if (login) login.style.display = "none";
  if (appOAuth(x)) {
    banner.className = "ok";
    banner.textContent = `Signed in @${handle}${x.userId ? " · id " + x.userId : ""} · posting + tweet ingest on`;
    return;
  }
  if (err) {
    banner.className = "warn";
    banner.textContent = (pluginConnected(x) ? `@${handle} · plugin profile only. ` : "") + err;
    return;
  }
  if (pluginConnected(x)) {
    banner.className = "muted";
    banner.innerHTML = `@${esc(handle)} connected via Cursor X · posting not connected; plugin profile only. <span>Posting/tweet sync needs Native Sign in (free OAuth) — likes on each tweet still need that token or plugin credits.</span>`;
    return;
  }
  banner.className = "muted";
  banner.textContent = `@${handle} · posting not connected; plugin profile only.`;
}

async function startXLogin() {
  try {
    const x = await fetch("/api/x/status").then((r) => r.json());
    if (appOAuth(x)) {
      go("dashboard");
      return;
    }
    if (x.hasClientId) {
      location.assign("/api/x/login");
      return;
    }
    location.hash = "#/signin?posting=1";
  } catch (err) {
    go("dashboard", "oauth_error=" + encodeURIComponent(String(err.message || err)));
  }
}

function bindSignIn(sel) {
  document.querySelectorAll(sel).forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      startXLogin();
    };
  });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shell(inner) {
  const nav = LINKS.map(([id, label]) => {
    const on = view === id || view.startsWith(id + "/");
    return `<a href="#/${id}" class="${on ? "active" : ""}">${label}</a>`;
  }).join("");
  return `<div class="shell"><aside class="side"><div class="brand" style="padding:8px 12px 18px">Blue Jay</div>${nav}<a href="#/" style="margin-top:24px;color:#f87171">Logout</a></aside><main class="main">${inner}</main></div>`;
}

function landing() {
  return `
    <header class="topnav"><div class="brand">Blue Jay</div><nav class="row"><a href="#/dashboard">App</a></nav></header>
    <section class="hero">
      <p class="pill">Blue Jay · v1.1 · local · 127.0.0.1:4747</p>
      <h1>Blue Jay — AI-powered growth for X<br /><span>that stays on this machine</span></h1>
      <p>Find an idea, rewrite it in your voice, queue it, keep the library. Writes use Settings: bundled Free Claude Code, VYCE gpt-6-luna when a key is set, or a custom OpenAI-compatible API. Generate never tweets. HouseX is a panel in this desk.</p>
      <div class="row" style="justify-content:center">
        <a class="btn" href="#/dashboard">Open the lab</a>
        <a class="btn ghost" href="#/dashboard" id="hero-x-login">Enable posting / tweet sync</a>
      </div>
      <p class="muted" style="margin-top:12px">Profile can load from Cursor X. Posting needs Native Sign in with X while this lab stays up at :4747.</p>
    </section>
    <div class="wrap grid3">
      <div class="card"><h3>IdeasLab</h3><p>A swipe file instead of a blank page.</p></div>
      <div class="card"><h3>X-GPT</h3><p>Rewrite in your voice, remix, or shorten.</p></div>
      <div class="card"><h3>Content Machine</h3><p>One topic becomes a week of posts. Generate actually returns ideas.</p></div>
    </div>`;
}

function dashboard() {
  return shell(`
    <h1>Command center</h1>
    <p class="muted">$0 plugin credits is the default. Free profile (followers, following, tweet count) stays. Per-tweet likes need Native Sign in or plugin credits — not pulled yet.</p>
    <div class="row" style="margin:12px 0">
      <button class="btn ghost" type="button" id="x-refresh">Refresh profile</button>
      <a class="btn ghost" href="#/stats">Stats</a>
      <a class="btn ghost" href="#/compose">Post</a>
    </div>
    <p id="x-banner" class="muted"></p>
    <p id="sync-note" class="muted">Loading…</p>
    <p id="sync-clock" class="muted"></p>
    <div id="live"></div>`);
}

function dash(n) {
  return n == null || n === "" ? "—" : String(n);
}

function metricBits(m) {
  if (!m) return "no metrics on this item";
  const bits = [];
  const map = [
    ["impressions", "impr"],
    ["likes", "likes"],
    ["replies", "replies"],
    ["reposts", "reposts"],
    ["quotes", "quotes"],
    ["bookmarks", "saves"],
    ["profileClicks", "profile taps"],
    ["urlClicks", "link taps"],
    ["videoViews", "video"]
  ];
  for (const [k, label] of map) {
    if (m[k] != null) bits.push(`${label} ${m[k]}`);
  }
  return bits.length ? bits.join(" · ") : "API omitted metric fields";
}

function heatHtml(grid) {
  if (!grid || !grid.length) return `<p class="muted">No timestamps yet — heatmap fills after posts sync.</p>`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const max = Math.max(1, ...grid.flat());
  const cells = grid.map((row, d) =>
    `<div class="heat-row"><span>${days[d]}</span>${row.map((n) => {
      const a = n / max;
      return `<i title="${n}" style="background:rgba(168,85,247,${0.12 + a * 0.88})"></i>`;
    }).join("")}</div>`
  ).join("");
  return `<div class="heat">${cells}</div>`;
}

function postCard(p) {
  return `<div class="idea">
    <p class="pill">${esc(p.status || "posted")}</p>
    <p style="white-space:pre-wrap">${esc((p.text || "").slice(0, 280))}</p>
    <p class="muted">${esc(metricBits(p.metrics))} · ${esc(p.postedAt || p.createdAt || "")}</p>
    ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open on X</a>` : ""}
    <button class="btn ghost" type="button" data-compose="${esc(p.text || "")}">Open in composer</button>
  </div>`;
}

function statCell(value, status, label, blocked) {
  const live = status === "live";
  const caption = live
    ? label
    : status === "not_pulled_zero_credits"
      ? ""
      : status === "need_signin_analytics"
      ? ""
        : blocked || "";
  return `<div class="stat"><b>${live ? dash(value) : "—"}</b><span class="muted">${esc(caption || label)}</span></div>`;
}

function liveHtml(s, lastSync) {
  const t = s.totals || {};
  const w = s.week || {};
  const c = s.counts || {};
  const ms = s.metricStatus || {};
  const zeroMode = Object.values(ms).includes("not_pulled_zero_credits") || (!c.posted && !appOAuth(s.x));
  const gapOnce = zeroMode
    ? `<p class="muted">Posts tracked, likes, replies, reposts, and video views: not pulled — $0 plugin credits and no app token. Profile tweet count (${dash(s.tweetCount)}) is still live.</p>`
    : "";
  const ends = ((lastSync && lastSync.endpoints) || (s.lastSync && s.lastSync.endpoints) || [])
    .map((e) => `<li><code>${esc(e.name)}</code> HTTP ${esc(e.status)}${e.count != null ? " · " + e.count : ""}${e.error ? " · " + esc(e.error) : e.ok ? " · ok" : ""}</li>`)
    .join("");
  const recent = (s.recent || []).filter((p) => p.status === "posted" && p.id);
  return `
    <div class="grid4" style="margin:18px 0">
      <div class="stat"><b>${dash(s.followers)}</b><span class="muted">Followers ${s.followerDelta == null ? "" : "(" + (s.followerDelta > 0 ? "+" : "") + s.followerDelta + ")"}</span></div>
      <div class="stat"><b>${dash(s.following)}</b><span class="muted">Following</span></div>
      <div class="stat"><b>${dash(s.tweetCount)}</b><span class="muted">X account posts (profile)</span></div>
      <div class="stat"><b>${c.posted ? dash(c.posted) : "—"}</b><span class="muted">Posts tracked</span></div>
    </div>
    ${gapOnce}
    <div class="grid4" style="margin:0 0 18px">
      ${statCell(t.likes, ms.likes, "Likes (public_metrics)")}
      ${statCell(t.replies, ms.replies, "Replies (public_metrics)")}
      ${statCell(t.reposts, ms.reposts, "Reposts (public_metrics)")}
      ${statCell(t.quotes, ms.quotes, "Quotes (public_metrics)")}
    </div>
    <div class="grid4" style="margin:0 0 18px">
      ${statCell(t.impressions, ms.impressions, "Impressions (organic)")}
      ${statCell(t.videoViews, ms.videoViews, "Video views")}
      ${statCell(t.profileClicks, ms.profileClicks, "Profile clicks")}
      ${statCell(t.bookmarks, ms.bookmarks, "Bookmarks (public)")}
    </div>
    <div class="grid4" style="margin:0 0 18px">
      <div class="stat"><b>${dash(c.queued)}</b><span class="muted">Queued</span></div>
      <div class="stat"><b>${dash(c.draft)}</b><span class="muted">Drafts</span></div>
      <div class="stat"><b>${dash(c.failed)}</b><span class="muted">Failed</span></div>
      <div class="stat"><b>${dash(s.streak)}</b><span class="muted">Posting streak (days)</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Last 7 days (ingested posts only)</h3>
      <p>${zeroMode ? "Per-tweet week stats not pulled." : `Posts ${dash(w.posts)} · Impr ${dash(w.impressions)} · Likes ${dash(w.likes)} · Replies ${dash(w.replies)} · Reposts ${dash(w.reposts)}`}</p>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Hour-of-day heatmap (UTC)</h3>
      ${heatHtml(s.heatmap)}
    </div>
    <h3>Your posts</h3>
    <div class="stack">${recent.length ? recent.map(postCard).join("") : `<p class="muted">${zeroMode ? "Per-tweet rows are not pulled — $0 plugin credits and no app token. That is not a zero-tweet account." : "No posts ingested yet."}</p>`}</div>
    <h3>Best posts</h3>
    <div class="stack">${(s.best || []).length ? s.best.map(postCard).join("") : `<p class="muted">Need ingested posts with metrics first.</p>`}</div>
    <h3 style="margin-top:16px">Worst / quietest (among posts that have metrics)</h3>
    <div class="stack">${(s.worst || []).length ? s.worst.map(postCard).join("") : `<p class="muted">Need metrics first.</p>`}</div>
    <h3 style="margin-top:16px">Endpoints this sync</h3>
    <ul class="muted" style="margin:8px 0 16px 18px">${ends || "<li>Plugin profile only (free {me}). Official /2/ tweet ingest is off until a user access token exists.</li>"}</ul>
    <h3 style="margin-bottom:10px">Quick actions</h3>
    <div class="actions">
      <a class="card" href="#/compose"><h3>Post</h3><p>Full composer. Confirm before live.</p></a>
      <a class="card" href="#/engage"><h3>Engage</h3><p>Mentions and inbound replies.</p></a>
      <a class="card" href="#/ideas"><h3>IdeasLab</h3><p>Next idea from local FCC.</p></a>
    </div>`;
}

async function fillLive(opts) {
  const note = root.querySelector("#sync-note");
  const clock = root.querySelector("#sync-clock");
  const live = root.querySelector("#live");
  if (!note || !live) return;
  const q = hashParts().q;
  const syncing = Boolean(opts && opts.syncing) || q.get("syncing") === "1";
  const wantRefresh = Boolean(opts && opts.refresh);
  note.className = "muted";
  let xStatus = {};
  try {
    xStatus = await fetch("/api/x/status").then((r) => r.json());
  } catch {
    xStatus = {};
  }
  const canOfficial = appOAuth(xStatus);
  if (syncing && !canOfficial) {
    note.textContent = "Plugin profile only — official tweet sync waits for Native Sign in.";
  } else if (syncing) {
    note.textContent = "Syncing your X… official API ingest after sign-in.";
    for (let i = 0; i < 45; i++) {
      try {
        const st = await fetch("/api/x/ingest").then((r) => r.json());
        note.textContent = st.inFlight
          ? "Syncing your X… " + (st.pending ? "queued " + st.pending : "")
          : "Sync finished.";
        if (clock) {
          clock.textContent = [
            st.lastSync && st.lastSync.at ? "Last synced " + st.lastSync.at : "",
            st.lastSync && st.lastSync.reason ? "reason " + st.lastSync.reason : "",
            st.nextRunAt ? "next " + st.nextRunAt : "",
            st.armed ? "timer " + st.intervalMinutes + "m" : ""
          ].filter(Boolean).join(" · ");
        }
        if (!st.inFlight && i > 0) break;
      } catch (err) {
        note.className = "warn";
        note.textContent = String(err.message || err);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } else {
    note.textContent = wantRefresh && canOfficial ? "Calling official X API…" : "Loading saved X world…";
  }
  try {
    const r = await fetch(wantRefresh && canOfficial ? "/api/x/stats?refresh=1" : "/api/x/stats");
    const data = await r.json();
    const summary = data.summary || {};
    const last = data.lastSync || summary.lastSync;
    const ingest = data.ingest || {};
    if (!r.ok) {
      note.className = "warn";
      note.textContent = data.error || `Sync HTTP ${r.status}`;
    } else {
      note.className = last && last.ok === false && last.error && !/missing valid authorization|not signed in/i.test(String(last.error)) ? "warn" : "ok";
      const who = appOAuth(summary.x || xStatus)
        ? "@" + ((summary.x && summary.x.username) || "user") + " (app OAuth)"
        : pluginConnected(summary.x || xStatus, summary)
          ? "@" + ((summary.profile && summary.profile.username) || (summary.x && summary.x.username) || "Jasper_Black") + " · plugin profile only"
          : "no X profile yet";
      const skip = last && last.skipped ? "official ingest idle" : (last && last.reason ? last.reason : "no reason");
      note.textContent = `${who} · last ${last && last.at ? last.at : "never"} · ${skip}`;
    }
    if (clock) {
      clock.textContent = [
        last && last.reason ? "reason " + last.reason : "",
        ingest.nextRunAt || (last && last.nextRunAt) ? "next " + (ingest.nextRunAt || last.nextRunAt) : "",
        ingest.armed ? "10-minute server timer armed" : "timer not armed"
      ].filter(Boolean).join(" · ");
    }
    live.innerHTML = liveHtml(summary, last);
    live.querySelectorAll("[data-compose]").forEach((btn) => {
      btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
    });
  } catch (err) {
    note.className = "warn";
    note.textContent = String(err.message || err);
  }
}

function ideaList(items) {
  if (!items.length) return `<p class="warn">No ideas yet. Generate a batch.</p>`;
  return items.map((idea) =>
    `<div class="idea"><p>${esc(idea.text)}</p><p class="muted">score ${idea.score || ""}</p>
      <button class="btn ghost" type="button" data-compose="${esc(idea.text)}">Open in composer</button></div>`
  ).join("");
}

function render() {
  if (view === "home" || view === "") {
    root.innerHTML = landing();
    bindSignIn("#hero-x-login");
    return;
  }
  if (view === "signin") {
    const q = hashParts().q;
    const err = q.get("error_description") || q.get("error") || "";
    const xErrCode = q.get("error") || "";
    const wantPosting = q.get("posting") === "1" || q.get("need") === "client";
    if (!wantPosting) {
      go("dashboard", err ? "oauth_error=" + encodeURIComponent(err) : "");
      return;
    }
    root.innerHTML = shell(`
      <h1>Enable posting / tweet sync</h1>
      <p class="muted">Plugin profile stays on the dashboard. This panel only starts Native Sign in with X while the lab is up at :4747.</p>
      <p id="x-banner" class="${err ? "warn" : "muted"}">${esc(err || "Ready. Click Enable posting — same window, so X can send errors back here.")}</p>
      ${xErrCode && xErrCode !== err ? `<p class="warn">X error code: <code>${esc(xErrCode)}</code></p>` : ""}
      <div class="row" style="margin:16px 0">
        <a class="btn" id="do-x-login" href="/api/x/login">Enable posting / tweet sync</a>
        <a class="btn ghost" href="#/dashboard">Return to dashboard</a>
      </div>
      <div class="card stack" style="margin-top:16px">
        <h3>Callback URL (paste this exactly on developer.x.com)</h3>
        <p><code id="cb-str">http://127.0.0.1:4747/callback/x</code>
          <button class="btn ghost" type="button" id="copy-cb">Copy</button></p>
        <ul class="muted" style="margin:8px 0 0 18px">
          <li>User authentication settings: ON</li>
          <li>Type of App: <b>Native App</b> (public client, PKCE). Do not pick Confidential / Web unless you also paste a Client secret below.</li>
          <li>Callback URI / Redirect URL: exactly <code>http://127.0.0.1:4747/callback/x</code> — not localhost, no slash at the end, http not https</li>
          <li>Website URL can be <code>http://127.0.0.1:4747</code></li>
          <li>Core scopes we request: <code>tweet.read tweet.write users.read offline.access</code> — enable those on the app. Extra scopes stay off until login works.</li>
        </ul>
      </div>
      <form class="card stack" id="once" style="margin-top:16px">
        <h3>X app on this machine</h3>
        <p class="muted">Client ID is remembered in gitignored data/. Secret only if the app is Confidential Web.</p>
        <label>Client ID</label>
        <input name="clientId" autocomplete="off" placeholder="from the X developer app" />
        <label><input type="checkbox" name="confidential" /> Confidential web app (send Client secret)</label>
        <label>Client secret (only if confidential)</label>
        <input name="clientSecret" type="password" autocomplete="off" />
        <button class="btn" type="submit">Save and sign in</button>
        <p id="xnote"></p>
      </form>`);
    bindSignIn("#do-x-login");
    const copy = root.querySelector("#copy-cb");
    if (copy) copy.onclick = () => {
      navigator.clipboard.writeText("http://127.0.0.1:4747/callback/x").catch(() => {});
      copy.textContent = "Copied";
    };
    fetch("/api/x/status").then((r) => r.json()).then((x) => {
      const banner = root.querySelector("#x-banner");
      const idInput = root.querySelector("input[name=clientId]");
      if (appOAuth(x)) {
        go("dashboard");
        return;
      }
      if (idInput && x.hasClientId) idInput.placeholder = `saved …${x.clientIdHint}`;
      if (banner && !err) {
        banner.className = x.hasClientId ? "ok" : "warn";
        banner.textContent = x.hasClientId
          ? `X app on this machine (…${x.clientIdHint}). Scopes: ${x.scopes}. Plugin @${x.username || x.expectedUsername} stays connected. This click only enables posting.`
          : `No Client ID yet. @${x.expectedUsername || "Jasper_Black"} is the house handle. Paste Client ID once, then Enable posting.`;
      }
    }).catch((e) => {
      const banner = root.querySelector("#x-banner");
      if (banner) { banner.className = "warn"; banner.textContent = String(e.message || e); }
    });
    const form = root.querySelector("#once");
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const note = root.querySelector("#xnote");
      const clientId = String(fd.get("clientId") || "").trim();
      const confidential = form.querySelector("[name=confidential]") && form.querySelector("[name=confidential]").checked;
      try {
        const body = {
          confidential,
          extraScopes: [],
          clientSecret: confidential ? String(fd.get("clientSecret") || "") : ""
        };
        if (clientId) body.clientId = clientId;
        const r = await fetch("/api/x/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Could not save X app");
        if (!data.x.hasClientId && !clientId) {
          if (note) { note.className = "warn"; note.textContent = "Client ID is required once."; }
          return;
        }
        location.assign("/api/x/login");
      } catch (err2) {
        if (note) { note.className = "warn"; note.textContent = String(err2.message || err2); }
      }
    };
    return;
  }
  if (view === "dashboard" || view === "stats") {
    root.innerHTML = dashboard();
    if (view === "stats") {
      const h = root.querySelector("h1");
      if (h) h.textContent = "Stats";
    }
    fillLive({ refresh: false, syncing: hashParts().q.get("syncing") === "1" });
    const btn = root.querySelector("#x-refresh");
    if (btn) btn.onclick = () => fillLive({ refresh: true });
    fetch("/api/x/status").then((r) => r.json()).then((x) => {
      paintSessionBanner(x, root.querySelector("#x-banner"), root.querySelector("#dash-x-login"));
    }).catch((e) => {
      const banner = root.querySelector("#x-banner");
      if (banner) { banner.className = "warn"; banner.textContent = String(e.message || e); }
    });
    return;
  }

  if (view === "ideas") {
    root.innerHTML = shell(`
      <h1>IdeasLab</h1>
      <p class="muted">A swipe file. Type a topic, get five hooks, keep the ones that sound like you.</p>
      <form class="card stack" id="f" style="margin:16px 0">
        <label>Topic</label>
        <input name="topic" value="${esc(state.profile.niche)}" />
        <button class="btn" type="submit">Fill the blank page</button>
        <p id="note"></p>
      </form>
      <div class="stack">${ideaList(state.ideas)}</div>`);
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const topic = new FormData(form).get("topic");
      setBusy(form, true);
      try {
        const data = await generateFromProxy({ kind: "ideas", topic, niche: state.profile.niche });
        const batch = (data.ideas || [{ text: data.text }]).map((idea) => ({
          id: uid(),
          text: idea.text,
          model: data.model
        }));
        state = save({
          ...state,
          ideas: [...batch, ...state.ideas],
          library: [...batch.map((idea) => ({ id: uid(), kind: "idea", text: idea.text })), ...state.library]
        });
        render();
      } catch (err) {
        setBusy(form, false, String(err.message || err));
      }
    };
    root.querySelectorAll("[data-compose]").forEach((btn) => {
      btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
    });
    return;
  }

  if (view === "content-machine") {
    root.innerHTML = shell(`
      <h1>Content Machine</h1>
      <p class="muted">Daily personalized post ideas via Free Claude Code. If the proxy is down, you get an error — not filler copy.</p>
      <form class="card stack" id="f" style="margin:16px 0">
        <h3>Learning preferences</h3>
        <label>Topic</label><input name="topic" value="${esc(state.profile.niche || "AI tools")}" />
        <label>Niche</label><input name="niche" value="SaaS founders" />
        <label>Favorite creators</label><input name="creators" value="garyvee, fmanju10" />
        <button class="btn" type="submit">Generate new ideas</button>
        <p id="note"></p>
      </form>
      <div class="stack">${ideaList(state.ideas.slice(0, 12))}</div>`);
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      setBusy(form, true);
      try {
        const data = await generateFromProxy({
          kind: "machine",
          topic: fd.get("topic"),
          niche: fd.get("niche"),
          creators: fd.get("creators")
        });
        const batch = (data.ideas || [{ text: data.text }]).map((idea) => ({
          id: uid(),
          text: idea.text,
          model: data.model
        }));
        state = save({
          ...state,
          profile: { ...state.profile, niche: String(fd.get("niche") || state.profile.niche) },
          ideas: [...batch, ...state.ideas],
          library: [...batch.map((idea) => ({ id: uid(), kind: "machine", text: idea.text })), ...state.library]
        });
        render();
      } catch (err) {
        setBusy(form, false, String(err.message || err));
      }
    };
    root.querySelectorAll("[data-compose]").forEach((btn) => {
      btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
    });
    return;
  }

  if (view === "x-gpt") {
    root.innerHTML = shell(`
      <h1>X-GPT</h1>
      <p class="muted">Rewrite in your voice through Free Claude Code. Fail closed if the proxy is down.</p>
      <form class="card stack" id="f" style="margin-top:16px">
        <label>Draft</label><textarea name="draft" placeholder="Paste a half-finished post"></textarea>
        <label>Mode</label>
        <select name="mode">
          <option value="voice">My style</option>
          <option value="remix">Remix</option>
          <option value="short">Shorten</option>
        </select>
        <button class="btn" type="submit">Rewrite</button>
        <p id="note"></p>
      </form>
      <div class="idea" id="out" style="margin-top:16px;white-space:pre-wrap;display:none"></div>`);
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      setBusy(form, true);
      try {
        const data = await generateFromProxy({ kind: "rewrite", draft: fd.get("draft"), mode: fd.get("mode") });
        state = save({ ...state, library: [{ id: uid(), kind: "rewrite", text: data.text }, ...state.library] });
        const out = root.querySelector("#out");
        out.style.display = "block";
        out.textContent = data.text;
        setBusy(form, false, data.model || "ok");
        let b = root.querySelector("#to-compose");
        if (!b) {
          b = document.createElement("button");
          b.id = "to-compose";
          b.className = "btn";
          b.type = "button";
          b.textContent = "Open in composer";
          out.after(b);
        }
        b.onclick = () => openCompose(data.text);
      } catch (err) {
        setBusy(form, false, String(err.message || err));
      }
    };
    return;
  }

  if (view === "video-to-post") {
    root.innerHTML = shell(`
      <h1>Video-to-Post</h1>
      <p class="muted">You made a video. This writes the post that sells it. It does not upload or publish.</p>
      <form class="card stack" id="f" style="margin-top:16px">
        <label>Video URL or file name</label>
        <input name="url" placeholder="https://youtu.be/… or clip.mp4" />
        <button class="btn" type="submit">Write the posts</button>
        <p id="note"></p>
      </form>
      <div class="idea" id="out" style="margin-top:16px;white-space:pre-wrap;display:none"></div>`);
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      setBusy(form, true);
      try {
        const data = await generateFromProxy({ kind: "video", url: new FormData(form).get("url") });
        state = save({ ...state, library: [{ id: uid(), kind: "video", text: data.text }, ...state.library] });
        const out = root.querySelector("#out");
        out.style.display = "block";
        out.textContent = data.text;
        setBusy(form, false, data.model || "ok");
        let b = root.querySelector("#to-compose");
        if (!b) {
          b = document.createElement("button");
          b.id = "to-compose";
          b.className = "btn";
          b.type = "button";
          b.textContent = "Open in composer";
          out.after(b);
        }
        b.onclick = () => openCompose(data.text);
      } catch (err) {
        setBusy(form, false, String(err.message || err));
      }
    };
    return;
  }

  if (view === "coach") {
    const c = state.coach;
    root.innerHTML = shell(`
      <h1>X Coach</h1>
      <p class="muted">Targets vs ingested X posts. Impressions stay — until Sign in with X returns organic_metrics.</p>
      <div id="coach-live" class="card" style="margin-top:16px"><p class="muted">Loading tracked posts…</p></div>
      <form class="card stack" id="f" style="margin-top:16px">
        <label>Posts per day</label><input name="posts" type="number" value="${c.posts}" />
        <label>Impressions goal</label><input name="impressions" type="number" value="${c.impressions}" />
        <label>Replies</label><input name="replies" type="number" value="${c.replies}" />
        <label>Reposts</label><input name="retweets" type="number" value="${c.retweets}" />
        <button class="btn" type="submit">Save targets</button>
      </form>
      <div id="coach-posts" class="stack" style="margin-top:16px"></div>`);
    fetch("/api/x/stats").then((r) => r.json()).then((data) => {
      const s = data.summary || {};
      const live = root.querySelector("#coach-live");
      const list = root.querySelector("#coach-posts");
      if (live) {
        live.innerHTML = `<p>Tracked posts ${dash(s.counts && s.counts.posted)} · public likes ${dash(s.totals && s.totals.likes)} · replies ${dash(s.totals && s.totals.replies)} · reposts ${dash(s.totals && s.totals.reposts)}</p>
          <p class="muted">Impressions not pulled — $0 plugin credits and no app token</p>`;
      }
      if (list) {
        const rows = (s.recent || []).filter((p) => p.status === "posted" && p.id);
        list.innerHTML = rows.length ? rows.map(postCard).join("") : `<p class="muted">Per-tweet rows not pulled — $0 plugin credits and no app token (profile tweet_count ${dash(s.tweetCount)}).</p>`;
        list.querySelectorAll("[data-compose]").forEach((btn) => {
          btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
        });
      }
    }).catch((err) => {
      const live = root.querySelector("#coach-live");
      if (live) live.innerHTML = `<p class="warn">${esc(err.message || err)}</p>`;
    });
    root.querySelector("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state = save({
        ...state,
        coach: {
          posts: Number(fd.get("posts")) || 0,
          impressions: Number(fd.get("impressions")) || 0,
          replies: Number(fd.get("replies")) || 0,
          retweets: Number(fd.get("retweets")) || 0
        }
      });
      render();
    };
    return;
  }

  if (view === "engage") {
    root.innerHTML = shell(`
      <h1>Engage</h1>
      <p class="muted">Find people worth talking to instead of doom-scrolling. Local starter list, not a scraped timeline.</p>
      <div class="stack" style="margin-top:16px">
        <div class="idea"><h3>@Jasper_Black</h3><p class="muted">Your own voice. Reply here first so the lab is not a stranger account.</p></div>
        <div class="idea"><h3>@the_machine_room_now</h3><p class="muted">Machine Room lane — comment on shipping, not vibes.</p></div>
        <div class="idea"><h3>one person who posted a receipt today</h3><p class="muted">Ask what they measured. Skip the fire emoji.</p></div>
      </div>`);
    return;
  }

  if (view === "collections") {
    root.innerHTML = shell(`
      <h1>Collections</h1>
      <p class="muted">Swipe-file buckets. Hooks, proof, asks — add your own.</p>
      <form class="card row" id="f" style="margin:16px 0">
        <input name="name" placeholder="New collection" />
        <button class="btn" type="submit">Add</button>
      </form>
      <div class="grid3">${state.collections.map((c) => `<div class="card"><h3>${esc(c.name)}</h3></div>`).join("")}</div>`);
    root.querySelector("#f").onsubmit = (e) => {
      e.preventDefault();
      const name = String(new FormData(e.target).get("name") || "").trim();
      if (!name) return;
      state = save({ ...state, collections: [{ id: uid(), name }, ...state.collections] });
      render();
    };
    return;
  }

  if (view === "calendar") {
    root.innerHTML = shell(`
      <h1>Calendar</h1>
      <p class="muted">Queue only. This does not post to X, Threads, or LinkedIn.</p>
      <form class="card stack" id="f" style="margin:16px 0">
        <label>When</label><input name="when" type="datetime-local" />
        <label>Draft</label><textarea name="text"></textarea>
        <button class="btn" type="submit">Queue locally</button>
      </form>
      <div class="stack">${state.calendar.length ? state.calendar.map((item) =>
        `<div class="idea"><p class="pill">${esc(item.when)}</p><p>${esc(item.text)}</p>
          <button class="btn ghost" type="button" data-compose="${esc(item.text)}">Open in composer</button></div>`
      ).join("") : `<p class="warn">Queue is empty.</p>`}</div>`);
    root.querySelector("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const text = String(fd.get("text") || "").trim();
      if (!text) return;
      state = save({
        ...state,
        calendar: [{ id: uid(), when: fd.get("when") || "unscheduled", text }, ...state.calendar]
      });
      render();
    };
    root.querySelectorAll("[data-compose]").forEach((btn) => {
      btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
    });
    return;
  }

  if (view === "compose") {
    root.innerHTML = shell(`<h1>Post</h1><p class="muted">Full X composer. Every control is on. Post still needs an explicit confirm. Generate never tweets.</p><div class="xcomp" id="composer"></div>`);
    mountComposer(root.querySelector("#composer"), { generate: generateFromProxy });
    return;
  }

  if (view === "settings") {
    const s = state.settings || EMPTY.settings;
    root.innerHTML = shell(`
      <h1>Settings</h1>
      <p class="muted">Pick who writes. Free Claude Code is the default. VYCE gpt-6-luna is used when a VYCE key is set. Custom is any other OpenAI-compatible API. Nothing is posted.</p>
      <p id="fcc-status" class="muted">Checking bundled FCC…</p>
      <form class="card stack" id="f" style="margin-top:16px">
        <label>Provider</label>
        <select name="provider">
          <option value="fcc"${providerName(s.provider) === "fcc" ? " selected" : ""}>Builtin Free Claude Code (Sonnet 4.6)</option>
          <option value="vyce"${providerName(s.provider) === "vyce" ? " selected" : ""}>VYCE · gpt-6-luna</option>
          <option value="custom"${providerName(s.provider) === "custom" ? " selected" : ""}>Custom OpenAI-compatible API</option>
        </select>
        <label>VYCE API key</label>
        <input name="vyceKey" type="password" autocomplete="off" value="${esc(s.vyceKey || "")}" />
        <p class="muted">VYCE gpt-6-luna for AI when this key is set. The model id is fixed. The key is stored in gitignored .env.local.</p>
        <label>Custom base URL</label>
        <input name="customBase" placeholder="http://127.0.0.1:8781/v1" value="${esc(s.customBase)}" />
        <label>Custom model id</label>
        <input name="customModel" placeholder="provider/model-id" value="${esc(s.customModel)}" />
        <label>Custom API key</label>
        <input name="customKey" type="password" autocomplete="off" value="${esc(s.customKey)}" />
        <button class="btn" type="submit">Save provider</button>
        <p id="note"></p>
      </form>
      <form class="card stack" id="xcred" style="margin-top:16px">
        <h3>X</h3>
        <p id="xstat" class="muted">Checking X…</p>
        <div class="row">
          <a class="btn ghost" href="#/dashboard" id="set-x-login">Enable posting / tweet sync</a>
          <button class="btn ghost" type="button" id="xout">Sign out</button>
        </div>
        <p id="xnote"></p>
        <details id="x-once" style="margin-top:12px">
          <summary class="muted">First-run Client ID (only if Sign in cannot start)</summary>
          <p class="muted">Native app at developer.x.com. Callback http://127.0.0.1:4747/callback/x. PKCE. Secret optional. Saved to gitignored data/.</p>
          <label>Client ID</label><input name="clientId" autocomplete="off" />
          <label>Client secret (optional)</label><input name="clientSecret" type="password" autocomplete="off" />
          <button class="btn ghost" type="submit">Save X app</button>
        </details>
      </form>`);
    fetch("/api/health").then((r) => r.json()).then((h) => {
      const el = root.querySelector("#fcc-status");
      if (!el) return;
      const up = h.fccUpdate || {};
      el.textContent = `Bundled FCC ${h.fccVersion || "?"} · ${up.message || up.action || "no check"}`;
      if (up.action === "check-failed" || up.action === "install-failed") el.className = "warn";
      else el.className = "ok";
    }).catch((err) => {
      const el = root.querySelector("#fcc-status");
      if (el) { el.className = "warn"; el.textContent = String(err.message || err); }
    });
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const next = {
        provider: providerName(String(fd.get("provider") || "fcc")),
        customBase: String(fd.get("customBase") || "").trim(),
        customModel: String(fd.get("customModel") || "").trim(),
        customKey: String(fd.get("customKey") || ""),
        vyceKey: String(fd.get("vyceKey") || "")
      };
      state = save({ ...state, settings: next });
      setBusy(form, true);
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `Settings HTTP ${r.status}`);
        const echoed = data.settings || {};
        if (echoed.provider !== next.provider) throw new Error("Settings did not round-trip provider");
        const keyNote = next.provider === "vyce"
          ? (echoed.hasVyceKey ? " · gpt-6-luna · key kept locally" : "")
          : (echoed.hasCustomKey ? " · key kept locally" : "");
        setBusy(form, false, `Saved ${next.provider}${keyNote}`);
      } catch (err) {
        setBusy(form, false, String(err.message || err));
      }
    };
    fetch("/api/x/status").then((r) => r.json()).then((x) => {
      const el = root.querySelector("#xstat");
      if (!el) return;
      if (appOAuth(x)) el.textContent = `App OAuth signed in @${x.username || "user"}${x.userId ? " · id " + x.userId : ""} · posting on`;
      else if (pluginConnected(x)) el.textContent = `@${x.username || x.expectedUsername} connected via Cursor X${x.userId ? " · id " + x.userId : ""} · posting off until Native OAuth`;
      else if (x.hasClientId) el.textContent = `@${x.expectedUsername} · X app saved (…${x.clientIdHint}), no profile yet`;
      else el.textContent = `@${x.expectedUsername} · no Client ID on this machine yet`;
    }).catch((err) => {
      const el = root.querySelector("#xstat");
      if (el) el.textContent = String(err.message || err);
    });
    bindSignIn("#set-x-login");
    root.querySelector("#xcred").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const note = root.querySelector("#xnote");
      try {
        const r = await fetch("/api/x/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: String(fd.get("clientId") || "").trim(),
            clientSecret: String(fd.get("clientSecret") || "")
          })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `X credentials HTTP ${r.status}`);
        if (note) { note.className = "ok"; note.textContent = data.x.hasClientId ? "X app saved. Signing in…" : "Need a Client ID."; }
        if (data.x && data.x.hasClientId) location.href = "/api/x/login";
      } catch (err) {
        if (note) { note.className = "warn"; note.textContent = String(err.message || err); }
      }
    };
    root.querySelector("#xout").onclick = async () => {
      const note = root.querySelector("#xnote");
      try {
        const r = await fetch("/api/x/logout", { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Sign out failed");
        if (note) { note.className = "ok"; note.textContent = "Signed out."; }
      } catch (err) {
        if (note) { note.className = "warn"; note.textContent = String(err.message || err); }
      }
    };
    return;
  }

  if (view === "housex" || view.startsWith("housex/")) {
    root.innerHTML = shell(`<div id="bj-housex"></div>`);
    if (window.renderHouseX) window.renderHouseX(root.querySelector("#bj-housex"));
    return;
  }

  if (view === "trends") {
    root.innerHTML = shell(`<div id="bj-trends"><h1>Trends</h1><p class="muted">Loading from X Trends Desk…</p></div>`);
    if (window.renderBlueJayTrends) window.renderBlueJayTrends(root.querySelector("#bj-trends"));
    return;
  }

  if (view === "library") {
    root.innerHTML = shell(`
      <h1>My Library</h1>
      <p class="muted">Ingested X posts plus local keeps. Empty only if X returned zero posts.</p>
      <div id="x-lib" class="stack" style="margin:16px 0"><p class="muted">Loading X posts…</p></div>
      <h3>Local keeps</h3>
      <button class="btn ghost" id="clr" style="margin:16px 0" type="button">Clear local library</button>
      <div class="stack">${state.library.length ? state.library.map((item) =>
        `<div class="idea"><p class="pill">${esc(item.kind)}</p><p style="white-space:pre-wrap">${esc(item.text)}</p>
          <button class="btn ghost" type="button" data-compose="${esc(item.text)}">Open in composer</button></div>`
      ).join("") : `<p class="muted">No local drafts kept yet.</p>`}</div>`);
    fetch("/api/x/stats").then((r) => r.json()).then((data) => {
      const s = data.summary || {};
      const el = root.querySelector("#x-lib");
      if (!el) return;
      const rows = (s.recent || []).filter((p) => p.status === "posted" && p.id);
      el.innerHTML = rows.length
        ? rows.map(postCard).join("")
        : `<p class="muted">Per-tweet library not pulled — $0 plugin credits and no app token. Profile tweet_count is ${dash(s.tweetCount)}. Local drafts below still work.</p>`;
      el.querySelectorAll("[data-compose]").forEach((btn) => {
        btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
      });
    }).catch((err) => {
      const el = root.querySelector("#x-lib");
      if (el) el.innerHTML = `<p class="warn">${esc(err.message || err)}</p>`;
    });
    root.querySelector("#clr").onclick = () => {
      state = save({ ...state, library: [] });
      render();
    };
    root.querySelectorAll("[data-compose]").forEach((btn) => {
      btn.onclick = () => openCompose(btn.getAttribute("data-compose"));
    });
    return;
  }

  root.innerHTML = landing();
}

render();
