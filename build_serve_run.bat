@echo off
REM build_serve_run.bat - install deps, serve, and open
cd /d "%~dp0"

echo =====================================================
echo Natac: Install deps, Serve (http-server), Launch index.html
echo =====================================================
echo.

REM --- check Node & npm ---
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NODE_MISSING
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NPM_MISSING

echo Node and npm found.
echo.

REM --- install deps if needed ---
if not exist "node_modules" (
  echo Running npm install...
  npm install
  if %ERRORLEVEL% NEQ 0 goto NPM_INSTALL_FAILED
)

REM --- start server in a new window (persistent) ---
echo Starting server in a new window (npm run serve)...
start "Natac Server" cmd /k "npm run serve"
if %ERRORLEVEL% NEQ 0 goto START_FAILED

REM Give server a moment to start
timeout /t 3 /nobreak >nul

REM Open index.html in default browser
set "URL=http://localhost:8080/index.html"
echo Opening %URL% in default browser...
start "" "%URL%"

echo.
echo Server launched in separate window titled "Natac Server".
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
