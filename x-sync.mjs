import fs from "node:fs";
import path from "node:path";
import { ensureAccess, hasUserAccessToken, loadXStore, saveXStore, tokenValue, xPublicStatus } from "./x-oauth.mjs";
import { runCmd, which } from "./trends-desk/reach.mjs";

const ME = "https://api.twitter.com/2/users/me";
const TWEETS = "https://api.twitter.com/2/tweets";
const TWEET_FIELDS = [
  "created_at",
  "public_metrics",
  "non_public_metrics",
  "organic_metrics",
  "conversation_id",
  "in_reply_to_user_id",
  "possibly_sensitive",
  "lang",
  "entities",
  "attachments",
  "referenced_tweets",
  "reply_settings",
  "text"
].join(",");
const MEDIA_FIELDS = "public_metrics,organic_metrics,duration_ms,type,preview_image_url,alt_text";
const USER_FIELDS = "public_metrics,username,name,description,created_at,verified,location,protected,profile_image_url";

export function worldPath(root) {
  return path.join(root, "data", "x-world.json");
}

function emptyWorld() {
  return {
    profile: null,
    followerHistory: [],
    posts: [],
    mentions: [],
    home: [],
    bookmarks: [],
    likes: [],
    listsOwned: [],
    listsFollowed: [],
    communities: [],
    spaces: [],
    queue: [],
    drafts: [],
    failed: [],
    lastSync: null
  };
}

export function loadWorld(root) {
  try {
    return { ...emptyWorld(), ...JSON.parse(fs.readFileSync(worldPath(root), "utf8")) };
  } catch {
    return emptyWorld();
  }
}

export function countOrNull(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^[\d,]+$/.test(v.trim())) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function applySignedInUser(world, user, at) {
  const metricsIn = (user && (user.public_metrics || user.metrics)) || {};
  const pick = (metricKey, alt) => countOrNull(metricsIn[metricKey] != null ? metricsIn[metricKey] : user && user[alt]);
  const followers = pick("followers_count", "followers");
  const following = pick("following_count", "following");
  const tweets = pick("tweet_count", "tweets");
  const likes = pick("like_count", "likes");
  const metrics = {};
  if (followers != null) metrics.followers_count = followers;
  if (following != null) metrics.following_count = following;
  if (tweets != null) metrics.tweet_count = tweets;
  if (likes != null) metrics.like_count = likes;
  const username = String((user && (user.username || user.screen_name)) || "").replace(/^@/, "");
  world.profile = {
    id: String((user && user.id) || ""),
    username,
    name: String((user && user.name) || ""),
    description: String((user && (user.description || user.bio)) || ""),
    metrics,
    createdAt: String((user && (user.created_at || user.createdAt)) || ""),
    capturedAt: at
  };
  world.followerHistory = Array.isArray(world.followerHistory) ? world.followerHistory : [];
  if (followers != null) {
    const prev = world.followerHistory.find((row) => row && row.at !== at && typeof row.followers === "number");
    world.followerHistory.unshift({ at, followers });
    world.followerHistory = world.followerHistory.slice(0, 120);
    world.profile.followerDelta = prev ? followers - prev.followers : null;
  }
  return world.profile;
}

export function parseProfilePayload(raw) {
  const text = String(raw || "").trim();
  if (!text || text.startsWith("<")) return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const row = Array.isArray(data)
    ? data[0]
    : data && (data.screen_name || data.username)
      ? data
      : data && data.data && !Array.isArray(data.data)
        ? data.data
        : data && Array.isArray(data.data)
          ? data.data[0]
          : null;
  if (!row || typeof row !== "object") return null;
  if (!row.screen_name && !row.username && !row.name) return null;
  return row;
}

export function saveWorld(root, world) {
  fs.mkdirSync(path.dirname(worldPath(root)), { recursive: true });
  fs.writeFileSync(worldPath(root), JSON.stringify({ ...emptyWorld(), ...world }, null, 2), "utf8");
}

function slim(value) {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key === "dataUrl" && typeof v === "string" ? `[omitted ${v.length} chars]` : v))
  );
}

function firstNum(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function metricsFromTweet(tweet, mediaByKey) {
  const pub = tweet.public_metrics || {};
  const org = tweet.organic_metrics || {};
  const np = tweet.non_public_metrics || {};
  const keys = (tweet.attachments && tweet.attachments.media_keys) || [];
  let videoViews = null;
  for (const key of keys) {
    const m = mediaByKey.get(key) || {};
    const mp = m.public_metrics || {};
    const mo = m.organic_metrics || {};
    const v = firstNum(mo.view_count, mp.view_count, mo.playback_0_count, mp.playback_0_count);
    if (v != null) videoViews = (videoViews || 0) + v;
  }
  return {
    impressions: firstNum(org.impression_count, np.impression_count, pub.impression_count),
    likes: firstNum(org.like_count, pub.like_count),
    replies: firstNum(org.reply_count, pub.reply_count),
    reposts: firstNum(org.retweet_count, pub.retweet_count),
    quotes: firstNum(pub.quote_count),
    bookmarks: firstNum(pub.bookmark_count),
    profileClicks: firstNum(org.user_profile_clicks, np.user_profile_clicks),
    urlClicks: firstNum(org.url_link_clicks, np.url_link_clicks),
    videoViews,
    raw: { public_metrics: pub, organic_metrics: org, non_public_metrics: np }
  };
}

function mediaMap(includes) {
  const map = new Map();
  for (const m of (includes && includes.media) || []) map.set(m.media_key || m.id, m);
  return map;
}

function clip(raw) {
  return String(raw || "").replace(/\s+/g, " ").slice(0, 280);
}

function xErr(res) {
  const d = res.data || {};
  return d.title || d.detail || d.error || (d.errors && d.errors[0] && (d.errors[0].detail || d.errors[0].message)) || clip(res.raw) || `HTTP ${res.status}`;
}

async function xGet(store, url) {
  const token = tokenValue(store);
  if (!token) {
    return {
      status: 0,
      ok: false,
      data: { title: "skipped: no user access token" },
      raw: ""
    };
  }
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25000)
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }
  return { status: r.status, ok: r.status < 400, data, raw: raw.slice(0, 400) };
}

function upsert(list, row, key = "id") {
  const id = String(row[key] || row.localId || "");
  const idx = list.findIndex((p) => (id && String(p[key]) === id) || (row.localId && p.localId === row.localId));
  const next = { ...(idx >= 0 ? list[idx] : {}), ...row, updatedAt: new Date().toISOString() };
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  return next;
}

function asPosts(tweets, includes, username, status) {
  const media = mediaMap(includes);
  return (tweets || []).map((t) => ({
    id: String(t.id),
    url: `https://x.com/${username || "i"}/status/${t.id}`,
    status,
    text: t.text || "",
    createdAt: t.created_at,
    postedAt: t.created_at,
    conversationId: t.conversation_id,
    inReplyToUserId: t.in_reply_to_user_id,
    referenced: t.referenced_tweets || [],
    metrics: metricsFromTweet(t, media),
    metricsAt: new Date().toISOString(),
    source: "sync"
  }));
}

async function paged(store, firstUrl, pages) {
  const items = [];
  let includes = { media: [], users: [] };
  let url = firstUrl;
  let last = { status: 0, ok: false, data: {}, raw: "" };
  for (let i = 0; i < pages && url; i++) {
    last = await xGet(store, url);
    if (!last.ok) return { last, items, includes };
    items.push(...(last.data.data || []));
    const inc = last.data.includes || {};
    includes.media.push(...(inc.media || []));
    includes.users.push(...(inc.users || []));
    const next = last.data.meta && last.data.meta.next_token;
    if (!next) break;
    url = firstUrl.includes("pagination_token=")
      ? firstUrl.replace(/pagination_token=[^&]+/, `pagination_token=${encodeURIComponent(next)}`)
      : `${firstUrl}&pagination_token=${encodeURIComponent(next)}`;
  }
  return { last, items, includes };
}

export function recordPostResults(root, out) {
  const world = loadWorld(root);
  const store = loadXStore(root);
  const username = store.username || "i";
  for (const item of (out && out.posts) || []) {
    if (item.queued) {
      const row = {
        localId: `q-${Date.now()}`,
        status: "queued",
        scheduledAt: item.local && item.local.scheduleAt,
        text: (item.preview && item.preview.text) || "",
        payload: slim(item.preview),
        createdAt: new Date().toISOString(),
        source: "compose"
      };
      world.queue.unshift(row);
      upsert(world.posts, row, "localId");
      continue;
    }
    if (item.id) {
      upsert(world.posts, {
        id: String(item.id),
        url: item.url || `https://x.com/${username}/status/${item.id}`,
        status: "posted",
        text: item.text || "",
        payload: slim(item.payload),
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        source: "compose"
      });
    }
  }
  saveWorld(root, world);
}

export function recordFailed(root, input, error) {
  const world = loadWorld(root);
  const text = (input && input.thread && input.thread[0] && input.thread[0].text) || (input && input.text) || "";
  const row = {
    localId: `fail-${Date.now()}`,
    status: "failed",
    text,
    error: String(error || "unknown"),
    createdAt: new Date().toISOString(),
    source: "compose"
  };
  world.failed.unshift(row);
  upsert(world.posts, row, "localId");
  saveWorld(root, world);
}

export function saveDraft(root, draft) {
  const world = loadWorld(root);
  const row = {
    localId: draft.localId || `draft-${Date.now()}`,
    status: "draft",
    text: (draft.thread && draft.thread[0] && draft.thread[0].text) || draft.text || "",
    payload: slim(draft),
    createdAt: draft.at || new Date().toISOString(),
    source: "composer"
  };
  world.drafts = [row, ...world.drafts.filter((d) => d.localId !== row.localId)].slice(0, 80);
  upsert(world.posts, row, "localId");
  saveWorld(root, world);
  return row;
}

export function queueLocal(root, item) {
  const world = loadWorld(root);
  const row = {
    localId: item.id || `cal-${Date.now()}`,
    status: "queued",
    scheduledAt: item.when || item.scheduledAt,
    text: item.text || "",
    createdAt: new Date().toISOString(),
    source: "calendar"
  };
  world.queue.unshift(row);
  upsert(world.posts, row, "localId");
  saveWorld(root, world);
  return row;
}

export async function reloadOpenProfile(root, opts = {}) {
  const store = loadXStore(root);
  const username = String(store.username || store.expectedUsername || "").replace(/^@/, "");
  const summaryNow = () => readCommandCenter(root);
  if (!username) {
    return { ok: false, error: "Not signed in. Profile was not reloaded.", summary: summaryNow() };
  }
  const run = opts.run || runCmd;
  const whichFn = opts.which || which;
  let raw = "";
  let backend = "";
  try {
    if (whichFn("opencli")) {
      backend = "opencli";
      raw = await run("opencli", ["twitter", "profile", username, "-f", "json"]);
    } else if (whichFn("twitter")) {
      backend = "twitter-cli";
      raw = await run("twitter", ["user", username, "--json"]);
    } else {
      return { ok: false, error: "Profile was not reloaded. No X user token, and OpenCLI is not installed.", summary: summaryNow() };
    }
  } catch (err) {
    return { ok: false, error: "Profile was not reloaded. " + clip(err.message || err), summary: summaryNow() };
  }
  const user = parseProfilePayload(raw);
  if (!user) return { ok: false, error: "Profile was not reloaded. " + backend + " returned no user.", summary: summaryNow() };
  const world = loadWorld(root);
  const at = new Date().toISOString();
  applySignedInUser(world, user, at);
  if (world.profile.username) store.username = world.profile.username;
  if (world.profile.id) store.userId = world.profile.id;
  saveXStore(root, store);
  world.lastSync = {
    at,
    ok: true,
    reason: "refresh",
    source: backend,
    error: null,
    endpoints: [{ name: backend + " profile", status: 200, ok: true, count: 1 }]
  };
  saveWorld(root, world);
  return { ok: true, lastSync: world.lastSync, summary: summarize(world, xPublicStatus(store)) };
}

function pluginOnlyResult(root, reason) {
  const world = loadWorld(root);
  const started = new Date().toISOString();
  const next = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const endpoints = world.profile
    ? [{ name: "plugin get_users_me", status: 200, ok: true, count: 1 }]
    : [];
  const attempt = {
    at: started,
    ok: true,
    skipped: true,
    skipReason: "no_app_token",
    error: null,
    httpStatus: 200,
    endpoints,
    reason: reason || "refresh",
    source: "plugin-profile",
    nextRunAt: next
  };
  world.lastAttempt = attempt;
  world.lastSync = {
    ...(world.lastSync && world.lastSync.ok ? world.lastSync : {}),
    ...attempt,
    error: null,
    ok: true
  };
  saveWorld(root, world);
  return {
    ok: true,
    skipped: true,
    error: null,
    lastSync: world.lastSync,
    summary: summarize(world, xPublicStatus(loadXStore(root)))
  };
}

export async function syncXWorld(root, opts = {}) {
  const started = new Date().toISOString();
  const world = loadWorld(root);
  const endpoints = [];
  const pages = opts.full ? 8 : 3;
  if (!hasUserAccessToken(loadXStore(root))) {
    if ((opts.reason || "") === "refresh") return reloadOpenProfile(root, opts);
    return pluginOnlyResult(root, opts.reason || "refresh");
  }
  let store;
  try {
    store = await ensureAccess(root);
    if (!tokenValue(store)) return pluginOnlyResult(root, opts.reason || "refresh");
  } catch (err) {
    return pluginOnlyResult(root, opts.reason || "refresh");
  }

  async function hit(name, url, apply) {
    const res = await xGet(store, url);
    const row = { name, url: url.split("?")[0], status: res.status, ok: res.ok };
    if (!res.ok) {
      row.error = xErr(res);
      endpoints.push(row);
      return res;
    }
    try {
      const count = apply(res);
      row.count = typeof count === "number" ? count : undefined;
    } catch (err) {
      row.error = String(err.message || err);
    }
    endpoints.push(row);
    return res;
  }

  const meUrl = `${ME}?user.fields=${USER_FIELDS}`;
  const me = await hit("users/me", meUrl, (res) => {
    const u = res.data.data || {};
    applySignedInUser(world, u, started);
    if (u.username) store.username = u.username;
    if (u.id) store.userId = String(u.id);
    saveXStore(root, store);
    return 1;
  });
  if (!me.ok) {
    world.lastAttempt = { at: started, ok: false, error: xErr(me), httpStatus: me.status, endpoints, reason: opts.reason || "refresh" };
    if (!world.lastSync || !world.lastSync.ok) world.lastSync = world.lastAttempt;
    saveWorld(root, world);
    return { ok: false, error: world.lastAttempt.error, lastSync: world.lastSync, summary: summarize(world, xPublicStatus(store)) };
  }

  const userId = world.profile.id;
  const username = world.profile.username || store.username || "i";
  const tweetQ = `tweet.fields=${TWEET_FIELDS}&expansions=attachments.media_keys,author_id&media.fields=${MEDIA_FIELDS}&user.fields=username`;

  async function pullTweets(name, pathPart, destKey, status) {
    const first = `https://api.twitter.com/2/${pathPart}?max_results=100&${tweetQ}`;
    endpoints.push({ name: name + "/start", url: first.split("?")[0], status: 0 });
    let pack = await paged(store, first, pages);
    if (!pack.last.ok && /organic|non_public/i.test(xErr(pack.last) + JSON.stringify(pack.last.data || {}))) {
      const pub = tweetQ.replace(",non_public_metrics", "").replace(",organic_metrics", "");
      pack = await paged(store, `https://api.twitter.com/2/${pathPart}?max_results=100&${pub}`, pages);
    }
    const last = pack.last;
    const row = { name, url: first.split("?")[0], status: last.status, ok: last.ok };
    if (!last.ok) {
      row.error = xErr(last);
      endpoints[endpoints.length - 1] = row;
      return;
    }
    const mapped = asPosts(pack.items, pack.includes, username, status);
    if (destKey === "posts") {
      for (const p of mapped) upsert(world.posts, p);
    } else {
      world[destKey] = mapped;
    }
    row.count = mapped.length;
    endpoints[endpoints.length - 1] = row;
  }

  await pullTweets("users/:id/tweets", `users/${userId}/tweets`, "posts", "posted");
  await pullTweets("users/:id/mentions", `users/${userId}/mentions`, "mentions", "mention");
  await pullTweets("users/:id/liked_tweets", `users/${userId}/liked_tweets`, "likes", "liked");
  await pullTweets("users/:id/bookmarks", `users/${userId}/bookmarks`, "bookmarks", "bookmark");
  await pullTweets("timelines/reverse_chronological", `users/${userId}/timelines/reverse_chronological`, "home", "home");

  if (username) {
    const q = encodeURIComponent(`to:${username} is:reply`);
    await hit(
      "tweets/search/recent",
      `https://api.twitter.com/2/tweets/search/recent?max_results=50&query=${q}&${tweetQ}`,
      (res) => {
        const extra = asPosts(res.data.data || [], res.data.includes, username, "inbound-reply");
        const have = new Set(world.mentions.map((m) => m.id));
        for (const p of extra) {
          if (!have.has(p.id)) world.mentions.unshift(p);
        }
        return extra.length;
      }
    );
  }

  await hit(
    "users/:id/owned_lists",
    `https://api.twitter.com/2/users/${userId}/owned_lists?max_results=100`,
    (res) => {
      world.listsOwned = res.data.data || [];
      return world.listsOwned.length;
    }
  );
  await hit(
    "users/:id/followed_lists",
    `https://api.twitter.com/2/users/${userId}/followed_lists?max_results=100`,
    (res) => {
      world.listsFollowed = res.data.data || [];
      return world.listsFollowed.length;
    }
  );
  await hit(
    "users/:id/list_memberships",
    `https://api.twitter.com/2/users/${userId}/list_memberships?max_results=100`,
    (res) => {
      const extra = res.data.data || [];
      const ids = new Set(world.listsFollowed.map((l) => l.id));
      for (const l of extra) if (!ids.has(l.id)) world.listsFollowed.push(l);
      return extra.length;
    }
  );
  await hit(
    "users/:id/communities",
    `https://api.twitter.com/2/users/${userId}/communities?max_results=100`,
    (res) => {
      world.communities = res.data.data || [];
      return world.communities.length;
    }
  );
  await hit(
    "spaces/by/creator_ids",
    `https://api.twitter.com/2/spaces/by/creator_ids?user_ids=${userId}&space.fields=title,created_at,started_at,state,participant_count,subscriber_count`,
    (res) => {
      world.spaces = res.data.data || [];
      return world.spaces.length;
    }
  );

  const known = world.posts.filter((p) => p.id && p.status === "posted").map((p) => String(p.id)).slice(0, 100);
  if (known.length) {
    await hit(
      "tweets lookup",
      `${TWEETS}?ids=${known.join(",")}&${tweetQ}`,
      (res) => {
        const mapped = asPosts(res.data.data || [], res.data.includes, username, "posted");
        for (const p of mapped) upsert(world.posts, p);
        return mapped.length;
      }
    );
  }

  const qpath = path.join(root, "data", "x-queue.json");
  try {
    const q = JSON.parse(fs.readFileSync(qpath, "utf8"));
    if (Array.isArray(q) && q.length) {
      world.queue = q.map((item, i) => ({
        localId: `file-${i}`,
        status: "queued",
        scheduledAt: item.at,
        text: (item.body && item.body.text) || "",
        payload: item.body,
        source: "queue-file"
      }));
    }
  } catch {
    /* none */
  }

  world.lastSync = {
    at: started,
    ok: endpoints.some((e) => e.ok),
    httpStatus: (endpoints.find((e) => !e.ok && e.status >= 400) || {}).status || 200,
    error: endpoints.filter((e) => e.error).map((e) => `${e.name}: ${e.error}`).join(" · ") || null,
    endpoints,
    reason: opts.reason || "refresh"
  };
  saveWorld(root, world);
  return {
    ok: world.lastSync.ok,
    error: world.lastSync.error,
    lastSync: world.lastSync,
    summary: summarize(world, xPublicStatus(store))
  };
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

function streakDays(posts) {
  const days = new Set(
    posts.filter((p) => p.status === "posted" && (p.postedAt || p.createdAt)).map((p) => dayKey(p.postedAt || p.createdAt))
  );
  if (!days.size) return 0;
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const key = d.toISOString().slice(0, 10);
    if (!days.has(key)) {
      if (n === 0) {
        d.setUTCDate(d.getUTCDate() - 1);
        continue;
      }
      break;
    }
    n += 1;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

function heatmap(posts) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const p of posts) {
    if (p.status !== "posted") continue;
    const iso = p.postedAt || p.createdAt;
    if (!iso) continue;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) continue;
    grid[dt.getUTCDay()][dt.getUTCHours()] += 1;
  }
  return grid;
}

function rankScore(p) {
  const m = p.metrics || {};
  if (m.impressions != null) return m.impressions;
  let n = 0;
  let any = false;
  for (const k of ["likes", "replies", "reposts", "quotes", "bookmarks", "profileClicks", "videoViews"]) {
    if (m[k] != null) {
      n += m[k];
      any = true;
    }
  }
  return any ? n : null;
}

function sumField(posts, field) {
  let total = 0;
  let any = false;
  for (const p of posts) {
    const v = p.metrics && p.metrics[field];
    if (typeof v === "number") {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

export function summarize(world, x) {
  const posts = world.posts || [];
  const posted = posts.filter((p) => p.status === "posted");
  const scored = posted
    .map((p) => ({ p, score: rankScore(p) }))
    .filter((row) => row.score != null)
    .sort((a, b) => b.score - a.score);
  const last7 = Date.now() - 7 * 86400000;
  const week = posted.filter((p) => {
    const t = Date.parse(p.postedAt || p.createdAt || "");
    return Number.isFinite(t) && t >= last7;
  });
  const prof = world.profile && world.profile.metrics ? world.profile.metrics : {};
  const tokenOn = Boolean(x && (x.signedIn || x.hasToken || x.appOAuth));
  const gap = !tokenOn && !posted.length ? "not_pulled_zero_credits" : "need_posts";
  const gapAnalytics = !tokenOn && !posted.length ? "not_pulled_zero_credits" : "need_signin_analytics";
  return {
    x: x || {},
    profile: world.profile,
    lastSync: world.lastSync,
    counts: {
      posted: posted.length,
      queued: (world.queue || []).length + posts.filter((p) => p.status === "queued").length,
      draft: (world.drafts || []).length + posts.filter((p) => p.status === "draft").length,
      failed: (world.failed || []).length + posts.filter((p) => p.status === "failed").length,
      mentions: (world.mentions || []).length,
      bookmarks: (world.bookmarks || []).length,
      likes: (world.likes || []).length,
      lists: (world.listsOwned || []).length + (world.listsFollowed || []).length,
      communities: (world.communities || []).length,
      spaces: (world.spaces || []).length,
      home: (world.home || []).length
    },
    followers: typeof prof.followers_count === "number" ? prof.followers_count : null,
    following: typeof prof.following_count === "number" ? prof.following_count : null,
    tweetCount: typeof prof.tweet_count === "number" ? prof.tweet_count : null,
    accountLikes: typeof prof.like_count === "number" ? prof.like_count : null,
    followerDelta: world.profile ? world.profile.followerDelta : null,
    totals: {
      impressions: sumField(posted, "impressions"),
      likes: sumField(posted, "likes"),
      replies: sumField(posted, "replies"),
      reposts: sumField(posted, "reposts"),
      quotes: sumField(posted, "quotes"),
      bookmarks: sumField(posted, "bookmarks"),
      profileClicks: sumField(posted, "profileClicks"),
      urlClicks: sumField(posted, "urlClicks"),
      videoViews: sumField(posted, "videoViews")
    },
    metricStatus: {
      likes: posted.some((p) => p.metrics && p.metrics.likes != null) ? "live" : gap,
      replies: posted.some((p) => p.metrics && p.metrics.replies != null) ? "live" : gap,
      reposts: posted.some((p) => p.metrics && p.metrics.reposts != null) ? "live" : gap,
      quotes: posted.some((p) => p.metrics && p.metrics.quotes != null) ? "live" : gap,
      bookmarks: posted.some((p) => p.metrics && p.metrics.bookmarks != null) ? "live" : gap,
      impressions: posted.some((p) => p.metrics && p.metrics.impressions != null) ? "live" : gapAnalytics,
      videoViews: posted.some((p) => p.metrics && p.metrics.videoViews != null) ? "live" : gapAnalytics,
      profileClicks: posted.some((p) => p.metrics && p.metrics.profileClicks != null) ? "live" : gapAnalytics
    },
    week: {
      posts: week.length,
      impressions: sumField(week, "impressions"),
      likes: sumField(week, "likes"),
      replies: sumField(week, "replies"),
      reposts: sumField(week, "reposts")
    },
    streak: streakDays(posted),
    heatmap: heatmap(posted),
    best: scored.slice(0, 5).map((row) => row.p),
    worst: scored.slice(-5).reverse().map((row) => row.p),
    recent: posted.slice(0, 25),
    mentions: (world.mentions || []).slice(0, 40),
    bookmarks: (world.bookmarks || []).slice(0, 25),
    listsOwned: world.listsOwned || [],
    listsFollowed: world.listsFollowed || [],
    communities: world.communities || [],
    spaces: world.spaces || [],
    queue: (world.queue || []).slice(0, 40),
    drafts: (world.drafts || []).slice(0, 40),
    failed: (world.failed || []).slice(0, 40),
    posts: posts.slice(0, 200)
  };
}

export function readCommandCenter(root) {
  return summarize(loadWorld(root), xPublicStatus(loadXStore(root)));
}
