/* Full X composer surface. No tool is disabled, hidden, or stubbed. */
(function () {
  const LONG = 25000;
  const EMOJI = ["😀","😁","😂","🤣","😅","😊","😍","🤩","😘","😉","😎","🤔","🙄","😴","🥳","👍","👎","👏","🔥","💯","✨","❤️","🧡","💛","💚","💙","💜","⭐","⚡","🎉","🌈","☀️","🌙","🍕","☕","🧠","📈","🚀","📎","🔗","✅","❌","📌"];
  const MENTIONS = ["Jasper_Black", "the_machine_room_now", "Premium", "x"];
  const TAGS = ["buildinpublic", "ai", "saas", "ship", "lab"];

  const BOLD = mapRange(0x1D400, "A", "Z", 0x1D41A, "a", "z");
  const ITAL = mapRange(0x1D434, "A", "Z", 0x1D44E, "a", "z");

  function mapRange(uA, a, z, la, aa, zz) {
    const m = {};
    for (let i = 0; i < 26; i++) {
      m[String.fromCharCode(a.charCodeAt(0) + i)] = String.fromCodePoint(uA + i);
      m[String.fromCharCode(aa.charCodeAt(0) + i)] = String.fromCodePoint(la + i);
    }
    return m;
  }

  function applyMap(s, map) {
    return [...s].map((ch) => map[ch] || ch).join("");
  }
  function strike(s) {
    return [...s].map((ch) => ch + "\u0336").join("");
  }

  function xCount(text) {
    const url = /https?:\/\/[^\s]+/gi;
    let n = 0;
    const stripped = String(text || "").replace(url, () => {
      n += 23;
      return " ";
    });
    for (const ch of stripped) {
      const cp = ch.codePointAt(0);
      n += cp > 0x1100 && cp < 0x3000 || cp >= 0x1f300 ? 2 : 1;
    }
    return n;
  }

  function bakeCrop(m) {
    if (!m || m.kind === "video" || !m.dataUrl || !m.crop) return Promise.resolve();
    const { z, x, y } = m.crop;
    if (Number(z) === 1 && !Number(x) && !Number(y)) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const w = Math.max(1, img.width / z);
        const h = Math.max(1, img.height / z);
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        const ox = (img.width - w) / 2 + (x / 50) * (img.width - w) / 2;
        const oy = (img.height - h) / 2 + (y / 50) * (img.height - h) / 2;
        ctx.drawImage(img, ox, oy, w, h, 0, 0, w, h);
        m.dataUrl = c.toDataURL("image/jpeg", 0.92);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = m.dataUrl;
    });
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function blankPost(text) {
    return {
      id: uid(),
      text: text || "",
      media: [],
      pollOn: false,
      pollOptions: ["", "", "", ""],
      pollMinutes: 1440,
      gifQuery: "",
      gifUrl: "",
      mediaTitle: "",
      mediaDescription: ""
    };
  }

  window.openCompose = function (text) {
    sessionStorage.setItem("supabird-compose", text || "");
    location.hash = "#/compose";
  };

  window.mountComposer = function (host, opts) {
    const generate = opts.generate;
    const seed = sessionStorage.getItem("supabird-compose") || (opts.initialText || "");
    sessionStorage.removeItem("supabird-compose");
    const draftsKey = "supabird-x-drafts";
    let thread = [blankPost(seed)];
    let replySettings = "everyone";
    let scheduleAt = "";
    let communityId = "";
    let placeId = "";
    let locationLabel = "";
    let quoteId = "";
    let dmLink = "";
    let inReplyTo = "";
    let taggedUserIds = "";
    let sensitive = false;
    let madeWithAi = false;
    let subscribersOnly = false;
    let shareWithFollowers = false;
    let paidPartnership = false;
    let showEmoji = false;
    let showCrop = null;
    let showPick = null;
    let showDrafts = false;
    let activeI = 0;
    let sel = { i: 0, start: 0, end: 0 };
    let xStatus = { signedIn: false, username: "", hasClientId: false };

    function applyDraft(d) {
      if (!d) { note("No drafts.", true); return; }
      thread = (d.thread || []).map((p) => ({ ...blankPost(""), ...p }));
      if (!thread.length) thread = [blankPost("")];
      replySettings = d.replySettings || "everyone";
      scheduleAt = d.scheduleAt || "";
      communityId = d.communityId || "";
      placeId = d.placeId || "";
      locationLabel = d.locationLabel || "";
      quoteId = d.quoteId || "";
      dmLink = d.dmLink || "";
      inReplyTo = d.inReplyTo || "";
      taggedUserIds = Array.isArray(d.taggedUserIds) ? d.taggedUserIds.join(" ") : (d.taggedUserIds || "");
      sensitive = !!d.sensitive;
      madeWithAi = !!d.madeWithAi;
      subscribersOnly = !!d.subscribersOnly;
      shareWithFollowers = !!d.shareWithFollowers;
      paidPartnership = !!d.paidPartnership;
      showDrafts = false;
      paint();
      note("Loaded draft.");
    }

    function drafts() {
      try { return JSON.parse(localStorage.getItem(draftsKey) || "[]"); } catch { return []; }
    }
    function saveDrafts(list) {
      localStorage.setItem(draftsKey, JSON.stringify(list));
    }

    function gather() {
      return {
        replySettings,
        scheduleAt,
        communityId,
        placeId,
        locationLabel,
        quoteId,
        dmLink,
        inReplyTo,
        taggedUserIds: taggedUserIds.split(/[\s,]+/).filter(Boolean),
        sensitive,
        madeWithAi,
        subscribersOnly,
        shareWithFollowers,
        paidPartnership,
        thread: thread.map((p) => ({
          text: p.text,
          pollOn: p.pollOn || (p.pollOptions || []).filter(Boolean).length >= 2,
          pollOptions: p.pollOptions,
          pollMinutes: p.pollMinutes,
          gifQuery: p.gifQuery,
          gifUrl: p.gifUrl,
          mediaTitle: p.mediaTitle,
          mediaDescription: p.mediaDescription,
          altTexts: p.media.map((m) => m.alt || ""),
          crop: p.media.map((m) => m.crop || null),
          media: p.media.map((m) => ({ name: m.name, kind: m.kind, alt: m.alt, dataUrl: m.dataUrl, crop: m.crop }))
        }))
      };
    }

    function applyFmt(which) {
      const idx = sel.i;
      const start = sel.start;
      const end = sel.end;
      const cur = thread[idx].text;
      const slice = start === end ? cur : cur.slice(start, end);
      const out = which === "b" ? applyMap(slice, BOLD) : which === "i" ? applyMap(slice, ITAL) : which === "s" ? strike(slice) : slice;
      thread[idx].text = start === end ? out : cur.slice(0, start) + out + cur.slice(end);
      paint();
    }

    function insertAt(i, s) {
      const el = host.querySelector(`.xcomp-editor[data-i="${i}"]`) || {};
      const p = thread[i];
      const pos = el.selectionStart || p.text.length;
      p.text = p.text.slice(0, pos) + s + p.text.slice(pos);
      paint();
    }

    function list(i, ordered) {
      const lines = thread[i].text.split(/\n/);
      thread[i].text = lines.map((ln, n) => {
        const t = ln.replace(/^\s*([•\-\d]+\.\s*)/, "");
        return (ordered ? `${n + 1}. ` : "• ") + t;
      }).join("\n");
      paint();
    }

    async function fileToPost(i, file, kind) {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      thread[i].media.push({
        name: file.name,
        kind: kind || (file.type.includes("gif") ? "gif" : file.type.includes("video") ? "video" : "image"),
        dataUrl,
        alt: thread[i].pendingAlt || "",
        crop: { z: 1, x: 0, y: 0 }
      });
      thread[i].pendingAlt = "";
      if (showCrop && showCrop.i === i) showCrop = { i, mi: thread[i].media.length - 1 };
      paint();
    }

    async function preview() {
      const r = await fetch("/api/x/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gather())
      });
      return r.json();
    }

    function paint() {
      const count = xCount(thread.map((p) => p.text).join("\n"));
      const cls = count > LONG ? "over" : count > 280 ? "over280" : "";
      host.innerHTML = `
        <p class="muted" id="xwho">${xStatus.signedIn || xStatus.appOAuth || xStatus.hasToken
          ? "App OAuth signed in @" + (xStatus.username || "user") + " — posting on"
          : (xStatus.pluginConnected || xStatus.userId || xStatus.username)
            ? "@" + (xStatus.username || "Jasper_Black") + " connected via Cursor X — Enable posting / tweet sync to tweet"
            : (xStatus.hasClientId ? "X app saved — enable posting / tweet sync" : "Save Client ID in Settings, then Enable posting / tweet sync")}</p>
        ${thread.map((p, i) => `
          <div class="xcomp-card">
            <p class="pill">Post ${i + 1} of thread</p>
            <textarea class="xcomp-editor" data-i="${i}" placeholder="What's happening?">${p.text.replace(/</g, "&lt;")}</textarea>
            <div class="xcomp-tools">
              <button type="button" data-act="bold" data-i="${i}">B</button>
              <button type="button" data-act="italic" data-i="${i}">I</button>
              <button type="button" data-act="strike" data-i="${i}">S</button>
              <button type="button" data-act="ul" data-i="${i}">• List</button>
              <button type="button" data-act="ol" data-i="${i}">1. List</button>
              <button type="button" data-act="link" data-i="${i}">Link</button>
              <button type="button" data-act="mention" data-i="${i}">@</button>
              <button type="button" data-act="hash" data-i="${i}">#</button>
              <button type="button" data-act="emoji" data-i="${i}">Emoji</button>
              <button type="button" data-act="img" data-i="${i}">Photo</button>
              <button type="button" data-act="gif" data-i="${i}">GIF</button>
              <button type="button" data-act="vid" data-i="${i}">Video</button>
              <button type="button" data-act="poll" data-i="${i}">Poll</button>
              <button type="button" data-act="alt" data-i="${i}">Alt text</button>
              <button type="button" data-act="crop" data-i="${i}">Crop</button>
            </div>
            <input type="file" accept="image/*" data-file="img" data-i="${i}" hidden />
            <input type="file" accept="image/gif" data-file="gif" data-i="${i}" hidden />
            <input type="file" accept="video/*" data-file="vid" data-i="${i}" hidden />
            <div class="xcomp-media">${p.media.map((m, mi) => m.kind === "video"
              ? `<video src="${m.dataUrl}" controls></video>`
              : `<img src="${m.dataUrl}" alt="${(m.alt || "").replace(/"/g, "")}" />`).join("")}</div>
            ${showPick && showPick.i === i ? `<div class="suggest">${(showPick.type === "mention" ? MENTIONS : TAGS).map((s) =>
              `<button type="button" data-pick="${showPick.type === "mention" ? "@" : "#"}${s}">${showPick.type === "mention" ? "@" : "#"}${s}</button>`
            ).join("")}</div>` : ""}
            <label>GIF URL or search</label>
            <input data-f="gifUrl" data-i="${i}" value="${(p.gifUrl || "").replace(/"/g, "&quot;")}" placeholder="https://…gif or search term" />
            <label>Media title</label><input data-f="mediaTitle" data-i="${i}" value="${(p.mediaTitle || "").replace(/"/g, "&quot;")}" />
            <label>Media description</label><input data-f="mediaDescription" data-i="${i}" value="${(p.mediaDescription || "").replace(/"/g, "&quot;")}" />
            <div class="stack">
              <p class="pill">Poll (sent when 2+ choices are filled)</p>
              <input data-poll="0" data-i="${i}" placeholder="Choice 1" value="${p.pollOptions[0] || ""}" />
              <input data-poll="1" data-i="${i}" placeholder="Choice 2" value="${p.pollOptions[1] || ""}" />
              <input data-poll="2" data-i="${i}" placeholder="Choice 3" value="${p.pollOptions[2] || ""}" />
              <input data-poll="3" data-i="${i}" placeholder="Choice 4" value="${p.pollOptions[3] || ""}" />
              <label>Poll minutes (5–10080)</label>
              <input type="number" data-f="pollMinutes" data-i="${i}" value="${p.pollMinutes}" />
            </div>
            <p class="pill">Alt text</p>
            ${(p.media.length ? p.media : [{ alt: "" }]).map((m, mi) => `<label>Alt ${mi + 1}</label><input data-alt="${mi}" data-i="${i}" value="${(m.alt || "").replace(/"/g, "&quot;")}" />`).join("")}
          </div>`).join("")}
        <div class="xcomp-tools">
          <button type="button" id="add-thread">+ Add another post</button>
          <button type="button" id="save-draft">Save draft</button>
          <button type="button" id="load-draft">Load draft</button>
          <button type="button" id="rewrite">Rewrite assist</button>
          <button type="button" id="emoji-toggle">Emoji tray</button>
        </div>
        ${showEmoji ? `<div class="xcomp-emoji">${EMOJI.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>` : ""}
        <div class="xcomp-meta">
          <div><label>Who can reply</label>
            <select id="replies">
              <option value="everyone"${replySettings === "everyone" ? " selected" : ""}>Everyone</option>
              <option value="following"${replySettings === "following" ? " selected" : ""}>Accounts you follow</option>
              <option value="mentionedUsers"${replySettings === "mentionedUsers" ? " selected" : ""}>Only mentioned</option>
              <option value="verified"${replySettings === "verified" ? " selected" : ""}>Verified</option>
              <option value="subscribers"${replySettings === "subscribers" ? " selected" : ""}>Subscribers</option>
            </select>
          </div>
          <div><label>Schedule</label><input id="sched" type="datetime-local" value="${scheduleAt}" /></div>
          <div><label>Community ID</label><input id="comm" value="${communityId.replace(/"/g, "&quot;")}" /></div>
          <div><label>Location label</label><input id="locl" value="${locationLabel.replace(/"/g, "&quot;")}" /></div>
          <div><label>Place ID</label><input id="place" value="${placeId.replace(/"/g, "&quot;")}" /></div>
          <div><label>Quote post ID</label><input id="quote" value="${quoteId.replace(/"/g, "&quot;")}" /></div>
          <div><label>Reply to post ID</label><input id="replyid" value="${inReplyTo.replace(/"/g, "&quot;")}" /></div>
          <div><label>DM deep link</label><input id="dm" value="${dmLink.replace(/"/g, "&quot;")}" /></div>
          <div><label>Tagged user IDs</label><input id="tags" value="${taggedUserIds.replace(/"/g, "&quot;")}" /></div>
        </div>
        <div class="row" style="margin:12px 0">
          <label class="row"><input type="checkbox" id="sens"${sensitive ? " checked" : ""} /> Sensitive</label>
          <label class="row"><input type="checkbox" id="ai"${madeWithAi ? " checked" : ""} /> Made with AI</label>
          <label class="row"><input type="checkbox" id="sub"${subscribersOnly ? " checked" : ""} /> Super followers only</label>
          <label class="row"><input type="checkbox" id="share"${shareWithFollowers ? " checked" : ""} /> Share with followers</label>
          <label class="row"><input type="checkbox" id="paid"${paidPartnership ? " checked" : ""} /> Paid partnership</label>
        </div>
        <p class="xcomp-count ${cls}">${count} / 280 standard · ${LONG} long-post (no Premium lock in this UI)</p>
        ${showDrafts ? `<div class="stack">${(drafts().length ? drafts().slice(0, 10).map((d, di) =>
          `<button class="btn ghost" type="button" data-draft="${di}">Load draft ${di + 1} · ${(d.at || "").slice(0, 19)} · ${String((d.thread && d.thread[0] && d.thread[0].text) || "").slice(0, 48)}</button>`
        ).join("") : `<p class="muted">No drafts yet.</p>`)}</div>` : ""}
        <div class="row">
          <button class="btn" type="button" id="do-post">Post</button>
          <a class="btn ghost" href="#/settings">X sign-in</a>
        </div>
        <pre class="xcomp-preview" id="live-preview">What will actually post loads here.</pre>
        <p id="compose-note" class="muted"></p>
        ${showCrop !== null ? `<div class="xcomp-modal"><div class="box">
          <h3>Crop</h3>
          ${thread[showCrop.i] && thread[showCrop.i].media[showCrop.mi] ? `
          <label>Zoom</label><input type="range" id="cz" min="1" max="3" step="0.05" value="${thread[showCrop.i].media[showCrop.mi].crop.z}" />
          <label>X</label><input type="range" id="cx" min="-50" max="50" value="${thread[showCrop.i].media[showCrop.mi].crop.x}" />
          <label>Y</label><input type="range" id="cy" min="-50" max="50" value="${thread[showCrop.i].media[showCrop.mi].crop.y}" />
          <button class="btn" type="button" id="crop-done">Apply crop to image</button>` : `<p class="muted">Pick a photo first, then crop it. Crop is baked into the file that uploads.</p>
          <button class="btn" type="button" id="crop-pick">Choose photo</button>`}
          <button class="btn ghost" type="button" id="crop-cancel">Close</button>
        </div></div>` : ""}
      `;
      bind();
      refreshPreview();
    }

    function note(msg, warn) {
      const n = host.querySelector("#compose-note");
      if (n) { n.className = warn ? "warn" : "ok"; n.textContent = msg; }
    }

    function readFields() {
      replySettings = host.querySelector("#replies").value;
      scheduleAt = host.querySelector("#sched").value;
      communityId = host.querySelector("#comm").value;
      locationLabel = host.querySelector("#locl").value;
      placeId = host.querySelector("#place").value;
      quoteId = host.querySelector("#quote").value;
      inReplyTo = host.querySelector("#replyid").value;
      dmLink = host.querySelector("#dm").value;
      taggedUserIds = host.querySelector("#tags").value;
      sensitive = host.querySelector("#sens").checked;
      madeWithAi = host.querySelector("#ai").checked;
      subscribersOnly = host.querySelector("#sub").checked;
      shareWithFollowers = host.querySelector("#share").checked;
      paidPartnership = host.querySelector("#paid").checked;
      host.querySelectorAll(".xcomp-editor").forEach((el) => {
        thread[Number(el.dataset.i)].text = el.value;
      });
      host.querySelectorAll("[data-f]").forEach((el) => {
        thread[Number(el.dataset.i)][el.dataset.f] = el.type === "number" ? Number(el.value) : el.value;
      });
      host.querySelectorAll("[data-poll]").forEach((el) => {
        thread[Number(el.dataset.i)].pollOptions[Number(el.dataset.poll)] = el.value;
      });
      host.querySelectorAll("[data-alt]").forEach((el) => {
        const p = thread[Number(el.dataset.i)];
        const mi = Number(el.dataset.alt);
        if (p.media[mi]) p.media[mi].alt = el.value;
        else p.pendingAlt = el.value;
      });
    }

    async function refreshPreview() {
      try {
        readFields();
        const data = await preview();
        const el = host.querySelector("#live-preview");
        if (el) el.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        const el = host.querySelector("#live-preview");
        if (el) el.textContent = String(err.message || err);
      }
    }

    function bind() {
      host.querySelectorAll(".xcomp-editor").forEach((el) => {
        const remember = () => {
          sel = { i: Number(el.dataset.i), start: el.selectionStart || 0, end: el.selectionEnd || 0 };
          activeI = sel.i;
        };
        el.addEventListener("focus", remember);
        el.addEventListener("keyup", remember);
        el.addEventListener("mouseup", remember);
        el.addEventListener("select", remember);
        el.addEventListener("input", () => {
          thread[Number(el.dataset.i)].text = el.value;
          remember();
          const c = xCount(thread.map((p) => p.text).join("\n"));
          const n = host.querySelector(".xcomp-count");
          if (n) {
            n.textContent = `${c} / 280 standard · ${LONG} long-post (no Premium lock in this UI)`;
            n.className = "xcomp-count " + (c > LONG ? "over" : c > 280 ? "over280" : "");
          }
        });
      });
      host.querySelectorAll(".xcomp-tools button[data-act]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          readFields();
          const i = Number(btn.dataset.i);
          activeI = i;
          const act = btn.dataset.act;
          if (act === "bold") applyFmt("b");
          else if (act === "italic") applyFmt("i");
          else if (act === "strike") applyFmt("s");
          else if (act === "ul") list(i, false);
          else if (act === "ol") list(i, true);
          else if (act === "link") insertAt(i, " https://");
          else if (act === "mention") { showPick = { type: "mention", i }; paint(); }
          else if (act === "hash") { showPick = { type: "hash", i }; paint(); }
          else if (act === "emoji") { showEmoji = true; paint(); }
          else if (act === "img") host.querySelector(`input[data-file="img"][data-i="${i}"]`).click();
          else if (act === "gif") host.querySelector(`input[data-file="gif"][data-i="${i}"]`).click();
          else if (act === "vid") host.querySelector(`input[data-file="vid"][data-i="${i}"]`).click();
          else if (act === "poll") { thread[i].pollOn = true; paint(); }
          else if (act === "alt") paint();
          else if (act === "crop") { showCrop = { i, mi: 0 }; paint(); }
        });
      });
      host.querySelectorAll("input[data-file]").forEach((inp) => {
        inp.addEventListener("change", () => {
          const f = inp.files && inp.files[0];
          if (f) fileToPost(Number(inp.dataset.i), f, inp.dataset.file === "vid" ? "video" : inp.dataset.file === "gif" ? "gif" : "image");
        });
      });
      host.querySelector("#add-thread").onclick = () => { thread.push(blankPost("")); paint(); };
      host.querySelector("#emoji-toggle").onclick = () => { showEmoji = !showEmoji; paint(); };
      host.querySelectorAll("[data-emoji]").forEach((b) => {
        b.onclick = () => insertAt(activeI, b.dataset.emoji);
      });
      host.querySelectorAll("[data-pick]").forEach((b) => {
        b.onclick = () => {
          insertAt(showPick ? showPick.i : activeI, " " + b.dataset.pick + " ");
          showPick = null;
          paint();
        };
      });
      host.querySelector("#save-draft").onclick = () => {
        readFields();
        const list = drafts();
        list.unshift({ at: new Date().toISOString(), ...gather() });
        saveDrafts(list.slice(0, 30));
        showDrafts = true;
        paint();
        note("Draft saved locally.");
      };
      host.querySelector("#load-draft").onclick = () => {
        showDrafts = true;
        paint();
      };
      host.querySelectorAll("[data-draft]").forEach((b) => {
        b.onclick = () => applyDraft(drafts()[Number(b.dataset.draft)]);
      });
      host.querySelector("#rewrite").onclick = async () => {
        readFields();
        const i = activeI || 0;
        note("Rewrite via selected model…");
        try {
          const data = await generate({ kind: "rewrite", mode: "voice", draft: thread[i].text });
          thread[i].text = data.text;
          madeWithAi = true;
          paint();
          note("Rewrite applied from " + (data.model || "model") + ".");
        } catch (err) {
          note(String(err.message || err), true);
        }
      };
      host.querySelector("#do-post").onclick = async () => {
        readFields();
        const payload = gather();
        let data;
        try { data = await preview(); } catch (err) { note(String(err.message || err), true); return; }
        const box = document.createElement("div");
        box.className = "xcomp-modal";
        box.innerHTML = `<div class="box">
          <h3>Confirm post</h3>
          <p class="muted">This is the official payload. Nothing is auto-sent.</p>
          <pre class="xcomp-preview">${JSON.stringify(data, null, 2).replace(/</g, "&lt;")}</pre>
          <div class="row">
            <button class="btn" type="button" id="yes">Post now</button>
            <button class="btn ghost" type="button" id="no">Cancel</button>
          </div>
        </div>`;
        document.body.appendChild(box);
        box.querySelector("#no").onclick = () => box.remove();
        box.querySelector("#yes").onclick = async () => {
          try {
            const r = await fetch("/api/x/post", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm: true, ...payload })
            });
            const out = await r.json();
            box.remove();
            if (!r.ok) { note(out.error || "Post failed", true); return; }
            const url = (out.posts && out.posts[0] && out.posts[0].url) || "";
            const sync = out.ingest && out.ingest.reason === "post" ? " · X ingest kicked (reason post)" : "";
            note((url ? ("Posted " + url) : JSON.stringify(out)) + sync);
          } catch (err) {
            box.remove();
            note(String(err.message || err), true);
          }
        };
      };
      const cropDone = host.querySelector("#crop-done");
      if (cropDone) {
        cropDone.onclick = () => {
          const m = thread[showCrop.i].media[showCrop.mi];
          m.crop = {
            z: Number(host.querySelector("#cz").value),
            x: Number(host.querySelector("#cx").value),
            y: Number(host.querySelector("#cy").value)
          };
          bakeCrop(m).then(() => {
            showCrop = null;
            paint();
          });
        };
      }
      const cropPick = host.querySelector("#crop-pick");
      if (cropPick) {
        cropPick.onclick = () => {
          const i = showCrop.i;
          host.querySelector(`input[data-file="img"][data-i="${i}"]`).click();
        };
      }
      const cropCancel = host.querySelector("#crop-cancel");
      if (cropCancel) cropCancel.onclick = () => { showCrop = null; paint(); };
      ["replies", "sched", "comm", "locl", "place", "quote", "replyid", "dm", "tags", "sens", "ai", "sub", "share", "paid"].forEach((id) => {
        const el = host.querySelector("#" + id);
        if (el) el.addEventListener("change", refreshPreview);
      });
    }

    fetch("/api/x/status").then((r) => r.json()).then((s) => { xStatus = s; paint(); }).catch(() => paint());
  };
})();
