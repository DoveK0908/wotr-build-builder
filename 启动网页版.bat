@echo off
rem ASCII only on purpose: cmd.exe parses this file in the console code page,
rem so non-ASCII text here breaks under some code pages. All hints stay English.
setlocal
cd /d "%~dp0"
set PORT=5200

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "web\node_modules" goto deps
if not exist "web\dist\index.html" goto build
goto serve

:deps
echo First run: installing web dependencies ^(npm install^)...
pushd web
call npm.cmd install --no-audit --no-fund
popd

:build
echo Building the production bundle...
pushd web
call node node_modules\vite\bin\vite.js build
popd

:serve
echo Serving the build planner at http://127.0.0.1:%PORT%/
start "wotr-planner-server" /D "%~dp0web" cmd /c "node scripts\serve.mjs --port %PORT%"
if /i "%~1"=="--no-open" goto end
timeout /t 2 >nul
start "" "http://127.0.0.1:%PORT%/"
goto end

:nonode
echo Node.js was not found.
echo Install it from https://nodejs.org/ ^(LTS^), then run this file again.
pause

:end
endlocal
