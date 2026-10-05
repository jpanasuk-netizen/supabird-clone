# Blue Jay — local X growth lab

**Blue Jay** is one local desk: profile, drafts, generate, Trends, and HouseX. It binds **http://127.0.0.1:4747** only. Never `:3000`. The GitHub folder may still be `supabird-clone`; the product name on screen is Blue Jay. HouseX is a panel in that shell, not a second site.

Generate does not tweet. Missing metrics stay blank or “not pulled” — never invented zeros.

## Start

Needs Node on PATH. From this folder:

```bat
start.cmd
```

`start.cmd` tries to spawn house Free Claude Code and runs `node server.mjs`. Then open the desk:

**http://127.0.0.1:4747/#/housex**

| Piece | Where |
| --- | --- |
| Blue Jay desk | http://127.0.0.1:4747/#/housex |
| HouseX API | http://127.0.0.1:8787/v1 |
| HouseX upstream env | `HOUSEX_API_URL` |
| AI | VYCE `gpt-6-luna` when a VYCE key is set. Otherwise local Free Claude Code. |

## HouseX

The HouseX sidebar entry talks to the local HouseX API. The browser stores the `hxk_…` key in `localStorage` only. Blue Jay forwards `Authorization` and does not write that key to disk.

1. Start the HouseX API on **http://127.0.0.1:8787/v1**.
2. Start Blue Jay with `start.cmd` or `node server.mjs`.
3. Open **http://127.0.0.1:4747/#/housex**.
4. In HouseX → Settings, paste the `hxk_…` key and run **Test connection**.

`HOUSEX_API_URL` in `.env.local` (see `.env.example`) overrides the proxy target. The default is `http://127.0.0.1:8787/v1`. The browser calls same-origin `/api/housex/…`.

A HouseX HTTP **501** (or `not_implemented`) shows a **not implemented** chip and does not render stand-in data. Drafts stay drafts until you confirm a schedule or an immediate publish. This desk does not send DMs, and it will not proxy any host except loopback HTTP.

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
