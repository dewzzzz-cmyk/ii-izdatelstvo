// Стадия «Мир»: проактивный worldbuilding до Структуры. Кандидаты предлагает
// текстовый LLM (тот же, что и для прозы — не тратит отдельных денег), автор
// одобряет, факты уходят в общую Библию. Карта — отдельная кнопка, платный
// image-API, только по явному клику (спека §5, §6, §9).

import { getState, save } from '../state.js';
import { rebuildBibleVecs, applyFactEdit, deleteBibleFactAt, toggleFactPinned } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap, mapPromptFor, rerollWorldFact, categoriesFor, CATEGORY_HINTS, MAP_LANGUAGES, runWorldOverview, findWorldDuplicates } from '../world.js';
import { saveMapItem, addMapLabel, removeMapLabel, updateMapLabelText, applyMapLabels, MAX_MAP_LABELS as MAX_MAP_LABELS_UI } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
import { openFactModal } from './rule-modal.js';
import { openVersionHistoryModal } from './illustrations.js';

let _candidates = [];        // предложенные, ещё не одобренные факты (все категории вместе, у каждого своё .category)
let _selected = new Set();   // id одобренных чекбоксом
let _hints = {};             // текст подсказки на категорию — держим тут (не в state), иначе теряется при ре-рендере во время генерации другой карточки
let _ideaSeed = '';          // общая «Идея мира» — та же причина держать вне DOM/state
let _busyCategory = null;    // категория, для которой сейчас идёт точечная генерация
let _bulkBusy = false;       // «Предложить весь мир» — идёт последовательный обход категорий
let _bulkProgress = '';      // текст прогресса булк-генерации, напр. "2 из 4"
let _mapBusy = false;
let _mapError = '';  // инлайн вместо блокирующего alert() — тот же подход, что в ui/illustrations.js
let _mapLabelEdit = false; // режим расстановки текстовых подписей поверх карты (см. compositeMapLabels)
let _mapLabelBusy = false; // идёт пересборка dataUrl (canvas) после добавления/правки/удаления подписи
let _depthBusy = false;
let _depthResult = null; // {depth, thinCategories, issues, suggestions} — последний прогон runWorldOverview, держится до следующего клика
let _catDepthBusy = null; // категория, для которой сейчас идёт ТОЧЕЧНАЯ проверка глубины (кнопка «📊» на карточке, отдельно от общей кнопки вверху)

function factsOfCategory(worldFacts, cat){ return worldFacts.filter(f=>f.category===cat); }
function candidatesOfCategory(cat){ return _candidates.filter(c=>c.category===cat); }

function wordForm(n, one, few, many){
  const mod10=n%10, mod100=n%100;
  if(mod10===1 && mod100!==11) return one;
  if(mod10>=2 && mod10<=4 && (mod100<10||mod100>=20)) return few;
  return many;
}

function renderCategoryCard(s, worldFacts, cat, busyAny, depthBusyAny){
  const canon = factsOfCategory(worldFacts, cat);
  const cands = candidatesOfCategory(cat);
  const busy = _busyCategory===cat;
  const catDepthBusy = _catDepthBusy===cat;
  const selCount = cands.filter(c=>_selected.has(c.id)).length;
  return `<div class="world-cat-card" data-cat="${esc(cat)}">
    <div class="world-cat-h">
      <b>${esc(cat)}</b>
      <span class="muted">${canon.length ? `${canon.length} ${wordForm(canon.length,'факт','факта','фактов')}` : 'пусто'}</span>
    </div>
    <input type="text" class="world-cat-hint" data-cat="${esc(cat)}" value="${esc(_hints[cat]||'')}" placeholder="${esc(CATEGORY_HINTS[cat]||'подсказка (необязательно)')}">
    <div class="row" style="gap:6px">
      <button class="btn world-cat-gen" data-cat="${esc(cat)}" ${busyAny||depthBusyAny?'disabled':''}>${busy?'<span class="spinner"></span> …':'✨ Предложить'}</button>
      <button class="btn world-cat-depth" data-cat="${esc(cat)}" ${busyAny||depthBusyAny?'disabled':''} data-tip="Оценить глубину только этой категории">${catDepthBusy?'<span class="spinner"></span> …':'📊'}</button>
    </div>

    ${canon.length ? `<div class="world-cat-facts">
      ${canon.map(f=>{
        const i = s.bible.indexOf(f);
        return `<div class="mem-card bible-card${f.pinned?' pinned':''}" data-bi="${i}">
          <div class="bible-actions">
            <button class="bc-act wc-act${f.pinned?' pinned':''}" data-act="pin" data-bi="${i}" title="${f.pinned?'Закреплён — всегда виден стражам и агентам, даже если сцена не про этот факт':'Закрепить — факт будет виден стражам/агентам всегда, а не только когда сцена тематически похожа'}">📌</button>
            <button class="bc-act wc-act" data-act="edit" data-bi="${i}" title="Редактировать">✎</button>
            <button class="bc-act wc-act" data-act="reroll" data-bi="${i}" title="Другой вариант (ИИ)">🔄</button>
            <button class="bc-act wc-act" data-act="del" data-bi="${i}" title="Удалить">✕</button>
          </div>
          <div class="mem-title" style="color:var(--accent)">${esc(f.keys||'факт')}</div>
          <div class="muted" style="font-size:12px">${esc(f.text)}</div>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${cands.length ? `<div class="world-cat-cands">
      ${cands.map(c=>`
        <div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;flex:1;min-width:0">
              <input type="checkbox" class="w-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
              <div style="flex:1;min-width:0">
                <input type="text" class="w-keys" data-id="${c.id}" value="${esc(c.keys)}" style="font-size:11px;color:var(--text-2);border:none;background:transparent;width:100%;padding:0;margin-bottom:2px">
                <textarea class="w-text" data-id="${c.id}" rows="2" style="width:100%;font-size:13px">${esc(c.text)}</textarea>
              </div>
            </label>
            <button class="w-cand-del" data-id="${c.id}" title="Убрать этот вариант из списка" style="flex-shrink:0;border:none;background:none;color:var(--text-3);cursor:pointer;font-size:14px;line-height:1;padding:2px 4px">✕</button>
          </div>
        </div>`).join('')}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="btn world-cat-clear" data-cat="${esc(cat)}">Отменить</button>
        <button class="btn btn-primary world-cat-approve" data-cat="${esc(cat)}" ${selCount?'':'disabled'}>Сохранить в канон (${selCount})</button>
      </div>
    </div>` : ''}

    <div class="world-cat-add" data-cat="${esc(cat)}">+ добавить вручную</div>
  </div>`;
}

function renderMapBlock(s, geoCount){
  const items = s.illustrations?.items||[];
  const map = items.find(it=>it.type==='map');
  const canGenerate = geoCount >= 2;
  const cost = estimateImageCost(s.illustrations?.provider||'gemini', s.illustrations?.quality||'standard', 1);
  const ic = s.illustrations || {};
  const mapLang = MAP_LANGUAGES[ic.mapLanguage] ? ic.mapLanguage : 'ru';
  // Промпт ДО генерации (что будет отправлено) — mapPromptFor может бросить,
  // если canGenerate почему-то true, а фактов всё равно не хватает (гонка
  // между geoCount и реальным списком не ожидается, но try на всякий случай).
  let previewPrompt = '';
  if(canGenerate){ try{ previewPrompt = mapPromptFor(s); }catch(e){ /* покажется как обычно при клике */ } }
  // Промпт — всегда развёрнутый текст, не <details>: автор должен видеть, что
  // реально уйдёт в генератор, не кликая лишний раз, прежде чем платить за картинку.
  const promptBlock = (label, text)=> text ? `<div class="muted" style="font-size:11px;margin-bottom:2px">${label}</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:8px;font-style:italic;padding:6px 8px;background:var(--surface-2);border-radius:6px;white-space:pre-wrap">${esc(text)}</div>` : '';
  const labels = map?.labels || [];
  const labelImgSrc = _mapLabelEdit ? (map?.baseDataUrl || map?.dataUrl) : map?.dataUrl;
  return `<div class="ph">Карта мира (референс)</div>
    <div class="pad">
      ${map ? `<div class="wmap-wrap" id="wMapWrap" style="position:relative;display:inline-block;max-width:280px;margin-bottom:8px;${_mapLabelEdit?'cursor:crosshair':''}">
        <img src="${labelImgSrc}" style="max-width:280px;width:100%;border-radius:var(--radius);display:block;user-select:none;pointer-events:none">
        ${_mapLabelEdit ? labels.map(l=>`<div class="wmap-pin" data-id="${esc(l.id)}" style="position:absolute;left:${l.xPct}%;top:${l.yPct}%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:2px;background:rgba(20,14,8,0.85);border-radius:12px;padding:2px 4px;white-space:nowrap">
          <input type="text" class="wmap-pin-text" data-id="${esc(l.id)}" value="${esc(l.text)}" placeholder="название" style="width:80px;font-size:11px;border:none;background:transparent;color:#f7edd8;padding:1px 3px">
          <button class="wmap-pin-del" data-id="${esc(l.id)}" title="Удалить подпись" style="border:none;background:none;color:#f7edd8;cursor:pointer;font-size:12px;line-height:1;padding:0 3px">✕</button>
        </div>`).join('') : ''}
      </div>
      ${_mapLabelEdit ? `<div class="muted" style="font-size:11px;margin-bottom:8px">${_mapLabelBusy?'<span class="spinner"></span> Пересобираю картинку…':`Кликните по карте, чтобы поставить подпись (текст — настоящий, без риска кракозябр). ${labels.length}/${MAX_MAP_LABELS_UI}.`}</div>` : ''}
      <div class="row" style="gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn" id="wMapLabelToggle">${_mapLabelEdit?'✓ Готово с подписями':'🏷 Подписать места (настоящий текст)'}</button>
        ${map.versions&&map.versions.length?`<button class="btn" id="wMapHistory" title="История версий карты (${map.versions.length}) — можно вернуться к прошлой">🕐 История (${map.versions.length})</button>`:''}
      </div>
      <div class="muted" style="font-size:11px;margin-bottom:8px">Также доступно в разделе «Иллюстрации» →</div>` : ''}
      <div class="row" style="gap:14px;margin-bottom:4px;flex-wrap:wrap">
        <label class="row" style="gap:6px;align-items:center;font-size:12px" for="wMapLang" data-tip="Свой язык подписей именно для карты — не связан с языком обложки/иллюстраций сцен в «Иллюстрациях». Для выдуманных языков модель рисует стилизацию под дух письменности, не настоящий перевод.">Язык подписей карты
          <select id="wMapLang" style="font-size:12px;width:auto">
            ${Object.entries(MAP_LANGUAGES).map(([id,l])=>`<option value="${id}" ${mapLang===id?'selected':''}>${esc(l.label)}</option>`).join('')}
          </select>
        </label>
        <label class="row" style="gap:6px;align-items:center;font-size:12px" for="wMapQuality" data-tip="Общая настройка для всех картинок проекта (то же, что в разделе «Иллюстрации») — вынесена сюда для удобства, отдельного значения для карты нет.">Качество
          <select id="wMapQuality" style="font-size:12px;width:auto">
            <option value="standard" ${(ic.quality||'standard')==='standard'?'selected':''}>Стандарт</option>
            <option value="hd" ${ic.quality==='hd'?'selected':''}>HD</option>
          </select>
        </label>
      </div>
      <div class="row" style="margin-bottom:8px">
        <label class="row" style="gap:6px;align-items:center;font-size:12px" data-tip="По умолчанию карта подписывает только 2-3 самых важных места крупным текстом — так надёжнее. Больше подписей означает больше текста на картинке, а мелкий/частый текст у любых image-моделей чаще выходит нечитаемой кашей из символов."><input type="checkbox" id="wMapRichLabels" ${ic.mapRichLabels?'checked':''}> Больше подписей на карте (риск нечитаемых артефактов текста)</label>
      </div>
      ${promptBlock(map?'Промпт, которым сгенерирована текущая карта:':'', map?.prompt)}
      ${promptBlock(`Промпт для ${map?'следующей генерации':'генератора'} (стиль каждый раз меняется случайно):`, previewPrompt)}
      ${_mapError?`<div style="color:var(--err);font-size:12px;margin-bottom:8px">⚠ Карта: ${esc(_mapError)}</div>`:''}
      ${canGenerate
        ? `<button class="btn" id="wMap">${_mapBusy?'<span class="spinner"></span> …':(map?'🔄 Перегенерировать':'🗺 Сгенерировать карту')} — ~$${cost}</button>`
        : `<div class="muted" style="font-size:12px">Нужно хотя бы 2-3 факта категории «География», чтобы предложить карту.</div>`}
    </div>`;
}

// category=null — общая проверка (все категории сразу, кнопка вверху).
// category='X' — точечная проверка ОДНОЙ категории (кнопка «📊» на карточке):
// заголовок и текст кнопки дозаполнения меняются, блок «Тонкие категории» не
// показывается (он не имеет смысла, когда r уже про одну категорию).
function openWorldDepthModal(r, onFill, category=null){
  const root = document.getElementById('modalRoot'); if(!root) return;
  const col = r.depth>=7?'var(--ok)':r.depth>=4?'var(--warn)':'var(--err)';
  const title = category ? `📊 Глубина категории «${esc(category)}»` : '📊 Глубина мира';
  const fillLabel = category ? `🔧 Дозаполнить «${esc(category)}»` : `🔧 Дозаполнить тонкие категории (${r.thinCategories.length})`;
  const showFill = category ? true : r.thinCategories.length>0;
  root.innerHTML = `<div class="modal-bg" id="wdBg"><div class="modal" style="width:560px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>${title}</h2>
    <div class="apv-row" style="flex-direction:column;align-items:flex-start;gap:2px;background:var(--accent-bg);padding:10px 12px;margin-bottom:6px">
      <b style="font-size:24px;color:${col}">${r.depth}/10</b>
    </div>
    ${(!category && r.thinCategories.length) ? `<div class="ares-h">Тонкие категории</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">${r.thinCategories.map(c=>`<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
    ${r.issues.length ? `<div class="ares-h">Проблемы</div>${r.issues.map(i=>`<div class="ares-note"><span>${esc(i)}</span></div>`).join('')}` : ''}
    ${r.suggestions.length ? `<div class="ares-h">Куда копать</div>${r.suggestions.map(x=>`<div class="ares-note"><span>${esc(x)}</span></div>`).join('')}` : ''}
    ${(!r.issues.length && !r.suggestions.length) ? `<div class="muted" style="margin-top:8px">Замечаний нет — ${category?'категория':'мир'} уже неплохо проработан${category?'а':''}.</div>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:14px;gap:8px">
      ${showFill ? `<button class="btn btn-primary" id="wdFillThin">${fillLabel}</button>` : ''}
      <button class="btn" id="wdClose">Закрыть</button>
    </div>
  </div></div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('wdBg').onclick = close;
  document.getElementById('wdClose').onclick = close;
  const fillBtn = document.getElementById('wdFillThin');
  if(fillBtn) fillBtn.onclick = ()=>{ close(); onFill(r); };
}

// По клику «Дозаполнить тонкие категории» из модалки — та же генерация, что
// у «✨ Предложить»/«Предложить весь мир» (кандидаты, не автозапись в канон),
// но только по категориям из thinCategories и с доп. подсказкой из issues/
// suggestions проверки глубины, чтобы модель целилась именно в названные пробелы.
async function fillThinCategories(els, s, r){
  if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
  if(_busyCategory || _bulkBusy) return;
  const validCats = categoriesFor(s.project.genre);
  const targets = r.thinCategories.filter(c=>validCats.includes(c));
  if(!targets.length) return;
  const note = [
    r.issues.length ? `Проблемы из проверки глубины мира: ${r.issues.join('; ')}.` : '',
    r.suggestions.length ? `Куда копать: ${r.suggestions.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  _bulkBusy = true;
  for(let i=0;i<targets.length;i++){
    const cat = targets[i];
    _bulkProgress = `${i+1} из ${targets.length}`;
    renderWorld(els);
    const hint = [_hints[cat], note].filter(Boolean).join(' ');
    try{
      const fresh = await suggestWorldFacts(s, cat, { hint, ideaSeed:_ideaSeed });
      _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
      fresh.forEach(c=>_selected.add(c.id));
    }catch(e){ console.warn('Мир, дозаполнение '+cat+':', e.message); }
  }
  _bulkBusy = false; _bulkProgress = '';
  renderWorld(els);
}

// По клику «🔧 Дозаполнить «X»» из точечной модалки (кнопка «📊» на карточке
// категории) — та же генерация, что у «✨ Предложить» этой же категории, просто
// с доп. подсказкой из issues/suggestions ТОЧЕЧНОЙ проверки. Переиспользует
// _busyCategory (не отдельный флаг) — с точки зрения UI это и есть «Предложить»
// для этой карточки, просто предзаполненный контекстом из проверки глубины.
async function fillOneCategory(els, s, cat, r){
  if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
  if(_busyCategory || _bulkBusy) return;
  const note = [
    r.issues.length ? `Проблемы из проверки глубины: ${r.issues.join('; ')}.` : '',
    r.suggestions.length ? `Куда копать: ${r.suggestions.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  _busyCategory = cat; renderWorld(els);
  try{
    const hint = [_hints[cat], note].filter(Boolean).join(' ');
    const fresh = await suggestWorldFacts(s, cat, { hint, ideaSeed:_ideaSeed });
    _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
    fresh.forEach(c=>_selected.add(c.id));
  }catch(e){ alert('Мир: '+e.message); }
  finally{ _busyCategory = null; renderWorld(els); }
}

// Проверка дублей — локальная (TF-IDF-косинус, findWorldDuplicates), без LLM,
// поэтому не завязана на API-ключ и не блокирует остальные действия. Список
// пересчитывается заново после каждого удаления — так пользователь может
// разобрать сразу несколько пар подряд, не переоткрывая модалку.
function renderDuplicatesModal(els){
  const s = getState();
  const root = document.getElementById('modalRoot'); if(!root) return;
  const pairs = findWorldDuplicates(s);
  const body = pairs.length ? pairs.map(p=>{
    const ia = s.bible.indexOf(p.a), ib = s.bible.indexOf(p.b);
    const pct = Math.round(p.sim*100);
    return `<div class="dup-pair" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <div class="muted" style="font-size:12px;margin-bottom:4px">${esc(p.a.category)} · сходство ${pct}%</div>
      <div class="row" style="align-items:flex-start;gap:6px;margin-bottom:4px">
        <div style="flex:1;font-size:13px">${esc(p.a.text)}</div>
        <button class="btn dup-del" data-bi="${ia}" title="Удалить этот факт">✕</button>
      </div>
      <div class="row" style="align-items:flex-start;gap:6px">
        <div style="flex:1;font-size:13px">${esc(p.b.text)}</div>
        <button class="btn dup-del" data-bi="${ib}" title="Удалить этот факт">✕</button>
      </div>
    </div>`;
  }).join('') : `<div class="muted" style="margin-top:8px">Похожих фактов не найдено.</div>`;
  root.innerHTML = `<div class="modal-bg" id="dupBg"><div class="modal" style="width:600px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>🔍 Возможные дубли${pairs.length?` (${pairs.length})`:''}</h2>
    ${body}
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="dupClose">Закрыть</button></div>
  </div></div>`;
  const close = ()=>{ root.innerHTML=''; };
  document.getElementById('dupBg').onclick = close;
  document.getElementById('dupClose').onclick = close;
  document.querySelectorAll('.dup-del').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const i = +b.dataset.bi;
    const fact = s.bible[i]; if(!fact) return;
    const preview = fact.text.length>60 ? fact.text.slice(0,60)+'…' : fact.text;
    if(!confirm(`Удалить факт «${preview}»? Отменить нельзя.`)) return;
    if(deleteBibleFactAt(s.bible, i)){ rebuildBibleVecs(s.bible); save(); renderWorld(els); renderDuplicatesModal(els); }
  });
}

export function renderWorld(els){
  const s = getState();
  const p = s.project;
  const worldFacts = (s.bible||[]).filter(b=>b.source==='world');
  const cats = categoriesFor(p.genre);
  const geoCount = worldFacts.filter(b=>b.category==='география').length;
  const podWarning = missingPOD(s);
  const busyAny = _bulkBusy || !!_busyCategory;
  const depthBusyAny = _depthBusy || !!_catDepthBusy;

  els.left.innerHTML = `<div class="ph">Мир</div>
    <div class="pad muted" style="font-size:12px">${worldFacts.length ? `${worldFacts.length} фактов в каноне` : 'Пока нет фактов мира.'}</div>`;

  els.right.innerHTML = `<div class="ph">Идея мира (необязательно)</div><div class="pad">
    <div class="field"><textarea id="wSeed" rows="3" placeholder="в общих чертах, если есть — иначе агент оттолкнётся от жанра и синопсиса">${esc(_ideaSeed)}</textarea></div>
  </div>`;

  els.center.className = 'panel panel-center';
  els.center.innerHTML = `
    <div class="read-bar">
      <span class="read-title">Мир</span>
      <span style="flex:1"></span>
      <button class="btn" id="wDupCheck" ${busyAny||depthBusyAny?'disabled':''} data-tip="Ищет похожие/повторяющиеся факты канона мира (без LLM, мгновенно) — риск дублей растёт с каждой добавленной пачкой фактов.">🔍 Проверить дубли</button>
      <button class="btn" id="wDepthCheck" ${busyAny||depthBusyAny?'disabled':''} data-tip="Оценивает насколько подробно и конкретно проработан мир СРАЗУ ПО ВСЕМ категориям — не по прозе, писать сцены ещё не нужно.">${_depthBusy?'<span class="spinner"></span> …':'📊 Оценить глубину мира'}</button>
      <button class="btn btn-primary" id="wSuggestAll" ${busyAny?'disabled':''}>${_bulkBusy?'<span class="spinner"></span> '+esc(_bulkProgress):'✨ Предложить весь мир'}</button>
    </div>
    <div class="read-body" id="wBody">
      ${podWarning ? `<div class="pad" style="border:1px solid var(--err);border-radius:8px;margin:0 0 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Для альтернативной истории точка развилки — основа жанра. Добавьте факт категории «История» с чёткой развилкой (событие + год + следствия), прежде чем продолжать.</div>
      </div>` : ''}
      ${cats.map(cat=>renderCategoryCard(s, worldFacts, cat, busyAny, depthBusyAny)).join('')}
      ${renderMapBlock(s, geoCount)}
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn btn-primary" id="wNext">Дальше — ${p.useVoice?'Голос':'Структура'} →</button>
      </div>
    </div>`;

  bindHandlers(els, s);
}

function bindHandlers(els, s){
  // Подсказки — держим в модульных переменных (Task 5, шаг 2), не в DOM/state:
  // иначе ре-рендер при генерации ОДНОЙ категории стирал бы то, что автор
  // напечатал в поле другой ещё не отправленной карточки.
  const seedEl = document.getElementById('wSeed');
  if(seedEl) seedEl.addEventListener('input', ()=>{ _ideaSeed = seedEl.value; });
  document.querySelectorAll('.world-cat-hint').forEach(inp=>{
    inp.addEventListener('input', ()=>{ _hints[inp.dataset.cat] = inp.value; });
  });

  // Точечная генерация одной категории.
  document.querySelectorAll('.world-cat-gen').forEach(btn=>btn.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    const cat = btn.dataset.cat;
    if(_busyCategory || _bulkBusy) return;
    _busyCategory = cat; renderWorld(els);
    try{
      const fresh = await suggestWorldFacts(s, cat, { hint:_hints[cat], ideaSeed:_ideaSeed });
      _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
      fresh.forEach(c=>_selected.add(c.id));
    }catch(e){ alert('Мир: '+e.message); }
    finally{ _busyCategory = null; renderWorld(els); }
  });

  const wdup = document.getElementById('wDupCheck');
  if(wdup) wdup.onclick = ()=>renderDuplicatesModal(els);

  const wdc = document.getElementById('wDepthCheck');
  if(wdc) wdc.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_depthBusy || _catDepthBusy || _busyCategory || _bulkBusy) return;
    _depthBusy = true; renderWorld(els);
    try{
      _depthResult = await runWorldOverview(s);
      openWorldDepthModal(_depthResult, (r)=>fillThinCategories(els, s, r));
    }catch(e){ alert('Глубина мира: '+e.message); }
    finally{ _depthBusy = false; renderWorld(els); }
  };

  // Точечная проверка глубины ОДНОЙ категории (кнопка «📊» на карточке) —
  // отдельно от общей кнопки вверху, которая всегда идёт по всем сразу.
  document.querySelectorAll('.world-cat-depth').forEach(btn=>btn.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    const cat = btn.dataset.cat;
    if(_depthBusy || _catDepthBusy || _busyCategory || _bulkBusy) return;
    _catDepthBusy = cat; renderWorld(els);
    try{
      const r = await runWorldOverview(s, cat);
      openWorldDepthModal(r, (rr)=>fillOneCategory(els, s, cat, rr), cat);
    }catch(e){ alert('Глубина категории: '+e.message); }
    finally{ _catDepthBusy = null; renderWorld(els); }
  });

  // «Предложить весь мир» — последовательно, категория за категорией (не
  // Promise.all — все категории пишут в общий _candidates, параллельные
  // резолвы гонялись бы за одним и тем же состоянием; спек-ревью явно
  // рекомендовало последовательный обход).
  const sa = document.getElementById('wSuggestAll');
  if(sa) sa.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busyCategory || _bulkBusy) return;
    const cats = categoriesFor(s.project.genre);
    _bulkBusy = true;
    for(let i=0;i<cats.length;i++){
      const cat = cats[i];
      _bulkProgress = `${i+1} из ${cats.length}`;
      renderWorld(els);
      try{
        const fresh = await suggestWorldFacts(s, cat, { hint:_hints[cat], ideaSeed:_ideaSeed });
        _candidates = _candidates.filter(c=>c.category!==cat).concat(fresh);
        fresh.forEach(c=>_selected.add(c.id));
      }catch(e){ console.warn('Мир, категория '+cat+':', e.message); }
    }
    _bulkBusy = false; _bulkProgress = '';
    renderWorld(els);
  };

  // Кандидаты: чекбокс/правка текста (как раньше, только теперь рендерятся внутри карточки категории).
  document.querySelectorAll('.w-cb').forEach(cb=>cb.onchange=()=>{
    if(cb.checked) _selected.add(cb.dataset.id); else _selected.delete(cb.dataset.id);
    renderWorld(els);
  });
  document.querySelectorAll('.w-text').forEach(t=>t.addEventListener('change',()=>{
    const c = _candidates.find(x=>x.id===t.dataset.id); if(c) c.text = t.value.trim();
  }));
  document.querySelectorAll('.w-keys').forEach(t=>t.addEventListener('change',()=>{
    const c = _candidates.find(x=>x.id===t.dataset.id); if(c) c.keys = t.value.trim();
  }));
  // Убрать ОДИН вариант из списка — отдельно от чекбокса (снять галочку не
  // убирает карточку, она просто остаётся висеть невыбранной среди хороших
  // вариантов) и отдельно от «Отменить» (то стирает вообще все кандидаты категории).
  document.querySelectorAll('.w-cand-del').forEach(b=>b.onclick=()=>{
    _candidates = _candidates.filter(c=>c.id!==b.dataset.id);
    _selected.delete(b.dataset.id);
    renderWorld(els);
  });

  // Отменить/сохранить в канон — теперь на уровне одной категории.
  document.querySelectorAll('.world-cat-clear').forEach(btn=>btn.onclick=()=>{
    const cat = btn.dataset.cat;
    _candidates.filter(c=>c.category===cat).forEach(c=>_selected.delete(c.id));
    _candidates = _candidates.filter(c=>c.category!==cat);
    renderWorld(els);
  });
  document.querySelectorAll('.world-cat-approve').forEach(btn=>btn.onclick=()=>{
    const cat = btn.dataset.cat;
    const approved = _candidates.filter(c=>c.category===cat && _selected.has(c.id));
    s.bible = s.bible || [];
    approved.forEach(c=>{ s.bible.push({ keys:c.keys, text:c.text, source:'world', category:c.category }); _selected.delete(c.id); });
    _candidates = _candidates.filter(c=>!approved.includes(c));
    rebuildBibleVecs(s.bible);
    if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
    save(); renderWorld(els);
  });

  // Правка/удаление/перегенерация факта уже в каноне.
  document.querySelectorAll('.wc-act[data-bi]').forEach(b=>b.onclick=async (e)=>{
    e.stopPropagation();
    const i = +b.dataset.bi; const fact = s.bible[i]; if(!fact) return;
    if(b.dataset.act==='pin'){ if(toggleFactPinned(s.bible,i)){ save(); renderWorld(els); } return; }
    if(b.dataset.act==='del'){
      const preview = fact.text.length>60 ? fact.text.slice(0,60)+'…' : fact.text;
      if(!confirm(`Удалить факт «${preview}»? Отменить нельзя.`)) return;
      if(deleteBibleFactAt(s.bible,i)){ rebuildBibleVecs(s.bible); save(); renderWorld(els); }
      return;
    }
    if(b.dataset.act==='edit'){
      openFactModal({ keys: fact.keys, text: fact.text }, (keys, text)=>{
        if(applyFactEdit(s.bible, i, keys, text)){ rebuildBibleVecs(s.bible); save(); renderWorld(els); }
      });
      return;
    }
    if(b.dataset.act==='reroll'){
      if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели (⚙).'); return; }
      b.disabled = true; const orig = b.textContent; b.textContent = '…';
      try{
        const newText = await rerollWorldFact(s, fact);
        fact.text = newText;
        rebuildBibleVecs(s.bible); save(); renderWorld(els);
      }catch(err){ alert('Мир: '+err.message); b.disabled=false; b.textContent=orig; }
    }
  });

  // Добавить вручную — та же модалка, что и bibleAdd в ui/memory.js,
  // категория проставляется автоматически (карточка уже про конкретную категорию).
  document.querySelectorAll('.world-cat-add').forEach(el=>el.onclick=()=>{
    const cat = el.dataset.cat;
    openFactModal({}, (keys, text)=>{
      s.bible = s.bible || [];
      s.bible.push({ keys, text, source:'world', category:cat });
      rebuildBibleVecs(s.bible);
      if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
      save(); renderWorld(els);
    });
  });

  s.illustrations = s.illustrations || {};
  const wMapLang = document.getElementById('wMapLang');
  if(wMapLang) wMapLang.onchange = ()=>{ s.illustrations.mapLanguage = wMapLang.value; save(); renderWorld(els); };
  const wMapQuality = document.getElementById('wMapQuality');
  if(wMapQuality) wMapQuality.onchange = ()=>{ s.illustrations.quality = wMapQuality.value; save(); renderWorld(els); };
  const wMapRichLabels = document.getElementById('wMapRichLabels');
  if(wMapRichLabels) wMapRichLabels.onchange = ()=>{ s.illustrations.mapRichLabels = wMapRichLabels.checked; save(); renderWorld(els); };

  const wm = document.getElementById('wMap');
  if(wm) wm.onclick = async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_mapBusy) return;
    _mapBusy = true; _mapError=''; renderWorld(els);
    try{
      const { dataUrl, prompt } = await generateWorldMap(s);
      saveMapItem(s, dataUrl, prompt);
      save();
    }catch(e){ _mapError = e.message; }
    finally{ _mapBusy = false; renderWorld(els); }
  };

  const wmh = document.getElementById('wMapHistory');
  if(wmh) wmh.onclick = ()=>{
    const map = (s.illustrations?.items||[]).find(it=>it.type==='map');
    if(map) openVersionHistoryModal(map, s, ()=>renderWorld(els));
  };

  // ── Подписи мест на карте (настоящий текст поверх картинки, см. illustrations.js) ──
  const getMap = ()=>(s.illustrations?.items||[]).find(it=>it.type==='map');
  const wmlt = document.getElementById('wMapLabelToggle');
  if(wmlt) wmlt.onclick = ()=>{ _mapLabelEdit = !_mapLabelEdit; renderWorld(els); };

  const applyAndRerender = async (map)=>{
    _mapLabelBusy = true; renderWorld(els);
    try{ await applyMapLabels(map); save(); }
    catch(e){ _mapError = e.message; }
    finally{ _mapLabelBusy = false; renderWorld(els); }
  };

  const wmw = document.getElementById('wMapWrap');
  if(wmw && _mapLabelEdit) wmw.addEventListener('click', (e)=>{
    if(_mapLabelBusy) return;
    const map = getMap(); if(!map) return;
    const rect = wmw.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    if(!addMapLabel(map, 'Место', xPct, yPct)){ return; } // лимит подписей достигнут
    applyAndRerender(map);
  });

  document.querySelectorAll('.wmap-pin-text').forEach(inp=>{
    inp.addEventListener('click', e=>e.stopPropagation());
    inp.addEventListener('change', ()=>{
      const map = getMap(); if(!map) return;
      updateMapLabelText(map, inp.dataset.id, inp.value);
      applyAndRerender(map);
    });
  });
  document.querySelectorAll('.wmap-pin-del').forEach(b=>b.onclick = (e)=>{
    e.stopPropagation();
    const map = getMap(); if(!map) return;
    removeMapLabel(map, b.dataset.id);
    applyAndRerender(map);
  });

  const wn = document.getElementById('wNext');
  if(wn) wn.onclick = ()=>{ s.ui.stage = s.project.useVoice ? 'voice' : 'structure'; save(); };
}
