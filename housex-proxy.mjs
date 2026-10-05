// Same-origin proxy from Blue Jay to a loopback HouseX API.
// The Bearer key is forwarded per request and never written to disk.
import { stripAutoDm } from "./public/housex-client.mjs";

export const HOUSEX_PROXY_PREFIX = "/api/housex";
export const DEFAULT_HOUSEX_BASE = "http://127.0.0.1:8787/v1";
const MAX_BODY = 1_000_000;

export function isHousexProxyPath(pathname) {
  return pathname === HOUSEX_PROXY_PREFIX || pathname.startsWith(`${HOUSEX_PROXY_PREFIX}/`);
}

export function housexSuffix(pathname) {
  if (!isHousexProxyPath(pathname)) return null;
  let rest = pathname.slice(HOUSEX_PROXY_PREFIX.length) || "/";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (rest.includes("..") || rest.includes("\\") || rest.includes("\0")) return null;
  return rest;
}

export function isDmPath(suffix) {
  return /\/(dm|dms|direct-messages|direct_messages)(\/|$)/i.test(suffix || "");
}

/** Loopback HTTP only. Rejects userinfo and any superx host. */
export function allowHousexBase(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "empty" };
  if (/superx/i.test(s)) return { ok: false, error: "refused host" };
  let url;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, error: "bad url" };
  }
  if (url.username || url.password) return { ok: false, error: "no userinfo" };
  if (url.protocol !== "http:") return { ok: false, error: "http only" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return { ok: false, error: "loopback only" };
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, base: `${url.protocol}//${url.host}${path}` };
}

export function resolveHousexBase(headerValue, envValue) {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const candidate = String(header || "").trim() || String(envValue || "").trim() || DEFAULT_HOUSEX_BASE;
  return allowHousexBase(candidate);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function prepareBody(buf) {
  if (!buf || !buf.length) return undefined;
  const text = buf.toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error("HouseX proxy expected JSON");
    err.status = 400;
    throw err;
  }
  return JSON.stringify(stripAutoDm(parsed));
}

export async function handleHousexProxy(req, res, url, env = process.env, fetchImpl = globalThis.fetch) {
  const method = req.method || "GET";
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    return;
  }
  const suffix = housexSuffix(url.pathname);
  if (!suffix) {
    sendJson(res, 400, { error: { code: "bad_path", message: "Path not allowed" } });
    return;
  }
  if (isDmPath(suffix)) {
    sendJson(res, 403, { error: { code: "dm_blocked", message: "Blue Jay does not send DMs." } });
    return;
  }
  const resolved = resolveHousexBase(req.headers["x-housex-base"], env.HOUSEX_API_URL);
  if (!resolved.ok) {
    sendJson(res, 400, {
      error: {
        code: "upstream_refused",
        message: "HouseX API URL must be loopback HTTP. Blue Jay will not proxy any other host."
      }
    });
    return;
  }
  let outbound;
  try {
    if (method !== "GET" && method !== "DELETE") outbound = prepareBody(await readBody(req));
  } catch (err) {
    sendJson(res, err.status || 400, { error: { code: "bad_body", message: String(err.message || err) } });
    return;
  }
  const headers = { accept: "application/json" };
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth) headers.authorization = auth;
  const idem = req.headers["idempotency-key"];
  if (typeof idem === "string" && idem) headers["idempotency-key"] = idem.slice(0, 200);
  if (outbound !== undefined) headers["content-type"] = "application/json";
  const target = resolved.base + suffix + (url.search || "");
  let upstream;
  try {
    upstream = await fetchImpl(target, {
      method,
      headers,
      body: outbound,
      redirect: "manual",
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    sendJson(res, 502, {
      error: {
        code: "upstream_unreachable",
        message: `HouseX API is not reachable at ${resolved.base}`
      }
    });
    return;
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    sendJson(res, 502, {
      error: {
        code: "upstream_redirect",
        message: "HouseX API returned a redirect. Blue Jay does not follow it."
      }
    });
    return;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  const out = {
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-housex-upstream": resolved.base
  };
  for (const name of ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
    const value = upstream.headers.get(name);
    if (value) out[name] = value;
  }
  res.writeHead(upstream.status, out);
  res.end(buf);
}
