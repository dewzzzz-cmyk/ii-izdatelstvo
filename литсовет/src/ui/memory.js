// Правая панель, вкладка «Память»: сводки (с откатом версий), состояния
// персонажей, сигналы дрейфа, факты Bible, квота хранилища.

import { getState, save, mergeCharacters, charNamesMatch, dismissObserved } from '../state.js';
import { rollback, summarizeScene } from '../memory.js';
import { storageEstimate } from '../storage.js';
import { uncalibratedScenes, recordRating, calibrationState } from '../calibration.js';
import { callLLM } from '../llm.js';
import { rebuildBibleVecs } from '../bible.js';
import { openRuleModal } from './rule-modal.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Свёрнутые секции панели «Память» — держим в модуле (не в state), это чисто
// UI-удобство на сессию, не часть проекта. По умолчанию длинные списки свёрнуты,
// чтобы не тонуть в персонажах/фактах при каждом открытии вкладки.
const collapsed = { sceneSums:true, characters:true, bible:true };

function sectionHeader(key, label, extraHtml=''){
  const c = collapsed[key];
  return `<div class="mem-h mem-h-toggle" data-sec="${key}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px">
    <span>${c?'▸':'▾'} ${label}</span>${extraHtml}
  </div>`;
}

export function renderMemory(){
  const s = getState();
  const mem = s.memory||{};
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  const sceneSums = scenes.filter(n=>(mem.scenes||{})[n.id]?.current);
  setTimeout(()=>{ bindMemory(); refreshQuota(); }, 0);

  return `
    <div class="ph">Память книги</div>
    <div class="pad" style="padding:10px 12px">
      <div id="quota" class="muted" style="margin-bottom:8px">квота…</div>

      ${renderCalibration(s)}

      ${sectionHeader('sceneSums', `Сводки сцен (${sceneSums.length})`)}
      ${collapsed.sceneSums ? '' : (sceneSums.length ? sceneSums.map(n=>{
        const e = mem.scenes[n.id];
        return `<div class="mem-card">
          <div class="mem-title">${esc(n.title)}</div>
          <textarea class="mem-sum" data-level="scenes" data-id="${n.id}" rows="2">${esc(e.current)}</textarea>
          <div class="row" style="gap:6px;margin-top:4px">
            <button class="mem-rs" data-id="${n.id}" title="Пере-суммаризировать сцену заново">↻ заново</button>
            ${e.versions&&e.versions.length?`<button class="mem-rb" data-level="scenes" data-id="${n.id}">↶ откатить (${e.versions.length})</button>`:''}
          </div>
        </div>`;
      }).join('') : '<div class="muted" style="margin-bottom:10px">Появятся после написания сцен.</div>')}

      ${s.characters&&s.characters.length?`
        ${sectionHeader('characters', `Персонажи (${s.characters.length})`)}
        ${collapsed.characters ? '' : s.characters.map((c,i)=>{
          const dupOf = s.characters.find((c2,i2)=>i2!==i && charNamesMatch(c.name,c2.name));
          return `<div class="mem-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="mem-title">${esc(c.name)}${dupOf?` <span class="stale-dot" title="Похоже на «${esc(dupOf.name)}» — возможно, один и тот же персонаж">⚠</span>`:''}</div>
            <div style="display:flex;gap:2px">
              <button class="bc-act char-merge" data-chi="${i}" title="Объединить с другим персонажем (если это дубль)">🔗</button>
              <button class="bc-act char-edit" data-chi="${i}" title="Изменить состояние">✏</button>
            </div>
          </div>
          <div class="muted char-state" data-chi="${i}" style="font-size:12px;cursor:pointer" title="Нажмите чтобы редактировать">${esc(c.stateNote||'—')}</div>
        </div>`;}).join('')}
      `:''}

      ${driftBlock(scenes)}

      ${observedBlock(s)}

      ${sectionHeader('bible', `Канон / Bible (${(s.bible||[]).length})`, `<button class="mem-mini" id="bibleAdd" data-tip="Добавить факт мира вручную. Канон удерживает агентов от противоречий.">+ факт</button>`)}
      ${collapsed.bible ? '' : ((s.bible||[]).map((b,i)=>`
        <div class="mem-card bible-card" data-bi="${i}">
          <div class="bible-actions">
            <button class="bc-act" data-act="edit" data-bi="${i}" title="Редактировать">✏</button>
            <button class="bc-act" data-act="expand" data-bi="${i}" title="✨ AI-расширить факт">✨</button>
            <button class="bc-act" data-act="del" data-bi="${i}" title="Удалить">🗑</button>
          </div>
          <div class="mem-title" style="color:var(--accent)">${esc(b.keys||'факт')}</div>
          <div class="muted" style="font-size:12px">${esc(b.text)}</div>
        </div>`).join('') || '<div class="muted">Канон пуст — факты появятся при написании или добавьте вручную.</div>')}
    </div>`;
}

function renderCalibration(s){
  const cal = s.global.calibration||{ratings:[]};
  const pending = uncalibratedScenes(s).length;
  const adj = cal.lastAdjust;
  return `<div class="mem-h">Калибровка вкуса</div>
    <div class="mem-card">
      <div class="muted" style="font-size:11px;margin-bottom:6px">Оцените прозу вслепую — порог Оценщика подстроится под ваш вкус (а не висит на «7/10»).</div>
      <div style="font-size:12px;margin-bottom:6px">Оценок: <b>${cal.ratings.length}</b>${adj?` · порог сейчас <b>${adj.threshold}</b> (вы ${adj.authorAvg} / ИИ ${adj.evalAvg})`:` · порог <b>${s.global.evaluatorThreshold??7}</b>`}</div>
      <button class="btn ${pending?'btn-primary':''}" id="calBtn" ${pending?'':'disabled'}>${pending?`Оценить сцену вслепую (${pending})`:'Нет новых сцен'}</button>
    </div>`;
}

// Объединить дубли персонажа (одно имя в разных формах — «Олег»/«Олег К.»).
// Показывает всех ОСТАЛЬНЫХ персонажей; выбранный становится каноническим
// именем, объединённая карточка забирает недостающие поля, а во всех сценах
// scene.presentChars с именем дубля переписывается на выбранное имя.
function openMergeCharacterModal(dropIdx){
  const s = getState();
  const chars = s.characters||[];
  const drop = chars[dropIdx]; if(!drop) return;
  const others = chars.map((c,i)=>({c,i})).filter(x=>x.i!==dropIdx);
  if(!others.length){ alert('Больше не с кем объединять — это единственный персонаж.'); return; }
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="mrgBg"><div class="modal" style="width:420px" onclick="event.stopPropagation()">
    <h2>🔗 Объединить «${esc(drop.name)}»</h2>
    <div class="muted" style="margin-bottom:10px;font-size:12px">Выберите, с кем объединить — если это один и тот же персонаж под другим именем. Состояние/описание объединятся, а в сценах, где отмечен «${esc(drop.name)}», отметка перейдёт на выбранное имя.</div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto">
      ${others.map(x=>`<button class="btn mrg-opt" data-keepi="${x.i}" style="text-align:left">${esc(x.c.name)}${x.c.stateNote?` <span class="muted" style="font-size:11px">— ${esc(x.c.stateNote.slice(0,40))}</span>`:''}</button>`).join('')}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="mrgCancel">Отмена</button></div>
  </div></div>`;
  const close = ()=>root.innerHTML='';
  document.getElementById('mrgBg').onclick = close;
  document.getElementById('mrgCancel').onclick = close;
  document.querySelectorAll('.mrg-opt').forEach(b=>b.onclick=()=>{
    const keepIdx = +b.dataset.keepi;
    const st = getState();
    const freshDropIdx = st.characters.indexOf(drop); // на случай если массив успел измениться
    if(freshDropIdx>=0 && mergeCharacters(st, keepIdx, freshDropIdx)) save();
    close();
  });
}

function openBlindRating(){
  const s = getState();
  const scenes = uncalibratedScenes(s);
  if(!scenes.length) return;
  const scene = scenes[scenes.length-1]; // самая свежая
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="calBg"><div class="modal" style="width:560px;max-width:92vw" onclick="event.stopPropagation()">
    <h2>Слепая оценка · «${esc(scene.title)}»</h2>
    <div class="muted" style="margin-bottom:8px">Прочитайте без оценки ИИ. Насколько это хорошая проза (1–10)?</div>
    <div style="max-height:300px;overflow-y:auto;font-size:13px;line-height:1.7;white-space:pre-wrap;border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px">${esc(scene.text)}</div>
    <div class="cal-scale" id="calScale">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="cal-n" data-n="${n}">${n}</button>`).join('')}</div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('calBg').onclick=close;
  document.querySelectorAll('.cal-n').forEach(b=>b.onclick=()=>{
    const adj = recordRating(scene.id, parseInt(b.dataset.n));
    close();
    if(adj){
      const t=document.createElement('div');
      t.style.cssText='position:fixed;bottom:20px;right:20px;z-index:9999;padding:10px 16px;background:var(--bg-3);border:1px solid var(--border);border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);animation:fadeIn .2s';
      t.textContent=`⚖️ Порог Оценщика → ${adj.threshold}/10 (вы ${adj.authorAvg} / ИИ ${adj.evalAvg})`;
      document.body.appendChild(t); setTimeout(()=>t.remove(),5000);
    }
  });
}

function driftBlock(scenes){
  const flagged = scenes.filter(n=>Array.isArray(n.drift) && n.drift.length);
  if(!flagged.length) return '';
  return `<div class="mem-h" style="color:var(--warn)">⚠ Сигналы дрейфа</div>
    ${flagged.map(n=>`<div class="mem-card" style="border-color:var(--warn-border)">
      <div class="mem-title">${esc(n.title)}</div>
      ${n.drift.map(d=>`<div style="font-size:12px;color:var(--warn)">${esc(d)}</div>`).join('')}
    </div>`).join('')}`;
}

// Замеченные Оценщиком клише-категории, повторившиеся в ≥2 сценах этой книги
// (state.style.observed[], копится через recordObservedPattern — см. pipeline.js).
// Мягкая память: уже подмешивается в контекст Прозаика как совет (context.js), но
// здесь автор может одним кликом закрепить это как жёсткое правило ⊕ или скрыть ✕.
function observedBlock(s){
  const items = (s.style?.observed||[]).map((o,i)=>({...o,i})).filter(o=>!o.dismissed && o.count>=2).sort((a,b)=>b.count-a.count);
  if(!items.length) return '';
  return `<div class="mem-h" title="Категории, которые Оценщик находил повторно в разных сценах — Прозаик уже видит их как совет в контексте следующих сцен">🔁 Повторяющиеся замечания</div>
    ${items.map(o=>`<div class="mem-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-size:12px;flex:1">${esc(o.category)}</div>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button class="bc-act obs-rule" data-oi="${o.i}" title="Закрепить как правило автора — впредь Прозаик не будет это порождать">⊕</button>
          <button class="bc-act obs-dismiss" data-oi="${o.i}" title="Скрыть — не предлагать превращать в правило (не блокирует, только убирает из списка)">✕</button>
        </div>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">встречалось в ${o.count} сценах</div>
    </div>`).join('')}`;
}

function bindMemory(){
  document.querySelectorAll('.mem-h-toggle').forEach(h=>h.onclick=(e)=>{
    if(e.target.closest('button')) return; // не сворачивать при клике на «+ факт» в заголовке
    collapsed[h.dataset.sec] = !collapsed[h.dataset.sec];
    const body = document.getElementById('rtabBody');
    if(body) body.innerHTML = renderMemory();
  });
  const cb=document.getElementById('calBtn'); if(cb) cb.onclick=openBlindRating;
  document.querySelectorAll('.mem-sum').forEach(t=>{
    t.addEventListener('change', ()=>{
      const s=getState(); const e=s.memory[t.dataset.level]?.[t.dataset.id];
      if(e){ if(e.current!==t.value){ e.versions.unshift({text:e.current, at:Date.now()}); if(e.versions.length>8)e.versions.length=8; } e.current=t.value; save(); }
    });
  });
  document.querySelectorAll('.mem-rb').forEach(b=>{
    b.onclick=()=>{ const s=getState(); if(rollback(s, b.dataset.level, b.dataset.id, 0)){ save(); } };
  });
  // Повторяющиеся замечания: закрепить как правило / скрыть.
  // openRuleModal сам вызывает addRule с (возможно отредактированным в модалке)
  // текстом — здесь только убираем запись из «мягкого» списка после сохранения,
  // не добавляем правило второй раз.
  document.querySelectorAll('.obs-rule').forEach(b=>b.onclick=()=>{
    const s=getState(); const oi=+b.dataset.oi; const o=(s.style?.observed||[])[oi]; if(!o) return;
    openRuleModal(o.category, { onSave:()=>{ const st=getState(); if(dismissObserved(st, oi)) save(); } });
  });
  document.querySelectorAll('.obs-dismiss').forEach(b=>b.onclick=()=>{
    const s=getState(); if(dismissObserved(s, +b.dataset.oi)) save();
  });
  // Персонажи: редактировать состояние
  function editCharState(i){
    const s=getState(); const c=s.characters[i]; if(!c) return;
    const stDiv=document.querySelector(`.char-state[data-chi="${i}"]`); if(!stDiv) return;
    const oldNote=c.stateNote||'';
    stDiv.innerHTML=`<textarea style="width:100%;min-height:52px;font-size:12px;background:var(--bg-2);color:var(--text);border:1px solid var(--accent);border-radius:4px;padding:4px;box-sizing:border-box;resize:vertical">${esc(oldNote)}</textarea><div style="display:flex;gap:6px;margin-top:4px"><button class="btn btn-primary" style="font-size:11px;padding:2px 8px">Сохранить</button><button class="btn" style="font-size:11px;padding:2px 8px">Отмена</button></div>`;
    const ta=stDiv.querySelector('textarea'); ta.focus(); ta.select();
    stDiv.querySelector('.btn-primary').onclick=()=>{ c.stateNote=ta.value.trim()||undefined; save(); };
    stDiv.querySelector('.btn:not(.btn-primary)').onclick=()=>{ stDiv.innerHTML=`<span class="muted">${esc(oldNote||'—')}</span>`; };
  }
  document.querySelectorAll('.char-edit').forEach(b=>b.onclick=e=>{ e.stopPropagation(); editCharState(+b.dataset.chi); });
  document.querySelectorAll('.char-merge').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openMergeCharacterModal(+b.dataset.chi); });
  document.querySelectorAll('.char-state').forEach(d=>d.onclick=()=>editCharState(+d.dataset.chi));

  // Bible: добавить факт
  const ba=document.getElementById('bibleAdd');
  if(ba) ba.onclick=()=>{
    const keys=prompt('Ключи факта (через запятую, напр.: «город, климат»):'); if(keys===null) return;
    const text=prompt('Сам факт:'); if(!text) return;
    const s=getState(); s.bible.push({keys:keys.trim(), text:text.trim()}); rebuildBibleVecs(s.bible); save();
  };
  // Bible: ред./AI-расширить/удалить. Матчим по [data-bi] (только у Bible-кнопок),
  // а не по классу bc-act — тот общий для char-edit/char-merge/obs-*, и раньше
  // здесь уже был баг: общий класс перехватывал их onclick при перебиндинге.
  document.querySelectorAll('.bc-act[data-bi]').forEach(b=>b.onclick=async (e)=>{
    e.stopPropagation();
    const s=getState(); const i=+b.dataset.bi; const fact=s.bible[i]; if(!fact) return;
    if(b.dataset.act==='del'){ s.bible.splice(i,1); rebuildBibleVecs(s.bible); save(); return; }
    if(b.dataset.act==='edit'){
      const keys=prompt('Ключи:', fact.keys||''); if(keys===null) return;
      const text=prompt('Факт:', fact.text||''); if(text===null) return;
      fact.keys=keys.trim(); fact.text=text.trim(); rebuildBibleVecs(s.bible); save(); return;
    }
    if(b.dataset.act==='expand'){
      if(!s.global.apiKey){ alert('Задайте API-ключ (⚙).'); return; }
      b.textContent='…'; b.disabled=true;
      try{
        const res=await callLLM({ baseURL:s.global.baseURL, apiKey:s.global.apiKey, model:s.global.model, temperature:0.6,
          messages:[{role:'system',content:'Ты — архивариус мира книги. Расширь канонический факт конкретными деталями (1-2 предложения), не противореча исходному. Верни только текст факта.'},
            {role:'user',content:`Жанр: ${s.project.genre||''}. Факт: ${fact.text}`}], maxTokens:300 });
        if(res.text){ fact.text=res.text.trim(); rebuildBibleVecs(s.bible); save(); }
      }catch(err){ alert('Не удалось: '+err.message); b.disabled=false; b.textContent='✨'; }
    }
  });
  document.querySelectorAll('.mem-rs').forEach(b=>{
    b.onclick=async ()=>{
      const s=getState(); const scene=(s.structure||[]).find(n=>n.id===b.dataset.id);
      if(!scene||!s.global.apiKey){ if(!s.global.apiKey) alert('Задайте API-ключ (⚙).'); return; }
      b.disabled=true; b.innerHTML='<span class="spinner"></span>';
      try{ await summarizeScene(s, scene); save(); }   // putVersioned сохранит прошлую сводку
      catch(e){ b.textContent='ошибка'; b.title=e.message; }
    };
  });
}

async function refreshQuota(){
  const el = document.getElementById('quota');
  if(!el) return;
  const est = await storageEstimate();
  if(!est){ el.textContent=''; return; }
  const mb = (est.usage/1048576).toFixed(1);
  const pct = Math.round(est.ratio*100);
  el.textContent = `Хранилище: ${mb} МБ (${pct}%)`;
  if(est.ratio > 0.8){ el.style.color='var(--warn)'; el.textContent += ' — пора экспортировать чекпоинт'; }
}
