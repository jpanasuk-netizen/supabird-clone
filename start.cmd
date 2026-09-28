@echo off
cd /d "%~dp0"
if exist "fcc\.venv\Scripts\python.exe" (
  "fcc\.venv\Scripts\python.exe" fcc\spawn.py
  start "supabird-fcc-update" /MIN "fcc\.venv\Scripts\python.exe" fcc\update.py
) else (
  echo FCC venv missing. Generate will fail closed until an install succeeds.
)
node server.mjs
