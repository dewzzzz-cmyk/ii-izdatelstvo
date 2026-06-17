// Рендереры стадий. ПП1+2: Концепция (онбординг+режим), Голос (образец→примеры),
// Структура (минимальный список сцен), Написание (редактор + запуск ядра).

import { getState, save, uid } from '../state.js';
import { extractVoice } from '../voice.js';
import { runScene } from '../pipeline.js';
import { renderDiagnostics } from './diagnostics.js';
import { renderMemory } from './memory.js';
import { summarizeScene, driftCheck } from '../memory.js';

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
  els.left.innerHTML = `<div class="ph">Голос</div><div class="pad"><div class="muted">Вставьте образец вашей прозы — система отберёт характерные предложения. Модель получает примеры, не числа.</div></div>`;
  els.right.innerHTML = renderVoicePanel(v);
  els.center.innerHTML = `
    <div class="pad" style="max-width:620px">
      <div class="field"><label>Образец прозы <span class="hint">(3–5 абзацев вашего текста или ориентир)</span></label>
        <textarea id="sample" rows="10" placeholder="Вставьте сюда фрагмент прозы…">${esc(v.sample)}</textarea></div>
      <div class="row">
        <button class="btn btn-primary" id="extract">Извлечь голос</button>
        <span class="muted" id="vstatus"></span>
      </div>
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn" id="toStruct">Дальше — Структура →</button>
      </div>
    </div>`;
  document.getElementById('extract').onclick = ()=>{
    const sample = document.getElementById('sample').value.trim();
    if(sample.length<40){ document.getElementById('vstatus').textContent='Слишком короткий образец.'; return; }
    const extracted = extractVoice(sample, 5);
    s.voice = extracted; save();
  };
  document.getElementById('toStruct').onclick = ()=>{ s.ui.stage='structure'; save(); };
}

function renderVoicePanel(v){
  if(!v.examples || !v.examples.length) return `<div class="ph">Отпечаток</div><div class="empty-state">Голос ещё не извлечён.</div>`;
  const m = v.metrics||{};
  return `<div class="ph">Отпечаток голоса</div>
    <div class="pad">
      <div class="muted" style="margin-bottom:8px">Примеры (идут в промпт):</div>
      ${v.examples.map(e=>`<div class="card" style="margin-bottom:6px;font-size:12px;font-style:italic;color:var(--text-2)">«${esc(e)}»</div>`).join('')}
      <div class="muted" style="margin:12px 0 6px">Метрики (только индикатор):</div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.8">
        Ср. длина предложения: <b>${m.avgSentence||'—'}</b> сл.<br>
        Доля диалога: <b>${m.dialogueRatio||0}%</b><br>
        Вариативность ритма: <b>${m.rhythmStdev||'—'}</b>
      </div>
    </div>`;
}

// ─────────────────────────────── СТРУКТУРА (мин.) ───────────────────────────────
export function renderStructure(els){
  const s = getState();
  const scenes = (s.structure||[]).filter(n=>n.type==='scene');
  els.left.innerHTML = `<div class="ph">Сцены</div>${renderSceneList(s)}`;
  els.right.innerHTML = '';
  els.center.innerHTML = `
    <div class="pad" style="max-width:620px">
      <div class="muted" style="margin-bottom:10px">Минимальная структура (полный Книжный архитектор — в под-проекте 4). Добавьте сцену с брифом, затем перейдите к Написанию.</div>
      <div class="field"><label>Название сцены</label><input type="text" id="scName" placeholder="например: Вокзал в дождь"></div>
      <div class="field"><label>Бриф сцены <span class="hint">(что происходит, тон, чем заканчивается)</span></label>
        <textarea id="scBrief" rows="3" placeholder="Анна прибывает. Тревога. Город чужой. Заканчивается — такси к дому."></textarea></div>
      <div class="field"><label>Эмоция читателя в финале</label><input type="text" id="scEmo" placeholder="тревога, одиночество…"></div>
      <button class="btn btn-primary" id="addScene">Добавить сцену</button>
      ${scenes.length?`<div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" id="toWrite">К Написанию →</button></div>`:''}
    </div>`;
  document.getElementById('addScene').onclick = ()=>{
    const name=document.getElementById('scName').value.trim();
    const brief=document.getElementById('scBrief').value.trim();
    if(!name && !brief){ return; }
    s.structure.push({ id:uid('sc'), type:'scene', title:name||'Без названия', brief, emotion:document.getElementById('scEmo').value.trim(), text:'', words:0, status:'todo', targetWords:700 });
    save();
  };
  const tw=document.getElementById('toWrite'); if(tw) tw.onclick=()=>{ s.ui.stage='write'; if(!s.ui.activeScene){ const fs=scenes[0]; if(fs) s.ui.activeScene=fs.id; } save(); };
}

function renderSceneList(s){
  const scenes=(s.structure||[]).filter(n=>n.type==='scene');
  if(!scenes.length) return `<div class="empty-state">Сцен пока нет.</div>`;
  return scenes.map(sc=>`<div class="scene-row ${s.ui.activeScene===sc.id?'active':''}" data-sc="${sc.id}">
    <span class="sr-name">${esc(sc.title)}</span><span class="sr-meta">${sc.words||'—'}</span></div>`).join('');
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

  els.center.innerHTML = `
    <div class="scene-bar">
      <span class="scene-tag">Сцена</span>
      <span class="scene-title">${esc(scene.title)}</span>
    </div>
    <div class="editor ${scene.text?'':'empty'}" id="editor">${scene.text?esc(scene.text):'Проза появится здесь после запуска агентов.'}</div>
    <div class="brief-box">
      <div class="field" style="margin:0"><label>Бриф сцены</label>
        <textarea id="brief" rows="2">${esc(scene.brief)}</textarea></div>
    </div>
    <div class="run-row">
      <button class="btn btn-primary btn-block" id="runBtn">▶ Запустить агентов</button>
    </div>`;
  document.getElementById('brief').addEventListener('input', e=>{ scene.brief=e.target.value; });

  renderRightPanel(els);

  document.getElementById('runBtn').onclick = async ()=>{
    const g=s.global;
    if(!g.apiKey){ alert('Задайте API-ключ в настройках (⚙).'); return; }
    scene.brief=document.getElementById('brief').value.trim();
    const btn=document.getElementById('runBtn'); btn.disabled=true;
    const ed=document.getElementById('editor'); ed.classList.remove('empty');
    try{
      const result = await runScene(s, scene, {}, prog=>{
        if(prog.streaming){
          ed.textContent=prog.text;
          scene.text=prog.text;            // держим scene в актуальном состоянии — ре-рендер не мигнёт плейсхолдером
        }
        else { btn.innerHTML=`<span class="spinner"></span> ${esc(prog.text)}`; }
      });
      scene.text=result.text; scene.words=(result.text.match(/\S+/g)||[]).length; scene.status='done';
      scene.lastEval=result.eval||null;
      save();
      // Суммаризация после одобрения (сжатие в память) + проверка дрейфа
      btn.innerHTML='<span class="spinner"></span> Суммаризация…';
      try{
        await summarizeScene(s, scene);
        scene.drift = driftCheck(s, scene);
        save();
      }catch(e){ console.warn('summarize failed', e); }
    }catch(e){
      ed.textContent='Ошибка: '+e.message;
    }finally{
      btn.disabled=false; btn.innerHTML='▶ Запустить снова';
    }
  };
}
