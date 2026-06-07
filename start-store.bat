@echo off
title Arabic Store - Storefront
cd /d "%~dp0"
echo Starting Storefront server...
start http://localhost:3000
node server.js
pause
