@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   ИИ-Издательство — локальный запуск
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js не найден.
  echo     Установите его один раз с https://nodejs.org (кнопка LTS),
  echo     перезапустите этот файл.
  echo.
  pause
  exit /b
)
echo Открываю http://localhost:8787 в браузере...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
echo Сервер запущен. НЕ закрывайте это окно, пока работаете.
echo Для остановки закройте окно или нажмите Ctrl+C.
echo.
node server.js
pause
