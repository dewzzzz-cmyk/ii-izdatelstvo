// Рендереры стадий. ПП1+2: Концепция (онбординг+режим), Голос (образец→примеры),
// Структура (минимальный список сцен), Написание (редактор + запуск ядра).

import { getState, save, uid } from '../state.js';
import { extractVoice } from '../voice.js';
import { runScene } from '../pipeline.js';
import { renderDiagnostics } from './diagnostics.js';
import { renderMemory } from './memory.js';
import { summarizeScene, driftCheck, maybeRollup } from '../memory.js';
import { runBookArchitect, applySkeleton } from '../architect-book.js';
import { chapterOf, chapterComplete, chapterClosed, needsAuthorHand, scenesOfChapter, closeChapter } from './author-control.js';
import { exportMd, exportDocx, exportEpub, exportJson } from '../export.js';
import { parseFile } from '../import.js';
import { importSeriesBook } from '../series.js';

export function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let _rightTab = 'diag'; // diag | mem
function renderRightPanel(els){
  els.right.innerHTML = `
    <div class="rtabs">
      <button class="rtab ${_rightTab==='diag'?'active':''}" data-rt="diag">Диагностика</button>
      <button class="rtab ${_rightTab==='mem'?'active':''}" data-rt="mem">Память</button>
    </div>
    <div id="rtabBody">${_rightTab==='diag'?renderDiagnostics():renderMemory()}</div>`;
  els.right.querySelectorAll('.rtab').forEach(b=>b.onclick=()=>{ _rightTab=b.dataset.rt; renderRightPanel(els); });
}

// ─────────────────────────────── КОНЦЕПЦИЯ ───────────────────────────────
export function renderConcept(els){
  const s = getState(); const p = s.project;
  els.left.innerHTML = `<div class="ph">Проект</div><div class="pad">
    <div class="muted">Прогрессивный онбординг: один вопрос, остальное по желанию.</div></div>`;
  els.right.innerHTML = '';
  els.center.innerHTML = `
    <div class="hero">
      <h1>О чём ваша книга?</h1>
      <div class="sub">Одно-два предложения. Остальное настроим по ходу.</div>
      <textarea class="big-input" id="idea" rows="3" placeholder="например: Женщина приезжает в северный город после смерти тётки и узнаёт, что та вела двойную жизнь…">${esc(p.idea)}</textarea>

      <div class="field" style="margin-top:14px"><label>Название</label>
        <input type="text" id="title" value="${esc(p.title)}" placeholder="Рабочее название"></div>

      <div class="field"><label>Режим работы</label>
        <div class="mode-switch" id="modeSwitch">
          <div class="mode-opt ${p.mode==='director'?'sel':''}" data-mode="director">Режиссёр<small>качество · контроль обязателен</small></div>
          <div class="mode-opt ${p.mode==='factory'?'sel':''}" data-mode="factory">Фабрика<small>скорость · контроль опционален</small></div>
        </div>
      </div>

      <button class="adv-toggle" id="advBtn">▾ Дополнительные настройки</button>
      <div id="adv" style="display:none">
        <div class="field"><label>Жанр</label><input type="text" id="genre" value="${esc(p.genre)}" placeholder="роман, повесть, сказка…"></div>
        <div class="field"><label>Эпоха / сеттинг</label><input type="text" id="era" value="${esc(p.era)}" placeholder="наши дни, XX век…"></div>
        <div class="field"><label>Целевой объём (слов)</label><input type="text" id="tw" value="${esc(p.targetWords)}"></div>
      </div>

      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn btn-primary" id="toVoice">Дальше — Голос →</button>
      </div>
    </div>`;

  const bind = (id, fn)=>{ const e=document.getElementById(id); if(e) e.addEventListener('input',fn); };
  bind('idea', e=>{ p.idea=e.target.value; });
  bind('title', e=>{ p.title=e.target.value; });
  bind('genre', e=>{ p.genre=e.target.value; });
  bind('era', e=>{ p.era=e.target.value; });
  bind('tw', e=>{ p.targetWords=parseInt(e.target.value)||80000; });
  document.getElementById('advBtn').onclick = (ev)=>{ const a=document.getElementById('adv'); const open=a.style.display!=='none'; a.style.display=open?'none':'block'; ev.target.textContent=(open?'▾':'▴')+' Дополнительные настройки'; };
  document.getElementById('modeSwitch').onclick = (ev)=>{ const o=ev.target.closest('.mode-opt'); if(!o)return; p.mode=o.dataset.mode; save(); };
  document.getElementById('toVoice').onclick = ()=>{ save(); s.ui.stage='voice'; save(); };
}

// ─────────────────────────────── ГОЛОС ───────────────────────────────
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
        <div class="row"><button class="btn btn-primary" id="extract">Извлечь голос</button><span class="muted" id="vstatus"></span></div>
      `:`
        <div class="field"><label>Загрузить готовую книгу серии <span class="hint">(.txt, .docx, .epub)</span></label>
          <input type="file" id="bookFile" accept=".txt,.docx,.epub"></div>
        <div class="row"><button class="btn btn-primary" id="importBook">Импортировать и извлечь</button><span class="muted" id="vstatus"></span></div>
        ${(s.series||[]).length?`<div class="muted" style="margin-top:12px">Загруженные книги: ${(s.series||[]).map(b=>esc(b.title)).join(', ')}</div>`:''}
      `}
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn" id="toStruct">Дальше — Структура →</button>
      </div>
    </div>`;

  document.getElementById('vmode').onclick=(ev)=>{ const o=ev.target.closest('.mode-opt'); if(!o)return; s.ui.voiceMode=o.dataset.m; save(); };

  const ext=document.getElementById('extract');
  if(ext) ext.onclick = ()=>{
    const sample = document.getElementById('sample').value.trim();
    if(sample.length<40){ document.getElementById('vstatus').textContent='Слишком короткий образец.'; return; }
    s.voice = extractVoice(sample, 5); save();
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
      save();
      st.textContent = `Готово: ${report.charactersAdded} персонажей, ${report.factsAdded} фактов, голос (${report.voiceExamples} примеров).`;
    }catch(e){ st.textContent='Ошибка: '+e.message; }
    finally{ imp.disabled=false; }
  };

  document.getElementById('toStruct').onclick = ()=>{ s.ui.stage='structure'; save(); };
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

// ─────────────────────────────── СТРУКТУРА (мин.) ───────────────────────────────
export function renderStructure(els){
  const s = getState();
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  els.left.innerHTML = `<div class="ph">Структура</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{ s.ui.activeScene=r.dataset.sc; s.ui.stage='write'; save(); });
  els.right.innerHTML = '';

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
          <input type="text" id="chCount" value="" placeholder="авто" style="width:70px">
          <button class="btn btn-primary" id="genSkeleton">${hasSkeleton?'Перегенерировать':'Сгенерировать скелет'}</button>
          <span class="muted" id="genStatus"></span>
        </div>
      </div>

      ${hasSkeleton ? renderSkeletonEditor(s) : `
        <div class="muted" style="margin:10px 0">или добавьте сцену вручную:</div>
        <div class="field"><label>Название сцены</label><input type="text" id="scName" placeholder="например: Вокзал в дождь"></div>
        <div class="field"><label>Бриф сцены</label><textarea id="scBrief" rows="2" placeholder="Что происходит, тон, чем заканчивается."></textarea></div>
        <div class="field"><label>Эмоция читателя</label><input type="text" id="scEmo" placeholder="тревога…"></div>
        <button class="btn" id="addScene">Добавить сцену</button>
      `}

      ${scenes.length?`<div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn btn-primary" id="toWrite">К Написанию →</button></div>`:''}
    </div>`;

  document.getElementById('genSkeleton').onclick = async (ev)=>{
    if(!s.global.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    if(hasSkeleton && !confirm('Перегенерировать скелет? Текущая структура (и тексты сцен) будут заменены.')) return;
    const btn=ev.target; btn.disabled=true; const st=document.getElementById('genStatus');
    st.innerHTML='<span class="spinner"></span> Архитектор проектирует…';
    try{
      const chCount = parseInt(document.getElementById('chCount').value)||0;
      const skeleton = await runBookArchitect(s, chCount?{chapters:chCount}:{});
      applySkeleton(s, skeleton, uid);
      save();
    }catch(e){ st.textContent='Ошибка: '+e.message; btn.disabled=false; }
  };

  const add=document.getElementById('addScene');
  if(add) add.onclick = ()=>{
    const name=document.getElementById('scName').value.trim();
    const brief=document.getElementById('scBrief').value.trim();
    if(!name && !brief) return;
    s.structure.push({ id:uid('sc'), type:'scene', title:name||'Без названия', brief, emotion:document.getElementById('scEmo').value.trim(), text:'', words:0, status:'todo', targetWords:700 });
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
      html += `<div class="sk-chapter"><span class="sk-arc">${esc(n.arc||'')}</span> ${esc(n.title)}</div>`;
    } else if(n.type==='scene'){
      const open = s.ui.editScene===n.id;
      html += `<div class="sk-scene ${open?'open':''}" data-sc="${n.id}">
        <div class="sk-scene-head" data-toggle="${n.id}">
          <span class="sk-sc-title">${esc(n.title)}</span>
          <span class="sr-meta">${n.text?(n.words+' сл'):('~'+(n.targetWords||700))}</span>
        </div>
        ${open?`<div class="sk-scene-body">
          <textarea class="sk-brief" data-id="${n.id}" rows="2" placeholder="бриф">${esc(n.brief)}</textarea>
          <input type="text" class="sk-emo" data-id="${n.id}" value="${esc(n.emotion||'')}" placeholder="эмоция читателя">
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
  document.querySelectorAll('.sk-brief').forEach(t=>t.addEventListener('change',()=>{ const n=node(s,t.dataset.id); if(n){n.brief=t.value;save();} }));
  document.querySelectorAll('.sk-emo').forEach(t=>t.addEventListener('change',()=>{ const n=node(s,t.dataset.id); if(n){n.emotion=t.value;save();} }));
}
function node(s,id){ return (s.structure||[]).find(n=>n.id===id); }

function renderSceneList(s){
  const nodes=(s.structure||[]);
  const scenes=nodes.filter(n=>n.type==='scene');
  if(!scenes.length) return `<div class="empty-state">Структуры пока нет.</div>`;
  let html='';
  nodes.forEach(n=>{
    if(n.type==='chapter'){ html+=`<div class="chapter-head">${esc(n.title)}</div>`; }
    else if(n.type==='scene'){
      html+=`<div class="scene-row ${s.ui.activeScene===n.id?'active':''}" data-sc="${n.id}">
        <span class="sr-name">${esc(n.title)}</span><span class="sr-meta">${n.words||(n.status==='done'?'':'—')}</span></div>`;
    }
  });
  return html;
}

// ─────────────────────────────── НАПИСАНИЕ ───────────────────────────────
export function renderWrite(els){
  const s = getState();
  const scenes=(s.structure||[]).filter(n=>n.type==='scene');
  if(!scenes.length){ els.left.innerHTML=`<div class="ph">Сцены</div>`; els.center.innerHTML=`<div class="empty-state">Сначала добавьте сцену на стадии «Структура».</div>`; els.right.innerHTML=''; return; }
  if(!s.ui.activeScene || !scenes.find(x=>x.id===s.ui.activeScene)) s.ui.activeScene=scenes[0].id;
  const scene = scenes.find(x=>x.id===s.ui.activeScene);

  els.left.innerHTML = `<div class="ph">Сцены</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{ s.ui.activeScene=r.dataset.sc; save(); });

  const ch = chapterOf(s, scene);
  const showStop = ch && chapterComplete(s, ch.id) && !chapterClosed(s, ch.id);

  els.center.innerHTML = `
    <div class="scene-bar">
      <span class="scene-tag">Сцена</span>
      <span class="scene-title">${esc(scene.title)}</span>
      ${scene.handDone?'<span class="hand-badge" title="абзац переписан автором">✍ рука автора</span>':''}
    </div>
    <div class="editor ${scene.text?'':'empty'}" id="editor" ${scene.text?'contenteditable="true" spellcheck="false"':''}>${scene.text?esc(scene.text):'Проза появится здесь после запуска агентов.'}</div>
    <div id="selMenu" class="sel-menu" style="display:none"></div>
    ${showStop?renderEditorialStop(s, ch):''}
    <div class="brief-box">
      <div class="field" style="margin:0 0 8px"><label>Бриф сцены</label>
        <textarea id="brief" rows="2">${esc(scene.brief)}</textarea></div>
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
      <button class="btn btn-primary btn-block" id="runBtn">${scene.text?'▶ Запустить снова':'▶ Запустить агентов'}</button>
    </div>`;
  document.getElementById('brief').addEventListener('input', e=>{ scene.brief=e.target.value; });

  // редактирование текста автором → отметка «рука автора»
  const edEl = document.getElementById('editor');
  if(scene.text){
    edEl.addEventListener('input', ()=>{ scene.text=edEl.innerText; if(!scene.handDone){ scene.handDone=true; } scene._dirty=true; });
    edEl.addEventListener('blur', ()=>{ if(scene._dirty){ scene.words=(scene.text.match(/\S+/g)||[]).length; scene._dirty=false; save(); } });
    initSelectionMenu(edEl, scene, els);
  }

  // инлайн-директива
  const runWith = (directive)=>doRun(els, s, scene, directive);
  document.getElementById('reRun').onclick = ()=>{ const d=document.getElementById('directive').value.trim(); runWith(d); };
  document.querySelectorAll('.ia-chip').forEach(c=>c.onclick=()=>{ document.getElementById('directive').value=c.dataset.d; });
  document.getElementById('runBtn').onclick = ()=>runWith('');

  const cc=document.getElementById('closeChapter');
  if(cc) cc.onclick = async ()=>{ cc.disabled=true; cc.innerHTML='<span class="spinner"></span> Закрываю…'; await closeChapter(s, ch.id); };

  renderRightPanel(els);
}

// ─────────────────────────────── РЕДАКТУРА + РОАДМАП + ЭКСПОРТ ───────────────────────────────
const STAGE_LABELS = [['concept','Концепция'],['voice','Голос'],['structure','Структура'],['write','Написание'],['edit','Редактура']];
export function renderEdit(els){
  const s = getState();
  const chapters = (s.structure||[]).filter(n=>n.type==='chapter');
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  const doneScenes = scenes.filter(sc=>sc.status==='done');
  const totalWords = doneScenes.reduce((a,sc)=>a+(sc.words||0),0);
  const cost = (s.diagnostics?.runs||[]).reduce((a,r)=>a+(r.totalCost||0),0);
  const avgVoice = (()=>{ const v=doneScenes.map(sc=>sc.lastEval?.scores?.voice).filter(Boolean); return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:'—'; })();

  els.left.innerHTML = `<div class="ph">Прогресс</div>${renderSceneList(s)}`;
  els.left.querySelectorAll('.scene-row').forEach(r=>r.onclick=()=>{ s.ui.activeScene=r.dataset.sc; s.ui.stage='write'; save(); });
  els.right.innerHTML = '';

  els.center.innerHTML = `
    <div class="pad" style="max-width:680px">
      <div class="rm-section">
        <div class="rm-h">Этапы производства</div>
        ${STAGE_LABELS.map(([id,label])=>{
          const done = stageDoneFor(s,id); const cur = id==='edit';
          return `<div class="rm-stage"><span class="rm-dot ${done?'done':cur?'cur':'todo'}">${done?'✓':cur?'▶':'○'}</span>${label}</div>`;
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

      <div class="rm-h">Экспорт книги</div>
      <div class="chips">
        <button class="btn" id="exMd">📕 .md</button>
        <button class="btn" id="exDocx">📄 .doc (Word)</button>
        <button class="btn" id="exEpub">📗 .epub</button>
        <button class="btn" id="exJson">⬇ .json (проект)</button>
      </div>
      ${!doneScenes.length?'<div class="muted" style="margin-top:8px">Напишите хотя бы одну сцену, чтобы экспортировать.</div>':''}
    </div>`;

  document.getElementById('exMd').onclick=()=>exportMd(s);
  document.getElementById('exDocx').onclick=()=>exportDocx(s);
  document.getElementById('exEpub').onclick=()=>exportEpub(s);
  document.getElementById('exJson').onclick=()=>exportJson(s);
}
function stageDoneFor(s,id){
  switch(id){
    case 'concept': return !!(s.project.idea||s.project.title);
    case 'voice': return (s.voice.examples||[]).length>0;
    case 'structure': return (s.structure||[]).some(n=>n.type==='scene');
    case 'write': return (s.structure||[]).filter(n=>n.type==='scene').some(n=>n.status==='done');
    default: return false;
  }
}

function renderEditorialStop(s, ch){
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

async function doRun(els, s, scene, directive){
  const g=s.global;
  if(!g.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
  scene.brief=document.getElementById('brief').value.trim();
  const btn=document.getElementById('runBtn'); btn.disabled=true;
  const ed=document.getElementById('editor'); ed.classList.remove('empty'); ed.removeAttribute('contenteditable');
  try{
    const result = await runScene(s, scene, directive?{directive}:{}, prog=>{
      if(prog.streaming){ ed.textContent=prog.text; scene.text=prog.text; }
      else { btn.innerHTML=`<span class="spinner"></span> ${esc(prog.text)}`; }
    });
    scene.text=result.text; scene.words=(result.text.match(/\S+/g)||[]).length; scene.status='done';
    scene.lastEval=result.eval||null; scene.flags=result.flags||{}; scene.handDone=false;
    save();
    btn.innerHTML='<span class="spinner"></span> Суммаризация…';
    try{ await summarizeScene(s, scene); scene.drift = driftCheck(s, scene); await maybeRollup(s); save(); }
    catch(e){ console.warn('summarize failed', e); }
  }catch(e){ ed.textContent='Ошибка: '+e.message; }
  finally{ btn.disabled=false; }
}

// Плавающее меню по выделению текста → директива, привязанная к фрагменту.
function initSelectionMenu(edEl, scene, els){
  const menu = document.getElementById('selMenu');
  if(!menu) return;
  const actions = [
    ['Переписать','перепиши выделенный фрагмент'],
    ['Сократить','сократи выделенный фрагмент'],
    ['Усилить','усиль выделенный фрагмент, добавь напряжения'],
    ['Деталь мира','добавь конкретную деталь мира в выделенный фрагмент'],
    ['Продолжить','продолжи прозу от выделенного фрагмента'],
  ];
  edEl.addEventListener('mouseup', ()=>{
    const sel=window.getSelection();
    const text=sel.toString().trim();
    if(!text){ menu.style.display='none'; return; }
    const rect=sel.getRangeAt(0).getBoundingClientRect();
    const appRect=document.getElementById('app').getBoundingClientRect();
    menu.style.display='flex';
    menu.style.top=(rect.top-appRect.top-38)+'px';
    menu.style.left=(rect.left-appRect.left)+'px';
    menu.innerHTML=actions.map(([label,d])=>`<button class="sm-btn" data-d="${esc(d)}: «${esc(text.slice(0,60))}»">${label}</button>`).join('');
    menu.querySelectorAll('.sm-btn').forEach(b=>b.onclick=()=>{ menu.style.display='none'; doRun(els, getState(), scene, b.dataset.d); });
  });
  document.addEventListener('mousedown', e=>{ if(!menu.contains(e.target) && e.target!==edEl && !edEl.contains(e.target)) menu.style.display='none'; });
}
