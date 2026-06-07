@echo off
title Arabic Store - Admin Panel
cd /d "%~dp0"
echo Starting Admin Panel...
start http://localhost:3000/admin.html
node server.js
pause
