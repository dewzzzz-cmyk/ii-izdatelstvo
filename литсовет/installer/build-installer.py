# Сборка дистрибутива Литсовета: payload (app\) + три bat-файла установщика.
#
# Явный белый список файлов, а не «скопируй всё кроме»: чёрный список молча
# протаскивает в дистрибутив то, чего там быть не должно — 17 МБ чужих книг из
# data\, ключи в логах, черновые скрипты. Забытый нужный файл виден сразу
# (программа не стартует), забытый лишний — не виден никогда.
import io, os, shutil, subprocess, sys

СБОРКА   = os.path.dirname(os.path.abspath(__file__))   # литсовет/installer
ИСХОДНИК = os.path.dirname(СБОРКА)                      # литсовет
ВЫХОД    = os.path.join(СБОРКА, 'pkg')                  # промежуточная, в .gitignore
APP      = os.path.join(ВЫХОД, 'app')

ФАЙЛЫ = ['server.js', 'package.json', 'index.html', 'styles.css',
         'README.md', 'CHANGELOG.md', 'start.sh']
ПАПКИ = ['src', 'test']

def собрать_payload():
    if os.path.isdir(APP): shutil.rmtree(APP)
    os.makedirs(APP)
    for f in ФАЙЛЫ:
        ист = os.path.join(ИСХОДНИК, f)
        if not os.path.isfile(ист): raise SystemExit('НЕТ ФАЙЛА: ' + ист)
        shutil.copy2(ист, os.path.join(APP, f))
    for d in ПАПКИ:
        ист = os.path.join(ИСХОДНИК, d)
        if not os.path.isdir(ист): raise SystemExit('НЕТ ПАПКИ: ' + ист)
        # Логи и черновики могли осесть где угодно — фильтруем на копировании.
        shutil.copytree(ист, os.path.join(APP, d),
                        ignore=shutil.ignore_patterns('*.log', 'node_modules', '__pycache__'))
    # Пустая data — чтобы сервер не создавал её при первом запуске в неизвестный
    # момент и чтобы деинсталлятор знал, где искать книги.
    os.makedirs(os.path.join(APP, 'data', 'projects'))

def проверить_импорты():
    # Главная проверка целостности: любой файл из src мог тянуть модуль, которого
    # в белом списке нет. Ошибка вылезет только у пользователя в браузере, поэтому
    # ищем её здесь — по фактическим import-путям в скопированных файлах.
    import re
    беда = []
    for корень, _, файлы in os.walk(APP):
        for имя in файлы:
            if not имя.endswith(('.js', '.mjs')): continue
            п = os.path.join(корень, имя)
            # Строчные комментарии выкидываем: в этом коде принято цитировать
            # строки кода в пояснениях, и такая цитата ловилась как импорт.
            текст = re.sub(r'^\s*//.*$', '', io.open(п, encoding='utf-8').read(), flags=re.M)
            for м in re.finditer(r"""(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]""", текст):
                цель = os.path.normpath(os.path.join(корень, м.group(1)))
                if not os.path.exists(цель):
                    беда.append(os.path.relpath(п, APP) + ' -> ' + м.group(1))
    # src/href проверяем только в index.html: внутри модулей такие строки — это
    # разметка будущего EPUB со вставками ${...}, а не ссылки на файлы рядом.
    html = io.open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
    for м in re.finditer(r'(?:src|href)="(?!https?:|//|data:)([^"#?]+)', html):
        сырой = м.group(1)
        if '${' in сырой: continue
        if not os.path.exists(os.path.normpath(os.path.join(APP, сырой.lstrip('/')))):
            беда.append('index.html -> ' + сырой)
    return беда

def положить_bat():
    пары = [('_Литсовет.bat',          os.path.join(APP, 'Литсовет.bat')),
            ('_УДАЛИТЬ ЛИТСОВЕТ.bat',  os.path.join(APP, 'УДАЛИТЬ ЛИТСОВЕТ.bat'))]
    for ист, цель in пары:
        p = os.path.join(ВЫХОД, ист)
        if not os.path.isfile(p): raise SystemExit('сначала gen-installer.py: нет ' + p)
        shutil.copy2(p, цель); os.remove(p)

if __name__ == '__main__':
    subprocess.run([sys.executable, os.path.join(СБОРКА, 'gen-installer.py'), ВЫХОД], check=True)
    собрать_payload()
    положить_bat()
    беда = проверить_импорты()
    if беда:
        print('ОБОРВАННЫЕ ССЫЛКИ В ДИСТРИБУТИВЕ:')
        for b in беда: print('  ' + b)
        raise SystemExit(1)
    n = sum(len(f) for _,_,f in os.walk(APP))
    размер = sum(os.path.getsize(os.path.join(к,и)) for к,_,ф in os.walk(APP) for и in ф)
    print('payload: %d файлов, %.1f МБ' % (n, размер/1048576))
