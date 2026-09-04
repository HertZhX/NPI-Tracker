@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto path_error
call "%~dp0config.cmd"

set "NPI_NODE=%~dp0runtime\node.exe"
set "NPI_SERVER=%~dp0app\server\index.mjs"
set "NPI_DIAG=%~dp0app\scripts\diagnose-windows.mjs"
set "NPI_LOG_DIR=%~dp0logs"
set "NPI_LOG=%NPI_LOG_DIR%\server.log"

if not exist "%NPI_LOG_DIR%" mkdir "%NPI_LOG_DIR%"
if not exist "%NPI_NODE%" goto missing_node
if not exist "%NPI_SERVER%" goto missing_server
if not exist "%NPI_DIAG%" goto missing_diagnostic

title NPI Tracker Server
echo.
echo ============================================================
echo   NPI Tracker Windows Server
echo   Local URL: http://127.0.0.1:%NPI_PORT%
echo   LAN URL:   http://SERVER-IP:%NPI_PORT%
echo   Log file:  %NPI_LOG%
echo ============================================================
echo.

echo.>>"%NPI_LOG%"
echo [%date% %time%] Running startup checks...>>"%NPI_LOG%"
"%NPI_NODE%" --version>>"%NPI_LOG%" 2>&1
if errorlevel 1 goto diagnostic_error
"%NPI_NODE%" "%NPI_DIAG%">>"%NPI_LOG%" 2>&1
if errorlevel 1 goto diagnostic_error

echo Startup checks passed.
echo Starting service. Keep this window open; press Ctrl+C to stop.
echo If the browser cannot connect, open logs\server.log.
echo.
echo [%date% %time%] Starting NPI Tracker...>>"%NPI_LOG%"
"%NPI_NODE%" "%NPI_SERVER%">>"%NPI_LOG%" 2>&1
set "NPI_EXIT_CODE=%ERRORLEVEL%"

echo.
echo NPI Tracker stopped with exit code %NPI_EXIT_CODE%.
echo See logs\server.log for details.
type "%NPI_LOG%"
pause
exit /b %NPI_EXIT_CODE%

:path_error
echo ERROR: Cannot access the extracted package directory.
echo Move the package to a writable folder such as D:\Apps\NPI-Tracker.
pause
exit /b 10

:missing_node
echo ERROR: runtime\node.exe is missing. Extract the complete ZIP before running.
pause
exit /b 11

:missing_server
echo ERROR: app\server\index.mjs is missing. Extract the complete ZIP before running.
pause
exit /b 12

:missing_diagnostic
echo ERROR: app\scripts\diagnose-windows.mjs is missing. Extract the complete ZIP before running.
pause
exit /b 13

:diagnostic_error
echo ERROR: Startup checks failed.
echo Open logs\server.log and send its contents to the maintainer.
echo.
type "%NPI_LOG%"
pause
exit /b 14
