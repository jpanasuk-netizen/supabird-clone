# X Trends Desk

Local dashboard (http://127.0.0.1:3489) that uses the xAI SDK + Grok X search to find the hottest topics per column (Law, Finance, or your own), tags them NEW / RISING / FADING, pulls real top replies, tracks API cost, and runs daily at 6 AM. Feeds Blue Jay's Trends tab; nothing auto-posts.

xAI is the primary source. **Secondary** (header) defaults to “xAI, then AgentReach”. When the key is missing, rejected, or out of credits, a column run and “Get replies” use AgentReach’s order instead: `twitter` search (`--json`), then `opencli twitter search -f json`, then `bird`. Reply threads come from `opencli twitter thread` and only include posts that tool actually returned. Instagram usernames in the header use `opencli instagram profile` + `user`, and fall back to Jina Reader (`https://r.jina.ai/https://instagram.com/USERNAME`) when OpenCLI is rate-limited or the Chrome session rejects navigation. Missing counts stay blank. AgentReach-only skips xAI entirely. xAI-only keeps the old “paste a key first” gate.

## Run
```
cd trends-desk
npm install
node trends-ui.mjs
```
Open http://localhost:3489, paste your xAI API key, click Save key (stored locally in .xai-key, gitignored), then Run all.

Requires Node 22.13+. `TrendsDesk.cs` builds an optional no-console Windows launcher.
