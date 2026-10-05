@echo off
cd /d "%~dp0"
if exist "fcc\.venv\Scripts\python.exe" (
  "fcc\.venv\Scripts\python.exe" fcc\spawn.py
  start "supabird-fcc-update" /MIN "fcc\.venv\Scripts\python.exe" fcc\update.py
) else (
  echo FCC venv missing. Generate will fail closed until an install succeeds.
)
echo Blue Jay http://127.0.0.1:4747/#/housex
echo HouseX API http://127.0.0.1:8787/v1
node server.mjs
