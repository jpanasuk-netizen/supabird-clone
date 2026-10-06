# Blue Jay — local X growth lab

**Blue Jay** is one local desk: profile, drafts, generate, Trends, and optional Native posting. It binds **http://127.0.0.1:4747** only. Never `:3000`. The GitHub folder may still be `supabird-clone`; the product name on screen is Blue Jay.

Generate does not tweet. Missing metrics stay blank or “not pulled” — never invented zeros.

## Start

Needs Node on PATH. From this folder:

```bat
start.cmd
```

Then open **http://127.0.0.1:4747**. `start.cmd` tries to spawn house Free Claude Code and runs `node server.mjs`.

| Piece | Where |
| --- | --- |
| Blue Jay desk | http://127.0.0.1:4747 |
| Trends | http://127.0.0.1:4747/#/trends (fed by X Trends Desk on :3489) |
| AI | VYCE `gpt-6-luna` when a VYCE key is set. Otherwise local Free Claude Code. |

## AI

Default generate uses local Free Claude Code. In Blue Jay → Settings, choose **VYCE · gpt-6-luna** and save a VYCE API key. That key lives in gitignored `.env.local` as `VYCE_API_KEY`. With the key set, generate calls VYCE model `gpt-6-luna`. With no key, generate stays on FCC and a VYCE save is refused. Generate never tweets.

## FCC (local 8080)

Idea generate talks to house Free Claude Code on **127.0.0.1:8080**, pin **6.4.10**. Do not commit `fcc/.venv` or `fcc-server.exe`.

```bat
py -m venv fcc\.venv
fcc\.venv\Scripts\python.exe -m pip install "free-claude-code==6.4.10"
```

`fcc\update.py` (started from `start.cmd`) can install/update that pin from PyPI in the background. If FCC is down, generate fails closed.

## X: two states

**$0 plugin mode (default).** Cursor X `{me}` profile is enough for followers, following, and tweet count. No billed plugin timeline/search. Official `/2/` ingest does not run without a user access token (no empty `Authorization` header).

**Native Sign in with X** (posting + tweet ingest). On developer.x.com use a **Native** app (PKCE). Callback must be exactly:

`http://127.0.0.1:4747/callback/x`

Not localhost, no trailing slash, http not https, port **4747**. Keep the lab up during OAuth. Tokens and Client ID are saved under gitignored `data/`. Composer still requires an explicit confirm before any live post.

## Secrets

`.env`, `.env.local`, and `data/*.json` are gitignored. Never commit API keys, OAuth tokens, or Client secrets.
