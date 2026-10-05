# X Trends Desk

Local dashboard (http://127.0.0.1:3489) that uses the xAI SDK + Grok X search to find the hottest topics per column (Law, Finance, or your own), tags them NEW / RISING / FADING, pulls real top replies, tracks API cost, and runs daily at 6 AM. Feeds the Trends tab on the Blue Jay desk at http://127.0.0.1:4747/#/trends. Nothing auto-posts.

## Run
```
cd trends-desk
npm install
node trends-ui.mjs
```
Open http://localhost:3489, paste your xAI API key, click Save key (stored locally in .xai-key, gitignored), then Run all.

Requires Node 22.13+. `TrendsDesk.cs` builds an optional no-console Windows launcher.
