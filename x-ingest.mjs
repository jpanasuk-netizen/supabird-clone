import { hasUserAccessToken, loadXStore } from "./x-oauth.mjs";
import { loadWorld, readCommandCenter, saveWorld, syncXWorld } from "./x-sync.mjs";

export const INGEST_MS = 10 * 60 * 1000;

let inFlight = null;
let pending = null;
let timer = null;
let nextRunAt = 0;
let armedAt = "";

const REASONS = new Set(["signin", "interval", "post", "refresh"]);
const RANK = { post: 4, signin: 3, refresh: 2, interval: 1 };

function why(reason) {
  return REASONS.has(reason) ? reason : "refresh";
}

function setPending(reason) {
  const rsn = why(reason);
  if (!pending || (RANK[rsn] || 0) >= (RANK[pending] || 0)) pending = rsn;
}

export function ingestStatus(root) {
  const world = loadWorld(root);
  return {
    armed: Boolean(timer),
    intervalMs: INGEST_MS,
    intervalMinutes: 10,
    inFlight: Boolean(inFlight),
    pending,
    nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
    armedAt: armedAt || null,
    lastSync: world.lastSync || null,
    lastAttempt: world.lastAttempt || null
  };
}

function stamp(root, reason, extra) {
  const world = loadWorld(root);
  const next = new Date(Date.now() + INGEST_MS).toISOString();
  nextRunAt = Date.now() + INGEST_MS;
  const attempt = {
    ...(world.lastSync || {}),
    ...extra,
    reason,
    nextRunAt: next
  };
  world.lastAttempt = attempt;
  if (extra && extra.ok) {
    world.lastSync = attempt;
  } else if (world.lastSync && world.lastSync.ok) {
    world.lastSync.nextRunAt = next;
  } else {
    world.lastSync = attempt;
  }
  saveWorld(root, world);
  return world.lastSync;
}

async function doIngest(root, reason) {
  if (!hasUserAccessToken(loadXStore(root))) {
    const out = await syncXWorld(root, { reason, full: false });
    stamp(root, reason, {
      ...(out.lastSync || {}),
      ok: true,
      skipped: true,
      error: null,
      at: (out.lastSync && out.lastSync.at) || new Date().toISOString()
    });
    return {
      ...out,
      ok: true,
      skipped: true,
      error: null,
      lastSync: loadWorld(root).lastSync,
      ingest: ingestStatus(root),
      summary: readCommandCenter(root)
    };
  }
  const out = await syncXWorld(root, { full: reason === "signin", reason });
  stamp(root, reason, {
    ...(out.lastSync || {}),
    ok: Boolean(out.ok),
    error: out.error || (out.lastSync && out.lastSync.error) || null,
    at: (out.lastSync && out.lastSync.at) || new Date().toISOString()
  });
  return {
    ...out,
    lastSync: loadWorld(root).lastSync,
    ingest: ingestStatus(root),
    summary: readCommandCenter(root)
  };
}

async function drain(root) {
  let last = { ok: false, error: "ingest did not run" };
  let overlapped = false;
  try {
    while (pending) {
      const r = pending;
      pending = null;
      last = await doIngest(root, r);
      if (pending) overlapped = true;
    }
    return { ...last, overlap: overlapped };
  } finally {
    inFlight = null;
    if (pending) {
      overlapped = true;
      inFlight = drain(root);
      const trailing = await inFlight;
      last = { ...trailing, overlap: true };
      return last;
    }
  }
}

export async function runIngest(root, reason) {
  setPending(reason);
  if (!inFlight) inFlight = drain(root);
  const out = await inFlight;
  return { ...out, ingest: ingestStatus(root) };
}

export function armIngestTimer(root) {
  if (timer) return ingestStatus(root);
  armedAt = new Date().toISOString();
  nextRunAt = Date.now() + INGEST_MS;
  timer = setInterval(() => {
    nextRunAt = Date.now() + INGEST_MS;
    const store = loadXStore(root);
    if (!hasUserAccessToken(store)) {
      console.log("X ingest interval skip (no user access token)");
      return;
    }
    if (inFlight) {
      setPending("interval");
      console.log("X ingest interval overlap — queued behind in-flight sync");
      return;
    }
    console.log("X ingest interval tick");
    runIngest(root, "interval")
      .then((out) => {
        console.log(`X ingest interval done ok=${out.ok} reason=interval`);
      })
      .catch((err) => {
        console.error("X ingest interval error", String(err.message || err));
      });
  }, INGEST_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`X ingest timer armed every ${INGEST_MS}ms at ${armedAt}`);
  return ingestStatus(root);
}
