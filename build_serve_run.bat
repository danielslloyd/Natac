@echo off
REM build_serve_run.bat - robust rebuild, serve, and open (explicit Windows handling)
cd /d "%~dp0"

echo =====================================================
echo Natac: Ensure deps, Rebuild (tsc), Serve (http-server), Launch index.html
echo =====================================================
echo.

REM --- check Node & npm ---
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NODE_MISSING
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto NPM_MISSING

echo Node and npm found.
echo.

REM --- if local tsc missing, run npm install ---
if exist "node_modules\.bin\tsc.cmd" goto HAVE_TSC_CMD
if exist "node_modules\typescript\lib\tsc.js" goto HAVE_TSC_JS
if exist "node_modules\.bin\tsc" goto HAVE_TSC_SH
echo Local tsc not found. Running npm install (this will install devDependencies)...
npm install
if %ERRORLEVEL% NEQ 0 goto NPM_INSTALL_FAILED

REM After install, check again
if exist "node_modules\.bin\tsc.cmd" goto HAVE_TSC_CMD
if exist "node_modules\typescript\lib\tsc.js" goto HAVE_TSC_JS
if exist "node_modules\.bin\tsc" goto HAVE_TSC_SH
echo Warning: local tsc not found after npm install. Will use npx fallback.
goto NPX_FALLBACK

REM ----------------------------------------------------------------
:HAVE_TSC_CMD
echo Found Windows tsc wrapper: node_modules\.bin\tsc.cmd
call "node_modules\.bin\tsc.cmd"
if %ERRORLEVEL% NEQ 0 goto BUILD_FAILED
goto AFTER_BUILD

:HAVE_TSC_JS
echo Found TypeScript JS compiler: node_modules\typescript\lib\tsc.js
node "node_modules\typescript\lib\tsc.js"
if %ERRORLEVEL% NEQ 0 goto BUILD_FAILED
goto AFTER_BUILD

:HAVE_TSC_SH
REM Found a non-Windows tsc shim (shell). Try running the JS compiler directly if available.
if exist "node_modules\typescript\lib\tsc.js" (
  echo Found shell tsc shim but will run node node_modules\typescript\lib\tsc.js instead.
  node "node_modules\typescript\lib\tsc.js"
  if %ERRORLEVEL% NEQ 0 goto BUILD_FAILED
  goto AFTER_BUILD
) else (
  echo Found node_modules\.bin\tsc but no typescript/lib/tsc.js present. Falling back to npx.
  goto NPX_FALLBACK
)

:NPX_FALLBACK
echo Running fallback: npx tsc
npx --yes tsc
if %ERRORLEVEL% NEQ 0 goto BUILD_FAILED
goto AFTER_BUILD

:AFTER_BUILD
echo Build succeeded.
echo.

REM --- start server in a new window (persistent) ---
echo Starting server in a new window (npm run serve)...
start "Natac Server" cmd /k "npm run serve"
if %ERRORLEVEL% NEQ 0 goto START_FAILED

REM Give server a moment to start
timeout /t 5 /nobreak >nul

REM Open index.html in default browser
set "URL=http://localhost:8080/index.html"
echo Opening %URL% in default browser...
start "" "%URL%"

echo.
echo Server launched in separate window titled "Natac Server".
echo If the server fails, check that window for errors.
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

:BUILD_FAILED
echo ERROR: Build failed (tsc returned an error).
echo Inspect the TypeScript output above; run 'node node_modules\typescript\lib\tsc.js' or 'npx tsc' manually to see details.
pause
exit /b 1

:START_FAILED
echo ERROR: Failed to start server window with 'npm run serve'.
pause
exit /b 1