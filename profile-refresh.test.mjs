import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySignedInUser, countOrNull, parseProfilePayload, reloadOpenProfile, readCommandCenter } from "./x-sync.mjs";
import { loadXStore, saveXStore } from "./x-oauth.mjs";

test("counts stay blank when the profile payload omits them", () => {
  assert.equal(countOrNull(undefined), null);
  assert.equal(countOrNull(""), null);
  assert.equal(countOrNull("104M"), null);
  assert.equal(countOrNull(0), 0);
  assert.equal(countOrNull("1,415"), 1415);
});

test("applySignedInUser replaces the signed-in profile and keeps a real delta", () => {
  const world = { profile: null, followerHistory: [{ at: "2020-01-01T00:00:00.000Z", followers: 10 }] };
  const profile = applySignedInUser(world, {
    id: "99",
    username: "fresh_handle",
    name: "Fresh Name",
    description: "updated bio",
    public_metrics: { followers_count: 42, following_count: 3, tweet_count: 7 }
  }, "2026-10-05T00:00:00.000Z");
  assert.equal(profile.username, "fresh_handle");
  assert.equal(profile.name, "Fresh Name");
  assert.equal(profile.description, "updated bio");
  assert.equal(profile.metrics.followers_count, 42);
  assert.equal(profile.followerDelta, 32);
  assert.equal(profile.capturedAt, "2026-10-05T00:00:00.000Z");
});

test("refresh without an X token reloads the signed-in profile from OpenCLI", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bj-profile-"));
  saveXStore(root, { ...loadXStore(root), username: "stale_handle", userId: "1" });
  const calls = [];
  const out = await reloadOpenProfile(root, {
    which: (cmd) => cmd === "opencli",
    run: async (bin, args) => {
      calls.push([bin, args]);
      return JSON.stringify({
        screen_name: "fresh_handle",
        name: "Fresh Name",
        bio: "from opencli",
        followers: 42,
        following: 3,
        tweets: 7
      });
    }
  });
  assert.equal(out.ok, true);
  assert.equal(calls[0][0], "opencli");
  assert.deepEqual(calls[0][1].slice(0, 3), ["twitter", "profile", "stale_handle"]);
  const summary = readCommandCenter(root);
  assert.equal(summary.profile.username, "fresh_handle");
  assert.equal(summary.profile.name, "Fresh Name");
  assert.equal(summary.followers, 42);
  assert.equal(summary.following, 3);
  assert.equal(summary.tweetCount, 7);
  assert.equal(loadXStore(root).username, "fresh_handle");
  assert.equal(parseProfilePayload("<html>"), null);
});
