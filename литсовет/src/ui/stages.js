// Рендереры стадий. ПП1+2: Концепция (онбординг+режим), Голос (образец→примеры),
// Структура (минимальный список сцен), Написание (редактор + запуск ядра).

import { getState, save, uid, addRule, charNamesMatch } from '../state.js';
import { extractVoice, analyzeStyleManner } from '../voice.js';
import { AUTHOR_STYLES, styleMatchesGenre } from '../styles.js';
import { ART_STYLES } from '../artStyles.js';
import { runScene, isRunning } from '../pipeline.js';
import { renderDiagnostics, renderSceneAnalysis, renderAgentPipeline } from './diagnostics.js';
import { renderMemory } from './memory.js';
import { renderChat } from './chat.js';
import { summarizeScene, driftCheck, maybeRollup, capBibleSize } from '../memory.js';
import { runBookArchitect, applySkeleton, runBookArchitectPatch, applySkeletonPatch, regenerateScene, regenerateDownstream, regenerateChapter, pushSceneVersion, revertScene, revertSkeleton, runStructureEval, clampSceneTargetWords } from '../architect-book.js';
import { chapterOf, chapterComplete, chapterClosed, needsAuthorHand, scenesOfChapter, closeChapter, isChapterLocked } from './author-control.js';
import { exportMd, exportDocx, exportEpub, exportJson } from '../export.js';
import { parseFile } from '../import.js';
import { importSeriesBook } from '../series.js';
import { transformSelection, INLINE_ACTIONS } from '../inline.js';
import { runHistoricalResearch } from '../historian.js';
import { rebuildBibleVecs, factAlreadyInBible } from '../bible.js';
import { worldFactsFingerprint } from '../world.js';
import { openRuleModal, openInputModal } from './rule-modal.js';
import { proofreadText } from '../proofread.js';
import { suggestEdits } from '../editor.js';
import { runBetaRead, runChekhovCheck, runCriticReview, canSuggestTitles, suggestTitles,
         hasWorldDepthFacts, runWorldDepthCheck, hasCharactersToCheck, runFlatCharacterCheck,
         passivityIsSystemic } from '../bookreview.js';
import { extractCraftSignature, detectRepeatingHumorPattern, dominantExpositionChannel } from '../craftsignals.js';
import { GENRES, ERAS } from '../genres.js';
import { suggestMissingWorldFacts } from '../world.js';
import { saveUploadedItem, removeCover } from '../illustrations.js';

export function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// .mode-switch/.mode-opt (Режиссёр/Фабрика, Отдельная книга/Серия, Голос) —
// раньше это были голые <div onclick>, недоступные с клавиатуры и без ролей
// для скринридера. Клик по-прежнему обрабатывает уже существующий onclick на
// контейнере (мы лишь синтетически вызываем .click() на нужной опции) —
// сама логика выбора не дублируется.
function bindModeSwitchKeyboard(container){
  if(!container) return;
  container.setAttribute('role', 'radiogroup');
  const opts = [...container.querySelectorAll('.mode-opt')];
  opts.forEach(o=>{
    o.setAttribute('role', 'radio');
    o.setAttribute('tabindex', o.classList.contains('sel') ? '0' : '-1');
    o.setAttribute('aria-checked', o.classList.contains('sel') ? 'true' : 'false');
  });
  container.onkeydown = (ev)=>{
    const cur = ev.target.closest?.('.mode-opt'); if(!cur || !opts.includes(cur)) return;
    if(ev.key===' '||ev.key==='Enter'){ ev.preventDefault(); cur.click(); }
    else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(ev.key)){
      ev.preventDefault();
      const i = opts.indexOf(cur);
      const dir = (ev.key==='ArrowRight'||ev.key==='ArrowDown') ? 1 : -1;
      const next = opts[(i+dir+opts.length)%opts.length];
      next.focus(); next.click();
    }
  };
}

// Кнопка «→ Прозаику» в панели Анализ сцены диспетчирует это событие.
// stages.js регистрирует слушатель один раз и вызывает doRun текущей сцены.
let _activeFlagFix = null;
document.addEventListener('litsovet:flag-fix', e => {
  if(_activeFlagFix) _activeFlagFix(e.detail.directive, e.detail.rewrite||false);
});

function sceneCountHint(tw){
  const w = parseInt(tw)||80000;
  const wps = Math.max(700, Math.min(2000, Math.round(w/60)));
  const scenes = Math.max(6, Math.round(w/wps));
  return `≈ ${scenes} сцен × ${wps} слов`;
}

let _topTab = 'analysis';  // analysis | process
let _busy = false;          // прогон идёт — блокируем переключение сцен (защита от гонки/потери данных)
let _autoChapter = false;   // автопилот главы: пишем оставшиеся сцены подряд
let _autoStopReq = false;   // запрошена остановка автопилота (после текущей сцены)
let _autoBusyLabel = '';    // текст на кнопке-«Стоп», пока автопилот работает — в т.ч. на фазе
                             // «закрываю главу» (summarizeChapter/runChekhovCheck — реальные вызовы
                             // ИИ, могут идти долго), где раньше кнопка не менялась и выглядела зависшей
// Сообщение о том, почему автопилот молча остановился — раньше при сбое сцены
// (сетевая ошибка, 5xx от прокси, обрыв) doRun писал «Ошибка: …» прямо в DOM
// редактора, но save() в finally runChapterAutopilot тут же перерисовывал
// панель заново по scene.text (пустому у несостоявшейся сцены) — сообщение
// затиралось генеритеской плашкой «Проза появится здесь…», и автор видел
// только то, что кнопка «Написать главу целиком» тихо вернулась в исходное
// состояние после одной сцены, без единого намёка на причину.
let _autoError = '';
let _runLog = [];           // лента шагов текущего/последнего прогона
let _selMenuHide = null;    // ссылки на document-слушатели initSelectionMenu (снимаем перед повторным навешиванием)
let _selMenuScroll = null;  // scroll-listener на panel-center для скрытия меню при прокрутке
let _runCurrent = '';       // что происходит прямо сейчас
let _edReviewOn = false;    // редактор в режиме ручного ревью (подсветка правок в тексте)
let _edSuggestions = [];    // необработанные предложения редактора текущей сцены
let _edReviewSceneId = null; // id сцены, к которой относятся _edSuggestions (сброс при смене сцены)
let _autoClosingChapters = new Set(); // главы, которые сейчас автозакрываются в «Фабрике» (защита от повторного вызова)
let _conceptAdvOpen = false; // «Дополнительные настройки» в Концепции — раскрыто/свёрнуто, переживает save()→rerender()
// Последние разборы Бета-ридера/Критика/Ружей Чехова — модалка закрывается по
// клику мимо (легко случайно), а сам разбор — реальный платный/долгий вызов
// LLM; без кэша закрытие теряет результат безвозвратно и его нужно оплачивать
// заново. Кнопка «↺» рядом с основной открывает этот кэш без нового вызова.
let _lastBetaRead = null;
let _lastCriticReview = null;
let _lastChekhov = null;

// Лента «Процесс»: пошагово что делают агенты и почему (особенно доработки).
function renderProcess(){
  if(!_runLog.length && !_runCurrent && !_busy)
    return `<div class="ph">Процесс</div><div class="empty-state">Запустите агентов — здесь по шагам видно, что и почему они делают.</div>`;
  const s=getState();
  const guardName=(role)=>{ const a=(s.agents||[]).find(x=>x.role===role||x.id===role); return a?a.name:role; };
  return `<div class="ph">Процесс ${_busy?'<span style="font-weight:400;text-transform:none;letter-spacing:0">идёт…</span>':''}</div>
    <div class="proc-feed">
      ${_runLog.map(l=>`<div class="proc-step ${l.state||''}">
        <div class="proc-line"><span class="proc-ic">${l.icon||'•'}</span><span class="proc-tx">${esc(l.text)}</span></div>
        ${l.flags&&l.flags.length?`<div class="proc-flags">
          ${l.flags.map(f=>`<div class="proc-flag"><span class="flag-sev sev-${f.severity}">${f.severity==='critical'?'критич':'предупр'}</span> <b>${esc(guardName(f.role))}:</b> ${esc(f.title)}${f.detail?`<div class="proc-flag-d">${esc(f.detail)}</div>`:''}</div>`).join('')}
          <button class="linklike proc-toanalysis" type="button">→ открыть и исправить во вкладке «Анализ сцены»</button>
        </div>`:''}
      </div>`).join('')}
      ${_busy&&_runCurrent?`<div class="proc-step run"><div class="proc-line"><span class="proc-ic"><span class="spinner"></span></span><span class="proc-tx">${esc(_runCurrent)}</span></div></div>`:''}
    </div>`;
}
// Живое обновление ленты во время прогона (без полного ре-рендера панели).
function pushProc(ev){
  if(ev.log){ _runLog.push(ev.log); }
  else if(ev.text){ _runCurrent = ev.text; }
  if(_topTab==='process'){ const b=document.getElementById('topBody'); if(b){ b.innerHTML=renderProcess(); b.scrollTop=b.scrollHeight; } }
}
// Правая панель «Написания»: ВЕРХ — анализ сцены (флаги), НИЗ — вкладки Роадмап/Агенты/Память.
function renderRightPanel(els){
  const s=getState();
  const rt = s.ui.rightTab || 'roadmap';
  const bottom = rt==='roadmap' ? renderRoadmap(s)
    : rt==='agents' ? `<div id="agentHost">${renderAgentPipeline()}</div>`
    : rt==='chat' ? renderChat()
    : renderMemory();
  els.right.className='panel panel-right split';
  els.right.innerHTML = `
    <div class="sect sect-top">
      <div class="rtabs">
        ${(()=>{
          const sc=(s.structure||[]).find(n=>n.id===s.ui.activeScene);
          const flagCnt=sc&&sc.flags?Object.values(sc.flags).reduce((t,a)=>t+(a||[]).length,0):0;
          const flagBadge=flagCnt?` <span style="background:var(--err-border);color:#fff;border-radius:8px;padding:0 5px;font-size:10px;font-weight:600">${flagCnt}</span>`:'';
          const procBadge=_busy?` <span style="color:var(--accent);font-size:10px">●</span>`:_runLog.length?` <span style="color:var(--text-2);font-size:10px">${_runLog.length}</span>`:'';
          return `<button class="rtab ${_topTab==='analysis'?'active':''}" data-tt="analysis">Анализ${flagBadge}</button>
        <button class="rtab ${_topTab==='process'?'active':''}" data-tt="process">Процесс${procBadge}</button>`;
        })()}
      </div>
      <div class="sect-scroll" id="topBody">${_topTab==='process'?renderProcess():renderSceneAnalysis()}</div>
    </div>
    <div class="sect sect-bot">
      <div class="rtabs">
        <button class="rtab ${rt==='roadmap'?'active':''}" data-rt="roadmap">Роадмап</button>
        <button class="rtab ${rt==='agents'?'active':''}" data-rt="agents">Агенты</button>
        <button class="rtab ${rt==='mem'?'active':''}" data-rt="mem">Память</button>
        <button class="rtab ${rt==='chat'?'active':''}" data-rt="chat">Чат</button>
      </div>
      <div class="sect-scroll ${rt==='chat'?'no-pad-scroll':''}" id="rtabBody">${bottom}</div>
    </div>`;
  els.right.querySelectorAll('.rtab[data-rt]').forEach(b=>b.onclick=()=>{ const s=getState(); s.ui.rightTab=b.dataset.rt; save(); });
  els.right.querySelectorAll('.rtab[data-tt]').forEach(b=>b.onclick=()=>{ _topTab=b.dataset.tt; renderRightPanel(els); });
  els.right.querySelectorAll('.proc-toanalysis').forEach(b=>b.onclick=()=>{ _topTab='analysis'; renderRightPanel(els); });
}

// ─────────────────────────────── КОНЦЕПЦИЯ ───────────────────────────────
export function renderConcept(els){
  const s = getState(); const p = s.project;
  // Логика жанрового dropdown: известный жанр → выбрать его; неизвестный → выбрать «другой» + показать поле
  const _knownGenre = GENRES.find(g=>g.v && g.v!=='другой' && g.v===p.genre);
  const _genreSelectVal = _knownGenre ? p.genre : (p.genre ? 'другой' : '');
  const _showCustom = !_knownGenre && !!p.genre;
  const _knownEra = ERAS.find(e=>e.v && e.v!=='другой' && e.v===p.era);
  const _eraSelectVal = _knownEra ? p.era : (p.era ? 'другой' : '');
  const _showCustomEra = !_knownEra && !!p.era;
  const _canTitles = canSuggestTitles(s);
  els.left.innerHTML = `<div class="ph">Проект</div><div class="pad">
    <div class="muted">Прогрессивный онбординг: один вопрос, остальное по желанию.</div></div>`;
  els.right.innerHTML = '';
  els.center.innerHTML = `
    <div class="hero">
      <h1>О чём ваша книга?</h1>
      <div class="sub">Одно-два предложения. Остальное настроим по ходу.</div>
      <textarea class="big-input" id="idea" rows="3" placeholder="например: Женщина приезжает в северный город после смерти тётки и узнаёт, что та вела двойную жизнь…">${esc(p.idea)}</textarea>

      <div class="field" style="margin-top:14px"><label>Название</label>
        <div class="row" style="gap:8px">
          <input type="text" id="title" value="${esc(p.title)}" placeholder="Рабочее название" style="flex:1">
          <button class="btn" id="titleSuggestBtn" type="button" ${_canTitles?'':'disabled'}
            data-tip="${_canTitles?'5-8 вариантов названия по содержанию уже написанных глав':'Допишите хотя бы 2 главы — тогда предложения будут по содержанию, а не по одной фразе синопсиса'}">✨ Предложить</button>
        </div>
        <div id="titleSuggestions" style="display:flex;flex-direction:column;gap:4px;margin-top:8px"></div>
      </div>

      <div class="field"><label>Автор <span class="hint">имя на обложке и в метаданных экспорта (EPUB, Word)</span></label>
        <input type="text" id="pAuthor" value="${esc(p.author||'')}" placeholder="Имя Фамилия или псевдоним"></div>

      <div class="field"><label>Синопсис <span class="hint">необязательно — нить сюжета, ключевые повороты; архитектор будет строить структуру на его основе</span></label>
        <textarea id="synopsis" rows="4" placeholder="Главная героиня приезжает в северный город… встречает загадочного незнакомца… в финале раскрывает тайну…">${esc(p.synopsis)}</textarea></div>

      <div class="field"><label>Жанр</label>
        <select id="genre">
          ${GENRES.map(g=>`<option value="${esc(g.v)}"${_genreSelectVal===g.v?' selected':''}>${esc(g.label)}</option>`).join('')}
        </select>
        <input type="text" id="genreCustom" value="${_showCustom?esc(p.genre):''}" placeholder="Свой жанр…" style="${_showCustom?'':'display:none'}">
      </div>

      <div class="field"><label>Режим работы</label>
        <div class="mode-switch" id="modeSwitch">
          <div class="mode-opt ${p.mode==='director'?'sel':''}" data-mode="director">Режиссёр<small>обязательная правка рукой · стоп после каждой главы</small></div>
          <div class="mode-opt ${p.mode==='factory'?'sel':''}" data-mode="factory">Фабрика<small>без остановок · автопилот идёт через всю книгу</small></div>
        </div>
        ${p.mode==='factory'?`<button class="btn" id="disableAllManual" style="margin-top:8px" data-tip="Переводит всех агентов (Прозаик, Оценщик, Стражи, редакторы) в автоматический режим — без пауз на подтверждение. Настройки температуры/токенов и включённость агентов не трогает, только флаг «ручной».">⚡ Выключить ручные подтверждения у всех агентов</button>`:''}
      </div>

      <button class="adv-toggle" id="advBtn">${_conceptAdvOpen?'▴':'▾'} Дополнительные настройки</button>
      <div id="adv" style="${_conceptAdvOpen?'':'display:none'}">
        <div class="field"><label>Формат</label>
          <div class="mode-switch" id="typeSwitch">
            <div class="mode-opt${p.type==='single'?' sel':''}" data-type="single">Отдельная книга<small>самостоятельное произведение</small></div>
            <div class="mode-opt${p.type==='series'?' sel':''}" data-type="series">Серия<small>несколько книг</small></div>
          </div>
        </div>
        <div id="seriesFields" style="${p.type==='series'?'':'display:none'}">
          <div class="field"><label>Название серии</label>
            <input type="text" id="seriesTitle" value="${esc(p.seriesTitle||'')}" placeholder="например: Северная трилогия"></div>
          <div class="field"><label>Книга в серии</label>
            <div class="row" style="gap:8px;align-items:center">
              <input type="number" id="seriesBook" value="${p.seriesBook||1}" min="1" style="width:70px">
              <span class="muted">из</span>
              <input type="number" id="seriesTotal" value="${p.seriesTotal||3}" min="2" style="width:70px">
            </div>
          </div>
          <div id="prevBooksField" style="${(p.seriesBook||1)>1?'':'display:none'}">
            <div class="field"><label>Содержание предыдущих книг <span class="hint">кратко — ИИ будет учитывать это в структуре и сценах</span></label>
              <textarea id="seriesSummary" rows="4" placeholder="Книга 1: Алина приезжает в Мурманск, узнаёт что тётка была двойным агентом…">${esc(p.seriesSummary||'')}</textarea></div>
          </div>
        </div>
        <div class="field"><label>Эпоха / сеттинг</label>
          <select id="era">
            ${ERAS.map(e=>`<option value="${esc(e.v)}"${_eraSelectVal===e.v?' selected':''}>${esc(e.label)}</option>`).join('')}
          </select>
          <input type="text" id="eraCustom" value="${_showCustomEra?esc(p.era):''}" placeholder="Своя эпоха/сеттинг…" style="${_showCustomEra?'':'display:none'}">
        </div>
        <div class="field"><label>Целевой объём (слов)</label>
          <input type="text" id="tw" value="${esc(p.targetWords||80000)}">
          <div class="hint" id="twHint">${sceneCountHint(p.targetWords||80000)}</div>
        </div>
        <div class="field"><label>Объём сцены (слов) <span class="hint">пусто/0 = авто (≈${Math.round((p.targetWords||80000)/60)}/60 слов, зажато 700–2000)</span></label>
          <input type="text" id="sceneWords" value="${p.sceneWords||''}" placeholder="авто"></div>
        <div class="field"><label>Число глав <span class="hint">пусто/0 = «авто» (предзаполнит поле числа глав на стадии Структура, там можно переопределить точечно)</span></label>
          <input type="text" id="chapterCount" value="${p.chapterCount||''}" placeholder="авто"></div>
        <div class="field"><label>Темп/ритм <span class="hint">доля сцена/секвель у Архитектора при построении структуры</span></label>
          <select id="pacing">
            <option value="action"${p.pacing==='action'?' selected':''}>Динамичный</option>
            <option value="balanced"${(!p.pacing||p.pacing==='balanced')?' selected':''}>Сбалансированный</option>
            <option value="reflective"${p.pacing==='reflective'?' selected':''}>Медитативный</option>
          </select></div>
        <label class="field row" style="gap:8px;cursor:pointer;align-items:center">
          <input type="checkbox" id="useVoice" ${p.useVoice?'checked':''}
            style="width:16px;height:16px;flex-shrink:0">
          <span><b>Голос автора</b> — включить вкладку «Голос» <span class="hint">загрузить образец своей прозы, чтобы модель писала в вашем стиле</span></span>
        </label>
        <label class="field row" style="gap:8px;cursor:pointer;align-items:center">
          <input type="checkbox" id="visualVoiceOn" ${s.style?.visualVoiceOn?'checked':''}
            style="width:16px;height:16px;flex-shrink:0">
          <span><b>Визуальный голос</b> <span class="hint">единый арт-стиль для всех иллюстраций книги — описание ниже добавляется в промпт каждой картинки</span></span>
        </label>
        <div id="visualVoiceField" style="${s.style?.visualVoiceOn?'':'display:none'}">
          <textarea id="visualVoice" rows="2" placeholder="например: акварель, тёплые приглушённые тона, мягкий рассеянный свет, в духе книжной иллюстрации начала XX века">${esc(s.style?.visualVoice||'')}</textarea>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Художественный стиль <span class="hint">(необязательно — добавляется к промпту картинки; не зависит от «Визуального голоса»)</span></label>
          <select id="artStyleId">
            <option value="">— без пресета —</option>
            ${ART_STYLES.map(st=>`<option value="${st.id}"${st.id===(s.style?.artStyleId||'')?' selected':''}>${esc(st.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field row" style="gap:8px;align-items:center;margin-top:8px">
          <label>Цвет</label>
          <select id="colorMode">
            <option value="color"${s.style?.colorMode!=='bw'?' selected':''}>Цветные</option>
            <option value="bw"${s.style?.colorMode==='bw'?' selected':''}>Чёрно-белые</option>
          </select>
        </div>
        <div class="field"><label>Обложка <span class="hint">необязательно — попадёт в EPUB (JPEG/PNG, до 3 МБ)</span></label>
          <div class="row" style="gap:10px;align-items:center">
            <input type="file" id="pCover" accept="image/jpeg,image/png" style="display:none">
            <button class="btn" id="pCoverBtn" type="button">${p.coverDataUrl?'Заменить обложку':'📷 Загрузить обложку'}</button>
            ${p.coverDataUrl?`<img src="${p.coverDataUrl}" alt="обложка" style="height:72px;border-radius:4px;border:1px solid var(--border)"><button class="btn" id="pCoverDel" type="button" title="Убрать обложку">✕</button>`:''}
          </div>
        </div>
      </div>

      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn btn-primary" id="toNext">Дальше — Мир →</button>
      </div>
    </div>`;

  const bind = (id, fn)=>{ const e=document.getElementById(id); if(e) e.addEventListener('input',fn); };
  bind('idea', e=>{ p.idea=e.target.value; });
  bind('title', e=>{ p.title=e.target.value; });
  const tsb = document.getElementById('titleSuggestBtn');
  if(tsb) tsb.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    tsb.disabled = true; const orig = tsb.textContent; tsb.innerHTML = '<span class="spinner"></span>';
    const box = document.getElementById('titleSuggestions');
    try{
      const titles = await suggestTitles(s);
      box.innerHTML = titles.map(t=>`<button type="button" class="btn title-opt" data-title="${esc(t.title)}"
        style="text-align:left;white-space:normal" title="${esc(t.reason)}">${esc(t.title)}<span class="muted" style="display:block;font-size:11px;margin-top:2px">${esc(t.reason)}</span></button>`).join('');
      box.querySelectorAll('.title-opt').forEach(b=>b.onclick=()=>{
        p.title = b.dataset.title;
        const inp = document.getElementById('title'); if(inp) inp.value = p.title;
        box.innerHTML = '';
        save();
      });
    }catch(e){ alert('Названия: '+e.message); }
    finally{ tsb.disabled = false; tsb.textContent = orig; }
  };
  bind('pAuthor', e=>{ p.author=e.target.value; });
  bind('synopsis', e=>{ p.synopsis=e.target.value; });
  // Обложка: файл → dataURL, через тот же saveUploadedItem()/removeCover(), что
  // и раздел «Иллюстрации» — раньше эта кнопка писала ПРЯМО в project.coverDataUrl
  // мимо illustrations.items, и «✕ Убрать обложку» чистила только его же: если
  // обложка была сгенерирована через ИИ в «Иллюстрациях», её картинка оставалась
  // висеть в галерее, но никуда больше не попадала — выглядело как рассинхрон
  // между вкладками. Теперь один источник правды на обе.
  const coverInput = document.getElementById('pCover');
  const coverBtn = document.getElementById('pCoverBtn');
  if(coverBtn) coverBtn.onclick = ()=>coverInput && coverInput.click();
  if(coverInput) coverInput.onchange = ()=>{
    const f = coverInput.files && coverInput.files[0];
    if(!f) return;
    if(f.size > 3*1024*1024){ alert('Файл больше 3 МБ — сожмите изображение.'); coverInput.value=''; return; }
    const rd = new FileReader();
    rd.onload = ()=>{ saveUploadedItem(s, rd.result, {type:'cover'}); save(); renderConcept(els); };
    rd.readAsDataURL(f);
  };
  const coverDel = document.getElementById('pCoverDel');
  if(coverDel) coverDel.onclick = ()=>{ removeCover(s); save(); renderConcept(els); };
  const eraSel = document.getElementById('era');
  const eraCustom = document.getElementById('eraCustom');
  if(eraSel){
    eraSel.onchange = ()=>{
      const v = eraSel.value;
      if(v==='другой'){ eraCustom.style.display=''; eraCustom.focus(); p.era = eraCustom.value||''; }
      else { eraCustom.style.display='none'; p.era = v; save(); }
    };
  }
  if(eraCustom) eraCustom.addEventListener('input', e=>{ p.era=e.target.value; });
  bind('seriesSummary', e=>{ p.seriesSummary=e.target.value; });
  bind('tw', e=>{
    p.targetWords=parseInt(e.target.value)||80000;
    const h=document.getElementById('twHint'); if(h) h.textContent=sceneCountHint(p.targetWords);
  });
  bind('sceneWords', e=>{ p.sceneWords=parseInt(e.target.value)||0; });
  bind('chapterCount', e=>{ p.chapterCount=parseInt(e.target.value)||0; });
  const pacingSel = document.getElementById('pacing');
  if(pacingSel) pacingSel.onchange = ()=>{ p.pacing = pacingSel.value; };
  // Жанр: выпадающий список + поле «свой»
  const genreSel = document.getElementById('genre');
  const genreCustom = document.getElementById('genreCustom');
  if(genreSel){
    genreSel.onchange = ()=>{
      const v = genreSel.value;
      const gd = GENRES.find(g=>g.v===v);
      if(v==='другой'){
        genreCustom.style.display=''; genreCustom.focus();
        p.genre = genreCustom.value||'';
      } else {
        genreCustom.style.display='none';
        p.genre = v;
        if(gd && gd.words){ p.targetWords=gd.words; const tw=document.getElementById('tw'); if(tw) tw.value=gd.words; const h=document.getElementById('twHint'); if(h) h.textContent=sceneCountHint(gd.words); }
        save();
      }
    };
  }
  if(genreCustom) genreCustom.addEventListener('input', e=>{ p.genre=e.target.value; });
  bind('seriesTitle', e=>{ p.seriesTitle=e.target.value; });
  bind('seriesBook',  e=>{
    p.seriesBook=Math.max(1,parseInt(e.target.value)||1);
    const f=document.getElementById('prevBooksField'); if(f) f.style.display=p.seriesBook>1?'':'none';
  });
  bind('seriesTotal', e=>{ p.seriesTotal=Math.max(2,parseInt(e.target.value)||2); });
  document.getElementById('advBtn').onclick = (ev)=>{
    const a=document.getElementById('adv');
    _conceptAdvOpen = a.style.display==='none';
    a.style.display=_conceptAdvOpen?'block':'none';
    ev.target.textContent=(_conceptAdvOpen?'▴':'▾')+' Дополнительные настройки';
  };
  document.getElementById('typeSwitch').onclick = (ev)=>{
    const o=ev.target.closest('.mode-opt'); if(!o) return;
    p.type=o.dataset.type;
    document.querySelectorAll('#typeSwitch .mode-opt').forEach(el=>{
      const sel = el.dataset.type===p.type;
      el.classList.toggle('sel', sel);
      el.setAttribute('aria-checked', sel?'true':'false');
      el.setAttribute('tabindex', sel?'0':'-1');
    });
    document.getElementById('seriesFields').style.display=p.type==='series'?'':'none';
  };
  document.getElementById('modeSwitch').onclick = (ev)=>{ const o=ev.target.closest('.mode-opt'); if(!o)return; p.mode=o.dataset.mode; save(); };
  bindModeSwitchKeyboard(document.getElementById('modeSwitch'));
  bindModeSwitchKeyboard(document.getElementById('typeSwitch'));
  const dam = document.getElementById('disableAllManual');
  if(dam) dam.onclick = ()=>{
    (s.agents||[]).forEach(a=>{ a.manual=false; });
    dam.textContent = '✓ Все агенты переведены в авто-режим';
    dam.disabled = true;
    setTimeout(()=>save(), 900); // задержка — чтобы подтверждение успело мелькнуть перед ре-рендером
  };
  document.getElementById('useVoice').onchange = (ev)=>{
    p.useVoice = ev.target.checked;
    save();
  };
  s.style = s.style || {};
  document.getElementById('visualVoiceOn').onchange = (ev)=>{
    s.style.visualVoiceOn = ev.target.checked;
    const f = document.getElementById('visualVoiceField'); if(f) f.style.display = s.style.visualVoiceOn?'':'none';
    save();
  };
  bind('visualVoice', e=>{ s.style.visualVoice = e.target.value; });
  const artStyleSel = document.getElementById('artStyleId');
  if(artStyleSel) artStyleSel.onchange = ()=>{ s.style.artStyleId = artStyleSel.value; save(); };
  const colorModeSel = document.getElementById('colorMode');
  if(colorModeSel) colorModeSel.onchange = ()=>{ s.style.colorMode = colorModeSel.value; save(); };
  document.getElementById('toNext').onclick = ()=>{ save(); s.ui.stage = 'world'; save(); };
}

// ─────────────────────────────── ГОЛОС ───────────────────────────────
// Итог импорта книги серии — save() внутри #importBook.onclick запускает общий
// rerender(), который пересоздаёт #vstatus ДО того, как обработчик успевает
// записать в него текст (закэшированная ссылка на узел остаётся отсоединённой
// от страницы). Тот же приём «отложенной записки», что и _pendingDirective ниже:
// кладём текст сюда, save()/rerender() пересоздают разметку, а сразу после
// рендера читаем и один раз показываем — вместо мгновенно исчезающего сообщения.
let _voiceImportStatus = '';
export function renderVoice(els){
  const s = getState(); const v = s.voice;
  const mode = s.ui.voiceMode || 'sample';
  els.left.innerHTML = `<div class="ph">Голос</div><div class="pad"><div class="muted">Голос — отпечаток вашего стиля. Модель получает примеры предложений, не числа.</div></div>`;
  els.right.innerHTML = renderVoicePanel(v, s);
  els.center.innerHTML = `
    <div class="pad" style="max-width:620px">
      <div class="mode-switch" id="vmode">
        <div class="mode-opt ${mode==='sample'?'sel':''}" data-m="sample">Образец текста<small>пишу первую книгу</small></div>
        <div class="mode-opt ${mode==='series'?'sel':''}" data-m="series">Мои книги серии<small>продолжаю серию</small></div>
      </div>
      ${mode==='sample'?`
        <div class="field"><label>Образец прозы <span class="hint">(3–5 абзацев вашего текста или ориентир)</span></label>
          <textarea id="sample" rows="9" placeholder="Вставьте сюда фрагмент прозы…">${esc(v.sample)}</textarea></div>
        <div class="row"><button class="btn btn-primary" id="extract">Извлечь голос</button>
          <button class="btn" id="analyzeManner" ${s.global.apiKey?'':'disabled'} title="${s.global.apiKey?'Разбирает диалоги, описание мира/окружения, синтаксис — отдельными правилами':'Задайте API-ключ в настройках'}">✨ Разобрать манеру письма</button>
          <span class="muted" id="vstatus"></span></div>
        <div id="mannerResults" style="margin-top:10px"></div>
      `:`
        <div class="field"><label>Загрузить готовую книгу серии <span class="hint">(.txt, .docx, .epub)</span></label>
          <input type="file" id="bookFile" accept=".txt,.docx,.epub"></div>
        <div class="row"><button class="btn btn-primary" id="importBook">Импортировать и извлечь</button><span class="muted" id="vstatus"></span></div>
        ${(s.series||[]).length?`
          <div class="muted" style="margin-top:12px;margin-bottom:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Загруженные книги</div>
          ${s.series.map((b,i)=>`<div class="card" style="margin-bottom:6px;padding:8px 10px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:500">${esc(b.title)}</div>
              ${b.summary?`<div class="muted" style="font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.summary.slice(0,80))}…</div>`:''}
            </div>
            <button class="btn" style="font-size:11px;padding:2px 7px;flex-shrink:0" data-si="${i}" title="Удалить книгу из серии">✕</button>
          </div>`).join('')}
        `:''}
      `}
      ${renderStylePresets(s)}
      ${renderRefsEditor(s)}
      ${renderProfanityEditor(s)}
      ${renderHumorEditor(s)}
      ${renderRulesEditor(s)}

      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn" id="toStruct">Дальше — Структура →</button>
      </div>
    </div>`;

  if(_voiceImportStatus){
    const st = document.getElementById('vstatus');
    if(st) st.textContent = _voiceImportStatus;
    _voiceImportStatus = '';
  }

  document.getElementById('vmode').onclick=(ev)=>{ const o=ev.target.closest('.mode-opt'); if(!o)return; s.ui.voiceMode=o.dataset.m; save(); };
  bindModeSwitchKeyboard(document.getElementById('vmode'));
  bindRefsEditor();
  bindProfanityEditor();
  bindHumorEditor();
  bindRulesEditor();
  document.querySelectorAll('.style-add').forEach(btn=>{
    btn.onclick = ()=>{
      const st = AUTHOR_STYLES.find(x=>x.id===btn.dataset.id); if(!st) return;
      const cur = getState();
      cur.style.refs = cur.style.refs || [];
      if(!cur.style.refs.includes(st.name)) cur.style.refs.push(st.name);
      st.rules.forEach(r=>addRule(cur, r));
      save();
    };
  });
  // save() после "+ Добавить" перерисовывает всю стадию — без этого пропадали
  // остальные ещё не добавленные карточки разбора манеры.
  if(_mannerRules.length) renderMannerCards(_mannerRules, s);

  const ext=document.getElementById('extract');
  if(ext) ext.onclick = ()=>{
    const sample = document.getElementById('sample').value.trim();
    if(sample.length<40){ document.getElementById('vstatus').textContent='Слишком короткий образец.'; return; }
    // extractVoice не несёт evolution (историю дрейфа голоса между книгами
    // серии, см. series.js importSeriesBook) — без сохранения ручное
    // «Извлечь голос» на книге 3+ серии молча стирало всю накопленную
    // историю, хотя автор просто хотел подправить образец текущей книги.
    const prevEvolution = s.voice?.evolution || [];
    s.voice = extractVoice(sample, 5);
    if(prevEvolution.length) s.voice.evolution = prevEvolution;
    save();
  };

  const am=document.getElementById('analyzeManner');
  if(am) am.onclick = async ()=>{
    const sample = document.getElementById('sample').value.trim();
    const st = document.getElementById('vstatus');
    const resEl = document.getElementById('mannerResults');
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    am.disabled=true; st.innerHTML='<span class="spinner"></span> Разбираю манеру письма…'; resEl.innerHTML='';
    try{
      _mannerRules = await analyzeStyleManner(sample, s);
      st.textContent = _mannerRules.length ? `Разобрано ${_mannerRules.length} правил.` : '';
      renderMannerCards(_mannerRules, s);
    }catch(e){ st.textContent='Ошибка: '+e.message; }
    finally{ am.disabled=false; }
  };

  const imp=document.getElementById('importBook');
  if(imp) imp.onclick = async ()=>{
    const file = document.getElementById('bookFile').files[0];
    const st = document.getElementById('vstatus');
    if(!file){ st.textContent='Выберите файл.'; return; }
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    imp.disabled=true; st.innerHTML='<span class="spinner"></span> Читаю файл…';
    try{
      const text = await parseFile(file);
      if(text.length<200) throw new Error('Слишком мало текста в файле.');
      st.innerHTML='<span class="spinner"></span> Извлекаю голос, персонажей, канон…';
      const title = file.name.replace(/\.[^.]+$/,'');
      const report = await importSeriesBook(s, title, text);
      // save() ниже перерисовывает всю стадию — st ссылался бы на уже
      // отсоединённый узел, поэтому текст идёт через _voiceImportStatus (см. её
      // объявление выше) и подставляется renderVoice() уже в новую разметку.
      _voiceImportStatus = `Готово: ${report.charactersAdded} персонажей, ${report.factsAdded} фактов, голос (${report.voiceExamples} примеров).`;
      save();
    }catch(e){ st.textContent='Ошибка: '+e.message; }
    finally{ imp.disabled=false; }
  };
  document.querySelectorAll('[data-si]').forEach(b=>b.onclick=()=>{
    const s=getState(); const i=+b.dataset.si;
    if(i>=0&&i<(s.series||[]).length){ s.series.splice(i,1); save(); }
  });

  document.getElementById('toStruct').onclick = ()=>{ s.ui.stage='structure'; save(); };
}

// Разбор манеры письма (✨): кэш последнего результата для рендера карточек,
// каждое правило добавляется в Правила автора по отдельности — не молча всё сразу.
let _mannerRules = [];
function renderMannerCards(rules, s){
  const el = document.getElementById('mannerResults');
  if(!el) return;
  if(!rules.length){ el.innerHTML='<div class="muted" style="font-size:12px">Правил не найдено.</div>'; return; }
  el.innerHTML = rules.map((r,i)=>`
    <div class="card" style="margin-bottom:6px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font-size:12px;flex:1">${esc(r)}</span>
      <button class="btn manner-add" data-i="${i}" style="font-size:11px;padding:3px 9px;flex-shrink:0">${(s.style.rules||[]).includes(r)?'✓ Добавлено':'+ Добавить'}</button>
    </div>`).join('');
  el.querySelectorAll('.manner-add').forEach(btn=>{
    btn.onclick=()=>{
      const r = rules[+btn.dataset.i]; if(!r) return;
      const s=getState();
      if(addRule(s, r)) save(); // перерисовывает стадию — сама карточка уже отразит "✓ Добавлено" из state
      // прокрутка к "Правилам автора", чтобы автор видел, куда именно приземлилось правило
      document.getElementById('rulesList')?.scrollIntoView({behavior:'smooth', block:'center'});
    };
  });
}

// Готовые стили — библиотека 15 авторов (styles.js). Клик пишет имя автора в
// Ориентиры стиля и правила стиля в Правила автора через уже существующий
// addRule() (дедуп встроен, см. state.js). Подсветка «подходит жанру» —
// сортировка/бейдж, не фильтрация: все 15 всегда видны и кликабельны.
function renderStylePresets(s){
  const genre = s.project.genre;
  const applied = new Set(s.style.refs||[]);
  const sorted = [...AUTHOR_STYLES].sort((a,b)=>
    (styleMatchesGenre(b,genre)?1:0) - (styleMatchesGenre(a,genre)?1:0));
  return `<div class="field" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
    <label>Готовые стили <span class="hint">(классика и жанровые авторы — добавляют имя в «Ориентиры» и набор правил в «Правила автора»)</span></label>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:8px">
      ${sorted.map(st=>{
        const isApplied = applied.has(st.name);
        const fits = styleMatchesGenre(st, genre);
        return `<div class="card" style="padding:8px 10px">
          <div style="font-weight:600;font-size:13px">${esc(st.name)}${fits?' <span class="muted" style="font-weight:400;font-size:11px">· подходит жанру</span>':''}</div>
          <div class="muted" style="font-size:12px;margin:4px 0 8px">${esc(st.blurb)}</div>
          <button class="btn style-add" data-id="${st.id}" ${isApplied?'disabled':''} style="font-size:11px;padding:3px 9px">${isApplied?'✓ Добавлено':'+ Добавить'}</button>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// Ориентиры стиля (авторы/тексты для тона, не образец для копирования) — идут в
// промпт Прозаика отдельной строкой (см. context.js: projBlock).
function renderRefsEditor(s){
  const refs = (s.style.refs||[]);
  return `<div class="field" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
    <label>Ориентиры стиля <span class="hint">(авторы или тексты, чью манеру держать в уме — не образец для копирования, а имя ориентира)</span></label>
    <div class="chips" id="refsList" style="margin-bottom:8px">${refs.length
      ? refs.map((r,i)=>`<span class="tag">${esc(r)}<button class="tag-x" data-i="${i}" title="Удалить">✕</button></span>`).join('')
      : `<span class="muted" style="font-size:12px">Пока пусто.</span>`}</div>
    <div class="row">
      <input type="text" id="refInput" placeholder="напр.: Борис Акунин, Артур Конан Дойл" style="flex:1">
      <button class="btn" id="refAdd">Добавить</button>
    </div>
  </div>`;
}
function bindRefsEditor(){
  const add=document.getElementById('refAdd'), inp=document.getElementById('refInput');
  if(!add) return;
  const doAdd=()=>{
    const t=inp.value.trim(); if(!t) return;
    const s=getState(); s.style.refs=s.style.refs||[];
    if(!s.style.refs.includes(t)){ s.style.refs.push(t); save(); }
    inp.value='';
  };
  add.onclick=doAdd;
  inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
  document.querySelectorAll('.tag-x').forEach(b=>b.onclick=()=>{ const s=getState(); s.style.refs.splice(+b.dataset.i,1); save(); });
}

// Ненормативная лексика (мат) — раньше поле было в данных, но нигде не читалось
// (см. effectiveRules() в state.js). off по умолчанию: явный запрет мата в
// промпте Прозаика и Оценщика, а не молчаливое разрешение «как получится».
const PROFANITY_OPTIONS = [
  ['off', 'Выключено — без мата'],
  ['mild', 'Мягко — лёгкая грубость, без мата'],
  ['moderate', 'Естественно — модель решает сама'],
  ['strict', 'Разрешено — откровенный мат в напряжённых сценах'],
];
function renderProfanityEditor(s){
  const cur = s.style.profanity || 'off';
  return `<div class="field" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
    <label>Ненормативная лексика <span class="hint">(влияет на Прозаика и Оценщика)</span></label>
    <select id="profanitySel">
      ${PROFANITY_OPTIONS.map(([v,label])=>`<option value="${v}"${cur===v?' selected':''}>${esc(label)}</option>`).join('')}
    </select>
  </div>`;
}
function bindProfanityEditor(){
  const sel = document.getElementById('profanitySel');
  if(!sel) return;
  sel.onchange = ()=>{ const s=getState(); s.style.profanity = sel.value; save(); };
}

// Явная авторская настройка иронии/юмора поверх жанрового умолчания — см.
// humorLevelNote() в genres.js. Найдено живым разбором: даже в ироничном
// жанре модель регулярно роняет иронию к кульминации, а жанровая заметка
// это лишь разрешает, не требует — 'strong' даёт явное требование.
const HUMOR_OPTIONS = [
  ['auto', 'Автоматически — решает жанр'],
  ['off', 'Выключено — держать серьёзный тон'],
  ['light', 'Немного — только в спокойных местах'],
  ['strong', 'Много — ирония даже в кульминации'],
];
function renderHumorEditor(s){
  const cur = s.style.humorLevel || 'auto';
  return `<div class="field" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
    <label>Ирония / юмор <span class="hint">(влияет на Прозаика; включает Стража юмора вне «иронических» жанров)</span></label>
    <select id="humorSel">
      ${HUMOR_OPTIONS.map(([v,label])=>`<option value="${v}"${cur===v?' selected':''}>${esc(label)}</option>`).join('')}
    </select>
  </div>`;
}
function bindHumorEditor(){
  const sel = document.getElementById('humorSel');
  if(!sel) return;
  sel.onchange = ()=>{ const s=getState(); s.style.humorLevel = sel.value; save(); };
}

// Правила автора (do/don't): задаются один раз, идут Прозаику (профилактика),
// Оценщику (штраф) и Стражу стиля (ловит). Пополняются и здесь, и через ⊕ в разборах.
const STARTER_RULES = [
  'Не называй эмоцию ярлыком — показывай её жестом, действием или деталью.',
  'Эмоциональный сдвиг показывай только с явным триггером в тексте (что именно его вызвало).',
  'Не ставь два телесных маркера реакции подряд (сглотнул / выдохнул / сердце ёкнуло).',
  'Не заканчивай абзац декларацией-тезисом — давай вывод через конкретику или умолчание.',
  'Избегай сравнений, тавтологичных теме сцены (оптические метафоры там, где речь об оптике, и т.п.).',
];
function renderRulesEditor(s){
  const rules = (s.style.rules||[]);
  return `<div class="field" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
    <label>Правила автора <span class="hint">(чего избегать / как писать — идут Прозаику, Оценщику и Стражу стиля)</span></label>
    <div id="rulesList">${rules.length
      ? rules.map((r,i)=>`<div class="rule-item" data-ri="${i}"><span class="rule-text">${esc(r)}</span><button class="rule-edit" data-i="${i}" title="Редактировать правило">✏️</button><button class="rule-del" data-i="${i}" title="Удалить правило">✕</button></div>`).join('')
      : `<div class="muted" style="font-size:12px">Пока пусто. Добавьте правило, копите их по ходу работы (кнопкой «⊕ В правило» в разборе Оценщика, флагах и инлайн-меню) или <button class="linklike" id="rulesSeed">засейте примерами из разбора</button>.</div>`}</div>
    <div class="row" style="margin-top:8px">
      <input type="text" id="ruleInput" placeholder="напр.: не называй эмоцию ярлыком — показывай жестом или деталью" style="flex:1">
      <button class="btn" id="ruleAdd">Добавить</button>
    </div>
  </div>`;
}
function bindRulesEditor(){
  const add=document.getElementById('ruleAdd'), inp=document.getElementById('ruleInput');
  if(!add) return;
  const doAdd=()=>{ const t=inp.value.trim(); if(!t) return; if(addRule(getState(), t)){ save(); } inp.value=''; };
  add.onclick=doAdd;
  inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); doAdd(); } };
  document.querySelectorAll('.rule-del').forEach(b=>b.onclick=()=>{ const s=getState(); s.style.rules.splice(+b.dataset.i,1); save(); });
  document.querySelectorAll('.rule-edit').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i;
    const item=document.querySelector(`.rule-item[data-ri="${i}"]`); if(!item) return;
    const s=getState(); const orig=s.style.rules[i]||'';
    item.innerHTML = `<textarea class="rule-edit-input" rows="4" style="flex:1">${esc(orig)}</textarea>
      <button class="rule-save" data-i="${i}" title="Сохранить">💾</button>
      <button class="rule-cancel" title="Отмена">✕</button>`;
    const ei=item.querySelector('.rule-edit-input'); ei.focus(); ei.select();
    const doSave=()=>{ const t=ei.value.trim(); if(!t) return; const s2=getState(); s2.style.rules[i]=t; save(); };
    const doCancel=()=>{
      item.innerHTML = `<span class="rule-text">${esc(orig)}</span><button class="rule-edit" data-i="${i}" title="Редактировать правило">✏️</button><button class="rule-del" data-i="${i}" title="Удалить правило">✕</button>`;
      bindRulesEditor(); // переустановить обработчики только что восстановленных кнопок
    };
    item.querySelector('.rule-save').onclick=doSave;
    item.querySelector('.rule-cancel').onclick=doCancel;
    ei.onkeydown=(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); doSave(); } else if(e.key==='Escape'){ e.preventDefault(); doCancel(); } };
  });
  const seed=document.getElementById('rulesSeed');
  if(seed) seed.onclick=()=>{ const s=getState(); STARTER_RULES.forEach(r=>addRule(s, r)); save(); };
}

function renderVoicePanel(v, s){
  if(!v.examples || !v.examples.length) return `<div class="ph">Отпечаток</div><div class="empty-state">Голос ещё не извлечён.</div>`;
  const m = v.metrics||{};
  const chars = (s&&s.characters)||[];
  return `<div class="ph">Отпечаток голоса</div>
    <div class="pad">
      <div class="muted" style="margin-bottom:8px">Примеры (идут в промпт):</div>
      ${v.examples.slice(0,6).map(e=>`<div class="card" style="margin-bottom:6px;font-size:12px;font-style:italic;color:var(--text-2)">«${esc(e)}»</div>`).join('')}
      <div class="muted" style="margin:12px 0 6px">Метрики (только индикатор):</div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.8">
        Ср. длина предложения: <b>${m.avgSentence||'—'}</b> сл.<br>
        Доля диалога: <b>${m.dialogueRatio||0}%</b><br>
        Вариативность ритма: <b>${m.rhythmStdev||'—'}</b>
      </div>
      ${(v.evolution&&v.evolution.length)?`<div class="muted" style="margin:12px 0 6px">Эволюция голоса:</div>${v.evolution.map(e=>`<div style="font-size:11px;color:var(--text-2)">${esc(e.book)}: ср. ${e.avgSentence} сл (${e.delta>0?'+':''}${e.delta})</div>`).join('')}`:''}
      ${chars.length?`<div class="muted" style="margin:12px 0 6px">Персонажи серии (${chars.length}):</div>${chars.slice(0,8).map(c=>`<div class="card" style="margin-bottom:5px"><div style="font-size:12px;font-weight:500">${esc(c.name)}</div><div style="font-size:11px;color:var(--text-3)">${esc(c.stateNote||c.desc||'')}</div></div>`).join('')}`:''}
    </div>`;
}

// ─────────────────── ИСТОРИЧЕСКАЯ РАЗВЕДКА (правая панель Структуры) ───────────────────
let _historianFacts = []; // кэш последних найденных фактов для рендера карточек

function renderHistorianPanel(s){
  const era = s.project.era || '';
  // Раньше подпись всегда обещала «факты эпохи» — честно только когда эпоха
  // реально задана (исторический сеттинг). Без неё поиск идёт по жанру/идее
  // книги и находит тематически смежные, а не исторические факты (живой
  // тест: для фэнтези без эпохи выпали Google Glass, фильм «Она», D&D
  // Spelljammer — полезно как генератор идей, но это не «история эпохи»,
  // и подпись, обещающая это, вводит в заблуждение).
  const hint = era
    ? `Эпоха: «${esc(era)}»`
    : 'Эпоха не задана — поиск пойдёт по жанру и идее книги (тематические находки, не исторические факты). Заполните «Эпоха / сеттинг» в Концепции для настоящего исторического поиска.';
  const label = era ? '🔍 Найти факты эпохи' : '🔍 Найти тематические факты';
  return `<div class="ph">Историческая разведка</div>
    <div class="pad">
      <div class="muted" style="margin-bottom:10px;font-size:12px">Находит реальные факты через Википедию и добавляет их в Канон — Прозаик автоматически использует их при написании сцен.</div>
      <div class="muted" style="font-size:11px;margin-bottom:12px">${hint}</div>
      <button class="btn btn-primary" id="btnResearch" ${s.global.apiKey?'':'disabled'} title="${s.global.apiKey?'':'Задайте API-ключ в настройках'}">${label}</button>
      <div id="researchStatus" class="muted" style="margin-top:10px;font-size:12px"></div>
      <div id="researchResults" style="margin-top:12px"></div>
    </div>`;
}


function renderFactCards(facts, s){
  const el = document.getElementById('researchResults');
  if(!el) return;
  if(!facts.length){ el.innerHTML='<div class="muted" style="font-size:12px">Факты не найдены.</div>'; return; }
  el.innerHTML = facts.map((f,i)=>`
    <div class="card" style="margin-bottom:8px;padding:10px 12px">
      <div style="font-size:11px;color:var(--accent);font-weight:500;margin-bottom:4px">${esc(f.keys)}</div>
      <div style="font-size:12px;line-height:1.5;margin-bottom:5px">${esc(f.text)}</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:7px">💡 ${esc(f.plotHook||'')}</div>
      <button class="btn fact-add" data-i="${i}" style="font-size:11px;padding:3px 9px">${factAlreadyInBible(f, s.bible)?'✓ Похоже, уже в каноне':'+  В канон'}</button>
    </div>`).join('');
  el.querySelectorAll('.fact-add').forEach(btn=>{
    btn.onclick=()=>{
      const f = facts[+btn.dataset.i];
      if(!f) return;
      if(!factAlreadyInBible(f, s.bible)){
        s.bible.push({ keys: f.keys, text: f.text + (f.plotHook ? '\n💡 ' + f.plotHook : '') });
        capBibleSize(s);
        rebuildBibleVecs(s.bible);
        save();
      }
      btn.textContent='✓ Похоже, уже в каноне'; btn.disabled=true;
    };
  });
}

// Факты, которых, по мнению Архитектора, не хватает канону после построения
// скелета (спека §7 — канал открыт, не одноразовый гейт). Тот же визуальный
// паттерн, что у renderFactCards («Историческая разведка»), но пишет
// source:'world' + category, не смешивается с исторической разведкой.
let _missingFacts = []; // кэш последних найденных недостающих фактов для рендера карточек

// Сбрасывает карточки недостающих фактов (без запроса к LLM) — вызывается перед
// save() везде, где на экране мог остаться скелет, к которому карточки уже не
// относятся (перегенерация, откат). Иначе save() перерисует стадию и старые
// карточки мелькнут как будто относящиеся к новому/восстановленному скелету.
function clearMissingFacts(){ _missingFacts = []; }
// Пересчитывает карточки недостающих фактов для свежепостроенного skeleton и,
// если что-то нашлось, сразу рендерит их в #missingFactsBlock.
async function refreshMissingFacts(s, skeleton){
  _missingFacts = await suggestMissingWorldFacts(s, skeleton);
  if(_missingFacts.length) renderMissingFactCards(_missingFacts, s);
}

function renderMissingFactCards(facts, s){
  const el = document.getElementById('missingFactsBlock');
  if(!el) return;
  el.innerHTML = `<div style="margin-top:16px">
    <div class="muted" style="font-size:12px;margin-bottom:8px">Архитектор опирался на факты, которых нет в каноне:</div>
    ${facts.map((f,i)=>`
      <div class="card" style="margin-bottom:8px;padding:10px 12px">
        <div style="font-size:11px;color:var(--accent);font-weight:500;margin-bottom:4px">${esc(f.category)} · ${esc(f.keys)}</div>
        <div style="font-size:12px;line-height:1.5;margin-bottom:7px">${esc(f.text)}</div>
        <button class="btn missing-fact-add" data-i="${i}" style="font-size:11px;padding:3px 9px">${factAlreadyInBible(f, s.bible)?'✓ В каноне':'+ В канон'}</button>
      </div>`).join('')}
  </div>`;
  el.querySelectorAll('.missing-fact-add').forEach(btn=>{
    btn.onclick=()=>{
      const f = facts[+btn.dataset.i]; if(!f) return;
      // Раньше здесь была байт-точная проверка (b.text===f.text) — не ловила
      // перефраз того же факта, который такая же карточка чуть выше
      // (renderFactCards, историческая разведка) уже дедупит через
      // factAlreadyInBible (TF-IDF/cosine) — тот же паттерн, применён и тут.
      if(!factAlreadyInBible(f, s.bible)){
        s.bible.push({ keys:f.keys, text:f.text, source:'world', category:f.category });
        capBibleSize(s);
        rebuildBibleVecs(s.bible);
        save();
      }
      btn.textContent='✓ В каноне'; btn.disabled=true;
    };
  });
}

function bindHistorianPanel(s){
  const btn = document.getElementById('btnResearch');
  if(!btn) return;
  btn.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    btn.disabled=true;
    const st=document.getElementById('researchStatus');
    const res=document.getElementById('researchResults');
    res.innerHTML='';
    try{
      const result = await runHistoricalResearch(s, msg=>{ if(st) st.innerHTML='<span class="spinner"></span> '+esc(msg); });
      _historianFacts = result.facts;
      if(st) st.textContent=`Найдено ${result.articleCount} статей Википедии · ${result.facts.length} фактов`;
      renderFactCards(_historianFacts, s);
    }catch(e){
      if(st) st.textContent='Ошибка: '+e.message;
    }finally{ btn.disabled=false; }
  };
}

// ─────────── Панель оценки структуры ───────────
function renderStructureEval(ev){
  const score = ev.score ?? 0;
  const prev = ev.prevScore ?? null;
  const color = score >= 8 ? 'var(--ok)' : score >= 6 ? '#e6a817' : 'var(--err)';
  const axisNames = { arc:'Арка', pacing:'Темп', conflict:'Конфликт', balance:'Баланс', ending:'Финал' };
  const axesBadges = Object.entries(axisNames).map(([k,label])=>{
    const v = ev.axes?.[k] ?? score;
    const c = v>=8?'var(--ok)':v>=6?'#e6a817':'var(--err)';
    return `<span style="font-size:11px;padding:2px 7px;border-radius:10px;background:${c}22;color:${c};white-space:nowrap">${label} ${v.toFixed(0)}</span>`;
  }).join('');
  const issuesList = (ev.issues||[]).map(t=>`<li style="color:var(--err)">⚠ ${esc(t)}</li>`).join('');
  const suggList = (ev.suggestions||[]).map(t=>`<li style="color:var(--text-2)">→ ${esc(t)}</li>`).join('');
  // Показываем дельту если была предыдущая оценка
  const scoreDelta = prev !== null ? score - prev : null;
  const deltaHtml = scoreDelta !== null
    ? `<span style="font-size:13px;font-weight:600;color:${scoreDelta > 0 ? 'var(--ok)' : scoreDelta < 0 ? 'var(--err)' : 'var(--text-3)'}">
        ${scoreDelta > 0 ? '↑' : scoreDelta < 0 ? '↓' : '='} ${prev.toFixed(1)} → ${score.toFixed(1)}
      </span>`
    : '';
  const didDrop = scoreDelta !== null && scoreDelta < 0;
  return `
    <div id="structEvalPanel" style="margin-top:18px;border:1px solid ${didDrop?'var(--err)':'var(--border)'};border-radius:8px;padding:14px 16px;background:var(--surface-2)">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <b style="font-size:13px">Оценка структуры</b>
        <div class="row" style="gap:10px;align-items:center">
          ${deltaHtml}
          <span style="font-size:22px;font-weight:700;color:${color}">${score.toFixed(1)}<span style="font-size:13px;color:var(--text-3)">/10</span></span>
        </div>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${axesBadges}</div>
      ${didDrop ? `<div style="font-size:12px;color:var(--err);margin-bottom:8px">⚠ Оценка упала — предыдущая структура была лучше. Откатите или попробуйте ещё раз.</div>` : ''}
      ${issuesList ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:13px">${issuesList}</ul>` : ''}
      ${suggList ? `<ul style="margin:0 0 10px;padding-left:18px;font-size:13px">${suggList}</ul>` : ''}
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn" id="evalDismiss" style="font-size:12px">Скрыть</button>
        ${score < 8 ? `<button class="btn btn-primary" id="regenWithEval" style="font-size:12px">♻ Улучшить структуру по замечаниям</button>` : ''}
      </div>
    </div>`;
}

// Архитектор⇄Оценщик — авто-цикл для скелета книги (аналог Прозаик⇄Оценщик в
// pipeline.js, но для структуры целиком, не одной сцены). Раньше «Улучшить
// структуру по замечаниям» было целиком ручной кнопкой — автор жал её сам
// столько раз, сколько хотел, оценка вообще не проверялась автоматически.
// Теперь генерация/переработка идёт до s.global.structureMaxIter раз (по
// умолчанию 3, настраивается в карточке «Книжный архитектор»), останавливаясь
// раньше, если оценка достигла 8/10 — тот же порог, что уже решал, показывать
// ли кнопку «Улучшить» в renderStructureEval выше.
const AXIS_NAMES_STRUCT = { arc:'Арка', pacing:'Темп', conflict:'Конфликт', balance:'Баланс', ending:'Финал' };
// Почти идеальный балл — панель оценки прячется сама (см. runIterativeArchitect
// ниже), а не ждёт, пока автор нажмёт «Скрыть» руками ради результата, который
// и так хорош. Отдельно от порога 8/10 (останов итераций/кнопка «Улучшить») —
// это порог именно видимости панели, по просьбе автора.
const STRUCT_AUTOHIDE_SCORE = 9.5;
function hintFromStructureEval(ev){
  if(!ev) return '';
  const axisScores = ev.axes
    ? 'ОЦЕНКИ ПО ОСЯМ:\n' + Object.entries(AXIS_NAMES_STRUCT).map(([k,label])=>`${label}: ${(ev.axes[k]??ev.score).toFixed(0)}/10`).join(', ')
    : '';
  const suggestions = (ev.suggestions||[]).join('\n');
  const issues = (ev.issues||[]).join('\n');
  return [axisScores, issues && 'ПРОБЛЕМЫ:\n'+issues, suggestions && 'РЕКОМЕНДАЦИИ:\n'+suggestions].filter(Boolean).join('\n\n');
}
function currentSkeletonAsPrevious(s){
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  return chapters.length ? {
    chapters: chapters.map(ch=>({
      title: ch.title, arc: ch.arc,
      // sceneType (сцена/секвель) — БЕЗ него Архитектор при «улучшении» не видит,
      // какой ритм сцена/секвель уже был в книге, и расставляет его заново вслепую
      // (runBookArchitect, temp 0.6) — а Оценщик структуры судит именно по этой
      // оси (architect-book.js structureEvalMessages, «Ритм сцена/секвель»). Из-за
      // этого точечное исправление одной проблемы могло случайно перетасовать
      // весь ритм книги и уронить итоговый балл, хотя целевая проблема решена.
      scenes: (s.structure||[]).filter(n=>n.type==='scene' && n.chapterId===ch.id)
        .map(sc=>({ title:sc.title, brief:sc.brief, emotion:sc.emotion, entryState:sc.entryState, targetWords:sc.targetWords, sceneType:sc.sceneType }))
    }))
  } : null;
}
async function runIterativeArchitect(s, { chCount, seedEval, btnId }){
  const maxIter = Math.max(1, s.global.structureMaxIter ?? 3);
  let prevEval = seedEval || null;
  let prevScore = prevEval ? prevEval.score : null;
  let skeleton = null, evalResult = null;
  // Цикл, как и Прозаик⇄Оценщик сцены, не хранит «лучший» скелет отдельно от
  // текущего — каждая итерация безусловно перезаписывает structure последней
  // попыткой, даже если та вышла хуже предыдущей. Откат (↶, skeletonVersions)
  // это технически чинит, но молча — автор не узнает, что стоит откатиться,
  // если явно не сравнит баллы сам. Трекаем лучший балл только чтобы предупредить.
  let bestScore = prevScore, bestIter = 0, lastIter = 0;
  // save() пересобирает DOM на каждой итерации — переприменяем busy-состояние
  // и текст статуса к свежим элементам, а не к ссылкам, взятым до первого save().
  const setBusy = (busy)=>{ ['genSkeleton','regenWithEval'].forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=busy; }); };
  const setStatus = (html)=>{ const st=document.getElementById('genStatus'); if(st) st.innerHTML=html; };
  // #genStatus рендерится наверху, рядом с карточкой «Книжный архитектор» — а
  // «♻ Улучшить структуру по замечаниям» лежит в самом низу списка сцен (может
  // быть далеко за 3000px вниз). Автор жал кнопку внизу и не видел вообще
  // никакой реакции, пока не проскроллит наверх — выглядело как «ничего не
  // происходит». btnId уже передавался обоими вызывающими местами, но раньше
  // не читался: спиннер прямо на нажатой кнопке — тот же приём, что и у
  // остальных долгих действий в этом файле (ag-run, чекпоинты и т.п.).
  // Не захватываем подпись кнопки ОДИН раз при входе — genSkeleton зависит от
  // hasSkeleton (см. renderStructure), а первая же успешная итерация цикла
  // (ниже) вызывает applySkeleton()+save(), меняя «Сгенерировать скелет» на
  // «Перегенерировать». Захваченная один раз строка, восстановленная после
  // ОШИБКИ НА 2-Й/3-Й итерации, откатывала бы уже созданный скелет обратно на
  // подпись «ещё не создан», хотя главы/сцены уже видны на экране. Пересчитываем
  // «родную» подпись заново в момент восстановления (те же литералы, что и в
  // разметке кнопок выше), а не когда-то раньше.
  const restLabel = ()=>{
    if(btnId==='genSkeleton') return (s.structure||[]).some(n=>n.type==='chapter') ? 'Перегенерировать' : 'Сгенерировать скелет';
    if(btnId==='regenWithEval') return '♻ Улучшить структуру по замечаниям';
    return '';
  };
  const setClickedBtnBusy = (label)=>{
    if(!btnId) return;
    const b = document.getElementById(btnId);
    if(b) b.innerHTML = `<span class="spinner"></span> ${label}`;
  };
  setBusy(true);
  try{
    for(let iter=1; iter<=maxIter; iter++){
      lastIter = iter;
      const label = maxIter>1 ? `Прогон ${iter}/${maxIter}: ` : '';
      // Точечная правка (structurePatchMode) — только когда есть предыдущая оценка
      // С реальными affectedChapters. Первая генерация (prevEval==null) и обычный
      // режим (тумблер выключен) всегда идут старым путём — полной пересборкой.
      const affected = prevEval && prevEval.affectedChapters;
      const usePatch = !!(s.global.structurePatchMode && affected && affected.length);
      setStatus(`<span class="spinner"></span> ${label}Архитектор ${usePatch?`правит главы ${affected.join(', ')}`:(prevEval?'перерабатывает':'проектирует')} структуру…`);
      setClickedBtnBusy(`${label}Архитектор ${usePatch?`правит ${affected.length} гл.`:(prevEval?'перерабатывает':'проектирует')}…`);
      const hint = prevEval ? hintFromStructureEval(prevEval) : '';
      if(usePatch){
        const patchChapters = await runBookArchitectPatch(s, { affectedChapters:affected, hint });
        applySkeletonPatch(s, patchChapters, uid);
      } else {
        const previousSkeleton = prevEval ? currentSkeletonAsPrevious(s) : null;
        const freshSkeleton = await runBookArchitect(s, { ...(chCount?{chapters:chCount}:{}), hint, previousSkeleton });
        applySkeleton(s, freshSkeleton, uid);
      }
      // И полный, и точечный путь сходятся здесь: skeleton всегда пересобирается
      // из АКТУАЛЬНОГО state.structure (не из ответа LLM напрямую) — Оценщику и
      // refreshMissingFacts нужен один и тот же формат независимо от режима.
      skeleton = currentSkeletonAsPrevious(s);
      s.structureEval = null;
      clearMissingFacts();
      save();
      setBusy(true);
      setStatus(`<span class="spinner"></span> ${label}Оценщик проверяет структуру…`);
      setClickedBtnBusy(`${label}Оценщик проверяет…`);
      evalResult = await runStructureEval(s, skeleton, prevEval);
      if(evalResult && prevScore!=null) evalResult.prevScore = prevScore;
      s.structureEval = evalResult;
      save();
      setBusy(true);
      if(evalResult && (bestScore==null || evalResult.score > bestScore)){ bestScore = evalResult.score; bestIter = iter; }
      if(!evalResult || evalResult.score >= 8) break;
      prevEval = evalResult; prevScore = evalResult.score;
    }
    if(skeleton) await refreshMissingFacts(s, skeleton);
    // bestIter=0 ("лучший — исходный сид, ни одна итерация не улучшила")
    // раньше делал `bestIter &&` ложным (0 falsy), и предупреждение никогда
    // не показывалось именно в самом частом случае провала — когда ВСЕ
    // прогоны вышли хуже сида. bestIter!==lastIter корректно ловит и его.
    if(evalResult && bestIter !== lastIter && evalResult.score < bestScore - 0.5){
      setStatus(`⚠ Итоговый прогон ${lastIter} (${evalResult.score}/10) вышел хуже прогона ${bestIter} (${bestScore}/10) — кнопкой «↶ скелет» выше можно вернуться на более ранний, лучший вариант (может понадобиться несколько нажатий).`);
    } else if(evalResult && evalResult.score >= STRUCT_AUTOHIDE_SCORE){
      // Балл почти идеальный — панель с оценкой и так больше нечего сообщить
      // (issues/suggestions пусты), а «Улучшить» уже скрыта порогом 8/10 в
      // renderStructureEval. Прячем панель сама, а не заставляем автора
      // нажимать «Скрыть» руками ради результата, который и так хорош.
      s.structureEval = null;
      save();
      setStatus(`✓ Структура оценена на ${evalResult.score.toFixed(1)}/10 — отлично, дальше не нужно.`);
    }
  }catch(e){
    setStatus('');
    const stE = document.getElementById('genStatus');
    if(stE) stE.textContent = 'Ошибка: '+e.message;
    // Та же причина, что и у спиннера выше: если ошибка (например, не задан
    // API-ключ) видна только в #genStatus наверху, автор внизу страницы её не
    // увидит вовсе. Кратко показываем и на самой кнопке.
    if(btnId){
      const b = document.getElementById(btnId);
      if(b){ b.textContent = '⚠ ошибка'; b.title = e.message; setTimeout(()=>{ if(b.textContent==='⚠ ошибка'){ b.textContent = restLabel(); b.title=''; } }, 3000); }
    }
  }finally{
    setBusy(false);
    // Если кнопка ещё существует и до сих пор показывает наш спиннер (свежий
    // ре-рендер панели после save() уже мог вернуть ей родной текст сам —
    // тогда трогать не нужно), возвращаем исходную подпись.
    if(btnId){
      const b = document.getElementById(btnId);
      if(b && b.querySelector('.spinner')) b.textContent = restLabel();
    }
  }
}

// Напоминание «давно не проверяли согласованность мира» — живой инцидент:
// три взаимоисключающих факта о судьбе «первого землянина» (умер / выжил и
// стал старейшиной / убит-но-выжил) спокойно жили в Библии несколько глав
// подряд, потому что ручную дорогую проверку runWorldOverview (ui/world.js)
// никто не запускал повторно после того, как канон разросся. Сама проверка
// уже умеет обнаруживать «устарел ли кэш» через worldFactsFingerprint — не
// дублируем эту логику, только решаем, когда об этом стоит НАПОМНИТЬ автору
// вне вкладки «Мир»: если хотя бы одна глава уже закрыта (есть что портить)
// и факты мира изменились с последней проверки (или её не было вовсе).
// Не автозапуск (проверка платная, через LLM) — только ссылка на вкладку.
export function worldCheckStale(s){
  const hasClosedChapter = (s.structure||[]).some(n=>n.type==='chapter' && n.closed);
  if(!hasClosedChapter) return false;
  const fp = worldFactsFingerprint(s, null);
  if(s.ui.worldCheckDismissedFor === fp) return false;
  const cached = s.worldDepthEvals && s.worldDepthEvals.__all__;
  return !cached || cached.fingerprint !== fp;
}

// ─────────────────────────────── СТРУКТУРА (мин.) ───────────────────────────────
export function renderStructure(els){
  const s = getState();
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  els.left.innerHTML = `<div class="ph">Структура</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{ s.ui.activeScene=r.dataset.sc; s.ui.stage='write'; save(); });
  els.right.innerHTML = renderHistorianPanel(s);
  bindHistorianPanel(s);
  // save() после "+ В канон" перерисовывает всю стадию — без этого пропадали
  // остальные ещё не добавленные карточки фактов.
  if(_historianFacts.length) renderFactCards(_historianFacts, s);

  const hasSkeleton = (s.structure||[]).some(n=>n.type==='chapter');
  els.center.innerHTML = `
    <div class="pad" style="max-width:660px">
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:22px">🏛️</div>
          <div style="flex:1">
            <div style="font-weight:500">Книжный архитектор</div>
            <div class="muted">Сгенерирует скелет книги: главы → сцены с брифами и эмоциями. Один запуск, потом редактируете.</div>
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="muted">Глав:</label>
          <input type="text" id="chCount" value="${s.project.chapterCount||''}" placeholder="авто" style="width:70px">
          <button class="btn btn-primary" id="genSkeleton">${hasSkeleton?'Перегенерировать':'Сгенерировать скелет'}</button>
          ${(s.skeletonVersions&&s.skeletonVersions.length)?`<button class="btn" id="revertSkeleton" title="Вернуть прошлый скелет">↶ скелет (${s.skeletonVersions.length})</button>`:''}
          ${(hasSkeleton && !s.structureEval)?`<button class="btn" id="evalOnly" data-tip="Оценить ТЕКУЩУЮ структуру Оценщиком без перегенерации — например, после отката «↶ скелет», когда оценка пропала, а «Улучшить по замечаниям» без неё недоступна.">⭐ Оценить структуру</button>`:''}
          <span class="muted" id="genStatus"></span>
        </div>
        <label class="row" style="gap:6px;margin-top:8px;font-size:12px;cursor:pointer;color:var(--text-2)">
          <input type="checkbox" id="structurePatchMode" ${s.global.structurePatchMode?'checked':''}>
          Точечные правки при «Улучшить» — не трогать главы без замечаний Оценщика
        </label>
      </div>

      ${hasSkeleton ? renderSkeletonEditor(s) : `
        <div class="muted" style="margin:10px 0">или добавьте сцену вручную:</div>
        <div class="field"><label>Название сцены</label><input type="text" id="scName" placeholder="например: Вокзал в дождь"></div>
        <div class="field"><label>Бриф сцены</label><textarea id="scBrief" rows="2" placeholder="Что происходит, тон, чем заканчивается."></textarea></div>
        <div class="field"><label>Эмоция читателя</label><input type="text" id="scEmo" placeholder="тревога…"></div>
        <button class="btn" id="addScene">Добавить сцену</button>
      `}

      ${s.structureEval ? renderStructureEval(s.structureEval) : ''}
      ${s.structureStale ? `<div style="margin-top:14px;border:1px solid var(--err);border-radius:8px;padding:12px 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Добавлены факты мира после построения структуры — возможно, стоит перестроить.</div>
        <button class="btn" id="dismissStale" style="font-size:11px;margin-top:8px;padding:2px 9px">Скрыть</button>
      </div>` : ''}
      ${worldCheckStale(s) ? `<div style="margin-top:14px;border:1px solid var(--warn,#c9a227);border-radius:8px;padding:12px 14px;background:var(--surface-2)">
        <div style="font-size:12px">⚠ Канон мира менялся, а проверка согласованности («Мир» → «Оценка глубины мира») давно не запускалась — уже написаны главы, которые могли опереться на противоречащие друг другу факты.</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn" id="goWorldCheck" style="font-size:11px;padding:2px 9px">Открыть «Мир» →</button>
          <button class="btn" id="dismissWorldCheck" style="font-size:11px;padding:2px 9px">Скрыть</button>
        </div>
      </div>` : ''}
      <div id="missingFactsBlock"></div>

      ${scenes.length?`<div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn btn-primary" id="toWrite">К Написанию →</button></div>`:''}
    </div>`;
  // save() после "+ В канон" перерисовывает всю стадию — без этого пропадали
  // остальные ещё не добавленные карточки недостающих фактов. #missingFactsBlock
  // существует только после els.center.innerHTML выше, поэтому вызываем здесь,
  // а не рядом с renderFactCards (там #researchResults уже в els.right).
  if(_missingFacts.length) renderMissingFactCards(_missingFacts, s);

  document.getElementById('genSkeleton').onclick = async (ev)=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    if(hasSkeleton){
      const btn=ev.target;
      if(btn.dataset.confirmed!=='1'){
        const orig=btn.textContent; btn.dataset.confirmed='1';
        btn.textContent='Нажми ещё раз — сцены будут заменены';
        btn.style.cssText='background:var(--err-border);color:#fff';
        setTimeout(()=>{ if(btn.dataset.confirmed==='1'){ delete btn.dataset.confirmed; btn.textContent=orig; btn.style.cssText=''; } },3000);
        return;
      }
      delete btn.dataset.confirmed; btn.style.cssText='';
    }
    const chCount = parseInt(document.getElementById('chCount').value)||0;
    s.structureEval = null; // сбрасываем старую оценку
    s.structureStale = false;
    await runIterativeArchitect(s, { chCount, seedEval:null, btnId:'genSkeleton' });
  };

  const patchToggle = document.getElementById('structurePatchMode');
  if(patchToggle) patchToggle.onchange = ()=>{ s.global.structurePatchMode = patchToggle.checked; save(); };

  const rs=document.getElementById('revertSkeleton');
  if(rs) rs.onclick = ()=>{
    // revertSkeleton() сам восстанавливает state.structureEval — версию,
    // сохранённую вместе с этим срезом structure[] (см. pushSkeletonVersion).
    // Карточки недостающих фактов всё равно убираем: не перезапускаем LLM,
    // просто убираем то, что относилось к скелету-до-отката.
    if(revertSkeleton(s)){ clearMissingFacts(); save(); }
  };

  const dismissStale = document.getElementById('dismissStale');
  if(dismissStale) dismissStale.onclick = ()=>{ s.structureStale=false; save(); };

  const goWorldCheck = document.getElementById('goWorldCheck');
  if(goWorldCheck) goWorldCheck.onclick = ()=>{ s.ui.stage='world'; save(); };
  const dismissWorldCheck = document.getElementById('dismissWorldCheck');
  if(dismissWorldCheck) dismissWorldCheck.onclick = ()=>{ s.ui.worldCheckDismissedFor = worldFactsFingerprint(s, null); save(); };

  // Кнопки оценщика структуры
  const evalDismiss = document.getElementById('evalDismiss');
  if(evalDismiss) evalDismiss.onclick = ()=>{ s.structureEval=null; save(); };

  // «⭐ Оценить структуру» — прогон одного Оценщика по ТЕКУЩЕЙ структуре, без
  // Архитектора и перегенерации. Закрывает тупик после отката «↶ скелет»:
  // старые версии скелета (сохранённые до того, как pushSkeletonVersion начал
  // хранить оценку) восстанавливаются без structureEval — панель с баллом и
  // кнопкой «Улучшить по замечаниям» пропадала, и запустить оценку заново было
  // просто нечем: она вызывалась только изнутри цикла генерации.
  const evalOnly = document.getElementById('evalOnly');
  if(evalOnly) evalOnly.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    evalOnly.disabled = true;
    evalOnly.innerHTML = '<span class="spinner"></span> Оценщик проверяет…';
    try{
      const skeleton = currentSkeletonAsPrevious(s);
      if(!skeleton){ evalOnly.textContent='⭐ Оценить структуру'; evalOnly.disabled=false; return; }
      const ev = await runStructureEval(s, skeleton, null);
      s.structureEval = ev;
      save();
    }catch(e){
      evalOnly.textContent = '⚠ ошибка';
      evalOnly.title = e.message;
      setTimeout(()=>{ if(evalOnly.textContent==='⚠ ошибка'){ evalOnly.textContent='⭐ Оценить структуру'; evalOnly.title=''; evalOnly.disabled=false; } }, 3000);
      return;
    }
  };

  const regenWithEval = document.getElementById('regenWithEval');
  if(regenWithEval) regenWithEval.onclick = async ()=>{
    if(!s.structureEval) return;
    const chCount = parseInt(document.getElementById('chCount')?.value)||0;
    await runIterativeArchitect(s, { chCount, seedEval:s.structureEval, btnId:'regenWithEval' });
  };

  const add=document.getElementById('addScene');
  if(add) add.onclick = ()=>{
    const name=document.getElementById('scName').value.trim();
    const brief=document.getElementById('scBrief').value.trim();
    if(!name && !brief) return;
    // привязываем к последней главе (или создаём главу), иначе авторский контроль отключается
    let lastCh = [...s.structure].reverse().find(n=>n.type==='chapter');
    if(!lastCh){ lastCh={ id:uid('ch'), type:'chapter', title:'Глава 1', arc:'завязка' }; s.structure.push(lastCh); }
    s.structure.push({ id:uid('sc'), type:'scene', chapterId:lastCh.id, title:name||'Без названия', brief, emotion:document.getElementById('scEmo').value.trim(), text:'', words:0, status:'todo', targetWords:700 });
    save();
  };

  const tw=document.getElementById('toWrite'); if(tw) tw.onclick=()=>{ s.ui.stage='write'; if(!s.ui.activeScene){ const fs=scenes[0]; if(fs) s.ui.activeScene=fs.id; } save(); };
}

function renderSkeletonEditor(s){
  const nodes = s.structure||[];
  let html = '<div class="muted" style="margin-bottom:8px">Нажмите на сцену чтобы отредактировать бриф и эмоцию до написания.</div>';
  let curChapter = null;
  nodes.forEach(n=>{
    if(n.type==='chapter'){
      curChapter = n;
      html += `<div class="sk-chapter"><span class="sk-arc">${esc(n.arc||'')}</span> <span style="flex:1">${esc(n.title)}</span><button class="sk-ch-regen" data-chregen="${n.id}" title="Перегенерировать все сцены этой главы по подсказке">↻ глава</button></div>`;
    } else if(n.type==='scene'){
      const open = s.ui.editScene===n.id;
      const isSeq = n.sceneType==='sequel';
      html += `<div class="sk-scene ${open?'open':''}" data-sc="${n.id}">
        <div class="sk-scene-head" data-toggle="${n.id}">
          <span class="sk-sc-title">${isSeq?'<span class="sk-seq-badge" title="Секвель — сцена реакции/передышки">↺</span> ':''}${esc(n.title)}</span>
          <span class="sr-meta">${n.text?(n.words+' сл'):('~'+(n.targetWords||700))}</span>
        </div>
        ${open?`<div class="sk-scene-body">
          <textarea class="sk-brief" data-id="${n.id}" rows="4" placeholder="бриф">${esc(n.brief)}</textarea>
          <input type="text" class="sk-entry" data-id="${n.id}" value="${esc(n.entryState||'')}" placeholder="на входе в сцену уже есть/известно (если не очевидно из предыдущей) — необязательно" data-tip="Заполняйте, только если герой на входе в эту сцену уже имеет предмет/знание/состояние, которое не самоочевидно из предыдущей сцены — например, «знает адрес гильдии со слов торговца» или «уже без куртки, отдал её в сцене 3». Стражи и Оценщик структуры сверяются с этим полем явно.">
          <input type="text" class="sk-emo" data-id="${n.id}" value="${esc(n.emotion||'')}" placeholder="эмоция читателя">
          <div class="mode-mini" data-tip="Сцена — растущее напряжение (цель→конфликт→поражение). Секвель — передышка (реакция→дилемма→решение). Влияет на инструкцию Прозаику при написании.">
            <button class="mm-btn sk-type-btn ${!isSeq?'on':''}" data-typeid="${n.id}" data-type="scene">Сцена</button>
            <button class="mm-btn sk-type-btn ${isSeq?'on':''}" data-typeid="${n.id}" data-type="sequel">Секвель</button>
          </div>
          <div class="sk-regen">
            <input type="text" class="sk-hint" data-id="${n.id}" placeholder="в каком направлении переделать (подсказка ИИ)…">
            <button class="sk-ic" data-regen="${n.id}" title="Перегенерировать эту сцену по подсказке">↻</button>
            <button class="sk-ic" data-revert="${n.id}" title="Вернуть прошлую версию" ${(n.briefVersions&&n.briefVersions.length)?'':'disabled'}>↶${n.briefVersions&&n.briefVersions.length?' '+n.briefVersions.length:''}</button>
          </div>
          <button class="sk-down" data-down="${n.id}" title="Если поворот сюжета — переписать все сцены после этой под изменение">↻↓ Перегенерировать дальнейшие сцены под это изменение</button>
          <span class="sk-st" data-st="${n.id}"></span>
        </div>`:''}
      </div>`;
    }
  });
  setTimeout(()=>bindSkeleton(s), 0);
  return html;
}

function bindSkeleton(s){
  document.querySelectorAll('.sk-scene-head[data-toggle]').forEach(h=>{
    h.onclick=()=>{ const id=h.dataset.toggle; s.ui.editScene = s.ui.editScene===id?null:id; save(); };
  });
  document.querySelectorAll('.sk-brief').forEach(t=>t.addEventListener('change',()=>{ const n=node(s,t.dataset.id); if(n){n.brief=t.value; clearMissingFacts(); save();} }));
  document.querySelectorAll('.sk-entry').forEach(t=>t.addEventListener('change',()=>{ const n=node(s,t.dataset.id); if(n){n.entryState=t.value; clearMissingFacts(); save();} }));
  document.querySelectorAll('.sk-emo').forEach(t=>t.addEventListener('change',()=>{ const n=node(s,t.dataset.id); if(n){n.emotion=t.value; clearMissingFacts(); save();} }));
  document.querySelectorAll('.sk-type-btn').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const n=node(s,b.dataset.typeid); if(n){ n.sceneType=b.dataset.type; clearMissingFacts(); save(); }
  });

  document.querySelectorAll('.sk-ic[data-regen]').forEach(b=>b.onclick=async ()=>{
    const n=node(s, b.dataset.regen); if(!n) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    const hint=(document.querySelector(`.sk-hint[data-id="${n.id}"]`)?.value||'').trim();
    const st=document.querySelector(`.sk-st[data-st="${n.id}"]`);
    b.disabled=true; if(st) st.innerHTML='<span class="spinner"></span>';
    try{
      const fresh=await regenerateScene(s, n, hint);
      pushSceneVersion(n);                 // сохранить текущую версию перед заменой
      Object.assign(n, fresh);
      clearMissingFacts(); // бриф сцены перезаписан — старые карточки недостающих фактов больше не про то, что на экране
      save();
    }catch(e){ if(st) st.textContent='Ошибка: '+e.message; b.disabled=false; }
  });
  document.querySelectorAll('.sk-ic[data-revert]').forEach(b=>b.onclick=()=>{
    const n=node(s, b.dataset.revert); if(!n) return;
    if(revertScene(s, n)){ clearMissingFacts(); save(); }
  });
  document.querySelectorAll('.sk-ch-regen[data-chregen]').forEach(b=>b.onclick=()=>{
    const ch=node(s, b.dataset.chregen); if(!ch) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    openInputModal({
      title:'↻ Перегенерировать главу',
      hint:'Планы всех сцен главы «'+ch.title+'» будут переписаны, уже написанные — помечены недописанными (старый текст не теряется, доступен через «↶» в Написании). Саму прозу нужно будет сгенерировать заново там же — кнопкой «Написать главу целиком». В каком направлении менять план? (пусто — просто усилить)',
      placeholder:'напр.: больше напряжения между героями',
      okLabel:'Перегенерировать план',
      onOk: async (hint)=>{
        b.disabled=true; const orig=b.textContent; b.innerHTML='<span class="spinner"></span>';
        try{ await regenerateChapter(s, ch, hint); clearMissingFacts(); save(); }
        catch(e){ b.textContent='ошибка'; b.title=e.message; b.disabled=false; setTimeout(()=>{b.textContent=orig;},1500); }
      },
    });
  });
  document.querySelectorAll('.sk-down[data-down]').forEach(b=>b.onclick=async ()=>{
    const n=node(s, b.dataset.down); if(!n) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    const after = (s.structure||[]).filter(x=>x.type==='scene');
    const cnt = after.length - after.findIndex(x=>x.id===n.id) - 1;
    if(cnt<=0){ const st=document.querySelector(`.sk-st[data-st="${n.id}"]`); if(st) st.textContent='Это последняя сцена.'; return; }
    if(b.dataset.confirmed!=='1'){
      const orig=b.textContent; b.dataset.confirmed='1';
      b.textContent=`Нажми ещё раз — ${cnt} сцен будут переписаны`;
      b.style.cssText='background:var(--err-border);color:#fff;font-size:11px';
      setTimeout(()=>{ if(b.dataset.confirmed==='1'){ delete b.dataset.confirmed; b.textContent=orig; b.style.cssText=''; } },3000);
      return;
    }
    delete b.dataset.confirmed; b.style.cssText='';
    const hint=(document.querySelector(`.sk-hint[data-id="${n.id}"]`)?.value||'').trim();
    const st=document.querySelector(`.sk-st[data-st="${n.id}"]`);
    b.disabled=true; if(st) st.innerHTML='<span class="spinner"></span> Переписываю хвост книги…';
    try{
      const applied=await regenerateDownstream(s, n, hint);
      clearMissingFacts(); // хвост книги переписан — старые карточки недостающих фактов больше не про то, что на экране
      save();
      // cnt — сколько сцен реально было в хвосте ДО вызова; applied.length может
      // быть меньше, если модель вернула не все — оставшиеся помечены ⚠ (stale)
      // внутри regenerateDownstream, но статус-строка должна честно назвать недостачу.
      if(st) st.textContent = applied.length < cnt
        ? `Переписано ${applied.length} из ${cnt} — остальные помечены ⚠ как возможно устаревшие.`
        : `Переписано сцен: ${applied.length}.`;
    }catch(e){ if(st) st.textContent='Ошибка: '+e.message; b.disabled=false; }
  });
}
function node(s,id){ return (s.structure||[]).find(n=>n.id===id); }

// Пометить все НИЖЕ написанные сцены как возможно устаревшие (поворот сюжета выше).
function markDownstreamStale(s, scene){
  const scenes=(s.structure||[]).filter(n=>n.type==='scene');
  const i=scenes.findIndex(n=>n.id===scene.id);
  scenes.slice(i+1).forEach(n=>{ if(n.status==='done') n.stale=true; });
}

function renderSceneList(s){
  const nodes=(s.structure||[]);
  const scenes=nodes.filter(n=>n.type==='scene');
  if(!scenes.length) return `<div class="empty-state">Структуры пока нет.</div>`;
  let html='';
  nodes.forEach(n=>{
    if(n.type==='chapter'){ html+=`<div class="chapter-head">${esc(n.title)}</div>`; }
    else if(n.type==='scene'){
      const sc = n.lastEval?.weighted;
      const scoreBadge = sc ? `<span class="sr-score ${n.lastEval.pass?'score-pass':'score-fail'}" title="Оценка оценщика: ${sc}">${sc}</span>` : '';
      const seqBadge = n.sceneType==='sequel' ? '<span class="sk-seq-badge" title="Секвель — сцена реакции/передышки">↺</span> ' : '';
      const lockBadge = isChapterLocked(s, n.chapterId) ? '<span class="stale-dot" title="Заблокировано: закройте предыдущую главу">🔒</span> ' : '';
      html+=`<div class="scene-row ${s.ui.activeScene===n.id?'active':''}" data-sc="${n.id}">
        <span class="sr-name">${n.stale?'<span class="stale-dot" title="возможно устарела">⚠</span> ':''}${lockBadge}${seqBadge}${esc(n.title)}</span>${scoreBadge}<span class="sr-meta">${n.words||(n.status==='done'?'':'—')}</span></div>`;
    }
  });
  return html;
}

// ─────────────────────────────── НАПИСАНИЕ ───────────────────────────────
export function renderWrite(els){
  const s = getState();
  // Если pipeline завершился пока мы были на другой стадии — флаг мог зависнуть
  if(_busy && !isRunning()) _busy = false;
  const scenes=(s.structure||[]).filter(n=>n.type==='scene');
  if(!scenes.length){ els.left.innerHTML=`<div class="ph">Сцены</div>`; els.center.innerHTML=`<div class="empty-state">Сначала добавьте сцену на стадии «Структура».</div>`; els.right.innerHTML=''; return; }
  if(!s.ui.activeScene || !scenes.find(x=>x.id===s.ui.activeScene)) s.ui.activeScene=scenes[0].id;
  const scene = scenes.find(x=>x.id===s.ui.activeScene);
  // Смена сцены во время ручного ревью редактора — подсветка относилась к другой сцене.
  if(_edReviewOn && _edReviewSceneId !== scene.id){ _edReviewOn=false; _edSuggestions=[]; }

  els.left.innerHTML = `<div class="ph">Сцены</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{ if(_busy){ return; } s.ui.activeScene=r.dataset.sc; save(); });

  const ch = chapterOf(s, scene);
  const locked = ch && isChapterLocked(s, ch.id);
  const showStop = ch && chapterComplete(s, ch.id) && !chapterClosed(s, ch.id);
  const isFactoryMode = s.project.mode==='factory';
  // «Фабрика»: стоп не блокирует — глава закрывается сама, без клика.
  // Гвард по id не даёт запустить closeChapter повторно, пока первый вызов
  // ещё не долетел до save() (ch.closed выставляется внутри синхронно,
  // но до этого момента промежуточные ре-рендеры видели бы showStop=true снова).
  if(showStop && isFactoryMode && !_autoChapter && !_autoClosingChapters.has(ch.id)){
    _autoClosingChapters.add(ch.id);
    setTimeout(async ()=>{ await closeChapter(s, ch.id); _autoClosingChapters.delete(ch.id); }, 500);
  }

  els.center.innerHTML = `
    <div class="scene-bar">
      <span class="scene-tag" data-tip="${scene.sceneType==='sequel'?'Секвель: реакция героя → дилемма → решение. Меньше внешнего действия, передышка после потрясения.':'Сцена: цель героя → конфликт → поражение/осложнение. Растущее напряжение.'}">${scene.sceneType==='sequel'?'↺ Секвель':'Сцена'}</span>
      <span class="scene-title">${esc(scene.title)}</span>
      ${(()=>{ const illust=illustrationForScene(s, scene.id); return illust?`<img class="scene-thumb" src="${illust}" alt="Иллюстрация сцены" data-tip="Иллюстрация сцены — клик открывает в полный размер" id="sceneThumb">`:''; })()}
      ${scene.stale?'<span class="stale-badge" title="сцена выше изменилась — проверьте, не противоречит ли">⚠ возможно устарела</span>':''}
      ${scene.handDone?'<span class="hand-badge" title="абзац переписан автором">✍ рука автора</span>':''}
      ${(scene.status==='done' && scene.targetWords && scene.words && scene.words < scene.targetWords*0.6)?`<span class="stale-badge" title="Правки Оценщика/Прозаика режут текст, но объём в директиву не попадает — короче цели могло получиться и намеренно (хороший ритм), и просто из-за накопленных сокращений. Проверьте на слух.">📏 ${scene.words} из ${scene.targetWords} слов</span>`:''}
      <span style="flex:1"></span>
      ${scene.text?'<button class="iconbtn" id="edProof" data-tip="ИИ-корректор: орфография, пунктуация, согласование. Стиль не трогает — покажет список правок перед применением.">Аа✓</button>':''}
      ${scene.text?`<button class="iconbtn" id="edStyle" data-tip="Редактор: ищет клише, эмоциональные ярлыки, однообразный ритм. В ручном режиме подсвечивает фрагменты прямо в тексте — примите (✓) или отклоните (✗) каждый. В авто — применяет сразу.">${_edReviewOn?'✕ Завершить редактуру':'📝 Редактор'}</button>
      <div class="mode-mini" id="edStyleModeWrap" data-tip="Авто — правки применяются сразу без вопросов, изменения остаются в тексте даже если потом переключить обратно на ручной. Ручной — подсвечивает и спрашивает по каждой.">
        <button class="ed-mode-btn ${!s.ui.editorAuto?'on':''}" data-edmode="manual">Ручной</button>
        <button class="ed-mode-btn ${s.ui.editorAuto?'on':''}" data-edmode="auto">Авто</button>
      </div>`:''}
      <button class="iconbtn" id="edUndo" data-tip="Отменить изменение в тексте (Ctrl+Z)">↶</button>
      <button class="iconbtn" id="edRedo" data-tip="Вернуть изменение (Ctrl+Shift+Z)">↷</button>
      ${scene.text?`<button class="chat-clear" id="clearScene" data-tip="Стереть текст сцены и сбросить статус на «не написана». Прошлый текст остаётся в истории — можно вернуть кнопкой ↶ ниже, как после обычной перегенерации.">🗑 Очистить сцену</button>`:''}
    </div>
    <div class="editor ${scene.text?'':'empty'}" id="editor" ${scene.text?`contenteditable="${_edReviewOn?'false':'true'}" spellcheck="false"`:''}>${scene.text?(_edReviewOn?markedEditorHtml(scene.text):esc(scene.text)):'Проза появится здесь после запуска агентов.'}</div>
    <div id="selMenu" class="sel-menu" style="display:none"></div>
    <div id="edPopup" class="ed-popup" style="display:none"></div>
    ${locked?renderChapterLockedBanner(s, ch):(showStop?renderEditorialStop(s, ch, isFactoryMode):'')}
    <div class="brief-box">
      <div class="field" style="margin:0 0 8px"><label>Бриф сцены</label>
        <textarea id="brief" rows="4">${esc(scene.brief)}</textarea></div>
      ${s.characters&&s.characters.length?`<div class="field" style="margin:0 0 10px">
        <label style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em">Персонажи в сцене <span class="hint">(отметьте присутствующих — Стражи увидят их состояния)</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px">
          ${s.characters.map(c=>{const on=(scene.presentChars||[]).some(nm=>charNamesMatch(nm,c.name)); return `<label class="pc-tag${on?' active':''}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:12px;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent-dim)':'transparent'};cursor:pointer"><input type="checkbox" class="pc-cb" data-name="${esc(c.name)}" ${on?'checked':''} style="display:none"><span>${esc(c.name)}</span></label>`; }).join('')}
        </div>
      </div>`:''}
      <label style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em">Сказать агенту, что изменить</label>
      <div class="ia-row">
        <input type="text" id="directive" class="ia-input" placeholder="напр.: «сделай финал тревожнее», «убери описание погоды»">
        <button class="btn" id="reRun">↻ Переписать</button>
      </div>
      <div class="ia-chips">
        ${['сократи вдвое','усиль эмоцию','больше конкретной детали','короче предложения'].map(c=>`<span class="ia-chip" data-d="${esc(c)}">${esc(c)}</span>`).join('')}
      </div>
    </div>
    <div class="run-row">
      <button class="btn btn-primary" id="runBtn" style="flex:1" ${locked?'disabled':''} data-tip="${locked?'Заблокировано: закройте предыдущую главу.':''}">${scene.text?'▶ Запустить снова':'▶ Запустить агентов'}</button>
      <button class="btn" id="regenSettings" data-tip="Настройки перегенерации: креативность Прозаика и объём сцены">⚙</button>
      ${(scene.proseVersions&&scene.proseVersions.length)?`<button class="btn" id="revertProse" data-tip="Вернуть прошлый вариант прозы (откат перегенерации)">↶ ${scene.proseVersions.length}</button>`:''}
    </div>
    ${(()=>{ // автопилот: две независимые кнопки — глава целиком / книга целиком,
      // не завязаны на «Режиссёр»/«Фабрика» (та настройка по-прежнему решает
      // другое — авто-закрытие главы на редакторском стопе и требование
      // «руки автора» для ручного закрытия).
      if(!ch) return '';
      const remInChapter = scenesOfChapter(s, ch.id).filter(x=>x.status!=='done').length;
      const remBook = (s.structure||[]).filter(n=>n.type==='scene' && n.status!=='done').length;
      if(!remInChapter && !remBook && !_autoChapter) return '';
      if(locked) return `<div class="run-row" style="margin-top:6px"><button class="btn" style="flex:1" disabled data-tip="Заблокировано: закройте предыдущую главу, прежде чем писать здесь.">🔒 Заблокировано</button></div>`;
      if(_autoChapter){
        return `<div class="run-row" style="margin-top:6px"><button class="btn" id="autoStop" style="flex:1">${esc(_autoBusyLabel || '■ Стоп (после текущей сцены)')}</button></div>`;
      }
      const chBtn = remInChapter
        ? `<button class="btn" id="autoChapterOnly" style="flex:1" data-tip="Пишет все оставшиеся сцены ТЕКУЩЕЙ главы подряд, каждая — через полный цикл агентов. Дальше не идёт, главу не закрывает.">✏ Написать главу целиком (${remInChapter} сц.)</button>`
        : '';
      const bookBtn = remBook
        ? `<button class="btn" id="autoBookAll" style="flex:1" data-tip="Пишет все сцены книги подряд, сама закрывает главы и переходит к следующей — без остановок до конца книги или ошибки.">📖 Написать книгу целиком (${remBook} сц.)</button>`
        : '';
      if(!chBtn && !bookBtn) return '';
      return `${_autoError ? `<div class="run-row" style="margin-top:6px"><div style="color:var(--err);font-size:12px;flex:1">⚠ ${esc(_autoError)}</div></div>` : ''}<div class="run-row" style="margin-top:6px;gap:8px">${chBtn}${bookBtn}</div>`;
    })()}
    ${// «Очистить главу» — намеренно ОТДЕЛЬНО от автопилот-блока выше: тот рано
      // возвращает '', если в главе не осталось несделанных сцен — а это как раз
      // случай, когда автору чаще всего и хочется стереть уже готовую главу
      // целиком и переписать. Не зависит от _autoChapter (во время автопилота
      // стирать главу из-под него не даём — !_autoChapter).
      ch && !_autoChapter && !locked && scenesOfChapter(s, ch.id).some(x=>x.text)
      ? `<div class="run-row" style="margin-top:6px;justify-content:flex-end"><button class="chat-clear" id="clearChapter" data-tip="Стереть тексты всех сцен главы «${esc(ch.title)}» и сбросить их статус. Если глава была закрыта — откроется заново. Каждую сцену можно вернуть по отдельности кнопкой ↶ на её странице.">🗑 Очистить главу</button></div>`
      : ''}
    ${(()=>{ const idx=scenes.findIndex(sc=>sc.id===scene.id); const nx=idx>=0&&idx<scenes.length-1?scenes[idx+1]:null; return nx?`<div class="run-row" style="margin-top:6px;justify-content:flex-end"><button class="btn" id="nextScene">→ ${esc(nx.title)}</button></div>`:''; })()}`;
  document.getElementById('brief').addEventListener('input', e=>{ scene.brief=e.target.value; });
  document.querySelectorAll('.pc-cb').forEach(cb=>cb.addEventListener('change', ()=>{
    scene.presentChars=[...document.querySelectorAll('.pc-cb:checked')].map(c=>c.dataset.name);
    document.querySelectorAll('.pc-tag').forEach(l=>{
      const on=l.querySelector('.pc-cb').checked;
      l.classList.toggle('active',on);
      l.style.borderColor=on?'var(--accent)':'var(--border)';
      l.style.background=on?'var(--accent-dim)':'transparent';
    });
    save();
  }));

  // редактирование текста автором → отметка «рука автора»
  const edEl = document.getElementById('editor');
  if(scene.text && !_edReviewOn){
    const editStartText = scene.text; // снимок ДО правки — сверяем на blur, реально ли текст изменился
    edEl.addEventListener('input', ()=>{ scene.text=edEl.innerText; if(!scene.handDone){ scene.handDone=true; } scene._dirty=true; });
    // Коммит правки (тут же ловит и Undo/Redo ниже — оба лишь ставят _dirty=true
    // и полагаются на этот blur): оценка/флаги относились к тексту ДО правки рукой.
    // Обнуляем оценку, только если текст на выходе реально отличается от снимка —
    // иначе клик в редактор + случайная правка, отменённая тем же Ctrl+Z до blur,
    // молча стирала действующую оценку сцены без единого фактического изменения.
    edEl.addEventListener('blur', ()=>{ if(scene._dirty){ scene.words=(scene.text.match(/\S+/g)||[]).length; if(scene.text!==editStartText){ scene.lastEval=null; scene.flags={}; } scene._dirty=false; save(); } });
    initSelectionMenu(edEl, scene, els);
  }
  if(scene.text && _edReviewOn) bindEditorMarks(edEl, scene, els);

  // инлайн-директива
  const runWith = (directive)=>doRun(els, s, scene, directive);
  _activeFlagFix = (d, rewrite) => doRun(els, getState(), scene, d, {rewrite}); // кнопки флагов в Анализ сцены
  document.getElementById('reRun').onclick = ()=>{ const d=document.getElementById('directive').value.trim(); runWith(d); };
  document.querySelectorAll('.ia-chip').forEach(c=>c.onclick=()=>{ document.getElementById('directive').value=c.dataset.d; });
  document.getElementById('runBtn').onclick = ()=>runWith('');
  // Находка из Бета-ридера/Ружей Чехова/Критика (Редактура) с готовой директивой —
  // см. goToSceneWithDirective. Применяем один раз при рендере: автор видит
  // текст в поле, правит/жмёт «Переписать» сам — ничего не запускается сюда сама собой.
  if(_pendingDirective!=null){
    const dInp = document.getElementById('directive');
    if(dInp) dInp.value = _pendingDirective;
    _pendingDirective = null;
  }

  // Undo/redo ТЕКСТА в редакторе (правки рукой) — нативная история contenteditable
  const edU=document.getElementById('edUndo'), edR=document.getElementById('edRedo');
  if(edU) edU.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('undo'); scene.text=ed.innerText; scene._dirty=true; } };
  if(edR) edR.onclick=()=>{ const ed=document.getElementById('editor'); if(ed){ ed.focus(); document.execCommand('redo'); scene.text=ed.innerText; scene._dirty=true; } };

  const sceneThumb = document.getElementById('sceneThumb');
  if(sceneThumb) sceneThumb.onclick = ()=>{ const w = window.open(); if(w) w.document.write(`<img src="${sceneThumb.src}" style="max-width:100%">`); };

  // Откат ПЕРЕГЕНЕРАЦИИ (как было) — вернуть прошлый вариант прозы.
  // Честный откат (LIFO), не свап с той же позицией — см. фикс revertSkeleton:
  // раньше клали текущий текст обратно в версии, и второй клик возвращал вперёд,
  // а более старые варианты становились навсегда недостижимы.
  const rp=document.getElementById('revertProse');
  if(rp) rp.onclick = ()=>{
    if(!scene.proseVersions||!scene.proseVersions.length) return;
    scene.text = scene.proseVersions.shift();
    scene.words=(scene.text.match(/\S+/g)||[]).length;
    scene.handDone=false;
    // Оценка/флаги относились к отменяемому тексту — теперь они не про то, что на экране.
    scene.lastEval=null; scene.flags={};
    save();
  };

  // «Очистить сцену»/«Очистить главу» — стереть уже написанную прозу и
  // сбросить статус, не трогая бриф/структуру. Прежний текст уходит в
  // proseVersions тем же способом, что и при обычной перегенерации (см.
  // scene.proseVersions.unshift чуть выше в файле) — «очистка» отменяется
  // тем же ↶, к которому автор уже привык, отдельного механизма не завели.
  function clearSceneText(sc){
    if(sc.text){
      sc.proseVersions = sc.proseVersions || [];
      sc.proseVersions.unshift(sc.text);
      if(sc.proseVersions.length>10) sc.proseVersions.length=10;
    }
    sc.text=''; sc.words=0; sc.status='todo'; sc.handDone=false;
    sc.lastEval=null; sc.flags={};
  }
  const clearSc=document.getElementById('clearScene');
  if(clearSc) clearSc.onclick = ()=>{
    if(!confirm(`Очистить сцену «${scene.title}»? Текст будет стёрт (можно вернуть кнопкой ↶).`)) return;
    clearSceneText(scene);
    save();
  };
  const clearCh=document.getElementById('clearChapter');
  if(clearCh) clearCh.onclick = ()=>{
    const chScenes = scenesOfChapter(s, ch.id);
    if(!confirm(`Очистить главу «${ch.title}» (${chScenes.length} сц.)? Тексты будут стёрты (каждую сцену можно вернуть по отдельности кнопкой ↶).`)) return;
    chScenes.forEach(clearSceneText);
    ch.closed = false;
    save();
  };

  // Настройки перегенерации (иконка ⚙ внизу)
  const rgs=document.getElementById('regenSettings');
  if(rgs) rgs.onclick = ()=>openRegenSettings(s, scene);

  const cc=document.getElementById('closeChapter');
  if(cc) cc.onclick = async ()=>{ cc.disabled=true; cc.innerHTML='<span class="spinner"></span> Закрываю…'; await closeChapter(s, ch.id); };

  const nx=document.getElementById('nextScene');
  if(nx){ const idx=scenes.findIndex(sc=>sc.id===scene.id); const nextSc=scenes[idx+1]; if(nextSc) nx.onclick=()=>{ if(_busy) return; s.ui.activeScene=nextSc.id; save(); }; }

  const gpc=document.getElementById('goToPrevChapter');
  if(gpc) gpc.onclick=()=>{
    if(_busy) return;
    const chapters=(s.structure||[]).filter(n=>n.type==='chapter');
    const idx=chapters.findIndex(c=>c.id===ch.id);
    const prevCh=idx>0?chapters[idx-1]:null; if(!prevCh) return;
    const prevScenes=scenesOfChapter(s, prevCh.id);
    const target=prevScenes.find(sc=>sc.status!=='done') || prevScenes[prevScenes.length-1];
    if(target){ s.ui.activeScene=target.id; save(); }
  };

  // ИИ-корректор: правописание без вмешательства в стиль, с предпросмотром правок
  const pf=document.getElementById('edProof');
  if(pf) pf.onclick = async ()=>{
    if(_busy) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    if(!scene.text || scene.text.trim().length < 20) return;
    pf.disabled=true; const orig=pf.textContent; pf.innerHTML='<span class="spinner"></span>';
    try{
      const res = await proofreadText(scene.text, s);
      openProofreadModal(scene, res);
    }catch(e){ alert('Корректор: '+e.message); }
    finally{ pf.disabled=false; pf.textContent=orig; }
  };

  bindEditorButton(els, s, scene);

  // Автопилот: глава целиком / книга целиком — два независимых запуска
  const startAutopilot = (crossChapters)=>{
    if(_busy) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    if(ch && isChapterLocked(s, ch.id)){ alert('Глава заблокирована: закройте предыдущую главу, прежде чем писать здесь.'); return; }
    runChapterAutopilot(els, s, ch, crossChapters);
  };
  const acOnly = document.getElementById('autoChapterOnly');
  if(acOnly) acOnly.onclick = ()=>startAutopilot(false);
  const acBook = document.getElementById('autoBookAll');
  if(acBook) acBook.onclick = ()=>startAutopilot(true);
  const acStop = document.getElementById('autoStop');
  if(acStop) acStop.onclick = ()=>{ _autoStopReq=true; acStop.disabled=true; acStop.textContent='…остановлюсь после этой сцены'; };

  renderRightPanel(els);
}

// Автопилот: crossChapters=false — только текущая глава (останавливается,
// не закрывает главу — решение автора). crossChapters=true — вся книга
// подряд, сама закрывает главу и переходит к следующей. Останавливается по
// кнопке (после текущей сцены) или при первой ошибке прогона. Ручные гейты
// агентов (approvalGate) срабатывают как обычно — автопилот просто ждёт ответа.
async function runChapterAutopilot(els, s, startCh, crossChapters){
  if(_autoChapter || !startCh) return;
  _autoChapter = true; _autoStopReq = false; _autoBusyLabel = ''; _autoError = '';
  renderWrite(els); // сразу показать «Стоп» — не ждать первого save() из цикла, иначе кнопка выглядит зависшей
  try{
    let ch = startCh, guard = 0;
    while(ch && guard++ < 200){
      if(_autoStopReq) break;
      const chScenes = scenesOfChapter(s, ch.id);
      const next = chScenes.find(sc=>sc.status!=='done');
      if(next){
        s.ui.activeScene = next.id;
        save();                                    // ре-рендер переключает редактор на сцену
        await new Promise(r=>setTimeout(r, 60));   // даём DOM устояться перед прогоном
        const err = await doRun(els, s, next, '');
        if(next.status!=='done' || !next.text){
          // Прогон упал — не идём дальше. doRun уже написал «Ошибка: …» прямо в
          // DOM редактора, но save() ниже (в finally) тут же перерисует панель
          // заново по scene.text (пустому у несостоявшейся сцены) и затрёт его
          // генерической плашкой — без _autoError автор не увидел бы вообще
          // ничего, кроме тихо вернувшейся кнопки «Написать главу целиком».
          _autoError = `Остановлено на сцене «${next.title||next.id}»${err?': '+err:' — прогон не завершился успехом'}.`;
          break;
        }
        continue;                                  // в главе могут остаться ещё сцены
      }
      // Глава дописана. «Глава целиком» — останавливаемся, закрытие остаётся за автором.
      if(!crossChapters || _autoStopReq) break;
      // Пустая глава (сцен вообще нет) — писать нечего, дальше молча не идём.
      if(!chScenes.length) break;
      // summarizeChapter/runChekhovCheck внутри closeChapter — реальные вызовы
      // ИИ, не мгновенные — без этого текста кнопка молча не менялась несколько
      // секунд между главами и выглядела так, будто клик не сработал.
      _autoBusyLabel = '■ Закрываю главу…'; renderWrite(els);
      await closeChapter(s, ch.id);
      _autoBusyLabel = '';
      const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
      ch = chapters[chapters.findIndex(c=>c.id===ch.id)+1] || null;
    }
  } finally {
    _autoChapter = false; _autoStopReq = false; _autoBusyLabel = '';
    save();                                      // финальный ре-рендер возвращает кнопку
  }
}

// Модалка результата корректора: список правок + применить/отмена.
function openProofreadModal(scene, res){
  const root=document.getElementById('modalRoot');
  if(!res.fixes.length){
    root.innerHTML=`<div class="modal-bg" id="pfBg"><div class="modal" style="width:380px" onclick="event.stopPropagation()">
      <h2>Аа✓ Корректор</h2>
      <div style="margin:6px 0 14px">Ошибок не найдено — текст чистый. ✓</div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="pfClose">Хорошо</button></div>
    </div></div>`;
    const close=()=>root.innerHTML='';
    document.getElementById('pfBg').onclick=close;
    document.getElementById('pfClose').onclick=close;
    return;
  }
  root.innerHTML=`<div class="modal-bg" id="pfBg"><div class="modal" style="width:560px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>Аа✓ Корректор · ${res.fixes.length} ${res.fixes.length===1?'правка':res.fixes.length<5?'правки':'правок'}</h2>
    <div class="muted" style="margin-bottom:8px;font-size:12px">Только орфография, пунктуация и согласование. Стиль не тронут. Применение можно откатить (↶).</div>
    <div style="max-height:45vh;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      ${res.fixes.map(f=>`<div class="apv-row"><span>${esc(f)}</span></div>`).join('')}
    </div>
    <div class="row" style="justify-content:flex-end;gap:8px">
      <button class="btn" id="pfCancel">Отмена</button>
      <button class="btn btn-primary" id="pfApply">✓ Применить правки</button>
    </div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('pfBg').onclick=close;
  document.getElementById('pfCancel').onclick=close;
  document.getElementById('pfApply').onclick=()=>{
    scene.proseVersions = scene.proseVersions || [];
    scene.proseVersions.unshift(scene.text);     // прошлый вариант — для отката ↶
    if(scene.proseVersions.length>10) scene.proseVersions.length=10;
    scene.text = res.corrected;
    scene.words = (res.corrected.match(/\S+/g)||[]).length;
    scene.lastEval=null; scene.flags={};   // оценка/флаги относились к тексту до правок
    close();
    save();
  };
}

// ── Редактор (стилистическая правка с подсветкой в тексте) ──

// Строит HTML текста с <mark> вокруг непересекающихся вхождений _edSuggestions.
// Побочный эффект: убирает из _edSuggestions правки, чей фрагмент больше не
// найти дословно (текст изменился) — иначе они бы зависли недостижимыми.
function markedEditorHtml(text){
  _edSuggestions = _edSuggestions.filter(sug=>text.includes(sug.original));
  const ranges = [];
  _edSuggestions.forEach((sug, idx)=>{
    let searchFrom = 0, pos;
    while((pos = text.indexOf(sug.original, searchFrom)) >= 0){
      const end = pos + sug.original.length;
      if(!ranges.some(r=>pos<r.end && end>r.start)){ ranges.push({start:pos, end, idx}); break; }
      searchFrom = pos + 1;
    }
  });
  ranges.sort((a,b)=>a.start-b.start);
  // Запоминаем позицию КОНКРЕТНОГО вхождения на самой подсказке — resolveSuggestion
  // раньше принимал правку через text.replace(original, suggestion) без /g, который
  // всегда меняет ПЕРВОЕ вхождение фразы в тексте, а не то, что реально подсвечено
  // и на которое нажал автор (если фраза встречается в сцене дважды с разными
  // предложенными правками).
  ranges.forEach(r=>{ _edSuggestions[r.idx]._pos = {start:r.start, end:r.end}; });
  let html = '', cursor = 0;
  ranges.forEach(r=>{
    html += esc(text.slice(cursor, r.start));
    html += `<mark class="ed-mark" data-idx="${r.idx}">${esc(text.slice(r.start, r.end))}</mark>`;
    cursor = r.end;
  });
  html += esc(text.slice(cursor));
  return html;
}

function bindEditorButton(els, s, scene){
  const wrap = document.getElementById('edStyleModeWrap');
  if(wrap) wrap.querySelectorAll('[data-edmode]').forEach(b=>b.onclick=()=>{
    s.ui.editorAuto = b.dataset.edmode==='auto';
    save();
  });
  const btn = document.getElementById('edStyle');
  if(!btn) return;
  if(_edReviewOn){ btn.onclick = ()=>{ _edReviewOn=false; _edSuggestions=[]; _edReviewSceneId=null; save(); }; return; }
  btn.onclick = async ()=>{
    if(_busy) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    btn.disabled = true; const orig = btn.textContent; btn.innerHTML = '<span class="spinner"></span>';
    try{
      const suggestions = await suggestEdits(scene.text, s);
      if(!suggestions.length){
        btn.disabled = false; btn.textContent = '✓ правок нет';
        setTimeout(()=>{ if(document.getElementById('edStyle')===btn) btn.textContent = orig; }, 1800);
        return;
      }
      scene.proseVersions = scene.proseVersions || [];
      scene.proseVersions.unshift(scene.text);   // откат перед любыми правками редактора
      if(scene.proseVersions.length>10) scene.proseVersions.length=10;
      if(s.ui.editorAuto){
        let text = scene.text;
        suggestions.forEach(sug=>{ if(text.includes(sug.original)) text = text.replace(sug.original, sug.suggestion); });
        scene.text = text; scene.words = (text.match(/\S+/g)||[]).length;
        scene.lastEval=null; scene.flags={};   // оценка/флаги относились к тексту до правок
        save();
        btn.disabled = false; btn.textContent = `✓ ${suggestions.length} правок`;
        setTimeout(()=>{ if(document.getElementById('edStyle')===btn) btn.textContent = orig; }, 1800);
      } else {
        _edSuggestions = suggestions;
        _edReviewOn = true;
        _edReviewSceneId = scene.id;
        save();   // ре-рендер подхватит _edReviewOn и покажет подсветку в тексте
      }
    }catch(e){ alert('Редактор: '+e.message); btn.disabled=false; btn.textContent=orig; }
  };
}

let _edPopupHide = null;   // document-слушатель для скрытия попапа (снимаем перед повторным навешиванием)

function bindEditorMarks(edEl, scene, els){
  const popup = document.getElementById('edPopup');
  if(!popup) return;
  const closePopup = ()=>{ popup.style.display='none'; };
  edEl.querySelectorAll('.ed-mark').forEach(mk=>{
    mk.onclick = (e)=>{
      e.stopPropagation();
      const idx = parseInt(mk.dataset.idx, 10);
      const sug = _edSuggestions[idx];
      if(!sug) return;
      const rect = mk.getBoundingClientRect();
      const appRect = document.getElementById('app').getBoundingClientRect();
      popup.innerHTML = `
        <div class="ed-pop-orig">«${esc(sug.original)}»</div>
        <div class="ed-pop-arrow">→</div>
        <div class="ed-pop-sugg">«${esc(sug.suggestion)}»</div>
        ${sug.reason?`<div class="ed-pop-reason">${esc(sug.reason)}</div>`:''}
        <div class="ed-pop-acts">
          <button class="ed-pop-x" id="edPopReject" title="Отклонить">✗</button>
          <button class="ed-pop-ok" id="edPopAccept" title="Принять">✓</button>
        </div>`;
      popup.style.display = 'block';
      popup.style.top = (rect.bottom - appRect.top + 6) + 'px';
      popup.style.left = Math.max(8, Math.min(rect.left - appRect.left, appRect.width - 300)) + 'px';
      document.getElementById('edPopAccept').onclick = ()=>{ resolveSuggestion(scene, idx, true); closePopup(); };
      document.getElementById('edPopReject').onclick = ()=>{ resolveSuggestion(scene, idx, false); closePopup(); };
    };
  });
  if(_edPopupHide) document.removeEventListener('mousedown', _edPopupHide);
  _edPopupHide = (e)=>{ if(!popup.contains(e.target) && !e.target.classList.contains('ed-mark')) closePopup(); };
  document.addEventListener('mousedown', _edPopupHide);
}

function resolveSuggestion(scene, idx, accept){
  const sug = _edSuggestions[idx];
  if(!sug) return;
  if(accept){
    const p = sug._pos;
    if(p && scene.text.slice(p.start, p.end)===sug.original){
      // Меняем именно то вхождение, что подсвечено и на которое нажал автор
      // (по позиции из markedEditorHtml), а не первое совпадение в тексте.
      scene.text = scene.text.slice(0,p.start) + sug.suggestion + scene.text.slice(p.end);
      scene.words = (scene.text.match(/\S+/g)||[]).length;
      scene.lastEval=null; scene.flags={};   // оценка/флаги относились к тексту до правки
    } else if(scene.text.includes(sug.original)){
      // запасной вариант, если позиция не совпала (текст менялся мимо рендера)
      scene.text = scene.text.replace(sug.original, sug.suggestion);
      scene.words = (scene.text.match(/\S+/g)||[]).length;
      scene.lastEval=null; scene.flags={};
    }
  }
  _edSuggestions.splice(idx, 1);
  if(!_edSuggestions.length){ _edReviewOn = false; _edReviewSceneId = null; }
  save();
}

// ─────────────────────────────── РЕДАКТУРА + РОАДМАП + ЭКСПОРТ ───────────────────────────────
const STAGE_LABELS = [['concept','Концепция'],['world','Мир'],['voice','Голос'],['structure','Структура'],['write','Написание'],['illustrations','Иллюстрации'],['edit','Редактура'],['publish','Публикация']];
// Роадмап — переиспользуемая секция (правая панель «Написания» + стадия «Редактура»).
export function renderRoadmap(s){
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  const doneScenes = scenes.filter(sc=>sc.status==='done');
  const totalWords = doneScenes.reduce((a,sc)=>a+(sc.words||0),0);
  const cost = (s.diagnostics?.runs||[]).reduce((a,r)=>a+(r.totalCost||0),0);
  const avgVoice = (()=>{ const v=doneScenes.map(sc=>sc.lastEval?.scores?.voice).filter(Boolean); return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:'—'; })();
  return `<div class="pad">
    <div class="rm-section">
      <div class="rm-h">Этапы производства</div>
      ${STAGE_LABELS.map(([id,label])=>{
        const done=stageDoneFor(s,id); const cur=s.ui.stage===id;
        return `<div class="rm-stage"><span class="rm-dot ${done&&!cur?'done':cur?'cur':'todo'}">${done&&!cur?'✓':cur?'▶':'○'}</span>${label}</div>`;
      }).join('')}
    </div>
    <div class="rm-section">
      <div class="rm-h">Главы · прогресс</div>
      ${chapters.length?chapters.map(ch=>{
        const cs=scenesOfChapter(s,ch.id); const cd=cs.filter(x=>x.status==='done').length;
        const pct=cs.length?Math.round(cd/cs.length*100):0;
        return `<div class="rm-chap"><div class="rm-chap-row"><span>${esc(ch.title)}</span><span class="muted">${cd}/${cs.length}${ch.closed?' ✓':''}</span></div><div class="rm-bar"><div class="rm-fill" style="width:${pct}%;background:${ch.closed?'var(--ok)':'var(--accent)'}"></div></div></div>`;
      }).join(''):'<div class="muted">Глав нет.</div>'}
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-val">${doneScenes.length}/${scenes.length}</div><div class="stat-lbl">сцен готово</div></div>
      <div class="stat-card"><div class="stat-val">${totalWords.toLocaleString('ru')}</div><div class="stat-lbl">слов</div></div>
      <div class="stat-card"><div class="stat-val">$${cost.toFixed(3)}</div><div class="stat-lbl">потрачено</div></div>
      <div class="stat-card"><div class="stat-val">${avgVoice}</div><div class="stat-lbl">ср. голос</div></div>
    </div>
    <div class="rm-section">
      <div class="rm-h">Контекст для агентов</div>
      <div class="chips">
        ${s.project.genre?`<span class="tag" style="background:var(--accent-bg);color:var(--accent);border-color:var(--accent-border)">${esc(s.project.genre)}</span>`:''}
        ${s.project.era?`<span class="tag">${esc(s.project.era)}</span>`:''}
        ${(s.style.refs||[]).map(r=>`<span class="tag" style="background:var(--ok-bg);color:var(--ok);border-color:var(--ok-border)">${esc(r)}</span>`).join('')}
        ${(s.style.forbidden||[]).map(f=>`<span class="tag" style="background:var(--err-bg);color:var(--err);border-color:var(--err-border)">↯ ${esc(f)}</span>`).join('')}
      </div>
    </div>
  </div>`;
}

// Иллюстрация сцены (если есть) — общий хелпер для PDF-экспорта и «Редактуры»,
// оба показывают книгу целиком с уже сгенерированными картинками.
function illustrationForScene(s, sceneId){
  const it = (s.illustrations?.items||[]).find(i=>i.type==='scene' && i.sceneId===sceneId);
  return it ? it.dataUrl : null;
}

function exportPdf(s){
  const title = esc(s.project.title||'Книга');
  const nodes = s.structure||[];
  const items = s.illustrations?.items || [];
  const mapItem = items.find(i=>i.type==='map') || null;
  let body='';
  if(mapItem) body += `<div class="pdf-img"><img src="${mapItem.dataUrl}"></div>`;
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2>${esc(n.title)}</h2>`;
    else if(n.type==='scene'&&n.text){
      const illust = illustrationForScene(s, n.id);
      // .scene-head группирует картинку+заголовок сцены — только эта пара защищена
      // от разрыва (page-break-inside:avoid), не вся .scene целиком: сама проза
      // сцены обычно длиннее страницы, и «не рвать» весь блок дало бы либо гигантский
      // пустой хвост страницы, либо игнор правила браузером на слишком высоком блоке.
      const head = illust
        ? `<div class="scene-head"><div class="pdf-img"><img src="${illust}"></div><h3>${esc(n.title)}</h3></div>`
        : `<h3>${esc(n.title)}</h3>`;
      body+=`<div class="scene">${head}<div class="prose">${n.text.split('\n\n').map(p=>`<p>${esc(p.trim())}</p>`).filter(p=>p!=='<p></p>').join('')}</div></div>`;
    }
  });
  const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>
    @page{margin:2cm 2.5cm}body{font-family:Georgia,serif;font-size:12pt;line-height:1.7;color:#111;max-width:680px;margin:0 auto}
    h1{font-size:22pt;text-align:center;margin:3cm 0 1cm}h2{font-size:16pt;margin:2cm 0 .5cm;border-bottom:1px solid #ccc;padding-bottom:.3cm}
    h3{font-size:12pt;font-weight:normal;font-style:italic;color:#555;margin:.8cm 0 .2cm}.prose p{text-indent:1.5em;margin:.15em 0}
    .prose p:first-child{text-indent:0}.pdf-img{text-align:center;margin:.5cm 0}.pdf-img img{max-width:100%;max-height:22cm}
    .pdf-img,.scene-head{page-break-inside:avoid;break-inside:avoid}
    @media print{h2{page-break-before:always}}
  </style></head><body><h1>${title}</h1>
  ${s.project.coverDataUrl?`<div class="pdf-img" style="margin:0 0 1.5cm">\n<img src="${s.project.coverDataUrl}" style="max-height:26cm"></div>`:''}
  ${s.project.author?`<p style="text-align:center;font-style:italic;margin:-.5cm 0 1.5cm">${esc(s.project.author)}</p>`:''}${body}<script>window.onload=()=>window.print()<\/script></body></html>`;
  const w=window.open('','_blank'); if(!w) return;
  w.document.write(html); w.document.close();
}

// Редактура — чтение собранной книги целиком + экспорт. Роадмап теперь живёт
// в правой панели «Написания», поэтому здесь — только книга как книга.
export function renderEdit(els){
  const s = getState();
  const nodes = s.structure||[];
  const doneScenes = nodes.filter(n=>n.type==='scene' && n.status==='done' && n.text);

  els.left.innerHTML = `<div class="ph">Главы</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{
    const el=document.getElementById('read-'+r.dataset.sc); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
  });
  els.right.innerHTML = `<div class="ph">Готовность книги</div>${renderRoadmap(s)}`;
  els.center.className='panel panel-center read-mode';

  let body='';
  if(s.project.coverDataUrl) body += `<div class="read-cover"><img src="${s.project.coverDataUrl}" alt="Обложка"></div>`;
  const mapItem = (s.illustrations?.items||[]).find(i=>i.type==='map');
  if(mapItem) body += `<div class="read-cover"><img src="${mapItem.dataUrl}" alt="Карта мира"></div>`;
  nodes.forEach(n=>{
    if(n.type==='chapter') body+=`<h2 class="read-ch">${esc(n.title)}</h2>`;
    else if(n.type==='scene' && n.text){
      const illust = illustrationForScene(s, n.id);
      body+=`<div class="read-scene" id="read-${n.id}">${illust?`<img class="read-illust" src="${illust}" alt="${esc(n.title)}">`:''}<div class="read-scene-t">${esc(n.title)}</div><div class="read-prose">${esc(n.text)}</div></div>`;
    }
  });

  els.center.innerHTML = `
    <div class="read-bar">
      <span class="read-title">${esc(s.project.title||'Книга')}</span>
      <span class="read-meta">${doneScenes.length} сцен · ${doneScenes.reduce((a,x)=>a+(x.words||0),0).toLocaleString('ru')} сл.</span>
      <span style="flex:1"></span>
      <button class="btn" id="betaRead" data-tip="Читает книгу целиком (не по сценам) и честно отвечает вопросами анкеты бета-ридера: цепляет ли начало, ясны ли мотивации героя, где проседает интерес, satisfying ли финал.">📖 Бета-ридер</button>
      ${_lastBetaRead?'<button class="btn" id="betaReadAgain" title="Открыть последний разбор снова — без нового вызова" style="padding:6px 8px">↺</button>':''}
      <button class="btn" id="chekhovCheck" data-tip="Отслеживает заявленные сюжетные заготовки (предмет, тайна, обещание) на масштабе всей книги — получили ли они развязку.">🔫 Ружья Чехова</button>
      ${_lastChekhov?'<button class="btn" id="chekhovAgain" title="Открыть последний разбор снова — без нового вызова" style="padding:6px 8px">↺</button>':''}
      <button class="btn" id="criticReview" data-tip="Несокращённая рецензия литературного критика — не анкета с баллами, а честное развёрнутое мнение о рукописи, с конкретными претензиями к конкретным сценам.">🎭 Критик</button>
      ${_lastCriticReview?'<button class="btn" id="criticAgain" title="Открыть последний разбор снова — без нового вызова" style="padding:6px 8px">↺</button>':''}
      <button class="btn" id="exMd">📕 .md</button>
      <button class="btn" id="exDocx">📄 .doc</button>
      <button class="btn" id="exEpub">📗 .epub</button>
      <button class="btn" id="exPdf">🖨 .pdf</button>
      <button class="btn" id="exJson">⬇ .json</button>
    </div>
    <div class="read-body">${doneScenes.length?body:'<div class="empty-state">Напишите сцены — здесь книга соберётся целиком для финального чтения.</div>'}</div>`;

  document.getElementById('exMd').onclick=()=>exportMd(s);
  document.getElementById('exDocx').onclick=()=>exportDocx(s);
  document.getElementById('exEpub').onclick=()=>exportEpub(s);
  document.getElementById('exJson').onclick=()=>exportJson(s);
  document.getElementById('exPdf').onclick=()=>exportPdf(s);

  const br=document.getElementById('betaRead');
  if(br) br.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    br.disabled=true; const orig=br.textContent; br.innerHTML='<span class="spinner"></span> Читаю книгу…';
    try{ const report=await runBetaRead(s); _lastBetaRead=report; openBetaReadModal(s, report); }
    catch(e){ alert('Бета-ридер: '+e.message); }
    finally{ br.disabled=false; br.textContent=orig; renderEdit(els); }
  };
  const bra=document.getElementById('betaReadAgain');
  if(bra) bra.onclick=(ev)=>{ ev.stopPropagation(); if(_lastBetaRead) openBetaReadModal(s, _lastBetaRead); };
  const cc=document.getElementById('chekhovCheck');
  if(cc) cc.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    cc.disabled=true; const orig=cc.textContent; cc.innerHTML='<span class="spinner"></span> Ищу заготовки…';
    try{ const setups=await runChekhovCheck(s); _lastChekhov=setups; openChekhovModal(s, setups); }
    catch(e){ alert('Ружья Чехова: '+e.message); }
    finally{ cc.disabled=false; cc.textContent=orig; renderEdit(els); }
  };
  const cha=document.getElementById('chekhovAgain');
  if(cha) cha.onclick=(ev)=>{ ev.stopPropagation(); if(_lastChekhov) openChekhovModal(s, _lastChekhov); };
  const crb=document.getElementById('criticReview');
  if(crb) crb.onclick=async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    crb.disabled=true; const orig=crb.textContent; crb.innerHTML='<span class="spinner"></span> Читаю и пишу рецензию…';
    try{
      // Глубина мира и картонность персонажей — отдельные вызовы (не часть
      // основной рецензии, см. комментарий в bookreview.js про maxTokens),
      // идут параллельно с ней. Каждый опционален по своим предпосылкам
      // (нужны факты магии/технологии; нужно ≥2 персонажа) — падение одного
      // не должно скрывать остальные два, поэтому allSettled, не all.
      const [reviewR, worldR, charR] = await Promise.allSettled([
        runCriticReview(s),
        hasWorldDepthFacts(s) ? runWorldDepthCheck(s) : Promise.resolve(null),
        hasCharactersToCheck(s) ? runFlatCharacterCheck(s) : Promise.resolve(null),
      ]);
      if(reviewR.status!=='fulfilled') throw reviewR.reason;
      // Кросс-сценовые проверки ниже — чистый код по уже накопленным
      // сигнатурам (craftsignals.js), без LLM-вызова: не часть allSettled,
      // синхронные и бесплатные.
      const sceneTitleById = Object.fromEntries((s.structure||[]).filter(n=>n.type==='scene').map(n=>[n.id, n.title]));
      const report = { ...reviewR.value,
        worldDepth: worldR.status==='fulfilled' ? worldR.value : null,
        flatCharacters: charR.status==='fulfilled' ? charR.value : null,
        humorPattern: detectRepeatingHumorPattern(s.memory?.craftSignals, sceneTitleById),
        expositionDominance: dominantExpositionChannel(s.memory?.craftSignals, sceneTitleById),
        passivity: passivityIsSystemic(s),
      };
      _lastCriticReview=report; openCriticModal(s, report);
    }
    catch(e){ alert('Критик: '+e.message); }
    finally{ crb.disabled=false; crb.textContent=orig; renderEdit(els); }
  };
  const cra=document.getElementById('criticAgain');
  if(cra) cra.onclick=(ev)=>{ ev.stopPropagation(); if(_lastCriticReview) openCriticModal(s, _lastCriticReview); };
}

function scoreColor(n){ return n>=7?'var(--ok)':n>=4?'var(--warn)':'var(--err)'; }

// Найти сцену по названию (точное совпадение без учёта регистра/пробелов) —
// общее для Бета-ридера/Критика/Ружей Чехова: все три возвращают sceneTitle
// как текстовое поле, не id, поэтому резолвить приходится по названию.
function findSceneByTitle(s, title){
  if(!title) return null;
  const t = String(title).trim().toLowerCase(); if(!t) return null;
  return (s.structure||[]).find(n=>n.type==='scene' && n.title.trim().toLowerCase()===t) || null;
}

// Не найденная модулем DOM-переменная, а «отложенная директива»: заметка
// находки книжного обзора (Бета-ридер/Ружья Чехова/Критик), которую нужно
// подставить в поле «Сказать агенту, что изменить» СРАЗУ после перехода на
// нужную сцену в Написании — рендер сцены случается позже (после save()),
// поэтому просто установить value синхронно здесь нельзя, элемент ещё не
// существует. renderWrite() проверяет и применяет её один раз при рендере.
let _pendingDirective = null;

// Перейти к сцене находки книжного обзора с уже заполненной директивой для
// Прозаика — автор видит готовое ТЗ в поле, может поправить и сам решает,
// нажимать «Переписать» или нет (не запускаем ИИ без явного клика автора).
function goToSceneWithDirective(s, sceneId, directive, close){
  s.ui.activeScene = sceneId; s.ui.stage = 'write';
  _pendingDirective = directive || '';
  save();
  if(close) close();
}

// Кнопка «Скопировать» для находок, которые не привязаны к конкретной сцене
// (sceneTitle пуст, или сцена не нашлась в структуре) — единственный способ
// хоть что-то сделать с такой находкой, раз перейти прямо к сцене нельзя.
function copyNoteBtn(text){
  if(!text) return '';
  return `<button class="btn ares-copy-note" data-copy="${esc(text)}" title="Скопировать в буфер — вставьте в поле «Сказать агенту, что изменить» на нужной сцене" style="font-size:11px;padding:2px 8px;align-self:flex-start;margin-top:2px">📋 Копировать</button>`;
}
// Кнопка «→ исправить» — переход к сцене находки с готовой директивой.
function fixSceneBtn(s, sceneTitle, directive){
  const sc = findSceneByTitle(s, sceneTitle);
  if(!sc) return sceneTitle ? `<div class="muted" style="font-size:11px">сцена «${esc(sceneTitle)}» не найдена в структуре</div>` : '';
  return `<button class="btn goto-fix" data-sc="${sc.id}" data-directive="${esc(directive)}" style="align-self:flex-start;font-size:11px;padding:3px 8px">→ «${esc(sc.title)}» (открыть с этим замечанием)</button>`;
}
function bindFixButtons(s, close){
  document.querySelectorAll('.goto-fix').forEach(b=>b.onclick=()=>{
    goToSceneWithDirective(s, b.dataset.sc, b.dataset.directive, close);
  });
}
function bindCopyNotes(){
  document.querySelectorAll('.ares-copy-note').forEach(b=>b.onclick=()=>{
    navigator.clipboard?.writeText(b.dataset.copy).catch(()=>{});
    const orig=b.textContent; b.textContent='✓ Скопировано'; b.disabled=true;
    setTimeout(()=>{ b.textContent=orig; b.disabled=false; }, 1200);
  });
}

function openBetaReadModal(s, r){
  const root=document.getElementById('modalRoot');
  const row=(label, score, note)=>`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:2px">
    <div class="row" style="justify-content:space-between"><b>${label}</b><span style="font-weight:700;color:${scoreColor(score)}">${score}/10</span></div>
    <div class="muted" style="font-size:12px">${esc(note||'—')}</div>
    ${copyNoteBtn(note)}
  </div>`;
  root.innerHTML=`<div class="modal-bg" id="brBg"><div class="modal" style="width:560px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>📖 Бета-ридер</h2>
    <div class="muted" style="margin-bottom:10px;font-size:12px">Читает книгу целиком (первая и последняя сцена — дословно, остальное — по сводкам) и честно отвечает как реальный читатель, не редактор.</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto">
      ${row('Крючок начала', r.hookScore, r.hookNote)}
      ${row('Ясность мотивации героя', r.motivationClarity, r.motivationNote)}
      ${row('Финал', r.endingScore, r.endingNote)}
      ${r.paceDrops.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <b>Где проседал интерес</b>
        ${r.paceDrops.map(p=>`<div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px">
          <div style="font-size:12px;color:var(--text-2)">• ${esc(p.note)}</div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${fixSceneBtn(s, p.sceneTitle, p.note)}
            ${!findSceneByTitle(s, p.sceneTitle)?copyNoteBtn(p.note):''}
          </div>
        </div>`).join('')}
      </div>`:''}
      <div class="apv-row" style="flex-direction:column;align-items:stretch;gap:2px;background:var(--accent-bg)">
        <b>Общее впечатление</b><div style="font-size:13px">${esc(r.overall||'—')}</div>
        ${copyNoteBtn(r.overall)}
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="brClose">Закрыть</button></div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('brBg').onclick=close;
  document.getElementById('brClose').onclick=close;
  bindFixButtons(s, close);
  bindCopyNotes();
}

function openCriticModal(s, r){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-bg" id="crBg"><div class="modal" style="width:600px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>🎭 Критик</h2>
    <div class="muted" style="margin-bottom:10px;font-size:12px">Несокращённая рецензия — не анкета со баллами. Мнение может быть резким; это осознанно.</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:56vh;overflow:auto">
      <div class="apv-row" style="flex-direction:column;align-items:stretch;gap:2px;background:var(--accent-bg)">
        <b>Вердикт</b><div style="font-size:13px;white-space:pre-wrap">${esc(r.verdict||'—')}</div>
      </div>
      ${r.strengths.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <b>Сильные стороны</b>
        ${r.strengths.map(x=>`<div style="font-size:12px;color:var(--text-2)">• ${esc(x)}</div>`).join('')}
      </div>`:''}
      ${r.problems.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <b>Проблемы</b>
        ${r.problems.map(p=>{
          const noteText = (p.issue||'')+(p.note?': '+p.note:'');
          return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;border-top:1px solid var(--border)">
            <div style="font-size:13px">${esc(p.issue)}</div>
            ${p.note?`<div style="font-size:12px;color:var(--text-2)">${esc(p.note)}</div>`:''}
            <div class="row" style="gap:6px;flex-wrap:wrap">
              ${fixSceneBtn(s, p.sceneTitle, noteText)}
              ${!findSceneByTitle(s, p.sceneTitle)?copyNoteBtn(noteText):''}
            </div>
          </div>`;
        }).join('')}
      </div>`:''}
      ${r.recommendation?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:2px">
        <b>Итог</b><div style="font-size:13px">${esc(r.recommendation)}</div>
      </div>`:''}
      ${r.worldDepth && r.worldDepth.items.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row" style="justify-content:space-between"><b>Глубина мира</b><span style="font-weight:700;color:${scoreColor(r.worldDepth.depth)}">${r.worldDepth.depth}/10</span></div>
        ${r.worldDepth.items.map(x=>{
          const noteText = (x.issue||'')+(x.suggestion?': '+x.suggestion:'');
          return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;border-top:1px solid var(--border)">
            <div style="font-size:13px">${esc(x.fact)}</div>
            <div style="font-size:12px;color:var(--text-2)">${esc(x.issue)}${x.suggestion?' — '+esc(x.suggestion):''}</div>
            <div class="row" style="gap:6px;flex-wrap:wrap">${copyNoteBtn(noteText)}</div>
          </div>`;
        }).join('')}
      </div>`:''}
      ${r.flatCharacters && r.flatCharacters.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <b>Картонные персонажи</b>
        ${r.flatCharacters.map(x=>{
          const noteText = (x.issue||'')+(x.suggestion?': '+x.suggestion:'');
          return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;border-top:1px solid var(--border)">
            <div style="font-size:13px"><b>${esc(x.name)}</b></div>
            <div style="font-size:12px;color:var(--text-2)">${esc(x.issue)}${x.suggestion?' — '+esc(x.suggestion):''}</div>
            <div class="row" style="gap:6px;flex-wrap:wrap">${copyNoteBtn(noteText)}</div>
          </div>`;
        }).join('')}
      </div>`:''}
      ${r.humorPattern && r.humorPattern.length?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <b>Повторяющийся приём</b>
        ${r.humorPattern.map(b=>{
          const noteText = `Приём «${b.style}» через «${b.channelRep}» повторяется ${b.occurrences.length} раз (сцены: ${b.occurrences.map(o=>o.sceneTitle).join(', ')}) — разнообразь подачу.`;
          return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;border-top:1px solid var(--border)">
            <div style="font-size:13px"><b>${esc(b.style)}</b> через «${esc(b.channelRep)}» — ${b.occurrences.length}×</div>
            <div style="font-size:12px;color:var(--text-2)">${b.occurrences.map(o=>esc(o.sceneTitle)).join(', ')}</div>
            <div class="row" style="gap:6px;flex-wrap:wrap">${copyNoteBtn(noteText)}</div>
          </div>`;
        }).join('')}
      </div>`:''}
      ${r.expositionDominance?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row" style="justify-content:space-between"><b>Однообразная подача информации</b><span style="font-weight:700">${Math.round(r.expositionDominance.ratio*100)}%</span></div>
        <div style="font-size:12px;color:var(--text-2)">«${esc(r.expositionDominance.channel)}» — источник в ${r.expositionDominance.count} из ${r.expositionDominance.total} сцен с экспозицией: ${r.expositionDominance.scenes.map(esc).join(', ')}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${copyNoteBtn(`Слишком часто информацию читателю подаёт «${r.expositionDominance.channel}» (${r.expositionDominance.count} из ${r.expositionDominance.total} сцен с экспозицией) — разнообразь источники подачи.`)}</div>
      </div>`:''}
      ${r.passivity?`<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="row" style="justify-content:space-between"><b>Пассивность героя</b><span style="font-weight:700">${r.passivity.count}/${r.passivity.window}</span></div>
        <div style="font-size:12px;color:var(--text-2)">Сцены: ${r.passivity.scenes.map(x=>esc(x.title)).join(', ')}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${copyNoteBtn('Герой слишком часто пассивен в последних сценах — дай ему явный выбор или действие, которое меняет ход сюжета.')}</div>
      </div>`:''}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="crClose">Закрыть</button></div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('crBg').onclick=close;
  document.getElementById('crClose').onclick=close;
  bindFixButtons(s, close);
  bindCopyNotes();
}

function openChekhovModal(s, setups){
  const root=document.getElementById('modalRoot');
  if(!setups.length){
    root.innerHTML=`<div class="modal-bg" id="chBg"><div class="modal" style="width:380px" onclick="event.stopPropagation()">
      <h2>🔫 Ружья Чехова</h2>
      <div style="margin:6px 0 14px">Заметных сюжетных заготовок не нашлось.</div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" id="chClose">Хорошо</button></div>
    </div></div>`;
    const close=()=>root.innerHTML='';
    document.getElementById('chBg').onclick=close;
    document.getElementById('chClose').onclick=close;
    return;
  }
  const unresolved = setups.filter(x=>!x.resolved).length;
  root.innerHTML=`<div class="modal-bg" id="chBg"><div class="modal" style="width:560px;max-width:94vw" onclick="event.stopPropagation()">
    <h2>🔫 Ружья Чехова${unresolved?` · ${unresolved} без развязки`:''}</h2>
    <div class="muted" style="margin-bottom:10px;font-size:12px">Значимые сюжетные заготовки и получили ли они развязку. Если книга не закончена — заготовки из последних сцен намеренно не отмечены как «без развязки».</div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto">
      ${setups.map(x=>{
        const directive = `Дай развязку заготовке «${x.what}» (введено: ${x.introducedIn||'—'}) — она осталась непогашенной.`;
        return `<div class="apv-row" style="flex-direction:column;align-items:stretch;gap:2px;background:${x.resolved?'var(--ok-bg,#f0faf0)':'var(--warn-bg,#fffbf0)'}">
        <div style="font-weight:500">${x.resolved?'✓':'⚠'} ${esc(x.what)}</div>
        <div class="muted" style="font-size:11px">введено: ${esc(x.introducedIn||'—')}${x.resolved?` · развязка: ${esc(x.resolvedIn||'—')}`:' · развязки не найдено'}</div>
        ${!x.resolved?`<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:2px">
          ${fixSceneBtn(s, x.sceneTitle, directive)}
          ${!findSceneByTitle(s, x.sceneTitle)?copyNoteBtn(directive):''}
        </div>`:''}
      </div>`;}).join('')}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="chClose">Закрыть</button></div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('chBg').onclick=close;
  document.getElementById('chClose').onclick=close;
  bindFixButtons(s, close);
  bindCopyNotes();
}
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'world': return (s.bible||[]).some(b=>b.source==='world');
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    case 'illustrations': return (s.illustrations?.items||[]).length>0;
    // «Публикация» — всегда false: приложение не может знать, опубликовал ли
    // автор книгу на внешней площадке (это происходит вне Литсовета вручную).
    case 'publish': return false;
    default: return false;
  }
}

function renderEditorialStop(s, ch, isFactoryMode){
  if(isFactoryMode){
    // «Фабрика»: стоп не блокирует — информирует и закрывает главу сам
    // (см. setTimeout-триггер в renderWrite), без клика и без правки рукой.
    return `<div class="stop-banner stop-banner-auto">
      <div class="sb-title"><span class="spinner"></span> Глава «${esc(ch.title)}» готова — закрываю автоматически…</div>
      <div class="sb-text">Режим «Фабрика»: редакторский стоп не блокирует работу, суммаризация идёт в фоне.</div>
    </div>`;
  }
  const needHand = needsAuthorHand(s);
  const scenes = scenesOfChapter(s, ch.id);
  const handOk = !needHand || scenes.some(sc=>sc.handDone);
  return `<div class="stop-banner">
    <div class="sb-title">✋ Редакторский стоп · глава «${esc(ch.title)}»</div>
    <div class="sb-text">Все сцены главы написаны. Прочитайте главу целиком перед следующей.${needHand?' Режим «Режиссёр»: перепишите хотя бы один абзац своей рукой.':''}</div>
    ${needHand&&!handOk?'<div class="sb-warn">⚠ Пока ни один абзац не переписан автором — отредактируйте текст любой сцены главы.</div>':''}
    <button class="btn ${handOk?'btn-primary':''}" id="closeChapter" ${handOk?'':'disabled'}>Закрыть главу →</button>
  </div>`;
}

// Глава заблокирована: предыдущая ещё не закрыта (не пройден редакторский стоп).
// Прозаик/автопилот здесь не работают (гейт — в doRun и startAutopilot),
// это только объяснение и переход к тому, что нужно закрыть.
function renderChapterLockedBanner(s, ch){
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  const idx = chapters.findIndex(c=>c.id===ch.id);
  const prevCh = idx>0 ? chapters[idx-1] : null;
  return `<div class="stop-banner stop-banner-lock">
    <div class="sb-title">🔒 Глава «${esc(ch.title)}» заблокирована</div>
    <div class="sb-text">Сначала закройте главу${prevCh?` «${esc(prevCh.title)}»`:''} — редакторский стоп там ещё не пройден. Прозаик и автопилот не будут работать здесь, пока предыдущая глава не закрыта.</div>
    ${prevCh?`<button class="btn" id="goToPrevChapter">← К главе «${esc(prevCh.title)}»</button>`:''}
  </div>`;
}

// Настройки перегенерации: креативность Прозаика (temp) + объём этой сцены.
function openRegenSettings(s, scene){
  const prose = (s.agents||[]).find(a=>a.role==='prose')||{};
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-bg" id="rgsBg"><div class="modal" style="width:420px" onclick="event.stopPropagation()">
    <h2>Настройки перегенерации</h2>
    <div class="muted" style="margin-bottom:12px">Влияют на «Запустить снова», инлайн-директиву и правку выделенного фрагмента.</div>
    <div class="field"><label>Креативность Прозаика <span class="hint">выше — смелее и неожиданнее, ниже — стабильнее</span></label>
      <div class="row"><input type="range" id="rgsTemp" min="0" max="1" step="0.05" value="${prose.temp??0.85}" style="flex:1"><span id="rgsTempV" style="min-width:36px;text-align:right;font-weight:500">${(prose.temp??0.85).toFixed(2)}</span></div></div>
    <div class="field"><label>Целевой объём сцены (слов)</label>
      <input type="text" id="rgsWords" value="${scene.targetWords||700}"></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="btn" id="rgsCancel">Отмена</button>
      <button class="btn btn-primary" id="rgsOk">Сохранить</button>
    </div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('rgsBg').onclick=close;
  document.getElementById('rgsCancel').onclick=close;
  const t=document.getElementById('rgsTemp');
  t.oninput=()=>document.getElementById('rgsTempV').textContent=parseFloat(t.value).toFixed(2);
  document.getElementById('rgsOk').onclick=()=>{
    if(prose) prose.temp=parseFloat(t.value);
    // Тот же клэмп, что теперь стоит на всех LLM-путях правки скелета — иначе
    // это единственная оставшаяся дверь, через которую можно вручную вписать
    // ту же аномалию (250 слов при норме книги 1600-2000), что и была найдена.
    scene.targetWords=clampSceneTargetWords(s, parseInt(document.getElementById('rgsWords').value)||scene.targetWords||700);
    save(); close();
  };
}

// Модалка ручного режима: показывает результат агента, ждёт «Принять» или «Переписать».
function approvalGate({role, label, output, draft, editable, verdict, guardFlags, criticalCount}){
  return new Promise(resolve=>{
    const root=document.getElementById('modalRoot');
    const isEval = role==='evaluator';
    const hint = isEval
      ? '«Принять» — взять текст как есть и завершить (петля остановится, даже если оценка «на доработку»). «На доработку» — вернуть Прозаику, он точечно поправит фразы по замечаниям. «⊕ В правило» — закрепить навсегда: следующая доработка и все будущие сцены это учтут.'
      : '«Принять» — взять текст как есть и продолжить. «Переписать» — заново с вашей заметкой.';
    // Для Оценщика — структурированный вердикт с кнопками «⊕ В правило» у клише и замечаний.
    let infoBlock = '';
    if(verdict){
      const an=(verdict.anchors||[]).map(a=>`<div class="apv-row" style="background:var(--ok-bg,#f0faf0)"><span style="color:var(--ok,#2a7a2a)">✦ «${esc(a)}»</span></div>`).join('');
      const cl=(verdict.cliches||[]).map(c=>`<div class="apv-row"><span>«${esc(c)}»</span><button class="apv-rule" data-rule="${esc('избегай штампа «'+c+'» и подобных шаблонных оборотов')}" title="Сделать правилом">⊕ В правило</button></div>`).join('');
      const nt=(verdict.notes||[]).map(n=>`<div class="apv-row"><span>${esc(n)}</span><button class="apv-rule" data-rule="${esc(n)}" title="Сделать правилом">⊕ В правило</button></div>`).join('');
      const qs=(verdict.questions||[]).map(q=>`<div class="apv-row" style="background:var(--warn-bg,#fffbf0)"><span style="color:var(--warn,#8a6000)">? ${esc(q)}</span></div>`).join('');
      // Замечания Стражей — раньше в этом гейте показывался ТОЛЬКО вердикт Оценщика,
      // хотя Стражи (логика/события/голос/...) к этому моменту уже отработали:
      // «Принять» можно было нажать не зная, что сцена содержит критическую
      // логическую ошибку. Теперь их находки — прямо здесь, до кнопки.
      const gf=(guardFlags||[]).map(f=>{
        const crit = f.severity==='critical';
        return `<div class="apv-row" style="background:${crit?'var(--err-bg, #fff0f0)':'var(--warn-bg,#fffbf0)'}"><span style="color:${crit?'var(--err,#a02020)':'var(--warn,#8a6000)'}">${crit?'⛔':'⚠'} [${esc(f.role)}] ${esc(f.title)}${f.detail?': '+esc(f.detail):''}</span></div>`;
      }).join('');
      infoBlock=`<div class="apv-verdict">
        <div class="muted" style="margin-bottom:4px">Оценка <b>${verdict.weighted}/10</b> (мин. ось ${verdict.minAxis}) · ${verdict.pass?'проходит порог':'на доработку'}</div>
        ${gf?`<div class="ph2">Замечания Стражей${criticalCount?` (${criticalCount} критич.)`:''}</div>${gf}`:''}
        ${an?`<div class="ph2">Якоря — не трогать</div>${an}`:''}
        ${cl?`<div class="ph2">Клише</div>${cl}`:''}
        ${nt?`<div class="ph2">Замечания</div>${nt}`:''}
        ${qs?`<div class="ph2">Вопросы автору</div>${qs}`:''}
      </div>`;
    } else if(output){
      infoBlock=`<div style="max-height:200px;overflow:auto;white-space:pre-wrap;border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:13px;line-height:1.6">${esc(output)}</div>`;
    }
    const editBlock = editable
      ? `<div class="muted" style="margin:10px 0 4px">Текст черновика — можно поправить руками прямо здесь:</div>
         <textarea id="apvDraft" class="apv-draft" spellcheck="false">${esc(draft||'')}</textarea>`
      : '';
    root.innerHTML=`<div class="modal-bg"><div class="modal" style="width:640px;max-width:94vw" onclick="event.stopPropagation()">
      <h2>Ручной режим · ${esc(label)}</h2>
      <div class="muted" style="margin-bottom:8px">${hint}</div>
      ${infoBlock}
      ${editBlock}
      <input type="text" id="apvNote" placeholder="${isEval?'что доработать Прозаику (по умолчанию — замечания Оценщика)':'заметка для переделки (необязательно)'}" style="margin-top:10px;width:100%">
      <div class="row" style="justify-content:flex-end;margin-top:10px;gap:8px">
        <button class="btn" id="apvRedo">↻ ${isEval?'На доработку Прозаику':'Переписать'}</button>
        <button class="btn btn-primary" id="apvOk">✓ Принять</button>
      </div>
    </div></div>`;
    // ⊕ В правило: рождаем правило прямо из вердикта. skipSave — идёт прогон и
    // ре-рендер оторвёт ссылку на редактор; правило в памяти сразу действует на
    // следующую доработку, а на диск попадёт при завершении прогона.
    document.querySelectorAll('.apv-rule').forEach(b=>b.onclick=()=>{
      openRuleModal(b.dataset.rule, { skipSave:true, onSave:()=>{ b.textContent='✓ правило'; b.classList.add('done'); b.disabled=true; } });
    });
    const getText=()=>{ const t=document.getElementById('apvDraft'); return t? t.value : undefined; };
    document.getElementById('apvOk').onclick=()=>{ const text=getText(); root.innerHTML=''; resolve({approve:true, text}); };
    document.getElementById('apvRedo').onclick=()=>{ const note=document.getElementById('apvNote').value.trim(); const text=getText(); root.innerHTML=''; resolve({approve:false, note, text}); };
  });
}

async function doRun(els, s, scene, directive, runFlags={}){
  const g=s.global;
  if(_busy) return;
  if(!g.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
  // Последовательность глав: пока предыдущая глава не закрыта — эту не пишем.
  // Единая точка входа (кнопка, чипы, флаги «→ Прозаику», автопилот) — гейт
  // здесь ловит все пути, а не только ручной клик по «▶ Запустить».
  const chForScene = chapterOf(s, scene);
  if(chForScene && isChapterLocked(s, chForScene.id)){
    alert('Глава заблокирована: закройте предыдущую главу (редакторский стоп), прежде чем писать здесь.');
    return;
  }
  _busy = true; _autoError = '';   // новая попытка — старое сообщение об остановке автопилота больше не актуально
  _runLog = []; _runCurrent = 'Запуск…'; _topTab = 'process';   // показываем «Процесс» во время прогона
  renderRightPanel(els);
  document.querySelectorAll('.scene-row').forEach(r=>r.style.opacity='0.5');
  scene.brief=document.getElementById('brief').value.trim();
  const wasDone = scene.status==='done' && !!scene.text;
  const oldText = scene.text;
  const oldEval = scene.lastEval;
  const btn=document.getElementById('runBtn'); btn.disabled=true;
  const ed=document.getElementById('editor'); ed.classList.remove('empty'); ed.removeAttribute('contenteditable');
  try{
    const runOpts = directive ? {directive, ...(runFlags.rewrite ? {} : {initialDraft: scene.text||''})} : {};
    // Полностью свежий прогон (без директивы) — новый текст, старые «уже отклонённые
    // как приём» замечания могут больше не относиться к делу.
    if(!directive) scene.rejectedNotes = [];
    runOpts.onApproval = approvalGate;   // ручной режим: пауза на подтверждение
    const result = await runScene(s, scene, runOpts, prog=>{
      if(prog.streaming){ ed.textContent=prog.text; scene.text=prog.text; }
      else if(prog.log){ pushProc(prog); }
      else { btn.innerHTML=`<span class="spinner"></span> ${esc(prog.text)}`; pushProc(prog); }
    });
    pushProc({log:{icon:'✓', text:`Готово · ${result.text? (result.text.match(/\S+/g)||[]).length+' сл.':''}${result.eval?' · оценка '+result.eval.weighted+'/10':''}`, state:'ok'}});
    if(wasDone && oldText){ scene.proseVersions=scene.proseVersions||[]; scene.proseVersions.unshift(oldText); if(scene.proseVersions.length>10)scene.proseVersions.length=10; }
    scene.text=result.text; scene.words=(result.text.match(/\S+/g)||[]).length; scene.status='done';
    scene.lastEval=result.eval||null; scene.flags=result.flags||{}; scene.handDone=false; scene.stale=false;
    // Перегенерация уже готовой сцены ничем не защищена от результата ХУЖЕ прежнего —
    // новый черновик молча становится текущим, а прежний (лучший) виден только через
    // кнопку отката (↶) в истории версий, если автор вообще заметит, что стало хуже.
    if(wasDone && oldEval?.ok && result.eval?.ok && ((oldEval.pass && !result.eval.pass) || result.eval.weighted < oldEval.weighted - 0.5)){
      pushProc({log:{icon:'⚠️', text:`Новая версия сцены хуже прежней: было ${oldEval.weighted}/10${oldEval.pass?' ✓ принято':''} → стало ${result.eval.weighted}/10 — прежний вариант в истории версий (кнопка ↶)`, state:'warn'}});
    }
    // Каскад: перезапись уже готовой сцены могла повернуть сюжет — нижние готовые сцены под подозрением
    if(wasDone) markDownstreamStale(s, scene);
    save();
    btn.innerHTML='<span class="spinner"></span> Суммаризация…';
    try{
      await summarizeScene(s, scene); scene.drift = driftCheck(s, scene);
      // Структурная сигнатура для кросс-сценовых проверок (повтор приёма/канала
      // подачи экспозиции по всей книге, см. craftsignals.js) — не блокирует
      // сохранение сцены при сбое, как и driftCheck/maybeRollup рядом.
      try{
        const sig = await extractCraftSignature(s, scene);
        if(sig){ s.memory.craftSignals = s.memory.craftSignals || {}; s.memory.craftSignals[scene.id] = sig; }
      }catch(e){ console.warn('craft signature failed', e); }
      await maybeRollup(s); save();
    }
    catch(e){ console.warn('summarize failed', e); }
  }catch(e){
    // Стриминг (prog.streaming выше) уже мог записать в scene.text свежий,
    // но неотревьюенный черновик (напр. упал вызов Оценщика ПОСЛЕ прозы) —
    // без отката следующий же save() (по любому несвязанному действию)
    // тихо затрёт последнюю хорошую версию, и её не будет даже в истории,
    // т.к. proseVersions пишется только при УСПЕШНОМ прогоне (строка выше).
    // Безусловно (не только при wasDone) — у ещё не готовой сцены до прогона
    // тоже мог быть текст (ручной черновик автора), его так же нельзя терять.
    scene.text = oldText;
    ed.textContent='Ошибка: '+e.message; pushProc({log:{icon:'⚠', text:'Ошибка: '+e.message, state:'warn'}});
    return e.message;
  }
  finally{
    btn.disabled=false; _busy=false; _runCurrent='';
    document.querySelectorAll('.scene-row').forEach(r=>r.style.opacity='');
    // После прогона возвращаемся на Анализ сцены — пользователь видит новые флаги
    _topTab = 'analysis';
    renderRightPanel(els);
  }
  return null;
}

// Плавающее меню по выделению текста → директива, привязанная к фрагменту.
// Смещение точки (node, offset) в символах внутри контейнера.
function charOffset(container, node, nodeOffset){
  const r=document.createRange(); r.selectNodeContents(container); r.setEnd(node, nodeOffset);
  return r.toString().length;
}

function initSelectionMenu(edEl, scene, els){
  const menu = document.getElementById('selMenu');
  if(!menu) return;
  let sel0=0, sel1=0;

  const showMenu = ()=>{
    const sel=window.getSelection();
    const text=sel.toString();
    if(!text.trim()){ menu.style.display='none'; return; }
    const range=sel.getRangeAt(0);
    sel0 = charOffset(edEl, range.startContainer, range.startOffset);
    sel1 = charOffset(edEl, range.endContainer, range.endOffset);
    if(sel1<sel0){ const t=sel0; sel0=sel1; sel1=t; }

    menu.style.display='flex';
    if(window.innerWidth<=767){
      // Мобайл: фиксируем меню внизу над навигацией (учитываем safe area)
      const navEl = document.getElementById('mobNav');
      const navH = navEl ? navEl.getBoundingClientRect().height : 56;
      menu.style.position='fixed';
      menu.style.bottom=(navH+10)+'px';
      menu.style.top='auto';
      menu.style.left='50%';
      menu.style.transform='translateX(-50%)';
      menu.style.flexWrap='wrap';
      menu.style.maxWidth='calc(100vw - 16px)';
    } else {
      const rect=range.getBoundingClientRect();
      const appRect=document.getElementById('app').getBoundingClientRect();
      menu.style.position='absolute';
      menu.style.transform='';
      menu.style.top=(rect.top-appRect.top-38)+'px';
      menu.style.left=(rect.left-appRect.left)+'px';
      menu.style.bottom='auto';
      menu.style.flexWrap='';
      menu.style.maxWidth='';
    }
    menu.innerHTML=INLINE_ACTIONS.map(([label,key])=>`<button class="sm-btn" data-act="${key}">${label}</button>`).join('')
      + `<button class="sm-btn sm-rule" data-act="__rule" title="Сделать правилом автора">⊕ В правило</button>`;
    menu.querySelectorAll('.sm-btn').forEach(b=>b.onclick=()=>{
      menu.style.display='none';
      if(b.dataset.act==='__rule'){
        const sel=edEl.textContent.slice(sel0, sel1).trim();
        openRuleModal('избегай оборотов вроде «'+sel.slice(0,80)+'»');
        return;
      }
      applyInlineEdit(scene, edEl, b.dataset.act, sel0, sel1);
    });
  };

  edEl.addEventListener('mouseup', showMenu);
  // Мобайл: touchend не всегда = mouseup; даём 120мс чтобы selection устоялось
  edEl.addEventListener('touchend', ()=>{ setTimeout(showMenu, 120); });

  const hideMenu = e=>{ if(!menu.contains(e.target) && e.target!==edEl && !edEl.contains(e.target)) menu.style.display='none'; };
  // Снимаем старые слушатели перед навешиванием новых (предотвращаем накопление при каждом рендере)
  if(_selMenuHide){
    document.removeEventListener('mousedown', _selMenuHide);
    document.removeEventListener('touchstart', _selMenuHide);
  }
  _selMenuHide = hideMenu;
  document.addEventListener('mousedown', hideMenu);
  document.addEventListener('touchstart', hideMenu, {passive:true});

  // Скрываем меню при прокрутке редактора (иначе меню зависает на старом месте)
  if(_selMenuScroll){
    const oldPanel = document.querySelector('.panel-center');
    if(oldPanel) oldPanel.removeEventListener('scroll', _selMenuScroll);
  }
  _selMenuScroll = ()=>{ menu.style.display='none'; };
  const panelCenter = document.querySelector('.panel-center');
  if(panelCenter) panelCenter.addEventListener('scroll', _selMenuScroll, {passive:true});
}

// Границы фрагмента: окно ~500 симв. сверху/снизу, подрезанное до целых
// предложений — чтобы агент видел чистые стыки, а не обрывки фраз, и сшивал
// фрагмент с границей сверху и снизу без шва.
function boundaryBefore(full, start, win=500){
  let chunk = full.slice(Math.max(0, start-win), start);
  if(start-win > 0){ // отбросить начатое в окне неполное предложение
    const m = chunk.match(/[.!?…»"”)\]]\s+|\n+/);
    if(m) chunk = chunk.slice(m.index + m[0].length);
  }
  return chunk.trim();
}
function boundaryAfter(full, end, win=500){
  let chunk = full.slice(end, end+win);
  if(end+win < full.length){ // оставить до последнего целого предложения в окне
    const m = chunk.match(/^[\s\S]*[.!?…»"”)\]](?=\s|$)/);
    if(m) chunk = m[0];
  }
  return chunk.trim();
}

// Точечная правка: меняем ТОЛЬКО выделенный фрагмент и вставляем на место.
async function applyInlineEdit(scene, edEl, action, start, end){
  const s=getState();
  if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
  const full = edEl.textContent;
  const selected = full.slice(start, end);
  if(!selected.trim()) return;
  const before = boundaryBefore(full, start);
  const after  = boundaryAfter(full, end);
  edEl.style.opacity='0.55'; edEl.setAttribute('aria-busy','1');
  try{
    const fresh = await transformSelection(s, action, selected, before, after);
    if(!fresh){ edEl.style.opacity=''; edEl.removeAttribute('aria-busy'); return; }
    const newText = action==='continue'
      ? full.slice(0, end) + (full[end-1]==='\n'?'':' ') + fresh + full.slice(end)
      : full.slice(0, start) + fresh + full.slice(end);
    scene.proseVersions = scene.proseVersions || [];
    scene.proseVersions.unshift(scene.text);            // прошлый вариант — для отката
    if(scene.proseVersions.length>10) scene.proseVersions.length=10;
    scene.text = newText; scene.words=(newText.match(/\S+/g)||[]).length;
    scene.lastEval=null; scene.flags={};   // оценка/флаги относились к тексту до правки
    save();
  }catch(e){ edEl.style.opacity=''; edEl.removeAttribute('aria-busy'); alert('Не удалось: '+e.message); }
}
