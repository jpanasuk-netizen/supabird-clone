// Click Refresh profile on the dashboard and confirm the signed-in profile repaints.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function summary(profile, followers) {
  return {
    ok: true,
    summary: {
      x: { signedIn: false, appOAuth: false, hasToken: false, pluginConnected: true, username: profile.username, userId: profile.id },
      profile,
      followers,
      following: 3,
      tweetCount: 7,
      followerDelta: null,
      counts: {},
      totals: {},
      metricStatus: {},
      week: {},
      lastSync: { at: profile.capturedAt, ok: true, reason: profile.capturedAt === "old" ? "saved" : "refresh" }
    }
  };
}

const OLD = { id: "1", username: "stale_handle", name: "Stale Name", description: "", capturedAt: "2020-01-01T00:00:00.000Z", metrics: { followers_count: 10, following_count: 3, tweet_count: 7 } };
const FRESH = { id: "1", username: "fresh_handle", name: "Fresh Name", description: "updated bio", capturedAt: "2026-10-05T12:00:00.000Z", metrics: { followers_count: 42, following_count: 3, tweet_count: 7 } };

test("Refresh profile click reloads the signed-in profile into the dashboard", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    hits.push(url.pathname + url.search);
    if (url.pathname === "/api/x/status") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ signedIn: false, appOAuth: false, hasToken: false, pluginConnected: true, username: "stale_handle", userId: "1" }));
      return;
    }
    if (url.pathname === "/api/x/stats") {
      const body = url.searchParams.get("refresh") === "1" ? summary(FRESH, 42) : summary(OLD, 10);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === "/api/x/ingest") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ inFlight: false }));
      return;
    }
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const abs = path.resolve(PUBLIC, file.replace(/^\/+/, ""));
    if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs)) {
      res.writeHead(404).end("no");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(abs)] || "text/plain", "cache-control": "no-store" });
    res.end(fs.readFileSync(abs));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const debugPort = 9400 + (port % 100);
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=/tmp/chrome-profile-click-" + port
  ], { stdio: "ignore" });
  try {
    let version;
    for (let i = 0; i < 40; i++) {
      try {
        version = await fetch("http://127.0.0.1:" + debugPort + "/json/version");
        if (version.ok) break;
      } catch { /* chrome still starting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!version || !version.ok) throw new Error("Chrome debug port did not open");
    const tab = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + port + "/#/dashboard"), { method: "PUT" }).then((r) => r.json());
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const send = (method, params) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send("Runtime.enable");
    const evalJs = async (expression) => {
      const msg = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
      return msg.result && msg.result.result && msg.result.result.value;
    };
    await evalJs("if (!location.hash.includes('dashboard')) location.hash = '#/dashboard'");
    let sawOld = false;
    for (let i = 0; i < 40; i++) {
      const text = await evalJs("document.querySelector('#live') ? document.querySelector('#live').innerText : ''");
      if (String(text).includes("Stale Name")) { sawOld = true; break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(sawOld, true, "dashboard should paint the saved profile before the click");
    const before = hits.filter((h) => h.startsWith("/api/x/stats"));
    assert.ok(before.every((h) => h === "/api/x/stats"), "first paint must not be a refresh");
    await evalJs("document.querySelector('#x-refresh').click()");
    let fresh = "";
    for (let i = 0; i < 40; i++) {
      fresh = await evalJs("document.querySelector('#live') ? document.querySelector('#live').innerText : ''");
      if (String(fresh).includes("Fresh Name") && String(fresh).includes("42")) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.match(String(fresh), /Fresh Name/);
    assert.match(String(fresh), /@fresh_handle/);
    assert.match(String(fresh), /42/);
    assert.match(String(fresh), /updated bio/);
    assert.ok(hits.includes("/api/x/stats?refresh=1"), "click must request /api/x/stats?refresh=1");
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }
});
