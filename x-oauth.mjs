import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUTH = "https://x.com/i/oauth2/authorize";
const TOKEN = "https://api.twitter.com/2/oauth2/token";
const TWEETS = "https://api.twitter.com/2/tweets";
const ME = "https://api.twitter.com/2/users/me";
const MEDIA = "https://api.x.com/2/media/upload";
const MEDIA_INIT = "https://api.x.com/2/media/upload/initialize";
const MEDIA_META = "https://api.x.com/2/media/metadata";
const MEDIA_META_V1 = "https://api.twitter.com/1.1/media/metadata/create.json";
export const CALLBACK = "http://127.0.0.1:4747/callback/x";
/** Minimum for ingest + text post. Extra scopes fail authorize if the X app does not have them. */
export const CORE_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
export const EXTRA_SCOPES = ["media.write", "like.read", "bookmark.read", "list.read", "follows.read"];
const HOUSE_HANDLE = "Jasper_Black";

export function scopesFor(store) {
  const extra = Array.isArray(store && store.extraScopes) ? store.extraScopes : [];
  const allow = new Set(EXTRA_SCOPES);
  const out = [...CORE_SCOPES];
  for (const s of extra) {
    if (allow.has(s) && !out.includes(s)) out.push(s);
  }
  return out.join(" ");
}

function appPath(root) {
  return path.join(root, "data", "x-app.json");
}

export function xStorePath(root) {
  return path.join(root, "data", "x-store.json");
}

function pendingPath(root) {
  return path.join(root, "data", "x-pending.json");
}

function savePending(root, pending) {
  fs.mkdirSync(path.dirname(pendingPath(root)), { recursive: true });
  fs.writeFileSync(pendingPath(root), JSON.stringify(pending, null, 2), "utf8");
}

function loadPending(root, store) {
  if (store.pending && store.pending.verifier && store.pending.state) return store.pending;
  try {
    return JSON.parse(fs.readFileSync(pendingPath(root), "utf8"));
  } catch {
    return store.pending || null;
  }
}

function clearPending(root, store) {
  store.pending = null;
  try {
    fs.unlinkSync(pendingPath(root));
  } catch {
    /* none */
  }
}

function emptyStore() {
  return {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    username: "",
    userId: "",
    expectedUsername: HOUSE_HANDLE,
    extraScopes: [],
    confidential: false,
    expiresAt: 0,
    pending: null,
    lastAuthorize: null
  };
}

export function loadXStore(root) {
  const p = xStorePath(root);
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return emptyStore();
  }
}

export function saveXStore(root, store) {
  const p = xStorePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = { ...emptyStore(), ...store };
  fs.writeFileSync(p, JSON.stringify(out, null, 2), "utf8");
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function tokenValue(store) {
  let t = String((store && store.accessToken) || "").trim();
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();
  if (!t || /^(undefined|null|none)$/i.test(t)) return "";
  return t;
}

export function hasUserAccessToken(store) {
  return Boolean(tokenValue(store));
}

export function xPublicStatus(store) {
  const handle = store.username || store.expectedUsername || HOUSE_HANDLE;
  const hasToken = hasUserAccessToken(store);
  return {
    hasClientId: Boolean(store.clientId),
    clientIdHint: store.clientId ? String(store.clientId).slice(-4) : "",
    signedIn: hasToken,
    appOAuth: hasToken,
    pluginConnected: Boolean(store.userId || store.username),
    hasToken,
    username: store.username || "",
    userId: store.userId || "",
    expectedUsername: handle,
    needClientId: !store.clientId,
    pkcePublic: !store.confidential,
    confidential: Boolean(store.confidential),
    callback: CALLBACK,
    scopes: scopesFor(store),
    extraScopes: Array.isArray(store.extraScopes) ? store.extraScopes : [],
    lastAuthorize: store.lastAuthorize || null,
    signInPath: "/api/x/login",
    labUrl: "http://127.0.0.1:4747/#/dashboard"
  };
}

function loadAppFile(root) {
  try {
    return JSON.parse(fs.readFileSync(appPath(root), "utf8"));
  } catch {
    return {};
  }
}

function saveAppFile(root, app) {
  fs.mkdirSync(path.dirname(appPath(root)), { recursive: true });
  fs.writeFileSync(appPath(root), JSON.stringify(app, null, 2), "utf8");
}

function persistApp(root, store) {
  if (!store.clientId) return;
  saveAppFile(root, {
    clientId: store.clientId,
    clientSecret: store.confidential ? store.clientSecret || "" : "",
    expectedUsername: store.expectedUsername || HOUSE_HANDLE,
    extraScopes: store.extraScopes || [],
    confidential: Boolean(store.confidential)
  });
}

export function hydrateXApp(root) {
  const store = loadXStore(root);
  const app = loadAppFile(root);
  const envId = String(process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || "").trim();
  const envSecret = String(process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || "");
  if (!store.clientId && app.clientId) store.clientId = String(app.clientId);
  if (!store.clientSecret && app.clientSecret) store.clientSecret = String(app.clientSecret);
  if (!store.clientId && envId) store.clientId = envId;
  if (!store.clientSecret && envSecret) store.clientSecret = envSecret;
  if (Array.isArray(app.extraScopes) && !Array.isArray(store.extraScopes)) store.extraScopes = app.extraScopes;
  if (typeof app.confidential === "boolean" && store.confidential == null) store.confidential = app.confidential;
  if (!store.expectedUsername) store.expectedUsername = HOUSE_HANDLE;
  if (!store.username && store.expectedUsername) store.username = store.expectedUsername;
  saveXStore(root, store);
  persistApp(root, store);
  return xPublicStatus(store);
}

export function saveXCredentials(root, input) {
  const store = loadXStore(root);
  const id = String(input.clientId || input.xClientId || "").trim();
  const secret = String(input.clientSecret || input.xClientSecret || "");
  if (id) store.clientId = id;
  if (Object.prototype.hasOwnProperty.call(input, "clientSecret") || Object.prototype.hasOwnProperty.call(input, "xClientSecret")) {
    store.clientSecret = secret;
  }
  store.confidential = Boolean(input.confidential) && Boolean(store.clientSecret);
  if (Array.isArray(input.extraScopes)) {
    store.extraScopes = input.extraScopes.filter((s) => EXTRA_SCOPES.includes(s));
  }
  if (!store.expectedUsername) store.expectedUsername = HOUSE_HANDLE;
  if (!store.username) store.username = store.expectedUsername;
  saveXStore(root, store);
  persistApp(root, store);
  return xPublicStatus(store);
}

export function beginLogin(root) {
  hydrateXApp(root);
  const store = loadXStore(root);
  if (!store.clientId) {
    throw new Error(
      "Need an X Client ID once. At developer.x.com create a Native app (PKCE). Callback URL must be exactly http://127.0.0.1:4747/callback/x. Paste the Client ID in the sign-in panel — this machine remembers it. Client secret is optional for Native."
    );
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const scope = scopesFor(store);
  store.pending = { verifier, state, at: Date.now(), redirectUri: CALLBACK, scope };
  savePending(root, store.pending);
  store.lastAuthorize = {
    at: new Date().toISOString(),
    clientIdLast4: String(store.clientId).slice(-4),
    redirect_uri: CALLBACK,
    scope,
    code_challenge_method: "S256",
    state: state.slice(0, 8) + "…",
    confidential: Boolean(store.confidential),
    pkce: true
  };
  saveXStore(root, store);
  console.log("X authorize", JSON.stringify(store.lastAuthorize));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: store.clientId,
    redirect_uri: CALLBACK,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return `${AUTH}?${q}`;
}

async function tokenRequest(store, body, forceSecret) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const useSecret = forceSecret === true || (forceSecret !== false && Boolean(store.confidential && store.clientSecret));
  const payload = new URLSearchParams(body);
  if (useSecret && store.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${store.clientId}:${store.clientSecret}`).toString("base64")}`;
  } else {
    payload.set("client_id", store.clientId);
  }
  const r = await fetch(TOKEN, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(20000) });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`X token non-JSON HTTP ${r.status}`);
  }
  if (r.status >= 400) {
    throw new Error(data.error_description || data.error || `X token HTTP ${r.status}`);
  }
  return { data, status: r.status, usedSecret: useSecret };
}

export function xCallbackError(query) {
  const err = String(query.get("error") || "").trim();
  if (!err) return null;
  const desc = String(query.get("error_description") || "").trim();
  return desc ? `${err}: ${desc}` : err;
}

export async function finishLogin(root, query) {
  const store = loadXStore(root);
  const denied = xCallbackError(query);
  const code = String(query.get("code") || "");
  const state = String(query.get("state") || "");
  const pending = loadPending(root, store);
  console.log("X callback", JSON.stringify({
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasVerifier: Boolean(pending && pending.verifier),
    stateMatch: Boolean(pending && pending.state && pending.state === state),
    tokenStatus: "pending"
  }));
  if (denied) throw new Error(`X did not grant access (${denied}). Check the callback URL is exactly ${CALLBACK}, User authentication is on, Type of App is Native, and scopes include ${scopesFor(store)}.`);
  if (!pending || !pending.verifier) {
    throw new Error("Sign-in session expired (PKCE verifier missing). Click Sign in with X once more without restarting the lab.");
  }
  if (state !== pending.state) {
    throw new Error("X sign-in state mismatch. Click Enable posting / tweet sync again from http://127.0.0.1:4747/#/dashboard.");
  }
  if (!code) throw new Error("X sign-in returned no code.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    code_verifier: pending.verifier
  });
  let pack;
  try {
    pack = await tokenRequest(store, body, false);
  } catch (err) {
    if (store.clientSecret) {
      pack = await tokenRequest(store, body, true);
    } else {
      throw err;
    }
  }
  const data = pack.data || {};
  const token = data.access_token || "";
  console.log("X callback token", JSON.stringify({
    hasCode: true,
    hasState: true,
    hasVerifier: true,
    tokenStatus: token ? `ok last4=${String(token).slice(-4)} http=${pack.status}` : `empty http=${pack.status}`
  }));
  if (!token) throw new Error("X returned no access token. If this is a Confidential web app, paste the Client secret and check that box.");
  store.accessToken = tokenValue({ accessToken: token });
  store.refreshToken = data.refresh_token || store.refreshToken || "";
  store.expiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
  clearPending(root, store);
  saveXStore(root, store);
  try {
    await refreshMe(root);
  } catch (err) {
    console.error("X refreshMe after login", String(err.message || err));
  }
  const st = xPublicStatus(loadXStore(root));
  if (!st.signedIn) throw new Error("Token did not persist. Try Sign in with X again.");
  return st;
}

export function logoutX(root) {
  const store = loadXStore(root);
  store.accessToken = "";
  store.refreshToken = "";
  store.userId = "";
  store.expiresAt = 0;
  store.pending = null;
  store.username = store.expectedUsername || HOUSE_HANDLE;
  saveXStore(root, store);
  return xPublicStatus(store);
}

async function refreshMe(root) {
  const store = await ensureAccess(root);
  const token = tokenValue(store);
  if (!token) throw new Error("Not signed in with a user access token.");
  const r = await fetch(`${ME}?user.fields=username,name`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.data) {
    store.username = data.data.username || "";
    store.userId = data.data.id || "";
    saveXStore(root, store);
  }
}

export async function ensureAccess(root) {
  const store = loadXStore(root);
  if (!hasUserAccessToken(store)) throw new Error("Not signed in. Click Sign in with X.");
  if (store.expiresAt && Date.now() > store.expiresAt - 30000 && store.refreshToken) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: store.refreshToken
    });
    const pack = await tokenRequest(store, body);
    const data = pack.data || {};
    store.accessToken = tokenValue({ accessToken: data.access_token || store.accessToken });
    if (data.refresh_token) store.refreshToken = data.refresh_token;
    store.expiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    saveXStore(root, store);
  }
  return store;
}

function clip(raw) {
  return String(raw || "").replace(/\s+/g, " ").slice(0, 280);
}

export function apiPayloadForPost(item) {
  const notes = [];
  const local = {};
  const body = {};
  const text = String(item.text || "").trim();
  if (text) body.text = text;

  if (item.replySettings && item.replySettings !== "everyone") {
    body.reply_settings = item.replySettings;
  }

  if (item.inReplyTo) {
    body.reply = { in_reply_to_tweet_id: String(item.inReplyTo) };
  }
  if (item.quoteId) body.quote_tweet_id = String(item.quoteId);
  if (item.communityId) body.community_id = String(item.communityId);
  if (item.placeId) body.geo = { place_id: String(item.placeId) };
  if (item.dmLink) body.direct_message_deep_link = String(item.dmLink);
  if (item.madeWithAi) body.made_with_ai = true;
  if (item.subscribersOnly) body.for_super_followers_only = true;
  if (item.shareWithFollowers) body.share_with_followers = true;
  if (item.paidPartnership) body.paid_partnership = true;
  if (item.sensitive) {
    body.possibly_sensitive = true;
    local.sensitive = true;
    notes.push("sensitive → possibly_sensitive (closest official field; X may 400 if v2 rejects it — that error is shown)");
  }

  const pollOpts = (item.pollOptions || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (item.pollOn || pollOpts.length >= 2) {
    if (pollOpts.length >= 2) {
      body.poll = {
        options: pollOpts.slice(0, 4).map((s) => s.slice(0, 25)),
        duration_minutes: Math.min(10080, Math.max(5, Number(item.pollMinutes) || 1440))
      };
    }
  }

  const mediaIds = (item.mediaIds || []).filter(Boolean);
  if (mediaIds.length) {
    body.media = { media_ids: mediaIds.slice(0, 4) };
    if (item.mediaTitle) body.media.title = String(item.mediaTitle);
    if (item.mediaDescription) body.media.description = String(item.mediaDescription);
    if (item.taggedUserIds && item.taggedUserIds.length) {
      body.media.tagged_user_ids = item.taggedUserIds.map(String).slice(0, 10);
    }
  } else if (item.taggedUserIds && item.taggedUserIds.length) {
    body.media = { tagged_user_ids: item.taggedUserIds.map(String).slice(0, 10) };
    notes.push("tagged_user_ids sent on media without media_ids — X may 400; not dropped");
  }
  if (item.mediaTitle && !(body.media && body.media.title)) {
    body.media = body.media || {};
    body.media.title = String(item.mediaTitle);
  }
  if (item.mediaDescription && !(body.media && body.media.description)) {
    body.media = body.media || {};
    body.media.description = String(item.mediaDescription);
  }

  if (item.scheduleAt) {
    local.scheduleAt = item.scheduleAt;
    notes.push("scheduleAt has no POST /2/tweets field — kept on the compose document and local queue, not omitted");
  }
  if (item.locationLabel) {
    local.locationLabel = item.locationLabel;
    notes.push("location label is not geo.place_id — place_id is the official field; label stays on the document");
  }
  if (item.gifQuery) local.gifQuery = item.gifQuery;
  if (item.gifUrl) local.gifUrl = item.gifUrl;
  if (item.altTexts && item.altTexts.length) local.altTexts = item.altTexts;
  if (item.crop) local.crop = item.crop;
  if (Array.isArray(item.media) && item.media.length && !mediaIds.length) {
    local.mediaPending = item.media.map((m) => ({
      name: m.name,
      kind: m.kind,
      alt: m.alt,
      crop: m.crop,
      bytes: String(m.dataUrl || "").length
    }));
    notes.push("media files upload on confirm via POST /2/media/upload then media.media_ids");
  }
  notes.push("bold/italic/strike/lists/links/mentions/hashtags/emoji live in text as Unicode/URLs (API has no HTML)");
  if (body.poll && body.media && body.media.media_ids) {
    notes.push("poll and media both filled — both sent; X may 400 because they are mutually exclusive");
  }

  return { body, local, notes, willPost: !item.scheduleAt };
}

async function xMediaJson(store, url, init) {
  const headers = { Authorization: `Bearer ${tokenValue(store)}`, ...(init.headers || {}) };
  if (!tokenValue(store)) throw new Error("Not signed in with a user access token.");
  const r = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(120000) });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }
  if (r.status >= 400) {
    throw new Error(`X media HTTP ${r.status}: ${clip(raw)}`);
  }
  return data;
}

async function setAltText(store, id, alt, notes) {
  const text = String(alt || "").trim();
  if (!text) return;
  const sliced = text.slice(0, 1000);
  try {
    await xMediaJson(store, MEDIA_META, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, metadata: { alt_text: { text: sliced } } })
    });
    notes.push(`alt text set on media ${id}`);
    return;
  } catch (err) {
    notes.push(`v2 media metadata failed: ${String(err.message || err)}`);
  }
  try {
    await xMediaJson(store, MEDIA_META_V1, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: id, alt_text: { text: sliced } })
    });
    notes.push(`alt text set via v1.1 metadata on media ${id}`);
  } catch (err) {
    notes.push(`alt text was not accepted by X (${String(err.message || err)}) — media_id still attached`);
  }
}

async function waitMediaReady(store, id, notes) {
  for (let n = 0; n < 40; n++) {
    let data;
    try {
      data = await xMediaJson(store, `${MEDIA}?media_id=${encodeURIComponent(id)}`, { method: "GET" });
    } catch {
      return;
    }
    const info = (data.data && data.data.processing_info) || data.processing_info;
    if (!info || info.state === "succeeded" || info.state === "complete") return;
    if (info.state === "failed") throw new Error(`X media processing failed for ${id}`);
    const wait = Math.max(1, Number(info.check_after_secs || 2)) * 1000;
    await new Promise((r) => setTimeout(r, wait));
  }
  notes.push(`media ${id} still processing after wait — tweet sent with media_ids anyway`);
}

async function uploadBuffer(store, buf, mime, kind, alt, notes) {
  const category =
    kind === "video" || String(mime).startsWith("video/")
      ? "tweet_video"
      : kind === "gif" || mime === "image/gif"
        ? "tweet_gif"
        : "tweet_image";
  if (category === "tweet_image" && buf.length < 5_000_000) {
    try {
      const form = new FormData();
      form.append("media_category", category);
      form.append("media", new Blob([buf], { type: mime }), "media");
      const data = await xMediaJson(store, MEDIA, { method: "POST", body: form });
      const id = (data.data && data.data.id) || data.media_id_string || data.id;
      if (id) {
        await setAltText(store, String(id), alt, notes);
        return String(id);
      }
    } catch (err) {
      notes.push(`simple media upload failed, trying chunked: ${String(err.message || err)}`);
    }
  }
  const init = await xMediaJson(store, MEDIA_INIT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: mime,
      total_bytes: buf.length,
      media_category: category
    })
  });
  const id = (init.data && init.data.id) || init.media_id_string || init.id;
  if (!id) throw new Error("X media initialize returned no id");
  const CHUNK = 1024 * 1024;
  for (let i = 0, seg = 0; i < buf.length; i += CHUNK, seg++) {
    const part = buf.subarray(i, Math.min(buf.length, i + CHUNK));
    const form = new FormData();
    form.append("segment_index", String(seg));
    form.append("media", new Blob([part], { type: mime || "application/octet-stream" }), "chunk");
    await xMediaJson(store, `${MEDIA}/${id}/append`, { method: "POST", body: form });
  }
  await xMediaJson(store, `${MEDIA}/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  if (category !== "tweet_image") await waitMediaReady(store, String(id), notes);
  await setAltText(store, String(id), alt, notes);
  return String(id);
}

async function uploadOne(store, asset, notes) {
  const src = String((asset && (asset.dataUrl || asset.gifUrl || asset.url)) || "");
  const kind = (asset && asset.kind) || "image";
  const alt = asset && asset.alt;
  if (src.startsWith("data:")) {
    const m = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("Media data URL is not base64");
    return uploadBuffer(store, Buffer.from(m[2], "base64"), m[1], kind, alt, notes);
  }
  if (/^https?:\/\//i.test(src)) {
    const r = await fetch(src, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Media URL HTTP ${r.status}`);
    const mime = r.headers.get("content-type") || (kind === "gif" ? "image/gif" : "application/octet-stream");
    const buf = Buffer.from(await r.arrayBuffer());
    return uploadBuffer(store, buf, mime, kind, alt, notes);
  }
  throw new Error("Media missing (need a data URL or http URL)");
}

function threadExtras(input) {
  return {
    replySettings: input.replySettings,
    scheduleAt: input.scheduleAt,
    communityId: input.communityId,
    placeId: input.placeId,
    locationLabel: input.locationLabel,
    quoteId: input.quoteId,
    dmLink: input.dmLink,
    inReplyTo: input.inReplyTo,
    taggedUserIds: input.taggedUserIds,
    sensitive: input.sensitive,
    madeWithAi: input.madeWithAi,
    subscribersOnly: input.subscribersOnly,
    shareWithFollowers: input.shareWithFollowers,
    paidPartnership: input.paidPartnership
  };
}

export async function postToX(root, input) {
  if (!input || input.confirm !== true) {
    throw new Error("Live post requires an explicit confirm click.");
  }
  const store = await ensureAccess(root);
  const extras = threadExtras(input);
  const items = Array.isArray(input.thread) && input.thread.length ? input.thread : [input];
  const results = [];
  let previousId = String(input.inReplyTo || "");
  for (const item of items) {
    const notes = [];
    const mediaIds = [...(item.mediaIds || [])];
    const files = Array.isArray(item.media) ? item.media : [];
    for (const file of files) {
      if (file && (file.dataUrl || file.url)) {
        mediaIds.push(await uploadOne(store, file, notes));
      }
    }
    const gif = String(item.gifUrl || item.gifQuery || "").trim();
    if (/^https?:\/\//i.test(gif)) {
      mediaIds.push(await uploadOne(store, { dataUrl: gif, kind: "gif", alt: (item.altTexts && item.altTexts[0]) || "" }, notes));
    } else if (gif) {
      notes.push(`GIF search term "${gif}" is not an X media URL — kept on the document, not dropped`);
    }
    const { body, local, notes: mapNotes, willPost } = apiPayloadForPost({
      ...extras,
      ...item,
      mediaIds,
      inReplyTo: previousId || item.inReplyTo || extras.inReplyTo,
      scheduleAt: extras.scheduleAt,
      taggedUserIds: extras.taggedUserIds || item.taggedUserIds
    });
    const allNotes = [...mapNotes, ...notes];
    if (!willPost) {
      const qpath = path.join(root, "data", "x-queue.json");
      let q = [];
      try { q = JSON.parse(fs.readFileSync(qpath, "utf8")); } catch { q = []; }
      q.unshift({ at: item.scheduleAt || extras.scheduleAt, body, local, notes: allNotes });
      fs.mkdirSync(path.dirname(qpath), { recursive: true });
      fs.writeFileSync(qpath, JSON.stringify(q, null, 2));
      results.push({ queued: true, notes: allNotes, local, preview: body });
      continue;
    }
    if (!body.text && !body.media && !body.poll) {
      throw new Error("Nothing to post (empty text, no media, no poll).");
    }
  const token = tokenValue(store);
  if (!token) throw new Error("Not signed in with a user access token.");
  const r = await fetch(TWEETS, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`X POST /2/tweets non-JSON HTTP ${r.status}: ${clip(raw)}`);
    }
    if (r.status >= 400) {
      const msg = (data.title || data.detail || data.error || clip(raw) || `HTTP ${r.status}`);
      throw new Error(`X API ${r.status}: ${msg}`);
    }
    const id = data.data && data.data.id;
    previousId = id || previousId;
    const username = store.username || "i";
    results.push({
      id,
      text: data.data && data.data.text,
      url: id ? `https://x.com/${username}/status/${id}` : "",
      notes: allNotes,
      payload: body
    });
  }
  return { ok: true, posts: results };
}

export { MEDIA };
