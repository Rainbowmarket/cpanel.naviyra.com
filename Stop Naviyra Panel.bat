@echo off
title Stop Naviyra Panel
cd /d "%~dp0"
node launcher\stop.mjs
timeout /t 3 >nul
