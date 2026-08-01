@echo off
REM Long-lived wrapper: supergateway over Semble stdio. Args: port
set PORT=%~1
if "%PORT%"=="" set PORT=9131
npx -y supergateway --stdio "%~dp0run-semble-stdio.cmd" --outputTransport streamableHttp --port %PORT% --streamableHttpPath /mcp --logLevel info --cors
