@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║    ИИ-Издательство — Сборка архива для переноса  ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: Имя архива с датой
for /f "tokens=1-3 delims=/" %%a in ("%date%") do (
    set DD=%%a
    set MM=%%b
    set YYYY=%%c
)
:: Windows date format may vary — use PowerShell for reliable date
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"') do set TODAY=%%d

set ZIPNAME=%USERPROFILE%\Desktop\ии-издательство-%TODAY%.zip

echo  Собираю архив: %ZIPNAME%
echo.

:: Собираем через PowerShell Compress-Archive
powershell -NoProfile -Command ^
  "$files = @('server.js','app.js','index.html','styles.css','deploy.bat','start.sh','README.md','package.json','favicon.svg','icon-192.svg','manifest.json'); ^
   $dirs = @(); ^
   if(Test-Path 'test'){$dirs += 'test'}; ^
   $all = $files | Where-Object {Test-Path $_}; ^
   Compress-Archive -Path $all -DestinationPath '%ZIPNAME%' -Force; ^
   Write-Host 'OK: архив создан'" 2>nul

if exist "%ZIPNAME%" (
    echo.
    echo ══════════════════════════════════════════════════
    echo  Архив создан на Рабочем столе:
    echo  %ZIPNAME%
    echo.
    echo  Что делать на другом компьютере:
    echo  1. Скопируйте архив куда удобно
    echo  2. Распакуйте
    echo  3. Запустите deploy.bat
    echo     — Node.js установится автоматически если его нет
    echo     — Сервер запустится и откроется браузер
    echo ══════════════════════════════════════════════════
    echo.
    :: Открываем папку где лежит архив
    explorer /select,"%ZIPNAME%"
) else (
    echo  ОШИБКА: архив не создан. Проверьте права доступа.
)

echo.
pause
