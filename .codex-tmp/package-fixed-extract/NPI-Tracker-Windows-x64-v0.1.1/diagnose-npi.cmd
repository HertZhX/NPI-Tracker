@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto path_error
call "%~dp0config.cmd"

set "NPI_LOG_DIR=%~dp0logs"
set "NPI_LOG=%NPI_LOG_DIR%\diagnostic.log"
if not exist "%NPI_LOG_DIR%" mkdir "%NPI_LOG_DIR%"

if not exist "%~dp0runtime\node.exe" goto missing_node
"%~dp0runtime\node.exe" "%~dp0app\scripts\diagnose-windows.mjs">"%NPI_LOG%" 2>&1
set "NPI_EXIT_CODE=%ERRORLEVEL%"

type "%NPI_LOG%"
echo.
echo Diagnostic log: %NPI_LOG%
pause
exit /b %NPI_EXIT_CODE%

:path_error
echo ERROR: Cannot access the extracted package directory.
pause
exit /b 10

:missing_node
echo ERROR: runtime\node.exe is missing. Extract the complete ZIP before running.
pause
exit /b 11
