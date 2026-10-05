import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import test from "node:test";
import { HousexClient, classifyHousexResponse, stripAutoDm } from "../public/housex-client.mjs";
import {
  allowHousexBase,
  handleHousexProxy,
  housexSuffix,
  isDmPath
} from "../housex-proxy.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test("loopback bases are accepted and other hosts are refused", () => {
  assert.equal(allowHousexBase("http://127.0.0.1:8787/v1").base, "http://127.0.0.1:8787/v1");
  assert.equal(allowHousexBase("http://localhost:8787/v1/").base, "http://localhost:8787/v1");
  assert.equal(allowHousexBase("https://api.superx.so/v1").ok, false);
  assert.equal(allowHousexBase("http://api.superx.so/v1").ok, false);
  assert.equal(allowHousexBase("http://127.0.0.1:8787/v1?x=1").base, "http://127.0.0.1:8787/v1");
  assert.equal(allowHousexBase("http://hxk_secret@127.0.0.1:8787/v1").ok, false);
  assert.equal(allowHousexBase("http://example.com/v1").ok, false);
  assert.equal(allowHousexBase("https://127.0.0.1:8787/v1").ok, false);
});

test("proxy paths reject traversal and DM routes", () => {
  assert.equal(housexSuffix("/api/housex/me"), "/me");
  assert.equal(housexSuffix("/api/housex/posts/analytics"), "/posts/analytics");
  assert.equal(housexSuffix("/api/housex/%2e%2e/secret"), null);
  assert.equal(isDmPath("/dm"), true);
  assert.equal(isDmPath("/direct-messages/send"), true);
  assert.equal(isDmPath("/me"), false);
});

test("classifier keeps 501, 401, and 429 as failures", () => {
  const stub = classifyHousexResponse(501, { error: { code: "not_implemented", message: "inspiration later" } });
  assert.equal(stub.ok, false);
  assert.equal(stub.kind, "not_implemented");
  assert.equal(stub.data, null);

  const denied = classifyHousexResponse(401, { error: { code: "invalid_api_key", message: "bad key" } });
  assert.equal(denied.kind, "unauthorized");

  const limited = classifyHousexResponse(429, { error: { code: "rate_limited", message: "slow down" } }, (name) => (name === "retry-after" ? "12" : null));
  assert.equal(limited.kind, "rate_limited");
  assert.equal(limited.retryAfter, 12);

  const ok = classifyHousexResponse(200, { data: { id: "me" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { id: "me" });
});

test("auto-DM fields are stripped before a write", () => {
  assert.deepEqual(stripAutoDm({ text: "hi", auto_dm: { message: "secret" }, title: "t" }), { text: "hi", title: "t" });
});

test("proxy forwards bearer auth, passes 501 through, and refuses other hosts", async () => {
  let hits = 0;
  let seenAuth = "";
  let seenBody = "";
  const upstream = http.createServer((req, res) => {
    hits += 1;
    seenAuth = req.headers.authorization || "";
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seenBody = Buffer.concat(chunks).toString("utf8");
      if (req.url.startsWith("/v1/inspiration")) {
        res.writeHead(501, { "content-type": "application/json", "retry-after": "3" });
        res.end(JSON.stringify({ error: { code: "not_implemented", message: "inspiration later" } }));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "59"
      });
      res.end(JSON.stringify({ data: { id: "jeremy" } }));
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    handleHousexProxy(req, res, url, { HOUSEX_API_URL: `http://127.0.0.1:${upstreamPort}/v1` });
  });
  const proxyPort = await listen(proxy);
  try {
    const me = await fetch(`http://127.0.0.1:${proxyPort}/api/housex/me`, {
      headers: { authorization: "Bearer hxk_test" }
    });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get("x-housex-upstream"), `http://127.0.0.1:${upstreamPort}/v1`);
    assert.deepEqual(await me.json(), { data: { id: "jeremy" } });
    assert.equal(seenAuth, "Bearer hxk_test");

    const stub = await fetch(`http://127.0.0.1:${proxyPort}/api/housex/inspiration?q=build`);
    assert.equal(stub.status, 501);
    const stubBody = await stub.json();
    assert.equal(stubBody.error.code, "not_implemented");

    const client = new HousexClient({
      apiKey: "hxk_test",
      origin: `http://127.0.0.1:${proxyPort}`
    });
    const classified = await client.call("GET", "/inspiration", { query: { q: "build" } });
    assert.equal(classified.kind, "not_implemented");
    assert.equal(classified.ok, false);

    hits = 0;
    const refused = await fetch(`http://127.0.0.1:${proxyPort}/api/housex/me`, {
      headers: { "x-housex-base": "https://api.superx.so/v1", authorization: "Bearer hxk_test" }
    });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error.code, "upstream_refused");
    assert.equal(hits, 0);

    const dm = await fetch(`http://127.0.0.1:${proxyPort}/api/housex/dm`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(dm.status, 403);

    const write = await fetch(`http://127.0.0.1:${proxyPort}/api/housex/scheduled-posts`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer hxk_test" },
      body: JSON.stringify({ text: "draft", auto_dm: { message: "do not send" } })
    });
    assert.equal(write.status, 200);
    assert.deepEqual(JSON.parse(seenBody), { text: "draft" });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("desk UI does not name or call the hosted product", () => {
  const ui = fs.readFileSync(new URL("../public/housex.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/housex.css", import.meta.url), "utf8");
  assert.doesNotMatch(ui + css, /superx/i);
  assert.match(ui, /not implemented/);
  assert.match(ui, /localStorage/);
});
