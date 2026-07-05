// Стадия «Мир»: проактивный worldbuilding до Структуры. Кандидаты предлагает
// текстовый LLM (тот же, что и для прозы — не тратит отдельных денег), автор
// одобряет, факты уходят в общую Библию. Карта — отдельная кнопка, платный
// image-API, только по явному клику (спека §5, §6, §9).

import { getState, save } from '../state.js';
import { rebuildBibleVecs, editBibleFactAt, deleteBibleFactAt } from '../bible.js';
import { suggestWorldFacts, missingPOD, generateWorldMap, rerollWorldFact, categoriesFor, CATEGORY_HINTS } from '../world.js';
import { saveMapItem } from '../illustrations.js';
import { estimateImageCost } from '../imagegen.js';
import { esc } from './stages.js';

let _candidates = [];        // предложенные, ещё не одобренные факты (все категории вместе, у каждого своё .category)
let _selected = new Set();   // id одобренных чекбоксом
let _hints = {};             // текст подсказки на категорию — держим тут (не в state), иначе теряется при ре-рендере во время генерации другой карточки
let _ideaSeed = '';          // общая «Идея мира» — та же причина держать вне DOM/state
let _busyCategory = null;    // категория, для которой сейчас идёт точечная генерация
let _bulkBusy = false;       // «Предложить весь мир» — идёт последовательный обход категорий
let _bulkProgress = '';      // текст прогресса булк-генерации, напр. "2 из 4"
let _mapBusy = false;

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
        return `<div class="mem-card bible-card" data-bi="${i}">
          <div class="bible-actions">
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
  return `<div class="ph">Карта мира (референс)</div>
    <div class="pad">
      ${map ? `<img src="${map.dataUrl}" style="max-width:280px;border-radius:var(--radius);display:block;margin-bottom:8px">
        <div class="muted" style="font-size:11px;margin-bottom:8px">Также доступно в разделе «Иллюстрации» →</div>` : ''}
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
  const sb = document.getElementById('wSuggest');
  if(sb) sb.onclick = async ()=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ текстовой модели в настройках (⚙).'); return; }
    if(_busy) return;
    const hints = {
      ideaSeed: document.getElementById('wSeed')?.value.trim(),
      limitation: document.getElementById('wLimit')?.value.trim(),
      antagonistFaction: document.getElementById('wAntag')?.value.trim(),
    };
    _busy = true; _busyText = 'Продумываю мир…'; renderWorld(els);
    try{
      _candidates = await suggestWorldFacts(s, hints);
      _selected = new Set(_candidates.map(c=>c.id));
    }catch(e){ alert('Мир: '+e.message); }
    finally{ _busy = false; _busyText=''; renderWorld(els); }
  };

  document.querySelectorAll('.mem-h-toggle[data-cat]').forEach(h=>h.onclick=()=>{
    const cat = h.dataset.cat;
    if(_collapsed.has(cat)) _collapsed.delete(cat); else _collapsed.add(cat);
    renderWorld(els);
  });

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

  const wc = document.getElementById('wClear');
  if(wc) wc.onclick = ()=>{ _candidates=[]; _selected=new Set(); renderWorld(els); };

  const wa = document.getElementById('wApprove');
  if(wa) wa.onclick = ()=>{
    const approved = _candidates.filter(c=>_selected.has(c.id));
    s.bible = s.bible || [];
    approved.forEach(c=>{ s.bible.push({ keys:c.keys, text:c.text, source:'world', category:c.category }); });
    rebuildBibleVecs(s.bible);
    _candidates = _candidates.filter(c=>!_selected.has(c.id));
    _selected = new Set();
    if((s.structure||[]).some(n=>n.type==='chapter')) s.structureStale = true;
    save(); renderWorld(els);
  };

  const wm = document.getElementById('wMap');
  if(wm) wm.onclick = async ()=>{
    if(!s.illustrations?.apiKey){ alert('Задайте ключ для генерации картинок в настройках (⚙).'); return; }
    if(_mapBusy) return;
    _mapBusy = true; renderWorld(els);
    try{
      const dataUrl = await generateWorldMap(s);
      saveMapItem(s, dataUrl);
      save();
    }catch(e){ alert('Карта: '+e.message); }
    finally{ _mapBusy = false; renderWorld(els); }
  };

  const wn = document.getElementById('wNext');
  if(wn) wn.onclick = ()=>{ s.ui.stage = s.project.useVoice ? 'voice' : 'structure'; save(); };
}
