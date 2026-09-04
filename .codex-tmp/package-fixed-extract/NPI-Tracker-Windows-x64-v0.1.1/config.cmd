@echo off
rem NPI Tracker Windows configuration. Keep this file in ANSI/ASCII text.
rem Use 0.0.0.0 for direct LAN access, or 127.0.0.1 behind an HTTPS proxy.
if not defined NPI_HOST set "NPI_HOST=0.0.0.0"

rem Change this value if port 4173 is already occupied.
if not defined NPI_PORT set "NPI_PORT=4173"

rem Keep 0 for direct HTTP. Use 1 only behind an HTTPS reverse proxy.
if not defined NPI_COOKIE_SECURE set "NPI_COOKIE_SECURE=0"

rem Example: set "NPI_ALLOWED_ORIGINS=https://npi.example.com"
if not defined NPI_ALLOWED_ORIGINS set "NPI_ALLOWED_ORIGINS="

rem The SQLite database and uploaded quotation files are stored here.
if not defined NPI_DB_PATH set "NPI_DB_PATH=%~dp0data\npi-tracker.sqlite"

set "HOST=%NPI_HOST%"
set "PORT=%NPI_PORT%"
set "NODE_ENV=production"
