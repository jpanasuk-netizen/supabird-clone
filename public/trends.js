// Blue Jay "Trends" tab: reads X Trends Desk (127.0.0.1:3489) through /api/trends/summary.
// Buttons only save local drafts or open the composer. Nothing posts from here; the composer's confirm gate stays.
(function () {
  const DESK = "http://localhost:3489";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CT = (t) => (t ? new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : "");
  const shortUrl = (u) => { const m = String(u).match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status/); return m ? "@" + m[1] + " on X" : String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/[/?#].*$/, ""); };
  const lk = (u, t) => `<a class="bjt-lnk" href="${esc(u)}" target="_blank" rel="noopener">${esc(t || shortUrl(u))}</a>`;
  let D = null;

  function css() {
    if (document.getElementById("bjt-css")) return;
    const s = document.createElement("style");
    s.id = "bjt-css";
    s.textContent = `
.bjt-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.bjt-top h1{margin:0 8px 0 0}
.bjt-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px}
.bjt-col h3{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.bjt-col h3 small{color:var(--muted);font-weight:400;font-size:12px}
.bjt-tr{border-top:1px solid var(--line);padding:10px 0}.bjt-tr:first-of-type{border-top:0}
.bjt-tr b.t{font-size:15px}.bjt-rank{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#231b3d;color:#d8b4fe;font-size:12px;font-weight:700;margin-right:6px}
.bjt-tag{font-size:10.5px;font-weight:700;letter-spacing:.5px;padding:1px 7px;border-radius:999px;margin-left:6px;vertical-align:2px}
.bjt-tag.NEW{background:#34d39922;color:#34d399;border:1px solid #34d39966}.bjt-tag.RISING{background:#fbbf2422;color:#fbbf24;border:1px solid #fbbf2466}.bjt-tag.FADING{background:#93a0c41a;color:#93a0c4;border:1px solid #93a0c455}
.bjt-why{color:var(--muted);font-size:14px;margin:4px 0}.bjt-lnk{display:inline-block;font-size:12px;padding:0 8px;margin:2px 4px 2px 0;border-radius:999px;background:#6366f11f;border:1px solid #6366f155;color:#c7d2fe}
.bjt-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.bjt-acts .btn{padding:5px 12px;font-size:13px}
.bjt-fade{margin-top:8px;color:var(--muted);font-size:13px}.bjt-fade summary{cursor:pointer}
.bjt-rp{margin-top:18px}.bjt-posts{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:10px;margin-top:8px}
.bjt-post{border:1px solid var(--line);border-radius:12px;padding:10px;background:#12162a}
.bjt-q{margin:6px 0;padding:6px 10px;border-left:3px solid var(--purple);background:#a855f70f;border-radius:0 8px 8px 0;white-space:pre-wrap;font-size:14px}
.bjt-by{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:4px;white-space:normal}
#bjt-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,var(--blue),var(--purple));color:#fff;padding:8px 16px;border-radius:999px;font-weight:600;display:none;z-index:50}`;
    document.head.appendChild(s);
  }
  function toast(m) {
    let t = document.getElementById("bjt-toast");
    if (!t) { t = document.createElement("div"); t.id = "bjt-toast"; document.body.appendChild(t); }
    t.textContent = m; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = "none"), 2200);
  }
  async function saveDraft(text, extra) {
    try {
      const r = await fetch("/api/x/drafts", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ localId: "trends-" + Date.now(), text, at: new Date().toISOString(), source: "trends-desk" }, extra || {})) });
      const j = await r.json();
      toast(j.ok ? "Saved as a draft (not posted)" : j.error || "Could not save");
    } catch (e) { toast(String(e.message || e)); }
  }
  const compose = (t) => (window.openCompose ? window.openCompose(t) : toast("Composer not loaded"));

  function trendText(tr) { return (tr.idea || tr.title).trim(); }
  function replyText(e, x) { return "Re: " + e.trend + "\n\nReply target: " + x.url; }

  function draw(el) {
    const cols = D.columns || [], reps = D.replies || [];
    el.innerHTML = `
      <div class="bjt-top"><h1>Trends</h1><span class="pill">from X Trends Desk · nothing posts from here</span>
        <button class="btn ghost" type="button" data-act="refresh">Refresh</button>
        <a class="btn ghost" href="${DESK}" target="_blank" rel="noopener">Open X Trends Desk</a>
        <span class="muted" style="font-size:12px">Updated ${CT(D.generated)}</span></div>
      <div class="bjt-cols">${cols.map((c, ci) => `
        <div class="card bjt-col"><h3>${esc(c.name)} <small>${c.latest ? CT(c.latest.t) + (c.basis ? " · vs " + esc(c.basis) : "") : "not run yet"}</small></h3>
        ${c.trends.slice(0, 5).map((tr, ti) => `<div class="bjt-tr"><b class="t"><span class="bjt-rank">${tr.rank}</span>${esc(tr.title)}</b>${tr.tag && tr.tag !== "STEADY" ? `<span class="bjt-tag ${tr.tag}">${tr.tag}</span>` : ""}
          ${tr.why ? `<p class="bjt-why">${esc(tr.why)}</p>` : ""}${tr.idea ? `<p class="bjt-why"><b>Idea:</b> ${esc(tr.idea)}</p>` : ""}
          <div>${(tr.links || []).slice(0, 4).map((u) => lk(u)).join("")}</div>
          <div class="bjt-acts"><button class="btn" type="button" data-act="draft" data-c="${ci}" data-t="${ti}">Save as draft</button><button class="btn ghost" type="button" data-act="compose" data-c="${ci}" data-t="${ti}">Open in composer</button></div></div>`).join("") || `<p class="muted">No report yet.</p>`}
        ${c.fading && c.fading.length ? `<details class="bjt-fade"><summary>Fading (${c.fading.length})</summary><ul style="margin:6px 0 0 18px">${c.fading.map((f) => `<li>${esc(f.title)} · #${f.was}${f.now ? " → #" + f.now : " → gone"}</li>`).join("")}</ul></details>` : ""}
        </div>`).join("")}</div>
      <div class="card bjt-rp"><h3>Replies</h3><p class="muted" style="font-size:13px">Real replies found by X Trends Desk (Grok X search), quoted verbatim. Open the links to confirm.</p>
      ${reps.length ? reps.map((e, ei) => `<div style="margin-top:14px"><b>${esc(e.trend)}</b> <span class="muted" style="font-size:12px">${CT(e.ts)}${e.status === "running" ? " · searching…" : ""}</span>
        ${e.status === "error" ? `<p class="warn">${esc(e.error)}</p>` : ""}
        ${e.status === "done" ? (e.posts.length ? `<div class="bjt-posts">${e.posts.map((p, pi) => `<div class="bjt-post"><div class="bjt-by">Original post ${lk(p.url, p.author)} ${esc(p.engagement)}</div>${p.text ? `<p style="font-size:13px;margin:4px 0">${esc(p.text)}</p>` : ""}
          ${p.replies.length ? p.replies.map((x, xi) => `<div class="bjt-q">${esc(x.text)}<div class="bjt-by">${lk(x.url, x.author)} ${esc(x.engagement)}
            <button class="btn ghost" style="padding:3px 10px;font-size:12px" type="button" data-act="rdraft" data-e="${ei}" data-p="${pi}" data-x="${xi}">Save reply draft</button>
            <button class="btn ghost" style="padding:3px 10px;font-size:12px" type="button" data-act="rcompose" data-e="${ei}" data-p="${pi}" data-x="${xi}">Open in composer</button></div></div>`).join("") : `<p class="muted">No replies found.</p>`}</div>`).join("")}</div>` : `<p class="muted">No replies found.</p>`) : ""}</div>`).join("") : `<p class="muted">No reply searches yet. Use “Get replies” on a trend in X Trends Desk.</p>`}</div>`;
    el.onclick = (ev) => {
      const b = ev.target.closest("[data-act]"); if (!b) return;
      const a = b.dataset.act;
      if (a === "refresh") return window.renderBlueJayTrends(el);
      if (a === "draft" || a === "compose") {
        const c = cols[+b.dataset.c], tr = c.trends[+b.dataset.t];
        return a === "draft" ? saveDraft(trendText(tr), { trend: tr.title, topic: c.id }) : compose(trendText(tr));
      }
      const e = reps[+b.dataset.e], p = e.posts[+b.dataset.p], x = p.replies[+b.dataset.x];
      if (a === "rdraft") return saveDraft(replyText(e, x), { trend: e.trend, topic: e.topic, replyTo: x.url, replyToAuthor: x.author, replyToText: x.text });
      if (a === "rcompose") return compose(replyText(e, x));
    };
  }

  window.renderBlueJayTrends = async function (el) {
    css();
    try {
      const r = await fetch("/api/trends/summary");
      D = await r.json();
      if (!D.ok) throw new Error(D.error || "offline");
    } catch (e) {
      el.innerHTML = `<h1>Trends</h1><p class="warn" style="margin-top:12px">X Trends Desk offline. Start it from the X Trends Desk desktop icon, then <a href="#/trends" onclick="location.reload()">refresh</a>.</p>`;
      return;
    }
    draw(el);
  };
})();
