# Архив исходников для переноса разработки на другую машину.
#
# Отличается от установщика: там payload для запуска, здесь — то, с чем работают.
# Общее одно — белый список. Чёрный список молча утащил бы data/ с книгами
# (17 МБ на этой машине), логи прогонов и черновые .mjs-скрипты.
import io, json, os, sys, zipfile

СБОРКА   = os.path.dirname(os.path.abspath(__file__))   # литсовет/installer
ИСХОДНИК = os.path.dirname(СБОРКА)                      # литсовет
КОРЕНЬ   = 'litsovet'                                   # папка внутри архива

ФАЙЛЫ = ['server.js', 'package.json', 'index.html', 'styles.css',
         'README.md', 'CHANGELOG.md', 'start.sh', 'deploy.bat', 'build-deploy.bat']
ПАПКИ = ['src', 'test', 'installer']

ВЕРСИЯ = json.load(io.open(os.path.join(ИСХОДНИК, 'package.json'), encoding='utf-8'))['version']
ДАТА = sys.argv[2] if len(sys.argv) > 2 else ''
ИМЯ = 'litsovet-v%s%s.zip' % (ВЕРСИЯ, '-' + ДАТА if ДАТА else '')
ЦЕЛЬ = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ИСХОДНИК), ИМЯ)

ПРОПУСК = ('.log', '.pyc')
СЛУЖЕБНЫЕ = {'pkg', '__pycache__', 'node_modules'}

def добавить(z, путь, внутри):
    zi = zipfile.ZipInfo(внутри)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    zi.flag_bits |= 0x800     # имена в UTF-8 — иначе проводник Windows соврёт
    z.writestr(zi, io.open(путь, 'rb').read())

with zipfile.ZipFile(ЦЕЛЬ, 'w', zipfile.ZIP_DEFLATED) as z:
    for ф in ФАЙЛЫ:
        п = os.path.join(ИСХОДНИК, ф)
        if not os.path.isfile(п): raise SystemExit('НЕТ ФАЙЛА: ' + п)
        добавить(z, п, КОРЕНЬ + '/' + ф)
    for д in ПАПКИ:
        корень_д = os.path.join(ИСХОДНИК, д)
        if not os.path.isdir(корень_д): raise SystemExit('НЕТ ПАПКИ: ' + корень_д)
        for к, папки, файлы in os.walk(корень_д):
            папки[:] = sorted(p for p in папки if p not in СЛУЖЕБНЫЕ)
            for и in sorted(файлы):
                if и.endswith(ПРОПУСК): continue
                п = os.path.join(к, и)
                добавить(z, п, КОРЕНЬ + '/' + os.path.relpath(п, ИСХОДНИК).replace('\\', '/'))

with zipfile.ZipFile(ЦЕЛЬ) as z:
    записи = z.infolist()
    if z.testzip(): raise SystemExit('битая запись: ' + z.testzip())
    # Версия внутри архива обязана совпадать с именем файла: расхождение
    # APP_VERSION и реальной версии в этом проекте уже случалось дважды.
    внутри = json.loads(z.read(КОРЕНЬ + '/package.json'))['version']
    if внутри != ВЕРСИЯ: raise SystemExit('версия внутри %s, в имени %s' % (внутри, ВЕРСИЯ))
    state = z.read(КОРЕНЬ + '/src/state.js').decode('utf-8')
    if ("APP_VERSION = '%s'" % ВЕРСИЯ) not in state:
        raise SystemExit('APP_VERSION в state.js не совпадает с package.json')
    утечки = [x.filename for x in записи if '/data/' in x.filename or x.filename.endswith('.log')]
    if утечки: raise SystemExit('в архив попало лишнее: ' + ', '.join(утечки[:5]))

print('%s\n%d записей, %.1f МБ, версия %s внутри и в имени, CRC сошлись'
      % (ЦЕЛЬ, len(записи), os.path.getsize(ЦЕЛЬ)/1048576, ВЕРСИЯ))
