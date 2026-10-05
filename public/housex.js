// HouseX desk inside the Blue Jay shell. Talks to a local HouseX API through
// /api/housex. The key lives in localStorage only. Drafts do not publish.
// This desk never sends DMs.
(function () {
  const LS_KEY = "bluejay-housex-v1";
  const DRAFT_KEY = "bluejay-housex-draft";
  const SCREENS = [
    ["overview", "Overview"],
    ["posts", "Posts"],
    ["compose", "Composer"],
    ["scheduled", "Scheduled"],
    ["inspiration", "Inspiration"],
    ["contacts", "Contacts"],
    ["signals", "Signals"],
    ["engage", "Engage"],
    ["organize", "Tags / Context / Queue"],
    ["settings", "Settings"]
  ];
  const TAG_COLORS = ["rose", "amber", "lime", "emerald", "teal", "cyan", "blue", "indigo", "violet", "fuchsia", "slate", "stone"];
  const mem = {
    posts: { type: "posts", sort: "posted_at", limit: 25, page: 1 },
    scheduled: { status: "draft,scheduled", page: 1 },
    inspiration: { q: "", sort: "relevant", limit: 20, page: 1 },
    contacts: { sort: "engagement", limit: 25, page: 1, contactId: "", listId: "" },
    signals: { page: 1 },
    engage: { feedId: "", page: 1 },
    organize: { tab: "tags" }
  };
  let cache = { accounts: null, accountsAt: 0 };
  let paintGen = 0;
  let lastRate = null;
  let listFrom = (data) => (Array.isArray(data) ? data : null);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function num(v) {
    return v == null || v === "" ? "—" : String(v);
  }
  function clip(s, n) {
    const t = String(s || "");
    return t.length > n ? t.slice(0, n) + "…" : t;
  }
  function loadCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      return {
        apiBase: typeof raw.apiBase === "string" ? raw.apiBase : "",
        apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
        accountId: typeof raw.accountId === "string" ? raw.accountId : ""
      };
    } catch {
      return { apiBase: "", apiKey: "", accountId: "" };
    }
  }
  function saveCfg(next) {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return next;
  }
  function screenFromHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const path = raw.split("?")[0];
    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "housex") return "overview";
    const id = parts[1] || "overview";
    return SCREENS.some(([s]) => s === id) ? id : "overview";
  }
  function screenLabel(id) {
    return (SCREENS.find(([s]) => s === id) || ["", "HouseX"])[1];
  }
  function hasKey(cfg) {
    return Boolean(cfg.apiKey && cfg.apiKey.trim());
  }
  function accountQuery(cfg, extra) {
    const q = { ...(extra || {}) };
    if (cfg.accountId) q.account_id = cfg.accountId;
    return q;
  }
  function noteRate(result) {
    if (result && result.rate) lastRate = result.rate;
  }

  async function makeClient(cfg) {
    const mod = await import("/housex-client.mjs");
    return new mod.HousexClient({
      apiKey: cfg.apiKey,
      upstream: cfg.apiBase,
      origin: location.origin
    });
  }

  function stubBanner(r) {
    return `<div class="hx-banner stub"><span class="hx-chip stub">not implemented</span><p>${esc(r.message || "This HouseX endpoint is not implemented.")}</p><p class="muted">HTTP ${esc(r.status)}${r.code ? " · " + esc(r.code) : ""}. Nothing here is filled in.</p></div>`;
  }
  function errBanner(r) {
    const kind = r.kind === "unauthorized" ? ["bad", "key rejected"]
      : r.kind === "rate_limited" ? ["lim", "rate limited"]
        : r.kind === "unreachable" ? ["bad", "unreachable"]
          : ["bad", "error"];
    const retry = r.kind === "rate_limited" && r.retryAfter != null ? ` · retry after ${r.retryAfter}s` : "";
    return `<div class="hx-banner err"><span class="hx-chip ${kind[0]}">${kind[1]}</span><p>${esc(r.message || "Request failed")}</p><p class="muted">HTTP ${esc(r.status || 0)}${r.code ? " · " + esc(r.code) : ""}${esc(retry)}</p></div>`;
  }
  function needKey() {
    return `<div class="hx-banner err"><span class="hx-chip bad">no key</span><p>Paste an hxk_ key in HouseX Settings. It stays in this browser’s localStorage. Blue Jay does not save it on the server, and nothing is fetched until a key is set.</p><p style="margin-top:10px"><a class="btn" href="#/housex/settings">Open Settings</a></p></div>`;
  }
  function show(r, okHtml) {
    noteRate(r);
    if (!r) return errBanner({ kind: "error", status: 0, message: "No response", code: "" });
    if (r.kind === "not_implemented") return stubBanner(r);
    if (!r.ok) return errBanner(r);
    return okHtml(r.data, r.raw);
  }
  function kpi(label, value) {
    return `<div class="stat hx-kpi"><b>${esc(num(value))}</b><span class="muted">${esc(label)}</span></div>`;
  }
  function jsonDetails(value, label) {
    let text = "";
    try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
    return `<details class="hx-raw"><summary class="muted">${esc(label || "Response")}</summary><pre>${esc(text)}</pre></details>`;
  }
  function textOf(row) {
    if (!row || typeof row !== "object") return "";
    if (typeof row.text === "string") return row.text;
    if (Array.isArray(row.parts)) return row.parts.map((p) => (p && p.text) || "").filter(Boolean).join("\n---\n");
    return "";
  }
  function metricsOf(row) {
    return (row && row.metrics) || {};
  }
  function postTable(rows) {
    if (!rows.length) return `<p class="muted">The API returned no rows.</p>`;
    const head = `<tr><th>When</th><th>Text</th><th class="num">Impr</th><th class="num">Likes</th><th class="num">Replies</th><th class="num">Reposts</th><th class="num">Quotes</th><th class="num">Saves</th></tr>`;
    const body = rows.map((p) => {
      const m = metricsOf(p);
      const when = p.posted_at || p.created_at || p.scheduled_for || p.published_at || "";
      return `<tr><td>${esc(when)}</td><td class="hx-text">${esc(clip(textOf(p), 280))}</td>
        <td class="num">${esc(num(m.impressions))}</td><td class="num">${esc(num(m.likes))}</td>
        <td class="num">${esc(num(m.replies))}</td><td class="num">${esc(num(m.reposts))}</td>
        <td class="num">${esc(num(m.quotes))}</td><td class="num">${esc(num(m.bookmarks))}</td></tr>`;
    }).join("");
    return `<div class="hx-scroll"><table class="hx-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  function kv(obj) {
    if (!obj || typeof obj !== "object") return `<p class="muted">Empty response.</p>`;
    const rows = Object.entries(obj).filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v));
    if (!rows.length) return jsonDetails(obj);
    return `<div class="hx-scroll"><table class="hx-table"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function analyticsHtml(data) {
    if (data == null) return `<p class="muted">Analytics response was empty.</p>`;
    if (typeof data !== "object") return `<p>${esc(data)}</p>`;
    const totals = data.totals && typeof data.totals === "object" ? data.totals : null;
    let html = "";
    if (totals) html += `<div class="hx-kpis">${Object.entries(totals).map(([k, v]) => kpi(k, v)).join("")}</div>`;
    const followers = data.followers && typeof data.followers === "object" ? data.followers : null;
    if (followers) {
      html += `<div class="hx-kpis">${kpi("followers start", followers.start)}${kpi("followers end", followers.end)}${kpi("follower change", followers.change ?? followers.delta)}</div>`;
    }
    const series = Array.isArray(data.series) ? data.series : Array.isArray(data.daily) ? data.daily : Array.isArray(data.days) ? data.days : null;
    if (series && series.length) {
      const vals = series.map((d) => Number(d.impressions ?? d.value ?? 0));
      const max = Math.max(1, ...vals.filter((n) => Number.isFinite(n)));
      html += `<div class="hx-series">${series.slice(-42).map((d, i) => {
        const n = Number(d.impressions ?? d.value ?? 0);
        const h = Math.max(2, Math.round(((Number.isFinite(n) ? n : 0) / max) * 48));
        return `<i title="${esc(d.date || d.day || i)} ${esc(num(d.impressions ?? d.value))}" style="height:${h}px"></i>`;
      }).join("")}</div>`;
    }
    if (!html) html = kv(data) + jsonDetails(data);
    return html;
  }
  function peopleTable(rows, idAttr) {
    if (!rows.length) return `<p class="muted">The API returned no people.</p>`;
    return `<div class="hx-scroll"><table class="hx-table"><thead><tr><th>Name</th><th>Handle</th><th class="num">Score</th><th></th></tr></thead><tbody>${
      rows.map((p) => {
        const id = p.id ?? p.contact_id ?? "";
        const handle = p.username || p.handle || p.screen_name || "";
        const score = p.engagement ?? p.icp_score ?? p.score ?? p.replies;
        return `<tr><td>${esc(p.name || p.display_name || "")}</td><td>${esc(handle ? "@" + String(handle).replace(/^@/, "") : "")}</td><td class="num">${esc(num(score))}</td><td>${idAttr ? `<button class="btn ghost hx-rowbtn" type="button" data-${idAttr}="${esc(id)}">Open</button>` : ""}</td></tr>`;
      }).join("")
    }</tbody></table></div>`;
  }

  function frame(screen, body, cfg) {
    const nav = SCREENS.map(([id, label]) => `<a href="#/housex/${id === "overview" ? "" : id}" class="${screen === id ? "active" : ""}">${label}</a>`).join("");
    const keyHint = hasKey(cfg) ? `<span class="hx-chip live">key …${esc(cfg.apiKey.slice(-4))}</span>` : `<span class="hx-chip bad">no key</span>`;
    const rate = lastRate ? `<span class="muted">${esc(lastRate.remaining ?? "—")}/${esc(lastRate.limit ?? "—")} left</span>` : "";
    return `<div class="hx-desk">
      <nav class="hx-sub" aria-label="HouseX">${nav}</nav>
      <div>
        <header class="hx-top">
          <div>
            <p class="pill">HouseX · local desk · drafts stay drafts</p>
            <h1>${esc(screenLabel(screen))}</h1>
          </div>
          <div class="hx-status">
            ${keyHint}
            ${rate}
            <label class="muted">Account <select id="hx-account"><option value="">Main account</option></select></label>
            <button class="btn ghost hx-rowbtn" type="button" id="hx-refresh">Refresh</button>
          </div>
        </header>
        <div id="hx-body">${body}</div>
      </div>
    </div>`;
  }

  async function loadAccounts(api) {
    if (cache.accounts && Date.now() - cache.accountsAt < 20000) return cache.accounts;
    const result = await api.call("GET", "/accounts");
    cache.accounts = result;
    cache.accountsAt = Date.now();
    return result;
  }

  function fillAccounts(el, cfg) {
    const sel = el.querySelector("#hx-account");
    if (!sel) return;
    const result = cache.accounts;
    el.querySelectorAll(".hx-acc-stub").forEach((n) => n.remove());
    if (result && result.ok) {
      const modList = (data) => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.accounts)) return data.accounts;
        return [];
      };
      const rows = modList(result.data);
      sel.innerHTML = `<option value="">Main account</option>` + rows.map((a) => {
        const id = String(a.id ?? a.account_id ?? "");
        const handle = a.username || a.handle || a.name || id;
        return `<option value="${esc(id)}"${cfg.accountId === id ? " selected" : ""}>${esc(handle)}</option>`;
      }).join("");
    } else if (result && result.kind === "not_implemented") {
      sel.insertAdjacentHTML("afterend", ` <span class="hx-chip stub hx-acc-stub">accounts not implemented</span>`);
    }
    sel.onchange = () => {
      const next = loadCfg();
      next.accountId = sel.value;
      saveCfg(next);
      cache.accountsAt = Date.now();
      window.renderHouseX(el);
    };
  }

  async function paintOverview(api, cfg) {
    const [me, accounts] = await Promise.all([
      api.call("GET", "/me"),
      loadAccounts(api)
    ]);
    noteRate(me.ok ? me : accounts);
    const meHtml = show(me, (data) => `<div class="card"><h3>Key</h3>${kv(data && data.user ? { ...data.user, plan: data.plan, key: data.key && data.key.name } : data)}${jsonDetails(data, "me payload")}</div>`);
    const accHtml = show(accounts, (data) => {
      const rows = Array.isArray(data) ? data : (data && data.accounts) || [];
      if (!Array.isArray(rows) || !rows.length) return `<div class="card"><h3>Accounts</h3><p class="muted">No accounts in this response.</p>${jsonDetails(data)}</div>`;
      return `<div class="card"><h3>Accounts</h3><div class="hx-scroll"><table class="hx-table"><thead><tr><th>Handle</th><th>Name</th><th>Id</th><th>Role</th></tr></thead><tbody>${
        rows.map((a) => `<tr><td>${esc(a.username || a.handle || "")}</td><td>${esc(a.name || "")}</td><td>${esc(a.id ?? "")}</td><td>${esc(a.role || a.permission || (a.is_main ? "main" : ""))}</td></tr>`).join("")
      }</tbody></table></div></div>`;
    });
    return `<div class="hx-split">${meHtml}${accHtml}</div><p class="muted">Reads use the selected account when one is set. Writes on this desk still ask before they schedule or publish, and they never include an auto-DM.</p>`;
  }

  async function paintPosts(api, cfg) {
    const f = mem.posts;
    const query = accountQuery(cfg, { type: f.type, sort: f.sort, limit: f.limit, page: f.page });
    const [posts, analytics] = await Promise.all([
      api.call("GET", "/posts", { query }),
      api.call("GET", "/posts/analytics", { query: accountQuery(cfg, {}) })
    ]);
    noteRate(posts.ok ? posts : analytics);
    const filters = `<form class="hx-filters" id="hx-post-filters">
      <label>Type <select name="type"><option value="posts"${f.type === "posts" ? " selected" : ""}>Posts</option><option value="replies"${f.type === "replies" ? " selected" : ""}>Replies</option><option value="all"${f.type === "all" ? " selected" : ""}>All</option></select></label>
      <label>Sort <select name="sort"><option value="posted_at"${f.sort === "posted_at" ? " selected" : ""}>Newest</option><option value="likes"${f.sort === "likes" ? " selected" : ""}>Likes</option><option value="impressions"${f.sort === "impressions" ? " selected" : ""}>Impressions</option></select></label>
      <label>Limit <input name="limit" type="number" min="1" max="100" value="${esc(f.limit)}" /></label>
      <button class="btn hx-rowbtn" type="submit">Apply</button>
    </form>`;
    return `${filters}<div class="hx-split"><div class="card"><h3>Posts</h3>${show(posts, (data) => {
      const rows = listFrom(data);
      if (!rows) return jsonDetails(data, "Posts payload");
      return postTable(rows);
    })}</div><div class="card"><h3>Analytics</h3>${show(analytics, analyticsHtml)}</div></div>`;
  }

  function composeForm(seed) {
    return `<form class="card stack" id="hx-compose">
      <p class="muted">Save draft does not publish. Schedule and publish each ask again. This form never sends an auto-DM.</p>
      <label>Title (organizer only, not posted)</label>
      <input name="title" maxlength="300" />
      <label>Post</label>
      <textarea name="text" maxlength="25000">${esc(seed || "")}</textarea>
      <label>More thread parts, separated by a line that is only ---</label>
      <textarea name="thread" placeholder="Second part"></textarea>
      <label>Scratchpad (not posted)</label>
      <textarea name="scratchpad"></textarea>
      <label>Tag ids, comma separated</label>
      <input name="tags" placeholder="from Tags" />
      <label>Schedule time (your local clock). Leave empty for a draft.</label>
      <input name="at" type="datetime-local" />
      <div class="row">
        <button class="btn" type="submit">Save draft</button>
        <button class="btn ghost" type="button" id="hx-schedule">Schedule…</button>
        <button class="btn ghost" type="button" id="hx-publish">Publish now…</button>
      </div>
      <div id="hx-compose-out"></div>
    </form>`;
  }

  function partsFromForm(form) {
    const fd = new FormData(form);
    const chunks = [];
    const main = String(fd.get("text") || "").trim();
    if (main) chunks.push(main);
    const extra = String(fd.get("thread") || "").trim();
    if (extra) {
      for (const block of extra.split(/\n---\n/)) {
        const t = block.trim();
        if (t) chunks.push(t);
      }
    }
    return { fd, chunks };
  }

  function composeBody(form, cfg, mode, whenUtc) {
    const { fd, chunks } = partsFromForm(form);
    if (!chunks.length) return { error: "Write a post first." };
    const body = {};
    if (chunks.length === 1) body.text = chunks[0];
    else body.parts = chunks.map((text) => ({ text }));
    const title = String(fd.get("title") || "").trim();
    const scratch = String(fd.get("scratchpad") || "").trim();
    if (title) body.title = title;
    if (scratch) body.scratchpad = scratch;
    const tags = String(fd.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (tags.length) body.tags = tags;
    if (cfg.accountId) body.account_id = cfg.accountId;
    if (mode === "schedule") body.scheduled_for = whenUtc;
    if (mode === "publish") body.scheduled_for = "now";
    return { body };
  }

  function localToUtc(value) {
    if (!value) return { error: "Pick a schedule time." };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { error: "That time is not valid." };
    if (d.getTime() < Date.now() + 60000) return { error: "Schedule at least a minute ahead." };
    return { utc: d.toISOString().replace(/\.\d{3}Z$/, "Z") };
  }

  async function paintScheduled(api, cfg) {
    const f = mem.scheduled;
    const result = await api.call("GET", "/scheduled-posts", {
      query: accountQuery(cfg, { status: f.status, limit: 50, page: f.page })
    });
    noteRate(result);
    const filters = `<form class="hx-filters" id="hx-sch-filters">
      <label>Status <select name="status">
        <option value="draft,scheduled"${f.status === "draft,scheduled" ? " selected" : ""}>Drafts and scheduled</option>
        <option value="draft"${f.status === "draft" ? " selected" : ""}>Drafts</option>
        <option value="scheduled"${f.status === "scheduled" ? " selected" : ""}>Scheduled</option>
        <option value="sent"${f.status === "sent" ? " selected" : ""}>Sent</option>
        <option value="error"${f.status === "error" ? " selected" : ""}>Error</option>
      </select></label>
      <button class="btn hx-rowbtn" type="submit">Apply</button>
    </form>`;
    const table = show(result, (data) => {
      const rows = Array.isArray(data) ? data : (data && (data.posts || data.items || data.scheduled_posts)) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No scheduled posts in this response.</p>`;
      mem.scheduled.rows = rows;
      return `<div class="hx-scroll"><table class="hx-table"><thead><tr><th>Status</th><th>When</th><th>Text</th><th></th></tr></thead><tbody>${
        rows.map((p) => `<tr><td><span class="hx-chip draft">${esc(p.status || "")}</span></td><td>${esc(p.scheduled_for || "—")}</td><td class="hx-text">${esc(clip(textOf(p), 180))}</td><td class="row">
          <button class="btn ghost hx-rowbtn" type="button" data-edit="${esc(p.id)}">Edit</button>
          <button class="btn ghost hx-rowbtn" type="button" data-del="${esc(p.id)}">Delete</button>
        </td></tr>`).join("")
      }</tbody></table></div>`;
    });
    const editing = mem.scheduled.editId ? (mem.scheduled.rows || []).find((p) => String(p.id) === String(mem.scheduled.editId)) : null;
    const editor = editing ? `<form class="card stack" id="hx-sch-edit" style="margin-top:12px">
      <h3>Edit ${esc(editing.id)}</h3>
      <label>Text (full replace)</label>
      <textarea name="text">${esc(textOf(editing))}</textarea>
      <label>Status</label>
      <select name="status">
        <option value="">Leave status</option>
        <option value="draft">Draft</option>
        <option value="scheduled">Scheduled</option>
      </select>
      <label>New time (local). Required to promote a draft.</label>
      <input name="at" type="datetime-local" />
      <button class="btn" type="submit">Save changes</button>
    </form>` : "";
    return `${filters}<div class="card">${table}</div>${editor}<div id="hx-sch-out"></div>`;
  }

  async function paintInspiration(api, cfg) {
    const f = mem.inspiration;
    let result = null;
    if (f.q) {
      result = await api.call("GET", "/inspiration", {
        query: { q: f.q, sort: f.sort, limit: f.limit, page: f.page, lang: "en" }
      });
      noteRate(result);
    }
    const form = `<form class="hx-filters" id="hx-insp">
      <label>Topic <input name="q" value="${esc(f.q)}" placeholder="build in public" /></label>
      <label>Sort <select name="sort">
        ${["relevant", "recent", "likes", "reposts", "impressions", "outlier"].map((s) => `<option value="${s}"${f.sort === s ? " selected" : ""}>${s}</option>`).join("")}
      </select></label>
      <button class="btn hx-rowbtn" type="submit">Search</button>
    </form>`;
    let body = `<p class="muted">Search the local inspiration index. Results are for structure and hooks. Nothing is copied into a live post from here.</p>`;
    if (result) {
      body = show(result, (data) => {
        const rows = Array.isArray(data) ? data : (data && (data.results || data.posts || data.items)) || [];
        if (!Array.isArray(rows)) return jsonDetails(data);
        if (!rows.length) return `<p class="muted">No inspiration rows in this response.</p>`;
        return `<div class="hx-split cols-3">${rows.map((p, i) => `<div class="card"><p class="hx-text">${esc(clip(textOf(p) || p.text, 500))}</p>
          <p class="muted">${esc(p.username ? "@" + p.username : p.author || "")} · outlier ${esc(num(p.outlier_score))} · likes ${esc(num((p.metrics || {}).likes ?? p.likes))}</p>
          <button class="btn ghost hx-rowbtn" type="button" data-seed="${i}">Use in composer</button>
        </div>`).join("")}</div>`;
      });
      if (result.ok) mem.inspiration.rows = Array.isArray(result.data) ? result.data : (result.data && (result.data.results || result.data.posts)) || [];
    }
    return `${form}${body}`;
  }

  async function paintContacts(api, cfg) {
    const f = mem.contacts;
    const [people, lists] = await Promise.all([
      api.call("GET", "/contacts", { query: accountQuery(cfg, { sort: f.sort, limit: f.limit, page: f.page }) }),
      api.call("GET", "/contact-lists", { query: accountQuery(cfg, {}) })
    ]);
    noteRate(people.ok ? people : lists);
    let replies = "";
    if (f.contactId) {
      const hist = await api.call("GET", `/contacts/${encodeURIComponent(f.contactId)}/replies`, {
        query: accountQuery(cfg, { sort: "recent", limit: 20 })
      });
      noteRate(hist);
      replies = `<div class="card" style="margin-top:12px"><h3>Replies from contact ${esc(f.contactId)}</h3>${show(hist, (data) => {
        const rows = Array.isArray(data) ? data : (data && data.replies) || [];
        if (!Array.isArray(rows) || !rows.length) return `<p class="muted">No replies in this response.</p>${jsonDetails(data)}`;
        return rows.map((r) => `<div class="idea"><p class="hx-text">${esc(r.text || "")}</p><p class="muted">${esc(r.created_at || r.posted_at || "")} · likes ${esc(num((r.metrics || {}).likes ?? r.likes))}</p></div>`).join("");
      })}</div>`;
    }
    let members = "";
    if (f.listId) {
      const mems = await api.call("GET", `/contact-lists/${encodeURIComponent(f.listId)}/members`, {
        query: accountQuery(cfg, { limit: 50 })
      });
      noteRate(mems);
      members = show(mems, (data) => {
        const rows = Array.isArray(data) ? data : (data && data.members) || [];
        if (!Array.isArray(rows)) return jsonDetails(data);
        if (!rows.length) return `<p class="muted">No members in this response.</p>`;
        return `<div class="hx-scroll"><table class="hx-table"><thead><tr><th>Handle</th><th>Name</th><th></th></tr></thead><tbody>${
          rows.map((m) => `<tr><td>${esc(m.username || m.handle || "")}</td><td>${esc(m.name || "")}</td><td><button class="btn ghost hx-rowbtn" type="button" data-drop="${esc(m.id)}">Remove</button></td></tr>`).join("")
        }</tbody></table></div>`;
      });
    }
    const peopleHtml = show(people, (data) => peopleTable(Array.isArray(data) ? data : (data && data.contacts) || [], "contact"));
    const listsHtml = show(lists, (data) => {
      const rows = Array.isArray(data) ? data : (data && (data.lists || data.contact_lists)) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No lists in this response.</p>`;
      mem.contacts.lists = rows;
      return `<div class="stack">${rows.map((l) => `<button class="btn ghost" type="button" data-list="${esc(l.id)}" style="justify-content:flex-start">${esc(l.name || l.id)}${l.is_system ? " · system" : ""}</button>`).join("")}</div>`;
    });
    return `<div class="hx-filters"><label>Sort <select id="hx-contact-sort">
      ${["engagement", "replies", "reposts"].map((s) => `<option value="${s}"${f.sort === s ? " selected" : ""}>${s}</option>`).join("")}
    </select></label></div>
    <div class="hx-split"><div class="card"><h3>Contacts</h3>${peopleHtml}${replies}</div>
    <div class="card"><h3>Lists</h3>${listsHtml}
      <form class="stack" id="hx-add-member" style="margin-top:12px">
        <label>Add handle to the open list</label>
        <input name="handle" placeholder="handle without @" />
        <button class="btn" type="submit">Add…</button>
      </form>
      <div style="margin-top:8px">${members}</div>
    </div></div>`;
  }

  async function paintSignals(api, cfg) {
    const [agents, leads] = await Promise.all([
      api.call("GET", "/signals/agents", { query: accountQuery(cfg, {}) }),
      api.call("GET", "/signals/leads", { query: accountQuery(cfg, { limit: 30, page: mem.signals.page }) })
    ]);
    noteRate(agents.ok ? agents : leads);
    const agentHtml = show(agents, (data) => {
      const rows = Array.isArray(data) ? data : (data && data.agents) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No signal agents in this response.</p>`;
      return `<div class="hx-scroll"><table class="hx-table"><thead><tr><th>Name</th><th>Status</th><th class="num">Leads</th><th></th></tr></thead><tbody>${
        rows.map((a) => `<tr><td>${esc(a.name || a.id)}</td><td>${esc(a.status || "")}</td><td class="num">${esc(num(a.lead_count ?? a.leads))}</td><td class="row">
          <button class="btn ghost hx-rowbtn" type="button" data-pause="${esc(a.id)}">Pause</button>
          <button class="btn ghost hx-rowbtn" type="button" data-resume="${esc(a.id)}">Resume</button>
          <button class="btn ghost hx-rowbtn" type="button" data-delagent="${esc(a.id)}">Delete</button>
        </td></tr>`).join("")
      }</tbody></table></div>`;
    });
    const leadHtml = show(leads, (data) => {
      const rows = Array.isArray(data) ? data : (data && data.leads) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No leads in this response. Agents find people over time. This desk does not message them.</p>`;
      return peopleTable(rows.map((l) => ({ ...l, ...(l.profile || {}), icp_score: l.icp_score })), "");
    });
    return `<div class="hx-split"><div class="card"><h3>Agents</h3>${agentHtml}
      <form class="stack" id="hx-new-agent" style="margin-top:12px">
        <h3>New keyword agent</h3>
        <label>Name</label><input name="name" maxlength="80" />
        <label>Who to look for</label><textarea name="icp" maxlength="500"></textarea>
        <label>Keywords, one per line (1–5)</label><textarea name="keywords" placeholder="building in public"></textarea>
        <button class="btn" type="submit">Create agent…</button>
        <p class="muted">Creating an agent only watches and scores. It does not send DMs or replies.</p>
      </form></div>
      <div class="card"><h3>Leads</h3>${leadHtml}</div></div><div id="hx-sig-out"></div>`;
  }

  async function paintEngage(api, cfg) {
    const feeds = await api.call("GET", "/engage/feeds", { query: accountQuery(cfg, {}) });
    noteRate(feeds);
    let posts = "";
    if (mem.engage.feedId) {
      const got = await api.call("GET", `/engage/feeds/${encodeURIComponent(mem.engage.feedId)}/posts`, {
        query: accountQuery(cfg, { limit: 30 })
      });
      noteRate(got);
      posts = `<div class="card" style="margin-top:12px"><h3>Feed posts</h3>${show(got, (data) => {
        const rows = Array.isArray(data) ? data : (data && (data.posts || data.items)) || [];
        if (!Array.isArray(rows)) return jsonDetails(data);
        mem.engage.posts = rows;
        if (!rows.length) return `<p class="muted">No posts in this feed response.</p>`;
        return rows.map((p, i) => `<div class="idea"><p class="hx-text">${esc(clip(textOf(p) || p.text, 400))}</p><p class="muted">${esc(p.username || p.author || "")}</p>
          <button class="btn ghost hx-rowbtn" type="button" data-draft="${i}">Draft a reply (nothing is sent)</button></div>`).join("");
      })}</div>`;
    }
    const received = await api.call("GET", "/replies/received", { query: accountQuery(cfg, { sort: "recent", limit: 20, page: mem.engage.page }) });
    noteRate(received);
    const feedHtml = show(feeds, (data) => {
      const rows = Array.isArray(data) ? data : (data && data.feeds) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No engage feeds in this response.</p>`;
      return `<div class="stack">${rows.map((f) => `<button class="btn ghost" type="button" data-feed="${esc(f.id)}">${esc(f.name || f.id)}</button>`).join("")}</div>`;
    });
    const recvHtml = show(received, (data) => {
      const rows = Array.isArray(data) ? data : (data && data.replies) || [];
      if (!Array.isArray(rows)) return jsonDetails(data);
      if (!rows.length) return `<p class="muted">No received replies in this response.</p>`;
      return rows.map((r) => `<div class="idea"><p class="hx-text">${esc(r.text || "")}</p><p class="muted">${esc((r.author && (r.author.username || r.author.name)) || r.username || "")} · ${esc(r.created_at || "")}</p></div>`).join("");
    });
    return `<div class="hx-split"><div class="card"><h3>Feeds</h3>${feedHtml}
      <form class="stack" id="hx-new-feed" style="margin-top:12px">
        <label>New feed name</label><input name="name" />
        <label>Query</label><input name="query" />
        <button class="btn" type="submit">Create feed…</button>
        <p class="muted">A feed is a reading list. Creating one does not reply or send a DM.</p>
      </form>${posts}</div>
      <div class="card"><h3>Replies received</h3>${recvHtml}<div id="hx-engage-out"></div></div></div>`;
  }

  async function paintOrganize(api, cfg) {
    const tab = mem.organize.tab;
    const tabs = `<div class="row" style="margin-bottom:10px">
      ${["tags", "context", "queue"].map((id) => `<button class="btn ${tab === id ? "" : "ghost"} hx-rowbtn" type="button" data-tab="${id}">${id}</button>`).join("")}
    </div>`;
    if (tab === "tags") {
      const tags = await api.call("GET", "/tags");
      noteRate(tags);
      const list = show(tags, (data) => {
        const rows = Array.isArray(data) ? data : (data && data.tags) || [];
        if (!Array.isArray(rows)) return jsonDetails(data);
        if (!rows.length) return `<p class="muted">No tags in this response.</p>`;
        return `<div class="hx-scroll"><table class="hx-table"><thead><tr><th>Name</th><th>Color</th><th>Id</th><th></th></tr></thead><tbody>${
          rows.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.color || "")}</td><td>${esc(t.id)}</td><td><button class="btn ghost hx-rowbtn" type="button" data-deltag="${esc(t.id)}">Delete</button></td></tr>`).join("")
        }</tbody></table></div>`;
      });
      return `${tabs}<div class="hx-split"><div class="card"><h3>Tags</h3>${list}</div>
        <form class="card stack" id="hx-new-tag"><h3>New tag</h3>
          <label>Name</label><input name="name" maxlength="40" />
          <label>Color</label><select name="color">${TAG_COLORS.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          <button class="btn" type="submit">Create tag</button>
        </form></div><div id="hx-org-out"></div>`;
    }
    if (tab === "context") {
      const ctx = await api.call("GET", "/context", { query: accountQuery(cfg, {}) });
      noteRate(ctx);
      return `${tabs}${show(ctx, (data) => {
        const doc = data || {};
        const profile = doc.profile_description || {};
        const reply = doc.reply || {};
        const voice = doc.voice || {};
        const style = doc.style_guide || {};
        const interests = Array.isArray(doc.interests) ? doc.interests.join(", ") : "";
        const creators = Array.isArray(voice.favorite_creators) ? voice.favorite_creators.join(", ") : "";
        return `<form class="card stack" id="hx-context">
          <p class="muted">Saving replaces the fields you edit and changes how HouseX writes for this account. Confirm comes next.</p>
          <label>Profile description</label><textarea name="profile">${esc(profile.text || "")}</textarea>
          <label class="hx-check"><input type="checkbox" name="profile_on"${profile.enabled ? " checked" : ""} /> Profile description enabled</label>
          <label>Rules</label><textarea name="rules">${esc(doc.rules || "")}</textarea>
          <label>Reply instructions</label><textarea name="reply_rules">${esc(reply.custom_instructions || "")}</textarea>
          <label>Interests, comma separated (replaces the list)</label><input name="interests" value="${esc(interests)}" />
          <label>Favorite creators, comma separated, max 3 (replaces the list)</label><input name="creators" value="${esc(creators)}" />
          <label>Style audience override</label><input name="audience" value="${esc(style.audience_override || "")}" />
          <button class="btn" type="submit">Save context…</button>
          ${style.generated ? `<p class="muted">Generated style guide is read-only here.</p>${jsonDetails(style.generated, "Generated style guide")}` : ""}
        </form>`;
      })}<div id="hx-org-out"></div>`;
    }
    const queue = await api.call("GET", "/queue-settings", { query: accountQuery(cfg, {}) });
    noteRate(queue);
    return `${tabs}${show(queue, (data) => {
      const slots = data && Array.isArray(data.slots) ? JSON.stringify(data.slots, null, 2) : "[]";
      return `<form class="card stack" id="hx-queue">
        <p class="muted">Slots are a full replace. 0 is Sunday. Changing them can move queued posts. Timezone alone does not.</p>
        <label>Timezone</label><input name="timezone" value="${esc((data && data.timezone) || "")}" placeholder="America/Chicago" />
        <label>Slots JSON</label><textarea name="slots">${esc(slots)}</textarea>
        <button class="btn" type="submit">Save queue…</button>
        ${data && data.reflow ? jsonDetails(data.reflow, "Last reflow") : ""}
      </form>`;
    })}<div id="hx-org-out"></div>`;
  }

  function paintSettings(cfg) {
    const prefixWarn = cfg.apiKey && !cfg.apiKey.startsWith("hxk_")
      ? `<p class="warn">HouseX keys usually start with hxk_. The test will still use what you saved.</p>` : "";
    return `<form class="card stack" id="hx-settings" autocomplete="off">
      <p class="muted">The API key stays in localStorage on this browser. Blue Jay’s server only forwards the Authorization header to the loopback HouseX API. It does not write the key to disk.</p>
      <label>API URL</label>
      <input name="apiBase" placeholder="http://127.0.0.1:8787/v1" value="${esc(cfg.apiBase)}" />
      <p class="muted">Leave blank to use the server default (HOUSEX_API_URL, or http://127.0.0.1:8787/v1). Any URL you set must be loopback HTTP. The browser calls Blue Jay at /api/housex so the key is not blocked by CORS.</p>
      <label>API key</label>
      <input name="apiKey" type="password" autocomplete="off" value="${esc(cfg.apiKey)}" placeholder="hxk_…" />
      ${prefixWarn}
      <div class="row">
        <button class="btn" type="submit">Save</button>
        <button class="btn ghost" type="button" id="hx-test">Test connection</button>
        <button class="btn ghost" type="button" id="hx-forget">Forget key</button>
      </div>
      <div id="hx-set-out"></div>
    </form>`;
  }

  async function paint(screen, cfg) {
    if (screen === "settings") return paintSettings(cfg);
    if (!hasKey(cfg)) return needKey();
    const api = await makeClient(cfg);
    if (screen === "overview") return paintOverview(api, cfg);
    if (screen === "posts") return paintPosts(api, cfg);
    if (screen === "compose") {
      let seed = "";
      try {
        seed = sessionStorage.getItem(DRAFT_KEY) || "";
        sessionStorage.removeItem(DRAFT_KEY);
      } catch { /* ignore */ }
      return composeForm(seed);
    }
    if (screen === "scheduled") return paintScheduled(api, cfg);
    if (screen === "inspiration") return paintInspiration(api, cfg);
    if (screen === "contacts") return paintContacts(api, cfg);
    if (screen === "signals") return paintSignals(api, cfg);
    if (screen === "engage") return paintEngage(api, cfg);
    if (screen === "organize") return paintOrganize(api, cfg);
    return paintOverview(api, cfg);
  }

  function ask(host, inner) {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.className = "card hx-confirm";
      box.innerHTML = `${inner}<div class="row" style="margin-top:10px"><button type="button" class="btn" data-yes>Confirm</button><button type="button" class="btn ghost" data-no>Cancel</button></div>`;
      host.prepend(box);
      box.querySelector("[data-yes]").onclick = () => {
        const ack = box.querySelector("[data-ack]");
        if (ack && !ack.checked) {
          let n = box.querySelector(".hx-acknote");
          if (!n) {
            n = document.createElement("p");
            n.className = "warn hx-acknote";
            box.querySelector(".row").before(n);
          }
          n.textContent = "Check the box to confirm.";
          return;
        }
        box.remove();
        resolve(true);
      };
      box.querySelector("[data-no]").onclick = () => { box.remove(); resolve(false); };
    });
  }

  function bind(el, screen) {
    const cfg = loadCfg();
    const refresh = el.querySelector("#hx-refresh");
    if (refresh) refresh.onclick = () => {
      cache.accountsAt = 0;
      window.renderHouseX(el);
    };
    fillAccounts(el, cfg);
    if (hasKey(cfg)) {
      makeClient(cfg).then((api) => loadAccounts(api)).then(() => {
        if (el.isConnected) fillAccounts(el, loadCfg());
      }).catch(() => {});
    }

    if (screen === "posts") {
      const form = el.querySelector("#hx-post-filters");
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        mem.posts.type = String(fd.get("type") || "posts");
        mem.posts.sort = String(fd.get("sort") || "posted_at");
        mem.posts.limit = Math.min(100, Math.max(1, Number(fd.get("limit")) || 25));
        window.renderHouseX(el);
      };
    }

    if (screen === "compose") {
      const form = el.querySelector("#hx-compose");
      const slot = el.querySelector("#hx-compose-out");
      async function send(mode) {
        const built = composeBody(form, loadCfg(), mode, mode === "schedule" ? mem.composeUtc : null);
        if (built.error) {
          slot.innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: built.error });
          return;
        }
        const api = await makeClient(loadCfg());
        const idem = mode === "publish" ? (mem.publishKey || (mem.publishKey = `hx-pub-${crypto.randomUUID()}`)) : `hx-${mode}-${crypto.randomUUID()}`;
        const result = await api.call("POST", "/scheduled-posts", { body: built.body, idempotencyKey: idem });
        noteRate(result);
        slot.innerHTML = show(result, (data) => `<p class="ok">${mode === "draft" ? "Draft saved. Nothing was published." : mode === "schedule" ? "Scheduled. It stays queued until that time." : "Publish request returned."}</p>${jsonDetails(data)}`);
        if (mode === "publish" && result.ok) mem.publishKey = "";
      }
      form.onsubmit = (e) => { e.preventDefault(); send("draft"); };
      el.querySelector("#hx-schedule").onclick = async () => {
        const preview = composeBody(form, loadCfg(), "draft");
        if (preview.error) {
          slot.innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: preview.error });
          return;
        }
        const when = localToUtc(new FormData(form).get("at"));
        if (when.error) {
          slot.innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: when.error });
          return;
        }
        mem.composeUtc = when.utc;
        const yes = await ask(form, `<p>Schedule this for <b>${esc(when.utc)}</b>? It will not go out until then. No DM is attached.</p>`);
        if (!yes) return;
        send("schedule");
      };
      el.querySelector("#hx-publish").onclick = async () => {
        const preview = composeBody(form, loadCfg(), "draft");
        if (preview.error) {
          slot.innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: preview.error });
          return;
        }
        const yes = await ask(form, `<p>Publish this to X now through HouseX? This is immediate.</p><label class="hx-check"><input type="checkbox" data-ack /> I confirmed the text and want it published now.</label>`);
        if (!yes) return;
        mem.publishKey = mem.publishKey || `hx-pub-${crypto.randomUUID()}`;
        send("publish");
      };
    }

    if (screen === "scheduled") {
      const form = el.querySelector("#hx-sch-filters");
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        mem.scheduled.status = String(new FormData(form).get("status") || "draft,scheduled");
        mem.scheduled.editId = "";
        window.renderHouseX(el);
      };
      el.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.onclick = () => { mem.scheduled.editId = btn.getAttribute("data-edit"); window.renderHouseX(el); };
      });
      el.querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-del");
          const yes = await ask(el.querySelector("#hx-body"), `<p>Delete scheduled post ${esc(id)}? This does not send it.</p>`);
          if (!yes) return;
          const api = await makeClient(loadCfg());
          const result = await api.call("DELETE", `/scheduled-posts/${encodeURIComponent(id)}`);
          const slot = el.querySelector("#hx-sch-out");
          if (slot) slot.innerHTML = show(result, () => `<p class="ok">Deleted.</p>`);
          if (result.ok) { mem.scheduled.editId = ""; window.renderHouseX(el); }
        };
      });
      const edit = el.querySelector("#hx-sch-edit");
      if (edit) edit.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(edit);
        const body = {};
        const text = String(fd.get("text") || "");
        if (text.trim()) body.text = text;
        const status = String(fd.get("status") || "");
        const at = String(fd.get("at") || "");
        if (status) body.status = status;
        if (at) {
          const when = localToUtc(at);
          if (when.error) {
            el.querySelector("#hx-sch-out").innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: when.error });
            return;
          }
          body.scheduled_for = when.utc;
        }
        if (status === "scheduled" || body.scheduled_for) {
          const yes = await ask(edit, `<p>Apply this as a scheduled post${body.scheduled_for ? " at " + esc(body.scheduled_for) : ""}? Drafts do not publish until you confirm a schedule.</p>`);
          if (!yes) return;
        }
        const current = loadCfg();
        if (current.accountId) body.account_id = current.accountId;
        const api = await makeClient(current);
        const result = await api.call("PATCH", `/scheduled-posts/${encodeURIComponent(mem.scheduled.editId)}`, { body });
        el.querySelector("#hx-sch-out").innerHTML = show(result, (data) => `<p class="ok">Saved.</p>${jsonDetails(data)}`);
        if (result.ok) window.renderHouseX(el);
      };
    }

    if (screen === "inspiration") {
      const form = el.querySelector("#hx-insp");
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        mem.inspiration.q = String(fd.get("q") || "").trim();
        mem.inspiration.sort = String(fd.get("sort") || "relevant");
        window.renderHouseX(el);
      };
      el.querySelectorAll("[data-seed]").forEach((btn) => {
        btn.onclick = () => {
          const row = (mem.inspiration.rows || [])[Number(btn.getAttribute("data-seed"))];
          const text = textOf(row) || (row && row.text) || "";
          try { sessionStorage.setItem(DRAFT_KEY, text); } catch { /* ignore */ }
          location.hash = "#/housex/compose";
        };
      });
    }

    if (screen === "contacts") {
      const sort = el.querySelector("#hx-contact-sort");
      if (sort) sort.onchange = () => { mem.contacts.sort = sort.value; window.renderHouseX(el); };
      el.querySelectorAll("[data-contact]").forEach((btn) => {
        btn.onclick = () => { mem.contacts.contactId = btn.getAttribute("data-contact"); window.renderHouseX(el); };
      });
      el.querySelectorAll("[data-list]").forEach((btn) => {
        btn.onclick = () => { mem.contacts.listId = btn.getAttribute("data-list"); window.renderHouseX(el); };
      });
      const add = el.querySelector("#hx-add-member");
      if (add) add.onsubmit = async (e) => {
        e.preventDefault();
        const handle = String(new FormData(add).get("handle") || "").trim().replace(/^@/, "");
        if (!mem.contacts.listId || !handle) return;
        const list = (mem.contacts.lists || []).find((l) => String(l.id) === String(mem.contacts.listId));
        if (list && list.is_system) {
          add.insertAdjacentHTML("beforebegin", errBanner({ kind: "error", status: 400, code: "system_list_read_only", message: "System lists are read-only." }));
          return;
        }
        const yes = await ask(add, `<p>Add @${esc(handle)} to this list? This does not message them.</p>`);
        if (!yes) return;
        const api = await makeClient(loadCfg());
        const result = await api.call("POST", `/contact-lists/${encodeURIComponent(mem.contacts.listId)}/members`, {
          body: { handle, ...(loadCfg().accountId ? { account_id: loadCfg().accountId } : {}) }
        });
        add.insertAdjacentHTML("beforebegin", show(result, (data) => `<p class="ok">${data && data.duplicate ? "Already on the list." : "Added."}</p>`));
        if (result.ok) window.renderHouseX(el);
      };
      el.querySelectorAll("[data-drop]").forEach((btn) => {
        btn.onclick = async () => {
          const memberId = btn.getAttribute("data-drop");
          const yes = await ask(el.querySelector("#hx-body"), `<p>Remove this person from the list? This does not message them.</p>`);
          if (!yes) return;
          const api = await makeClient(loadCfg());
          const result = await api.call("DELETE", `/contact-lists/${encodeURIComponent(mem.contacts.listId)}/members/${encodeURIComponent(memberId)}`);
          const slot = el.querySelector("#hx-body");
          if (result.kind === "not_implemented") slot.insertAdjacentHTML("afterbegin", stubBanner(result));
          else if (!result.ok) slot.insertAdjacentHTML("afterbegin", errBanner(result));
          if (result.ok) window.renderHouseX(el);
        };
      });
    }

    if (screen === "signals") {
      const form = el.querySelector("#hx-new-agent");
      if (form) form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        const icp = String(fd.get("icp") || "").trim();
        const keywords = String(fd.get("keywords") || "").split(/\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
        if (!name || !icp) return;
        const yes = await ask(form, `<p>Create signal agent “${esc(name)}”? It watches and scores only. Blue Jay will not send DMs.</p>`);
        if (!yes) return;
        const body = { name, icp_description: icp };
        if (keywords.length) body.keywords = keywords;
        if (loadCfg().accountId) body.account_id = loadCfg().accountId;
        const api = await makeClient(loadCfg());
        const result = await api.call("POST", "/signals/agents", { body, idempotencyKey: `hx-agent-${crypto.randomUUID()}` });
        el.querySelector("#hx-sig-out").innerHTML = show(result, (data) => `<p class="ok">Agent created. Leads show up later. Nobody was messaged.</p>${jsonDetails(data)}`);
        if (result.ok) window.renderHouseX(el);
      };
      async function patchAgent(id, status) {
        const yes = await ask(el.querySelector("#hx-body"), `<p>${status === "paused" ? "Pause" : "Resume"} agent ${esc(id)}? This does not send messages.</p>`);
        if (!yes) return;
        const api = await makeClient(loadCfg());
        const result = await api.call("PATCH", `/signals/agents/${encodeURIComponent(id)}`, { body: { status } });
        el.querySelector("#hx-sig-out").innerHTML = show(result, () => `<p class="ok">Updated.</p>`);
        if (result.ok) window.renderHouseX(el);
      }
      el.querySelectorAll("[data-pause]").forEach((btn) => { btn.onclick = () => patchAgent(btn.getAttribute("data-pause"), "paused"); });
      el.querySelectorAll("[data-resume]").forEach((btn) => { btn.onclick = () => patchAgent(btn.getAttribute("data-resume"), "active"); });
      el.querySelectorAll("[data-delagent]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-delagent");
          const yes = await ask(el.querySelector("#hx-body"), `<p>Delete agent ${esc(id)}? Saved leads stay. Nothing is messaged.</p>`);
          if (!yes) return;
          const api = await makeClient(loadCfg());
          const result = await api.call("DELETE", `/signals/agents/${encodeURIComponent(id)}`);
          el.querySelector("#hx-sig-out").innerHTML = show(result, () => `<p class="ok">Deleted.</p>`);
          if (result.ok) window.renderHouseX(el);
        };
      });
    }

    if (screen === "engage") {
      el.querySelectorAll("[data-feed]").forEach((btn) => {
        btn.onclick = () => { mem.engage.feedId = btn.getAttribute("data-feed"); window.renderHouseX(el); };
      });
      const form = el.querySelector("#hx-new-feed");
      if (form) form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        const query = String(fd.get("query") || "").trim();
        if (!name) return;
        const yes = await ask(form, `<p>Create engage feed “${esc(name)}”? It does not reply or send DMs.</p>`);
        if (!yes) return;
        const body = { name };
        if (query) body.query = query;
        if (loadCfg().accountId) body.account_id = loadCfg().accountId;
        const api = await makeClient(loadCfg());
        const result = await api.call("POST", "/engage/feeds", { body });
        el.querySelector("#hx-engage-out").innerHTML = show(result, (data) => `<p class="ok">Feed saved.</p>${jsonDetails(data)}`);
        if (result.ok) window.renderHouseX(el);
      };
      el.querySelectorAll("[data-draft]").forEach((btn) => {
        btn.onclick = async () => {
          const row = (mem.engage.posts || [])[Number(btn.getAttribute("data-draft"))] || {};
          const api = await makeClient(loadCfg());
          const result = await api.call("POST", "/engage/reply-draft", {
            body: {
              text: textOf(row) || row.text || "",
              post_url: row.url || row.post_url || undefined,
              ...(loadCfg().accountId ? { account_id: loadCfg().accountId } : {})
            }
          });
          const slot = el.querySelector("#hx-engage-out");
          slot.innerHTML = show(result, (data) => {
            const draft = (data && (data.text || data.draft || data.reply)) || "";
            return `<p class="ok">Reply draft only. Nothing was sent.</p><div class="idea hx-text">${esc(typeof draft === "string" ? draft : JSON.stringify(draft))}</div>`;
          });
        };
      });
    }

    if (screen === "organize") {
      el.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.onclick = () => { mem.organize.tab = btn.getAttribute("data-tab"); window.renderHouseX(el); };
      });
      const tagForm = el.querySelector("#hx-new-tag");
      if (tagForm) tagForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(tagForm);
        const api = await makeClient(loadCfg());
        const result = await api.call("POST", "/tags", { body: { name: String(fd.get("name") || "").trim(), color: String(fd.get("color") || "slate") } });
        el.querySelector("#hx-org-out").innerHTML = show(result, () => `<p class="ok">Tag created.</p>`);
        if (result.ok) window.renderHouseX(el);
      };
      el.querySelectorAll("[data-deltag]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-deltag");
          const yes = await ask(el.querySelector("#hx-body"), `<p>Delete tag ${esc(id)}? It comes off every post. Nothing is published.</p>`);
          if (!yes) return;
          const api = await makeClient(loadCfg());
          const result = await api.call("DELETE", `/tags/${encodeURIComponent(id)}`);
          el.querySelector("#hx-org-out").innerHTML = show(result, () => `<p class="ok">Tag deleted.</p>`);
          if (result.ok) window.renderHouseX(el);
        };
      });
      const ctx = el.querySelector("#hx-context");
      if (ctx) ctx.onsubmit = async (e) => {
        e.preventDefault();
        const yes = await ask(ctx, `<p>Save context settings? This changes how HouseX writes for the account.</p>`);
        if (!yes) return;
        const fd = new FormData(ctx);
        const interests = String(fd.get("interests") || "").split(",").map((s) => s.trim()).filter(Boolean);
        const creators = String(fd.get("creators") || "").split(",").map((s) => s.trim()).filter(Boolean);
        const body = {
          profile_description: { text: String(fd.get("profile") || ""), enabled: Boolean(ctx.querySelector("[name=profile_on]").checked) },
          rules: String(fd.get("rules") || ""),
          reply: { custom_instructions: String(fd.get("reply_rules") || "") },
          interests,
          voice: { favorite_creators: creators },
          style_guide: { audience_override: String(fd.get("audience") || "") || null }
        };
        if (loadCfg().accountId) body.account_id = loadCfg().accountId;
        const api = await makeClient(loadCfg());
        const result = await api.call("PATCH", "/context", { body });
        el.querySelector("#hx-org-out").innerHTML = show(result, () => `<p class="ok">Context saved.</p>`);
      };
      const queue = el.querySelector("#hx-queue");
      if (queue) queue.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(queue);
        let slots;
        try { slots = JSON.parse(String(fd.get("slots") || "[]")); }
        catch { el.querySelector("#hx-org-out").innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: "Slots JSON is not valid." }); return; }
        if (!Array.isArray(slots)) {
          el.querySelector("#hx-org-out").innerHTML = errBanner({ kind: "error", status: 400, code: "invalid_parameter", message: "Slots must be a JSON array." });
          return;
        }
        const yes = await ask(queue, `<p>Replace queue slots? Posts sitting on old slots may move. No post is published by this save.</p>`);
        if (!yes) return;
        const body = { slots, timezone: String(fd.get("timezone") || "").trim() || undefined };
        if (loadCfg().accountId) body.account_id = loadCfg().accountId;
        const api = await makeClient(loadCfg());
        const result = await api.call("PATCH", "/queue-settings", { body });
        el.querySelector("#hx-org-out").innerHTML = show(result, (data) => `<p class="ok">Queue saved.</p>${data && data.reflow ? jsonDetails(data.reflow, "Reflow") : ""}`);
      };
    }

    if (screen === "settings") {
      const form = el.querySelector("#hx-settings");
      const slot = el.querySelector("#hx-set-out");
      function readForm() {
        const fd = new FormData(form);
        return {
          apiBase: String(fd.get("apiBase") || "").trim(),
          apiKey: String(fd.get("apiKey") || "").trim(),
          accountId: loadCfg().accountId
        };
      }
      form.onsubmit = (e) => {
        e.preventDefault();
        saveCfg(readForm());
        cache.accountsAt = 0;
        slot.innerHTML = `<p class="ok">Saved in this browser only.</p>`;
      };
      el.querySelector("#hx-forget").onclick = () => {
        const next = loadCfg();
        next.apiKey = "";
        saveCfg(next);
        cache.accounts = null;
        window.renderHouseX(el);
      };
      el.querySelector("#hx-test").onclick = async () => {
        const next = readForm();
        saveCfg(next);
        cache.accountsAt = 0;
        if (!next.apiKey) {
          slot.innerHTML = needKey();
          return;
        }
        slot.innerHTML = `<p class="muted">Calling /me…</p>`;
        const api = await makeClient(next);
        const result = await api.call("GET", "/me");
        noteRate(result);
        const where = result.upstream ? `<p class="muted">Upstream ${esc(result.upstream)}</p>` : "";
        slot.innerHTML = show(result, (data) => `<p class="ok">Connected.</p>${where}${kv(data)}`) + (result.ok ? "" : where);
        fillAccounts(el, next);
      };
    }
  }

  window.renderHouseX = async function (el) {
    if (!el) return;
    const gen = ++paintGen;
    const screen = screenFromHash();
    const cfg = loadCfg();
    document.body.classList.add("hx-mode");
    el.innerHTML = frame(screen, `<p class="muted">Loading HouseX…</p>`, cfg);
    let body = "";
    try {
      const mod = await import("/housex-client.mjs");
      listFrom = mod.listFromHousex;
      body = await paint(screen, cfg);
    } catch (err) {
      body = errBanner({ kind: "unreachable", status: 0, code: "network_error", message: String(err && err.message ? err.message : err) });
    }
    if (gen !== paintGen) return;
    const slot = el.querySelector("#hx-body");
    if (slot) slot.innerHTML = body;
    bind(el, screen);
  };
})();
