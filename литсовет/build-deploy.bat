@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║         Литсовет — Сборка архива для переноса    ║
echo ╚══════════════════════════════════════════════════╝
echo.

for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"') do set TODAY=%%d

set ZIPNAME=%USERPROFILE%\Desktop\литсовет-%TODAY%.zip

echo  Собираю архив: %ZIPNAME%
echo.

powershell -NoProfile -Command ^
  "$files = @('server.js','index.html','styles.css','package.json','deploy.bat','start.sh','README.md'); ^
   $dirs = @('src'); ^
   $all = ($files | Where-Object {Test-Path $_}) + ($dirs | Where-Object {Test-Path $_}); ^
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
    echo.
    echo  Проекты (data\projects) в архив НЕ входят — это чистая
    echo  установка. Чтобы перенести и книги, скопируйте папку
    echo  data вручную рядом с server.js на новом компьютере.
    echo ══════════════════════════════════════════════════
    echo.
    explorer /select,"%ZIPNAME%"
) else (
    echo  ОШИБКА: архив не создан. Проверьте права доступа.
)

echo.
pause
