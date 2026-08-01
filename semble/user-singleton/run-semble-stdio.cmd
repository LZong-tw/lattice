@echo off
REM Single-argv stdio entry for supergateway (avoid Windows shell splitting).
where uvx >nul 2>nul
if errorlevel 1 (
  "%USERPROFILE%\.local\bin\uvx.exe" --from "semble[mcp]" semble
) else (
  uvx --from "semble[mcp]" semble
)
