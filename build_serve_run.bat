@echo off
REM build_serve_run.bat - install deps, serve on random port, and open
cd /d "%~dp0"

echo =====================================================
echo Natac: Install deps, Serve on random port, Launch index.html
echo =====================================================
echo.

REM --- check Node & npm ---
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NODE_MISSING
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NPM_MISSING

echo Node and npm found.
echo.

REM --- Kill any existing http-server processes ---
echo Killing any existing http-server instances...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Natac Server" >nul 2>&1
REM Alternative: kill by process name pattern if Natac Server window still exists
for /f "tokens=2" %%A in ('tasklist ^| findstr /i "node.exe"') do (
  taskkill /F /PID %%A >nul 2>&1
)
echo.

REM --- install deps if needed ---
if not exist "node_modules" (
  echo Running npm install...
  npm install
  if %ERRORLEVEL% NEQ 0 goto NPM_INSTALL_FAILED
)

REM --- Generate random port between 3000 and 9999 ---
setlocal enabledelayedexpansion
for /f %%x in ('powershell -Command "[random]::new().Next(3000, 10000)"') do set PORT=%%x
echo Generated random port: !PORT!
echo.

REM --- start server in a new window (persistent) on random port ---
echo Starting server in a new window on port !PORT!...
start "Natac Server" cmd /k "npx http-server -p !PORT!"
if %ERRORLEVEL% NEQ 0 goto START_FAILED

REM Give server a moment to start
timeout /t 3 /nobreak >nul

REM Open index.html in default browser
set "URL=http://localhost:!PORT!/index.html"
echo Opening %URL% in default browser...
start "" "!URL!"

echo.
echo Server launched in separate window titled "Natac Server" on port !PORT!.
echo No build step needed - just edit JS files and refresh!
echo.
pause
goto :eof

:NODE_MISSING
echo ERROR: Node.js not found in PATH.
echo Install Node.js and ensure 'node' is on your PATH.
pause
exit /b 1

:NPM_MISSING
echo ERROR: npm not found in PATH.
echo Install Node.js (includes npm) or ensure 'npm' is on your PATH.
pause
exit /b 1

:NPM_INSTALL_FAILED
echo ERROR: npm install failed. Check npm output above.
pause
exit /b 1

:START_FAILED
echo ERROR: Failed to start server window with 'npm run serve'.
pause
exit /b 1
