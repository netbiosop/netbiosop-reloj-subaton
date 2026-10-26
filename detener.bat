@echo off
REM Apaga el reloj que corre en segundo plano (el tiempo queda guardado).
cd /d "%~dp0"
node iniciar.js --detener
timeout /t 3 >nul
