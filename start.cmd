@echo off
rem Starts Blacksite (http://localhost:4800) and opens it. Double-click me.
cd /d "%~dp0"
set "BUN=bun"
where bun >nul 2>nul || (if exist "%USERPROFILE%\.bun\bin\bun.exe" (set "BUN=%USERPROFILE%\.bun\bin\bun.exe") else (echo Bun is not installed. Get it from https://bun.sh ^(powershell -c "irm bun.sh/install.ps1 ^| iex"^) & pause & exit /b 1))
if not exist node_modules echo Installing dependencies, one moment...
rem every time, not only the first: an updated checkout may need new ones (quick when nothing changed)
call "%BUN%" install || (pause & exit /b 1)
call "%BUN%" scripts\build-web.ts || (pause & exit /b 1)
start "Blacksite" /min "%BUN%" server\index.ts %*
