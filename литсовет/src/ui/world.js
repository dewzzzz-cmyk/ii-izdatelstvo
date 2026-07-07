// Стадия «Мир»: проактивный worldbuilding до Структуры. Кандидаты предлагает
// текстовый LLM (тот же, что и для прозы — не тратит отдельных денег), автор
// одобряет, факты уходят в общую Библию. Карта — отдельная кнопка, платный
// image-API, только по явному клику (спека §5, §6, §9).

import { getState, save } from '../state.js';
import { rebuildBibleVecs, applyFactEdit, deleteBibleFactAt, toggleFactPinned } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap, mapPromptFor, rerollWorldFact, categoriesFor, CATEGORY_HINTS } from '../world.js';
import { saveMapItem } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';
import { openFactModal } from './rule-modal.js';

let _candidates = [];        // предложенные, ещё не одобренные факты (все категории вместе, у каждого своё .category)
let _selected = new Set();   // id одобренных чекбоксом
let _hints = {};             // текст подсказки на категорию — держим тут (не в state), иначе теряется при ре-рендере во время генерации другой карточки
let _ideaSeed = '';          // общая «Идея мира» — та же причина держать вне DOM/state
let _busyCategory = null;    // категория, для которой сейчас идёт точечная генерация
let _bulkBusy = false;       // «Предложить весь мир» — идёт последовательный обход категорий
let _bulkProgress = '';      // текст прогресса булк-генерации, напр. "2 из 4"
let _mapBusy = false;
let _mapError = '';  // инлайн вместо блокирующего alert() — тот же подход, что в ui/illustrations.js

function factsOfCategory(worldFacts, cat){ return worldFacts.filter(f=>f.category===cat); }
function candidatesOfCategory(cat){ return _candidates.filter(c=>c.category===cat); }

function wordForm(n, one, few, many){
  const mod10=n%10, mod100=n%100;
  if(mod10===1 && mod100!==11) return one;
  if(mod10>=2 && mod10<=4 && (mod100<10||mod100>=20)) return few;
  return many;
}

function renderCategoryCard(s, worldFacts, cat, busyAny){
  const canon = factsOfCategory(worldFacts, cat);
  const cands = candidatesOfCategory(cat);
  const busy = _busyCategory===cat;
  const selCount = cands.filter(c=>_selected.has(c.id)).length;
  return `<div class="world-cat-card" data-cat="${esc(cat)}">
    <div class="world-cat-h">
      <b>${esc(cat)}</b>
      <span class="muted">${canon.length ? `${canon.length} ${wordForm(canon.length,'факт','факта','фактов')}` : 'пусто'}</span>
    </div>
    <input type="text" class="world-cat-hint" data-cat="${esc(cat)}" value="${esc(_hints[cat]||'')}" placeholder="${esc(CATEGORY_HINTS[cat]||'подсказка (необязательно)')}">
    <button class="btn world-cat-gen" data-cat="${esc(cat)}" ${busyAny?'disabled':''}>${busy?'<span class="spinner"></span> …':'✨ Предложить'}</button>

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
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
            <input type="checkbox" class="w-cb" data-id="${c.id}" ${_selected.has(c.id)?'checked':''} style="margin-top:3px">
            <div style="flex:1">
              <input type="text" class="w-keys" data-id="${c.id}" value="${esc(c.keys)}" style="font-size:11px;color:var(--text-2);border:none;background:transparent;width:100%;padding:0;margin-bottom:2px">
              <textarea class="w-text" data-id="${c.id}" rows="2" style="width:100%;font-size:13px">${esc(c.text)}</textarea>
            </div>
          </label>
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
  // Промпт ДО генерации (что будет отправлено) — mapPromptFor может бросить,
  // если canGenerate почему-то true, а фактов всё равно не хватает (гонка
  // между geoCount и реальным списком не ожидается, но try на всякий случай).
  let previewPrompt = '';
  if(canGenerate){ try{ previewPrompt = mapPromptFor(s); }catch(e){ /* покажется как обычно при клике */ } }
  return `<div class="ph">Карта мира (референс)</div>
    <div class="pad">
      ${map ? `<img src="${map.dataUrl}" style="max-width:280px;border-radius:var(--radius);display:block;margin-bottom:8px">
        <div class="muted" style="font-size:11px;margin-bottom:8px">Также доступно в разделе «Иллюстрации» →</div>
        ${map.prompt ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-2)">Промпт, которым сгенерирована текущая карта</summary><div style="font-size:12px;color:var(--text-2);margin-top:4px;font-style:italic">${esc(map.prompt)}</div></details>` : ''}` : ''}
      ${previewPrompt ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-2)">Промпт для ${map?'следующей генерации':'генератора'} (стиль каждый раз меняется случайно)</summary><div style="font-size:12px;color:var(--text-2);margin-top:4px;font-style:italic">${esc(previewPrompt)}</div></details>` : ''}
      ${_mapError?`<div style="color:var(--err);font-size:12px;margin-bottom:8px">⚠ Карта: ${esc(_mapError)}</div>`:''}
      ${canGenerate
        ? `<button class="btn" id="wMap">${_mapBusy?'<span class="spinner"></span> …':(map?'🔄 Перегенерировать':'🗺 Сгенерировать карту')} — ~$${cost}</button>`
        : `<div class="muted" style="font-size:12px">Нужно хотя бы 2-3 факта категории «География», чтобы предложить карту.</div>`}
    </div>`;
}

export function renderWorld(els){
  const s = getState();
  const p = s.project;
  const worldFacts = (s.bible||[]).filter(b=>b.source==='world');
  const cats = categoriesFor(p.genre);
  const geoCount = worldFacts.filter(b=>b.category==='география').length;
  const podWarning = missingPOD(s);
  const busyAny = _bulkBusy || !!_busyCategory;

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
      <button class="btn btn-primary" id="wSuggestAll" ${busyAny?'disabled':''}>${_bulkBusy?'<span class="spinner"></span> '+esc(_bulkProgress):'✨ Предложить весь мир'}</button>
    </div>
    <div class="read-body" id="wBody">
      ${podWarning ? `<div class="pad" style="border:1px solid var(--err);border-radius:8px;margin:0 0 14px;background:var(--surface-2)">
        <div style="font-size:12px;color:var(--err)">⚠ Для альтернативной истории точка развилки — основа жанра. Добавьте факт категории «История» с чёткой развилкой (событие + год + следствия), прежде чем продолжать.</div>
      </div>` : ''}
      ${cats.map(cat=>renderCategoryCard(s, worldFacts, cat, busyAny)).join('')}
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

  const wn = document.getElementById('wNext');
  if(wn) wn.onclick = ()=>{ s.ui.stage = s.project.useVoice ? 'voice' : 'structure'; save(); };
}
