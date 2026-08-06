# Генератор bat-файлов установщика в кодировке CP866.
#
# Почему CP866, а не UTF-8: cmd.exe читает bat-файл в ТЕКУЩЕЙ кодовой странице
# консоли, а у русской Windows это 866. Файл в UTF-8 покажет кракозябры, и
# лечение через `chcp 65001` в начале файла — известный источник других бед:
# ломается `pause`, локализованные подсказки и разбор длинных строк. Проверено
# на этой машине: (Get-Culture) = ru-RU, OutputEncoding.CodePage = 866.
import io, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)

УСТАНОВЩИК = r'''@echo off
setlocal EnableExtensions
title Установка Литсовета
cd /d "%~dp0"

echo.
echo   ЛИТСОВЕТ — установка
echo   ====================
echo.

rem --- 1. Node.js -----------------------------------------------------------
echo   [1/5] Проверяю Node.js...
where node >nul 2>&1
if errorlevel 1 goto NET_NODE
for /f "delims=v. tokens=1" %%v in ('node -v') do set NODEMAJOR=%%v
if "%NODEMAJOR%"=="" goto NET_NODE
if %NODEMAJOR% LSS 18 goto СТАРЫЙ_NODE
echo         Node.js найден, версия подходит.
goto ПАПКА

:NET_NODE
echo.
echo   Node.js не установлен. Без него программа не запустится.
echo.
where winget >nul 2>&1
if errorlevel 1 goto NODE_ВРУЧНУЮ
echo   Могу поставить его сам через магазин приложений Windows.
echo   Откроется окно установки, может понадобиться подтверждение.
echo.
set ОТВЕТ=
set /p ОТВЕТ=  Установить Node.js сейчас? (д/н):
if /i "%ОТВЕТ%"=="д" goto СТАВИМ_NODE
if /i "%ОТВЕТ%"=="y" goto СТАВИМ_NODE
goto NODE_ВРУЧНУЮ

:СТАВИМ_NODE
echo.
echo   Устанавливаю Node.js, это займёт пару минут...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo   Node.js установлен. ЗАКРОЙТЕ ЭТО ОКНО и запустите установку заново —
echo   Windows должна подхватить новую программу в новом окне.
echo.
pause
exit /b 0

:NODE_ВРУЧНУЮ
echo.
echo   Установите Node.js вручную:
echo     1. Откройте https://nodejs.org
echo     2. Скачайте версию LTS
echo     3. Установите (все галочки по умолчанию)
echo     4. Запустите эту установку заново
echo.
pause
exit /b 1

:СТАРЫЙ_NODE
echo.
echo   Node.js слишком старый: нужна версия 18 или новее.
echo   Обновите с https://nodejs.org и запустите установку заново.
echo.
pause
exit /b 1

rem --- 2. Куда ставим -------------------------------------------------------
:ПАПКА
set "ЦЕЛЬ=%LOCALAPPDATA%\Litsovet"
echo.
echo   [2/5] Папка установки:
echo         %ЦЕЛЬ%
echo.
echo         Enter — согласиться. Или впишите свой путь.
set ПУТЬ=
set /p ПУТЬ=  Куда ставить:
if not "%ПУТЬ%"=="" set "ЦЕЛЬ=%ПУТЬ%"

if exist "%ЦЕЛЬ%\server.js" (
  echo.
  echo   В этой папке уже стоит Литсовет. Обновлю до текущей версии.
  echo   Ваши книги в папке data не пострадают.
  echo.
)

rem --- 3. Файлы -------------------------------------------------------------
echo   [3/5] Копирую файлы...
if not exist "%~dp0app\server.js" goto НЕТ_ФАЙЛОВ
if not exist "%ЦЕЛЬ%" mkdir "%ЦЕЛЬ%" 2>nul
if not exist "%ЦЕЛЬ%" goto НЕ_СОЗДАТЬ
xcopy "%~dp0app\*" "%ЦЕЛЬ%\" /E /I /Y /Q >nul
if errorlevel 1 goto НЕ_СКОПИРОВАТЬ
if not exist "%ЦЕЛЬ%\data" mkdir "%ЦЕЛЬ%\data"
echo         Готово.

rem --- 4. Ярлыки ------------------------------------------------------------
echo   [4/5] Создаю ярлыки...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "foreach($p in @($w.SpecialFolders('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  "  $s=$w.CreateShortcut((Join-Path $p 'Литсовет.lnk'));" ^
  "  $s.TargetPath=(Join-Path '%ЦЕЛЬ%' 'Литсовет.bat');" ^
  "  $s.WorkingDirectory='%ЦЕЛЬ%';" ^
  "  $s.Description='Литсовет — ИИ-инструмент для написания прозы';" ^
  "  $s.IconLocation='%%SystemRoot%%\System32\shell32.dll,70';" ^
  "  $s.Save() }" ^
  "if(-not (Test-Path (Join-Path $w.SpecialFolders('Desktop') 'Литсовет.lnk'))){ exit 1 }" >nul 2>&1
rem Проверяем факт появления файла, а не код возврата: рабочий стол бывает
rem перенаправлен в OneDrive, и запись туда может тихо не состояться.
if errorlevel 1 (
  echo         Ярлыки создать не удалось — запускайте Литсовет.bat из папки установки.
) else (
  echo         Ярлык «Литсовет» на рабочем столе и в меню Пуск.
)

rem --- 5. Готово ------------------------------------------------------------
echo   [5/5] Проверяю установку...
pushd "%ЦЕЛЬ%"
node -e "require('fs').accessSync('server.js');require('fs').accessSync('src/state.js');require('fs').accessSync('index.html')" >nul 2>&1
if errorlevel 1 (
  popd
  goto НЕ_ПРОВЕРИЛОСЬ
)
popd
echo         Все файлы на месте.

echo.
echo   ГОТОВО. Литсовет установлен.
echo.
echo   Запуск — ярлык «Литсовет» на рабочем столе.
echo   Программа откроется в браузере по адресу http://localhost:8788
echo.
echo   ВАЖНО: при первом запуске впишите ключ API в Настройках (шестерёнка
echo   справа вверху). Ключ хранится только в памяти браузера и после
echo   перезагрузки страницы вводится заново — так задумано.
echo.
set ЗАПУСК=
set /p ЗАПУСК=  Запустить Литсовет сейчас? (д/н):
if /i "%ЗАПУСК%"=="д" start "" "%ЦЕЛЬ%\Литсовет.bat"
if /i "%ЗАПУСК%"=="y" start "" "%ЦЕЛЬ%\Литсовет.bat"
exit /b 0

:НЕТ_ФАЙЛОВ
echo.
echo   ОШИБКА: рядом с установщиком нет папки app с файлами программы.
echo   Скорее всего архив распакован не полностью.
echo   Распакуйте архив целиком (правой кнопкой — «Извлечь все») и повторите.
echo.
pause
exit /b 1

:НЕ_СОЗДАТЬ
echo.
echo   ОШИБКА: не удалось создать папку
echo   %ЦЕЛЬ%
echo   Возможно, нет прав на запись. Попробуйте другой путь, например:
echo   %USERPROFILE%\Litsovet
echo.
pause
exit /b 1

:НЕ_СКОПИРОВАТЬ
echo.
echo   ОШИБКА: файлы скопировались не полностью.
echo   Чаще всего это антивирус или нехватка места на диске.
echo.
pause
exit /b 1

:НЕ_ПРОВЕРИЛОСЬ
echo.
echo   ОШИБКА: после копирования часть файлов не найдена.
echo   Установка НЕ завершена. Проверьте место на диске и антивирус.
echo.
pause
exit /b 1
'''

ЗАПУСК = r'''@echo off
setlocal EnableExtensions
title Литсовет — работает, не закрывайте это окно
cd /d "%~dp0"

rem 127.0.0.1, а не все интерфейсы: не будет запроса брандмауэра Windows,
rem и книги не окажутся доступны соседям по сети в кафе или коворкинге.
set HOST=127.0.0.1
if "%PORT%"=="" set PORT=8788

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js не найден. Возможно, он был удалён.
  echo   Установите заново с https://nodejs.org и запустите снова.
  echo.
  pause
  exit /b 1
)

rem Уже запущен? Тогда просто откроем вкладку, второй сервер не нужен.
netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Литсовет уже работает. Открываю в браузере...
  start "" "http://localhost:%PORT%"
  timeout /t 3 >nul 2>&1
  exit /b 0
)

echo.
echo   ЛИТСОВЕТ
echo   Адрес: http://localhost:%PORT%
echo.
echo   Это окно — сам сервер. Пока оно открыто, программа работает.
echo   Чтобы закончить работу — закройте это окно.
echo.

start "" cmd /c "timeout /t 2 >nul 2>&1 & start http://localhost:%PORT%"
node server.js

echo.
echo   Сервер остановлен.
pause
'''

УДАЛЕНИЕ = r'''@echo off
setlocal EnableExtensions
title Удаление Литсовета
cd /d "%~dp0"

echo.
echo   УДАЛЕНИЕ ЛИТСОВЕТА
echo.
echo   Папка: %~dp0
echo.
echo   ВНИМАНИЕ: в папке data лежат ваши книги, синхронизированные с этого
echo   компьютера. Если они нужны — скопируйте папку data в надёжное место
echo   ПРЕЖДЕ чем продолжать. Отменить удаление будет нельзя.
echo.
set ОТВЕТ=
set /p ОТВЕТ=  Удалить программу? Напишите слово «удалить»:
if /i not "%ОТВЕТ%"=="удалить" (
  echo.
  echo   Отменено, ничего не тронуто.
  pause
  exit /b 0
)

set ДАННЫЕ=
set /p ДАННЫЕ=  Удалить и книги из папки data тоже? (д/н):

del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Литсовет.lnk" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=(New-Object -ComObject WScript.Shell).SpecialFolders('Desktop');" ^
  "Remove-Item (Join-Path $d 'Литсовет.lnk') -ErrorAction SilentlyContinue" >nul 2>&1

if /i "%ДАННЫЕ%"=="д" goto ВСЁ
if /i "%ДАННЫЕ%"=="y" goto ВСЁ

echo.
echo   Удаляю программу, книги в папке data оставляю.
for %%f in (server.js index.html styles.css package.json README.md CHANGELOG.md "Литсовет.bat" start.sh) do del "%%~f" 2>nul
rmdir /s /q src 2>nul
rmdir /s /q test 2>nul
echo   Готово. Ваши книги остались в папке data.
echo.
pause
exit /b 0

:ВСЁ
echo.
echo   Удаляю всё, включая книги.
rem Сам себя bat-файл удалить не может: пока он выполняется, файл открыт, и
rem rmdir снесёт всё вокруг, оставив папку с одним этим файлом. Поэтому папку
rem удаляет отдельный процесс, запущенный из другого места и подождавший,
rem пока это окно закроется.
set "ПАПКА=%~dp0"
if "%ПАПКА:~-1%"=="\" set "ПАПКА=%ПАПКА:~0,-1%"
cd /d "%TEMP%"
start "" /min cmd /c timeout /t 3 ^>nul ^& rmdir /s /q "%ПАПКА%"
echo   Готово. Папка исчезнет через пару секунд после закрытия этого окна.
echo.
pause
exit /b 0
'''

# В CP866 нет длинного тире, многоточия и типографских кавычек-лапок. Молча
# упасть на кодировании нельзя, но и молча выбросить символ — тоже: получится
# текст с дырками. Заменяем на то, что в 866 есть, и после этого ПРОВЕРЯЕМ,
# что обратное декодирование даёт ровно то, что мы собирались записать.
ЗАМЕНЫ = {
    '—': '-',      # — длинное тире
    '–': '-',      # – среднее тире
    '…': '...',    # … многоточие
    '“': '"', '”': '"', '„': '"',
    '«': '"', '»': '"',   # в cp866 их нет — проверено кодированием
    '‘': "'", '’': "'",
    ' ': ' ',      # неразрывный пробел
}

def под866(t):
    for a, b in ЗАМЕНЫ.items():
        t = t.replace(a, b)
    return t

def записать(имя, текст):
    путь = os.path.join(OUT, имя)
    готово = под866(текст)
    # Ни одного символа не должно потеряться незаметно.
    плохие = sorted({c for c in готово if c not in '\n\r' and не_кодируется(c)})
    if плохие:
        raise SystemExit('не кодируются в cp866: ' + ' '.join(f'{c!r}(U+{ord(c):04X})' for c in плохие))
    # \r\n — обязательны: cmd.exe с чистыми \n в некоторых конструкциях
    # (метки, многострочные блоки) ведёт себя непредсказуемо.
    данные = готово.replace('\n', '\r\n').encode('cp866')
    # Круговая проверка: то, что прочтёт cmd.exe, обязано совпасть с исходником.
    assert данные.decode('cp866').replace('\r\n', '\n') == готово, 'круг не сошёлся: ' + имя
    io.open(путь, 'wb').write(данные)
    print('записан', имя, len(данные), 'байт (cp866), круговая проверка пройдена')

def не_кодируется(c):
    try:
        c.encode('cp866'); return False
    except UnicodeEncodeError:
        return True

записать('УСТАНОВИТЬ ЛИТСОВЕТ.bat', УСТАНОВЩИК)
записать('_Литсовет.bat', ЗАПУСК)
записать('_УДАЛИТЬ ЛИТСОВЕТ.bat', УДАЛЕНИЕ)
