@echo off
chcp 65001 >nul
title Reloj Subaton (modo consola para revisar errores)
cd /d "%~dp0"
node server.js
echo.
echo   El reloj se detuvo. Pulsa una tecla para cerrar.
pause >nul
