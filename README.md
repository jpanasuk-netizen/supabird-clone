# Blue Jay — local X growth lab

**Blue Jay** is a local command center for X: profile, drafts, generate, and optional Native posting. It binds **http://127.0.0.1:3100** only. Never `:3000`. The GitHub folder may still be `supabird-clone`; the product name on screen is Blue Jay.

Generate does not tweet. Missing metrics stay blank or “not pulled” — never invented zeros.

## Start

Needs Node on PATH. From this folder:

```bat
start.cmd
```

Then open **http://127.0.0.1:3100**. `start.cmd` tries to spawn house Free Claude Code and runs `node server.mjs`.

## HouseX desk

HouseX is a panel in this same Blue Jay shell (sidebar entry **HouseX**), not a separate site. It reads and writes a local HouseX API. The browser stores the API key in `localStorage` only. Blue Jay forwards `Authorization` to the loopback API and does not write the key to disk.

1. Start the HouseX API so it listens on **http://127.0.0.1:8787/v1**.
2. Start Blue Jay (`start.cmd` or `node server.mjs`) at **http://127.0.0.1:3100**.
3. Open **http://127.0.0.1:3100/#/housex**.
4. In HouseX → Settings, set the API URL if it is not the default, paste an `hxk_…` key, and run **Test connection**.

`HOUSEX_API_URL` in `.env.local` (see `.env.example`) overrides the proxy target. The default is `http://127.0.0.1:8787/v1`. This app is not Vite, so there is no `VITE_HOUSEX_API_URL`. The browser calls same-origin `/api/housex/…`, which Blue Jay proxies, so a cross-origin block on `:8787` does not matter.

A HouseX HTTP **501** (or `not_implemented`) shows a **not implemented** chip and does not render stand-in data. Drafts stay drafts until you confirm a schedule or an immediate publish. This desk does not send DMs, and it will not proxy any host except loopback HTTP.

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
