@echo off
setlocal

set "PORT=5173"
set "URL=http://localhost:%PORT%"

echo [OrigamiCraft] Starting local server on port %PORT%...
start "" "%URL%"
python -m http.server %PORT%
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to start server with "python".
  echo Please install Python or add it to PATH.
  pause
  exit /b 1
)

start "" "%URL%"
