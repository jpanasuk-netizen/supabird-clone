import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseBackend,
  cliBlocked,
  instagramAccount,
  instagramLoginWall,
  isCreditBlock,
  parseHandleList,
  parseJinaInstagram,
  postsFromText,
  reportFromPosts,
  reportSource,
  searchX,
  threadReplies
} from "./reach.mjs";

const TWEET = {
  id: "100",
  author: "nasa",
  text: "Artemis is on the pad",
  likes: 12,
  views: 340,
  url: "https://x.com/i/status/100"
};

test("xAI stays primary until credits or the key fail", () => {
  assert.equal(chooseBackend({ reach: "auto", hasKey: true }), "xai");
  assert.equal(chooseBackend({ reach: "auto", hasKey: true, creditBlocked: true }), "reach");
  assert.equal(chooseBackend({ reach: "auto", hasKey: false }), "reach");
  assert.equal(chooseBackend({ reach: "only", hasKey: true }), "reach");
  assert.equal(chooseBackend({ reach: "off", hasKey: true }), "xai");
  assert.equal(chooseBackend({ reach: "off", hasKey: false }), "stop");
});

test("credit block is auth, billing, and quota — not a server error", () => {
  assert.equal(isCreditBlock({ status: 401, message: "nope" }), true);
  assert.equal(isCreditBlock({ status: 403, message: "Your team has no credits" }), true);
  assert.equal(isCreditBlock({ status: 429, message: "quota" }), true);
  assert.equal(isCreditBlock({ status: 500, message: "boom" }), false);
  assert.equal(isCreditBlock({ status: 404, message: "model not found" }), false);
  assert.equal(isCreditBlock(new Error("insufficient credits")), true);
});

test("parses OpenCLI JSON and does not invent a missing view count", () => {
  const posts = postsFromText(JSON.stringify([{ author: "nasa", text: "hi", likes: 0, url: "https://x.com/nasa/status/5" }]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].likes, 0);
  assert.equal(posts[0].views, null);
  assert.equal(posts[0].engagement, "likes 0");
  assert.equal(posts[0].url, "https://x.com/nasa/status/5");
});

test("parses a YAML list and a wrapped data array", () => {
  const yaml = `- id: "9"\n  author: esa\n  text: "hello: world"\n  url: https://x.com/esa/status/9\n  likes: 3\n`;
  const posts = postsFromText(yaml);
  assert.equal(posts[0].text, "hello: world");
  assert.equal(posts[0].url, "https://x.com/esa/status/9");
  const wrapped = postsFromText(JSON.stringify({ data: [TWEET] }));
  assert.equal(wrapped[0].author, "nasa");
  assert.equal(wrapped[0].views, 340);
});

test("a tweet that mentions rate limits is still a tweet", () => {
  const posts = postsFromText(JSON.stringify([{ author: "a", text: "rate limit talk", url: "https://x.com/a/status/8" }]));
  assert.equal(posts.length, 1);
});

test("HTML and navigation rejected are blocked pages", () => {
  assert.equal(cliBlocked("<html>login</html>"), true);
  assert.equal(cliBlocked("Navigation rejected"), true);
  assert.throws(() => postsFromText("<html>nope</html>"));
});

test("report quotes only the posts it was given", () => {
  const md = reportFromPosts([
    { author: "nasa", text: "Line one\nline two", url: "https://x.com/nasa/status/100", engagement: "likes 12" }
  ], "opencli");
  assert.match(md, /^Source: AgentReach via opencli\./);
  assert.equal(reportSource(md), "reach:opencli");
  assert.match(md, /https:\/\/x\.com\/nasa\/status\/100/);
  assert.doesNotMatch(md, /status\/999/);
  assert.match(md, /Line one line two/);
  assert.equal(reportSource("### Grok topic\n"), "xai");
  assert.throws(() => reportFromPosts([{ author: "a", text: "no url", url: "" }], "opencli"));
});

test("search tries twitter-cli before OpenCLI", async () => {
  const calls = [];
  const found = await searchX("court rulings", {
    limit: 2,
    which: (cmd) => cmd === "twitter" || cmd === "opencli",
    run: async (bin) => {
      calls.push(bin);
      if (bin === "twitter") throw new Error("no cookies");
      return JSON.stringify([TWEET, { author: "x", text: "second", url: "https://x.com/x/status/2" }]);
    }
  });
  assert.deepEqual(calls, ["twitter", "opencli"]);
  assert.equal(found.backend, "opencli");
  assert.equal(found.posts.length, 2);
});

test("thread replies drop the focal post and anything without a status URL", async () => {
  const replies = await threadReplies("https://x.com/nasa/status/100", {
    which: () => true,
    run: async () => JSON.stringify([
      { author: "nasa", text: "root", url: "https://x.com/nasa/status/100" },
      { author: "sam", text: "real reply", url: "https://x.com/sam/status/101", likes: 4 },
      { author: "nope", text: "missing url" },
      { author: "long", text: "not this id", url: "https://x.com/long/status/1001" }
    ])
  });
  assert.equal(replies.length, 2);
  assert.equal(replies[0].text, "real reply");
  assert.equal(replies[1].url, "https://x.com/long/status/1001");
});

test("instagram usernames are a short allow-list", () => {
  assert.deepEqual(parseHandleList("@nasa, esa"), ["nasa", "esa"]);
  assert.throws(() => parseHandleList("not a/name"));
  assert.throws(() => parseHandleList("a,b,c,d,e,f,g,h,i"));
});

test("Jina profile text keeps follower text and recent posts, and invents no URLs", () => {
  const text = `Title: NASA (@nasa) • Instagram photos and videos

nasa

104M followers

90 following

NASA Making the seemingly impossible, possible.

Recent posts:

Photo by NASA... August 2026
Video by NASA Aeronautics... October 02, 2026
`;
  const ig = parseJinaInstagram(text, "nasa");
  assert.equal(ig.followers, "104M");
  assert.equal(ig.following, "90");
  assert.equal(ig.posts.length, 2);
  assert.equal(ig.posts[0].url, "");
  assert.match(ig.posts[0].text, /August 2026/);
  assert.equal(ig.backend, "jina");
});

test("a Jina login wall is not treated as an empty profile", () => {
  const wall = "Title: Instagram\n\nLog into Instagram\n\nMobile number, username or email\n\nPassword\n";
  assert.equal(instagramLoginWall(wall), true);
  assert.equal(instagramLoginWall("Title: NASA\n\n104M followers\n\n90 following\n"), false);
});

test("OpenCLI Instagram failure falls through to Jina", async () => {
  const calls = [];
  const ig = await instagramAccount("nasa", {
    which: (cmd) => cmd === "opencli",
    run: async () => {
      throw new Error("Navigation rejected");
    },
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async text() {
          return JSON.stringify({ data: { content: "Title: NASA\n\n104M followers\n\n90 following\n\nRecent posts:\n\nPhoto by NASA... August 2026\n" } });
        }
      };
    }
  });
  assert.equal(calls[0], "https://r.jina.ai/https://instagram.com/nasa");
  assert.equal(ig.backend, "jina");
  assert.equal(ig.followers, "104M");
  assert.equal(ig.posts.length, 1);
});

test("a live OpenCLI profile does not call Jina", async () => {
  let fetched = false;
  const ig = await instagramAccount("nasa", {
    which: (cmd) => cmd === "opencli",
    run: async (_bin, args) => {
      if (args[1] === "profile") {
        return JSON.stringify({ username: "nasa", name: "NASA", followers: 104000000, following: 90, posts: 12, bio: "space", verified: "Yes" });
      }
      return JSON.stringify([{ caption: "pad photo", likes: 10, comments: 2, type: "photo", date: "10/2/2026" }]);
    },
    fetch: async () => { fetched = true; throw new Error("should not fetch"); }
  });
  assert.equal(fetched, false);
  assert.equal(ig.backend, "opencli");
  assert.equal(ig.followers, 104000000);
  assert.equal(ig.posts[0].text, "pad photo");
  assert.equal(ig.posts[0].likes, 10);
});
