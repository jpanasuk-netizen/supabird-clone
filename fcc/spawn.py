"""Detach fcc-server.exe so OPENSSL mixing cannot kill it. Never pass NIM as upstream."""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

CREATE_BREAKAWAY_FROM_JOB = 0x01000000
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

ROOT = Path(__file__).resolve().parent
BUNDLED = ROOT / ".venv" / "Scripts" / "fcc-server.exe"
HOUSE = Path(os.environ.get("USERPROFILE", r"C:\Users\jpana")) / ".local" / "bin" / "fcc-server.exe"
HOST = "127.0.0.1"


def listening(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.4):
            return True
    except OSError:
        return False


def env_for_child(exe: Path, port: int) -> dict[str, str]:
    return {
        "PATH": r"C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;" + str(exe.parent),
        "SYSTEMROOT": r"C:\Windows",
        "WINDIR": r"C:\Windows",
        "USERPROFILE": os.environ.get("USERPROFILE", r"C:\Users\jpana"),
        "HOME": os.environ.get("HOME", os.environ.get("USERPROFILE", r"C:\Users\jpana")),
        "TEMP": os.environ.get("TEMP", r"C:\Windows\Temp"),
        "TMP": os.environ.get("TMP", r"C:\Windows\Temp"),
        "APPDATA": os.environ.get("APPDATA", ""),
        "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
        "HOST": HOST,
        "PORT": str(port),
        "FCC_OPEN_BROWSER": "0",
        "NVIDIA_NIM_API_KEY": "",
        "MODEL_FALLBACKS": "",
    }


def start(exe: Path, port: int, log: Path, pid_file: Path) -> None:
    if not exe.is_file():
        raise SystemExit(f"missing {exe}")
    with log.open("w", encoding="utf-8") as out:
        proc = subprocess.Popen(
            [str(exe)],
            cwd=str(exe.parent),
            env=env_for_child(exe, port),
            stdout=out,
            stderr=subprocess.STDOUT,
            creationflags=CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
            close_fds=True,
        )
    pid_file.write_text(str(proc.pid), encoding="utf-8")
    print(f"spawned FCC pid={proc.pid} {HOST}:{port} exe={exe}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", default="")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--house", action="store_true")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    if args.house:
        exe = Path(args.exe) if args.exe else HOUSE
        port = args.port or 8080
    else:
        exe = Path(args.exe) if args.exe else BUNDLED
        port = args.port or 8082
    tag = "house" if (args.house or exe == HOUSE) else "bundled"
    log = ROOT / f"fcc-start-{tag}.log"
    pid_file = ROOT / f"fcc-server-{tag}.pid"
    if args.restart:
        if pid_file.is_file():
            try:
                pid = int(pid_file.read_text(encoding="utf-8").strip())
                subprocess.call(
                    ["taskkill", "/PID", str(pid), "/F"],
                    timeout=5,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except ValueError:
                pass
    if listening(port):
        print(f"FCC already on {HOST}:{port}", flush=True)
        return
    start(exe, port, log, pid_file)


if __name__ == "__main__":
    main()
