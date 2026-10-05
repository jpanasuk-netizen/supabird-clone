// HouseX /v1 client. The API key stays in the browser; requests go to Blue Jay's
// same-origin proxy, which forwards Bearer auth and does not store the key.

export function stripAutoDm(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const next = { ...body };
  delete next.auto_dm;
  delete next.autoDm;
  delete next.dm_message;
  return next;
}

export function unwrapHousex(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

function errorParts(payload, status) {
  const err = payload && payload.error;
  let code = `http_${status || 0}`;
  let message = status ? `Request failed with HTTP ${status}` : "Could not reach HouseX";
  if (err && typeof err === "object") {
    if (typeof err.code === "string" && err.code) code = err.code;
    if (typeof err.message === "string" && err.message) message = err.message;
  } else if (typeof err === "string" && err) {
    code = err.split(":")[0].trim() || code;
    message = err;
  } else if (payload && typeof payload.message === "string" && payload.message) {
    message = payload.message;
    if (typeof payload.code === "string" && payload.code) code = payload.code;
  }
  return { code, message };
}

function headerNum(get, name) {
  if (!get) return null;
  const raw = get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a HouseX response. HTTP 501 (or a not_implemented code) is never ok.
 * headerGet(name) reads a response header, lowercase names.
 */
export function classifyHousexResponse(status, payload, headerGet) {
  const get = typeof headerGet === "function" ? headerGet : () => null;
  const { code, message } = errorParts(payload, status);
  const retryAfter = headerNum(get, "retry-after");
  const rate = get("x-ratelimit-limit") == null ? null : {
    limit: headerNum(get, "x-ratelimit-limit"),
    remaining: headerNum(get, "x-ratelimit-remaining"),
    reset: headerNum(get, "x-ratelimit-reset")
  };
  const upstream = get("x-housex-upstream") || null;
  const base = { status: status || 0, code, message, retryAfter, rate, upstream, raw: payload ?? null, data: null };

  const stub = status === 501 || code === "not_implemented" || code === "not_implemented_yet";
  if (stub) {
    return { ...base, ok: false, kind: "not_implemented", message: message || "This HouseX endpoint is not implemented." };
  }
  if (status === 401 || code === "invalid_api_key") {
    return { ...base, ok: false, kind: "unauthorized" };
  }
  if (status === 429 || code === "rate_limited") {
    return { ...base, ok: false, kind: "rate_limited" };
  }
  if (!status || code === "network_error" || code === "upstream_unreachable") {
    return { ...base, ok: false, kind: "unreachable" };
  }
  if (status >= 400) {
    return { ...base, ok: false, kind: "error" };
  }
  return { ...base, ok: true, kind: "ok", message: "", data: unwrapHousex(payload) };
}

export function listFromHousex(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const keys = ["items", "posts", "accounts", "contacts", "leads", "agents", "feeds", "tags", "lists", "results", "members", "replies", "scheduled_posts", "articles"];
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }
  return null;
}

function queryString(query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class HousexClient {
  constructor({ apiKey = "", upstream = "", origin = "http://127.0.0.1:3100", fetchImpl } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.upstream = String(upstream || "").trim();
    this.origin = origin;
    // Call fetch with the global this. Browsers throw Illegal invocation if the
    // host function is detached and invoked as a method of this client.
    const impl = fetchImpl || globalThis.fetch;
    this.fetchImpl = (input, init) => impl.call(globalThis, input, init);
  }

  async call(method, path, { query, body, idempotencyKey } = {}) {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    if (/\/(dm|dms|direct-messages|direct_messages)(\/|$)/i.test(suffix)) {
      return classifyHousexResponse(403, {
        error: { code: "dm_blocked", message: "Blue Jay does not send DMs." }
      });
    }
    const url = new URL(`/api/housex${suffix}${queryString(query)}`, this.origin);
    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.upstream) headers["X-HouseX-Base"] = this.upstream;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(stripAutoDm(body));
      headers["Content-Type"] = "application/json";
    }
    let response;
    try {
      response = await this.fetchImpl(url, { method, headers, body: payload });
    } catch (err) {
      return classifyHousexResponse(0, {
        error: { code: "network_error", message: `Could not reach HouseX (${err && err.message ? err.message : err})` }
      });
    }
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: { code: "bad_json", message: text.slice(0, 240) } };
      }
    }
    const get = (name) => response.headers.get(name);
    return classifyHousexResponse(response.status, json, get);
  }
}
