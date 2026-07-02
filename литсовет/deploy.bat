@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo  Litsovet - Deploy
echo.

echo [1/4] Node.js...
where node >nul 2>&1
if errorlevel 1 goto no_node
node -e "if(parseInt(process.version.slice(1))<18)process.exit(1)" >nul 2>&1
if errorlevel 1 goto old_node
echo      OK
goto check_files

:no_node
echo  ERROR: Node.js not found!
echo  Install: https://nodejs.org - LTS - run again
pause
exit /b 1

:old_node
echo  ERROR: Node.js too old (need v18+)
echo  Update: https://nodejs.org
pause
exit /b 1

:check_files
echo [2/4] Files...
if not exist server.js  goto missing
if not exist index.html goto missing
if not exist styles.css goto missing
if not exist src\state.js goto missing
echo      OK
goto check_folder

:missing
echo  ERROR: files missing - put all archive files in one folder.
pause
exit /b 1

:check_folder
echo [3/4] Folders...
if not exist data mkdir data
echo      OK

echo [4/4] Port 8788...
netstat -ano 2>nul | findstr ":8788 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo      Already running!
    start "" "http://localhost:8788"
    pause
    exit /b 0
)
echo      OK

echo.
echo  URL: http://localhost:8788
echo  DO NOT CLOSE THIS WINDOW!
echo.

start "" cmd /c "timeout /t 2 >nul 2>&1 & start http://localhost:8788"
node server.js

echo  Server stopped.
pause
