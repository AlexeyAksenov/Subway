@echo off
cd /d "%~dp0"
set PORT=8080
echo Last Train (Moscow metro FPS): starting local server at http://localhost:%PORT%/
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/"
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
  npx --yes http-server -p %PORT% -c-1 .
  goto :eof
)
echo Python 3 (python.org) or Node.js (nodejs.org) is required.
pause
