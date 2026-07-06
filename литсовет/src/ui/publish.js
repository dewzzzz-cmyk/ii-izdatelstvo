// Стадия «Публикация»: экспорт + чек-лист под РУЧНУЮ загрузку — авто-
// публикация через API недоступна ни для одной из трёх площадок (см. §1
// спеки docs/superpowers/specs/2026-07-06-publishing-checklist-design.md):
// у Author.Today API только для чтения, у ЛитРес — по бизнес-договору,
// у Прозы.ру API нет вообще. Секции ниже не сворачиваются — как карточки
// «Мира», не нужен ещё один UI-паттерн там, где обойдётся без него.

import { getState } from '../state.js';
import { buildBook, exportFb2, typo } from '../export.js';
import { esc } from './stages.js';

const AT_PART_LIMIT = 100000;     // Author.Today: рекомендованный максимум знаков на «часть»
const AT_NEWS_THRESHOLD = 15000;  // Author.Today: порог совокупного текста для «Новинок»
const LITRES_MIN_CHARS = 4000;    // ЛитРес Самиздат: минимальный объём книги
const LITRES_MAX_MB = 70;         // ЛитРес Самиздат: максимальный размер файла

let _chapterTexts = {}; // id вида "at-0"/"proza-2" → полный текст главы (источник для копирования, не хранить в DOM-атрибутах — может быть очень длинным)

function chapterFullText(ch){
  return ch.scenes.map(sc=>typo(sc.text).trim()).join('\n\n***\n\n');
}

function renderChapterList(book, platformId){
  return book.chapters.map((ch,i)=>{
    const text = chapterFullText(ch);
    const id = `${platformId}-${i}`;
    _chapterTexts[id] = text;
    const len = text.length;
    const over = len > AT_PART_LIMIT;
    return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>${esc(ch.title||'Глава '+(i+1))}</b>
        <span class="${over?'stale-badge':'muted'}" style="font-size:11px">${len.toLocaleString('ru')} зн.${over?' — больше лимита части':''}</span>
      </div>
      <button class="btn pub-copy" data-copy-id="${id}" style="align-self:flex-start;font-size:11px;padding:2px 8px">📋 Копировать текст главы</button>
    </div>`;
  }).join('');
}

function renderChecklist(items){
  return `<ul style="margin:6px 0 12px 18px;padding:0;font-size:12px;color:var(--text-2)">
    ${items.map(i=>`<li>${i}</li>`).join('')}
  </ul>`;
}

export function renderPublish(els){
  const s = getState();
  const book = buildBook(s);
  _chapterTexts = {};

  els.left.innerHTML = `<div class="ph">Публикация</div>
    <div class="pad muted" style="font-size:12px">Ни у одной площадки нет доступного автору API для авто-публикации — здесь готовятся материалы под их ручную форму/загрузчик, сам процесс публикации не заменяется.</div>`;

  els.right.innerHTML = `<div class="ph">Книга</div>
    <div class="pad muted" style="font-size:12px">${book.chapters.length} ${book.chapters.length===1?'глава':book.chapters.length<5&&book.chapters.length>0?'главы':'глав'}</div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
    <div class="read-bar"><span class="read-title">Публикация</span></div>
    <div class="read-body">
      ${!book.chapters.length ? '<div class="empty-state">Напишите хотя бы одну главу — здесь появятся материалы для публикации.</div>' : `
      <div class="world-cat-card">
        <div class="world-cat-h"><b>Author.Today</b></div>
        ${renderChecklist([
          `Текст вставляется в веб-форму по главам — файл не нужен, копируйте главу за главой ниже.`,
          `Рекомендованный максимум — ${AT_PART_LIMIT.toLocaleString('ru')} знаков на одну «часть» (главу).`,
          `Чтобы попасть в «Новинки», нужно суммарно ≥ ${AT_NEWS_THRESHOLD.toLocaleString('ru')} новых знаков за раз.`,
        ])}
        ${renderChapterList(book, 'at')}
      </div>

      <div class="world-cat-card">
        <div class="world-cat-h"><b>Проза.ру / Стихи.ру</b></div>
        ${renderChecklist([
          `Публикация — тоже через веб-форму вставки текста, файл не требуется.`,
        ])}
        ${renderChapterList(book, 'proza')}
      </div>

      <div class="world-cat-card">
        <div class="world-cat-h"><b>ЛитРес Самиздат</b></div>
        ${renderChecklist([
          `Загружается готовый файл — FB2, DOCX или PDF, минимум ${LITRES_MIN_CHARS.toLocaleString('ru')} знаков, максимум ${LITRES_MAX_MB} МБ.`,
          `Обложка — отдельно, PNG/JPG в RGB.`,
          `Название, аннотацию, жанр и цену заполняете в мастере публикации на сайте — специально не встроены в файл, чтобы не конфликтовать при конвертации.`,
        ])}
        <button class="btn btn-primary" id="pubFb2">⬇ Скачать FB2</button>
      </div>
      `}
    </div>`;

  bindHandlers(els, s);
}

function bindHandlers(els, s){
  document.querySelectorAll('.pub-copy').forEach(b=>b.onclick=()=>{
    const text = _chapterTexts[b.dataset.copyId];
    if(!text) return;
    navigator.clipboard?.writeText(text).catch(()=>{});
    const orig = b.textContent; b.textContent = '✓ Скопировано'; b.disabled = true;
    setTimeout(()=>{ b.textContent = orig; b.disabled = false; }, 1200);
  });
  const fb2 = document.getElementById('pubFb2');
  if(fb2) fb2.onclick = ()=>{ exportFb2(s); };
}
