@echo off
chcp 65001 >nul
rem antwen music local debugging: double-click to start the server (:5175) and the web app (:5173).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 22.13 or later: https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo Node %%v is too old: antwen music needs Node 22.13 or later ^(for its built-in SQLite^).
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm not found. Install it first:  npm i -g pnpm
  pause
  exit /b 1
)

if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example
)

rem Quick when nothing changed; picks up new dependencies after a pull.
call pnpm install --prefer-offline
if errorlevel 1 (
  echo.
  echo pnpm install failed. If downloads time out, try:  set HTTPS_PROXY=http://127.0.0.1:7890  then run dev.cmd again
  pause
  exit /b 1
)

rem Open the browser once Vite has had a moment to start.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:5173"
call pnpm dev
pause
