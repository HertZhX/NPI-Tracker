@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto path_error
call "%~dp0config.cmd"

if not exist "%~dp0runtime\node.exe" goto missing_node
echo.
echo Resetting the administrator password...
"%~dp0runtime\node.exe" "%~dp0app\scripts\reset-admin-password.mjs"
set "NPI_EXIT_CODE=%ERRORLEVEL%"
echo.
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
