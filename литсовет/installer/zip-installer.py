# Упаковка дистрибутива. Имена внутри архива кириллические, поэтому важен не
# сам факт создания zip, а флаг UTF-8 (бит 11 общего назначения) у каждой такой
# записи: без него проводник Windows разбирает имена в системной кодировке и
# пользователь видит «пЄрхэютър» вместо «УСТАНОВИТЬ ЛИТСОВЕТ». Ставим флаг и
# проверяем, что он действительно записан.
import io, json, os, sys, zipfile

СБОРКА = os.path.dirname(os.path.abspath(__file__))
ИСТОЧНИК = os.path.join(СБОРКА, 'pkg')
# Версию берём из package.json, а не пишем руками: дважды за историю проекта
# расходились APP_VERSION и то, чем приложение представлялось на самом деле.
ВЕРСИЯ = json.load(io.open(os.path.join(os.path.dirname(СБОРКА), 'package.json'), encoding='utf-8'))['version']
ИМЯ = 'Литсовет-установщик-%s.zip' % ВЕРСИЯ
ЦЕЛЬ = sys.argv[1] if len(sys.argv) > 1 else os.path.join(СБОРКА, ИМЯ)

with zipfile.ZipFile(ЦЕЛЬ, 'w', zipfile.ZIP_DEFLATED) as z:
    for корень, папки, файлы in os.walk(ИСТОЧНИК):
        папки.sort(); файлы.sort()
        for имя in файлы:
            п = os.path.join(корень, имя)
            внутри = os.path.relpath(п, ИСТОЧНИК).replace('\\', '/')
            zi = zipfile.ZipInfo(внутри)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zi.flag_bits |= 0x800          # имя в UTF-8 — иначе проводник соврёт
            z.writestr(zi, io.open(п, 'rb').read())

плохие = []
with zipfile.ZipFile(ЦЕЛЬ) as z:
    записи = z.infolist()
    for zi in записи:
        нужен_флаг = any(ord(c) > 127 for c in zi.filename)
        if нужен_флаг and not (zi.flag_bits & 0x800):
            плохие.append(zi.filename)
    битый = z.testzip()

if плохие:  raise SystemExit('без флага UTF-8: ' + ', '.join(плохие))
if битый:   raise SystemExit('битая запись: ' + битый)
print('%s\n%d записей, %.1f МБ, флаг UTF-8 на месте, CRC сошлись'
      % (ЦЕЛЬ, len(записи), os.path.getsize(ЦЕЛЬ)/1048576))
