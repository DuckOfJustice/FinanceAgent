@echo off
cd /d "%~dp0"
echo Starte FinanceDuck...
docker compose up -d
timeout /t 3 >nul
start https://localhost:8443
