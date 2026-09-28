# SupaBird — local X growth lab

A local command center for X: profile, drafts, generate, and optional Native posting. It binds **http://127.0.0.1:3100** only. Never `:3000`.

Generate does not tweet. Missing metrics stay blank or “not pulled” — never invented zeros.

## Start

Needs Node on PATH. From this folder:

```bat
start.cmd
```

Then open **http://127.0.0.1:3100**. `start.cmd` tries to spawn house Free Claude Code and runs `node server.mjs`.

Copy `.env.example` to `.env.local` if you want a custom OpenAI-compatible writer. Default generate uses local FCC.

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

`http://127.0.0.1:3100/callback/x`

Not localhost, no trailing slash, http not https, port **3100**. Keep the lab up during OAuth. Tokens and Client ID are saved under gitignored `data/`. Composer still requires an explicit confirm before any live post.

## Secrets

`.env`, `.env.local`, and `data/*.json` are gitignored. Never commit API keys, OAuth tokens, or Client secrets.
