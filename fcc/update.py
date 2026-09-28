"""Check upstream FCC in the background. Never block the UI.

Boot path: spawn the installed copy immediately. This script only downloads
when PyPI reports a newer version, then restarts our fcc-server.

Cache: fcc/update-status.json (gitignored). Fresh cache + matching installed
version skips the network.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT.parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
PIN = ROOT / "VERSION"
STATUS = ROOT / "update-status.json"
PYPI = "https://pypi.org/pypi/free-claude-code/json"
HTTP_TIMEOUT = 3
CACHE_TTL_SEC = 6 * 3600


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_status(**fields: object) -> dict:
    payload = {
        "checkedAt": now_iso(),
        "pinFile": str(PIN),
        "source": PYPI,
        "httpTimeoutSec": HTTP_TIMEOUT,
        "cacheTtlSec": CACHE_TTL_SEC,
        **fields,
    }
    STATUS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"FCC update: {payload.get('message')}", flush=True)
    return payload


def parse_ver(text: str) -> tuple[int, ...]:
    parts = []
    for bit in str(text).strip().lstrip("v").split("."):
        n = "".join(ch for ch in bit if ch.isdigit())
        parts.append(int(n or 0))
    return tuple(parts or (0,))


def newer(upstream: str, installed: str) -> bool:
    return parse_ver(upstream) > parse_ver(installed)


def pin_lines() -> list[str]:
    if not PIN.is_file():
        return []
    return PIN.read_text(encoding="utf-8").splitlines()


def installed_version() -> str:
    lines = pin_lines()
    if lines:
        return lines[0].strip()
    return ""


def pin_commit() -> str:
    lines = pin_lines()
    return lines[1].strip() if len(lines) > 1 else ""


def read_status() -> dict:
    if not STATUS.is_file():
        return {}
    try:
        data = json.loads(STATUS.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def cache_fresh_and_current(installed: str) -> dict | None:
    prev = read_status()
    if not installed or not prev:
        return None
    checked = prev.get("checkedAt") or ""
    try:
        ts = datetime.fromisoformat(str(checked).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - ts).total_seconds()
    except ValueError:
        return None
    if age > CACHE_TTL_SEC or age < 0:
        return None
    upstream = str(prev.get("upstream") or "")
    prev_installed = str(prev.get("installed") or "")
    if not upstream or upstream != installed or prev_installed != installed:
        return None
    if str(prev.get("action") or "") in {"check-failed", "install-failed", "unchecked", "downloading"}:
        return None
    return prev


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "supabird-fcc-update"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upstream_version() -> str:
    ver = str(http_json(PYPI).get("info", {}).get("version") or "").strip()
    if not ver:
        raise RuntimeError("PyPI returned empty version")
    return ver


def write_pin(version: str, commit: str) -> None:
    PIN.write_text(
        "\n".join(
            [
                version,
                commit,
                "https://github.com/Alishahryar1/free-claude-code",
                f"pypi:free-claude-code=={version}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def run_uv(args: list[str], timeout: int = 180) -> None:
    subprocess.check_call(["uv", *args], cwd=str(APP), env=os.environ.copy(), timeout=timeout)


def ensure_venv() -> None:
    if VENV_PY.is_file():
        return
    run_uv(["python", "install", "3.14.7"], timeout=120)
    run_uv(["venv", "--python", "3.14.7", str(ROOT / ".venv")], timeout=60)


def install_version(version: str) -> None:
    ensure_venv()
    run_uv(
        ["pip", "install", "--python", str(VENV_PY), f"free-claude-code=={version}"],
        timeout=180,
    )


def restart_bundled() -> None:
    spawn = ROOT / "spawn.py"
    py = str(VENV_PY) if VENV_PY.is_file() else sys.executable
    subprocess.check_call([py, str(spawn), "--restart"], cwd=str(APP), timeout=20)


def main() -> int:
    installed = installed_version()
    cached = cache_fresh_and_current(installed)
    if cached:
        write_status(
            action="cache-skip",
            installed=installed,
            upstream=str(cached.get("upstream") or installed),
            commit=pin_commit(),
            network="skipped",
            message=f"cache hit {installed}; skipped network",
        )
        return 0

    try:
        upstream = upstream_version()
    except Exception as exc:
        write_status(
            action="check-failed",
            installed=installed or "none",
            upstream="",
            commit="",
            network="failed",
            message=f"update check failed; using installed {installed or 'none'} ({exc})",
        )
        return 0

    if not installed:
        write_status(
            action="downloading",
            installed="none",
            upstream=upstream,
            commit="",
            network="pypi",
            message=f"downloading FCC {upstream} in background",
        )
        try:
            install_version(upstream)
            write_pin(upstream, "")
            restart_bundled()
            write_status(
                action="installed",
                installed=upstream,
                upstream=upstream,
                commit="",
                network="pypi",
                message=f"installed FCC {upstream}",
            )
        except Exception as exc:
            write_status(
                action="install-failed",
                installed="none",
                upstream=upstream,
                commit="",
                network="pypi",
                message=f"install failed; FCC not available ({exc})",
            )
        return 0

    if not newer(upstream, installed):
        write_pin(installed, pin_commit())
        write_status(
            action="up-to-date",
            installed=installed,
            upstream=upstream,
            commit=pin_commit(),
            network="pypi",
            message=f"up to date {installed}; skipped download",
        )
        return 0

    write_status(
        action="downloading",
        installed=installed,
        upstream=upstream,
        commit=pin_commit(),
        network="pypi",
        message=f"downloading FCC {upstream} (have {installed}); UI stays up",
    )
    try:
        install_version(upstream)
        write_pin(upstream, "")
        restart_bundled()
        write_status(
            action="updated",
            installed=upstream,
            upstream=upstream,
            commit="",
            network="pypi",
            message=f"updated FCC {installed} -> {upstream} and restarted",
        )
    except Exception as exc:
        write_status(
            action="install-failed",
            installed=installed,
            upstream=upstream,
            commit=pin_commit(),
            network="pypi",
            message=f"update to {upstream} failed; using installed {installed} ({exc})",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
