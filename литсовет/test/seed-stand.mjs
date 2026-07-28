// Заливает стенд (test/fixtures/stand.json) на запущенный сервер, чтобы
// проверять поломки на нём, а не на настоящей книге автора.
//
//   node test/seed-stand.mjs                      → http://localhost:8787
//   node test/seed-stand.mjs http://localhost:8788
//
// После заливки открыть приложение и выбрать проект «СТЕНД QA» в списке.
// Стенд можно ломать как угодно: перезалить — одна команда.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const здесь = path.dirname(fileURLToPath(import.meta.url));
const база = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');

const стенд = JSON.parse(await readFile(path.join(здесь, 'fixtures', 'stand.json'), 'utf8'));

// Сервер держит оптимистичную блокировку по rev: если стенд уже заливали,
// нужно отправить ТЕКУЩИЙ серверный rev, иначе прилетит 409 REV_CONFLICT.
const текущий = await fetch(`${база}/api/sync/${стенд.id}`)
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);
if (текущий && Number.isFinite(текущий.rev)) стенд.rev = текущий.rev;

const ответ = await fetch(`${база}/api/sync/${стенд.id}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(стенд),
});
const тело = await ответ.text();

if (!ответ.ok) {
  console.error(`Не удалось залить стенд: HTTP ${ответ.status} ${тело}`);
  process.exit(1);
}
console.log(`Стенд залит на ${база} — ${тело}`);
console.log('Открой приложение и выбери проект «СТЕНД QA — заранее сломанная книга».');
console.log('Что в нём заранее сломано:');
console.log('  2. Оборванный прогон       → баннер «недописанный черновик»');
console.log('  3. Ручной черновик автора  → баннера быть НЕ должно (различитель)');
console.log('  4. Недобор объёма          → 542 из 800, пометка о недоборе');
console.log('  Канон                      → «Глеб» отсутствует в брифах, баннер устаревшего канона');
