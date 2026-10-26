@echo off
REM Inicia el reloj en segundo plano y abre el panel.
REM Esta ventana se abre minimizada y se cierra sola. Si algo falla, se abre logs\errores.txt
if not "%~1"=="min" (start "Reloj Subaton" /min "%~f0" min & exit /b)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  start "" "https://nodejs.org"
  echo Falta Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir iniciar.bat.
  pause
  exit
)
node iniciar.js
exit
