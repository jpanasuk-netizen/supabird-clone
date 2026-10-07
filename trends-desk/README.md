# X Trends Desk

Local dashboard (http://127.0.0.1:3489) that finds the hottest X topics per column (Law, Finance, AI, or your own) through the free OpenCLI session, with the xAI SDK + Grok X search as an optional paid fallback. It tags topics NEW / RISING / FADING, pulls real top replies, tracks API cost, and runs daily at 6 AM. Feeds the Trends tab on the Blue Jay desk at http://127.0.0.1:4747/#/trends.

## Post reply (live)
Every tweet in the desk (the post links on each trend card, each original post in the Replies panel, and each reply quoted under it) has its own reply box and a **🚀 Post reply** button. The box shows the tweet id it will reply to. Pressing it asks you to confirm, then the server calls:

```
opencli twitter reply https://x.com/<user>/status/<tweetId> "<text>" --window background -f json
```

That posts a reply to that exact tweet (OpenCLI opens `x.com/compose/post?in_reply_to=<tweetId>`) as the X account logged in to OpenCLI's Chrome session. There is no standalone-post path. The new reply's link (or the error) shows under the box. Every attempt is logged to `posted.json`.

`POST /api/reply {tweetId, url, text}`: ids and links must match, text must be 1–280 weighted characters, one post at a time, and an exact duplicate reply to the same tweet is refused. Add `"dryRun": true` to validate and see the command without posting. `GET /api/posted` lists past attempts. Nothing posts on its own.

## Run
```
cd trends-desk
npm install
node trends-ui.mjs
```
On LightBringer the desk runs in WSL from `~/xai-test`. `trends-ui.sh` (also in `C:\Users\jpana\watch-split`) copies `trends-ui.mjs` there and restarts it hidden. `free-x.mjs` must sit next to it.

An xAI key is optional (stored locally in `.xai-key`, gitignored). Requires Node 22.13+. `TrendsDesk.cs` builds an optional no-console Windows launcher.
