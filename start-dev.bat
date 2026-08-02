@echo off
setlocal
title YoJan Dev Launcher
cd /d "%~dp0"

echo ============================================
echo   YoJan - dev environment launcher
echo ============================================
echo.

REM --- Node.js must be on PATH ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH.
    echo         Install it from https://nodejs.org and try again.
    pause
    exit /b 1
)

REM --- Fresh-clone hint: dependencies must be installed first ---
if not exist "node_modules" echo [HINT] Backend dependencies missing - run:  npm install
if not exist "frontend\node_modules" echo [HINT] Frontend dependencies missing - run:  cd frontend ^&^& npm install

REM --- Load .env (DATABASE_URL, JWT secret, ...) for the backend ---
REM %%~b strips surrounding quotes, so both DATABASE_URL="postgres://..." and
REM plain KEY=VALUE lines work. Values containing %% or ^ would still break it.
if not exist ".env" (
    echo [WARN] .env not found - the backend may not connect to the database.
) else (
    for /f "eol=# tokens=1,* delims==" %%a in (.env) do set "%%a=%%~b"
    echo [OK] .env loaded
)

REM --- Warn if something is already running on the dev ports ---
REM (trailing space after the port avoids matching e.g. :30000)
netstat -ano 2>nul | findstr /c:":3000 " | findstr /c:"LISTENING" >nul && echo [WARN] Port 3000 is already in use - the backend may already be running.
netstat -ano 2>nul | findstr /c:":5173 " | findstr /c:"LISTENING" >nul && echo [WARN] Port 5173 is already in use - the frontend may already be running.

echo.
echo Launching both servers in their own windows...
echo   Backend : http://localhost:3000   (health check: /ping)
echo   Frontend: http://localhost:5173   (the app - open this one)
echo.
echo Close a window to stop that server, or press Ctrl+C inside it.
echo.

REM --- Backend API (Express + Prisma) ---
start "YoJan Backend" cmd /k "node backend/src/index.js"

REM --- Frontend (Vite dev server; proxies /api to the backend) ---
start "YoJan Frontend" cmd /k "cd frontend && npm run dev"

echo Both servers started. Press any key to close this launcher window...
pause >nul
