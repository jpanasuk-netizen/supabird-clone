@echo off
cd /d "%~dp0\.."
start "supabird-fcc-update" /MIN python fcc\update.py
