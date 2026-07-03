// Чат с ИИ о книге.
// Два режима: 💬 Обсуждение — вопросы о сюжете, логике, персонажах.
//             ✎ Правка — ИИ переписывает текст сцены по указанию автора.

import { getState, save } from '../state.js';
import { callLLM } from '../llm.js';
import { bibleForPrompt } from '../bible.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

export function renderChat(){
  const s = getState();
  s.chat = s.chat || [];
  const editMode = !!(s.ui && s.ui.chatEditMode);
  setTimeout(bindChat, 0);
  const scene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  const bits = [];
  if(scene) bits.push(`«${esc(scene.title||'без названия')}»${scene.text?' (текст)':' (бриф)'}`);
  if(s.project.genre) bits.push('жанр');
  if(s.project.synopsis||s.project.idea) bits.push('синопсис');
  if(s.characters&&s.characters.length) bits.push('персонажей');
  if(s.bible&&s.bible.length) bits.push('канон');
  const ctxLine = bits.length ? 'Видит: ' + bits.join(', ') : 'Контекст пуст — откройте сцену.';

  const messages = s.chat.length ? s.chat.map((m,idx)=>{
    const isLastAI = editMode && m.role==='assistant' && idx===s.chat.length-1;
    return `<div class="chat-msg ${m.role}">
      <div class="chat-bubble">${esc(m.content)}</div>
      ${isLastAI?`<button class="apply-to-scene" id="applyToScene">✎ Применить к сцене</button>`:''}
    </div>`;
  }).join('') : `<div class="muted" style="padding:10px 12px">${editMode
    ? '✎ Режим правки: опишите что изменить — ИИ перепишет сцену целиком, затем появится кнопка «Применить».'
    : '💬 Спросите ИИ о книге: «логично ли, что Анна знает про письма?», «предложи поворот для главы 3», «какой мотив у Мартина?»'
  }</div>`;

  return `
    <div class="chat-wrap">
      <div class="chat-ctx">
        <span class="chat-ctx-tx" data-tip="${esc('Обсуждение — вопросы о сюжете и персонажах. Правка — ИИ переписывает текст сцены по вашему указанию.')}">${ctxLine}</span>
        <div class="chat-mode-btns">
          <button class="chat-mode-btn${!editMode?' active':''}" id="chatModeDiscuss" title="Обсуждение сюжета">💬</button>
          <button class="chat-mode-btn${editMode?' active':''}" id="chatModeEdit" title="Режим правки текста">✎</button>
          ${s.chat.length?`<button class="chat-clear" id="chatClear" title="Очистить переписку">✕</button>`:''}
        </div>
      </div>
      <div class="chat-log" id="chatLog">${messages}</div>
      <div class="chat-input-row">
        <textarea id="chatInput" rows="2" placeholder="${editMode?'Что изменить в тексте сцены…':'Спросить о книге…'}"></textarea>
        <button class="btn btn-primary" id="chatSend">→</button>
      </div>
    </div>`;
}

function contextPrompt(s, editMode){
  const scene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  if(editMode){
    const parts = [
      'Ты — редактор прозы. Автор даёт указание изменить текст сцены.',
      'Верни ТОЛЬКО готовую прозу — полный текст сцены с внесёнными изменениями. Без пояснений, без заголовков, без комментариев.',
      'Сохраняй стиль, характеры персонажей, ключевые события и примерный объём (если не просят иначе).',
    ];
    if(scene) parts.push(`Бриф сцены: ${scene.brief||scene.title||'—'}`);
    if(scene && scene.text) parts.push('ТЕКСТ СЦЕНЫ:\n' + scene.text);
    else parts.push('Текст сцены ещё не написан — напиши его по брифу с учётом пожелания автора.');
    return parts.join('\n');
  }
  const parts = [
    'Ты — соавтор-консультант книги. Помогаешь обсуждать сюжет, логику, повороты, мотивы персонажей. Отвечай кратко и по делу. Ты НЕ пишешь прозу — ты обсуждаешь.',
    `Жанр: ${s.project.genre||'—'}. Синопсис: ${s.project.synopsis||s.project.idea||'—'}`,
  ];
  if(s.characters&&s.characters.length) parts.push('Персонажи: '+s.characters.map(c=>`${c.name} (${c.stateNote||c.desc||'—'})`).join('; '));
  if(scene) parts.push(`Текущая сцена «${scene.title}»: ${scene.brief||''}` + (scene.text?`\nТекст сцены:\n${scene.text.slice(0,1500)}`:''));
  const bible = bibleForPrompt(s.bible, (scene?.brief||'')+' '+(s.project.synopsis||''), 6);
  if(bible) parts.push('Канон:\n'+bible);
  return parts.join('\n');
}

function bindChat(){
  const send = document.getElementById('chatSend');
  const input = document.getElementById('chatInput');
  if(!send) return;

  const discBtn = document.getElementById('chatModeDiscuss');
  if(discBtn) discBtn.onclick = ()=>{ const s=getState(); s.ui.chatEditMode=false; save(); };
  const editBtn = document.getElementById('chatModeEdit');
  if(editBtn) editBtn.onclick = ()=>{ const s=getState(); s.ui.chatEditMode=true; save(); };

  const applyBtn = document.getElementById('applyToScene');
  if(applyBtn) applyBtn.onclick = ()=>{
    const s=getState();
    const scene=(s.structure||[]).find(n=>n.id===s.ui.activeScene);
    if(!scene){ alert('Нет активной сцены.'); return; }
    const lastAI=[...s.chat].reverse().find(m=>m.role==='assistant');
    if(!lastAI) return;
    // Двухшаговое подтверждение вместо confirm() (не работает в iOS PWA)
    if(applyBtn.dataset.armed !== 'yes'){
      applyBtn.dataset.armed='yes';
      applyBtn.textContent='⚠ Подтвердить замену →';
      applyBtn.style.background='var(--err,#c0392b)';
      setTimeout(()=>{ if(applyBtn.dataset.armed==='yes'){ applyBtn.dataset.armed=''; applyBtn.textContent='✎ Применить к сцене'; applyBtn.style.background=''; } }, 3000);
      return;
    }
    scene.text = lastAI.content;
    scene.words = (lastAI.content.match(/\S+/g)||[]).length;
    scene.lastEval=null; scene.flags={};   // оценка/флаги относились к тексту до правки
    save();
  };

  const doSend = async ()=>{
    const s=getState(); const text=input.value.trim();
    if(!text) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ (⚙).'); return; }
    const editMode = !!(s.ui && s.ui.chatEditMode);
    s.chat=s.chat||[]; s.chat.push({role:'user', content:text}); save();
    input.value=''; send.disabled=true;
    const log=document.getElementById('chatLog');
    if(log){ log.innerHTML+=`<div class="chat-msg assistant"><div class="chat-bubble"><span class="spinner"></span></div></div>`; log.scrollTop=log.scrollHeight; }
    try{
      const msgs=[{role:'system',content:contextPrompt(s, editMode)}, ...s.chat.slice(-10).map(m=>({role:m.role,content:m.content}))];
      const res=await callLLM({ baseURL:s.global.baseURL, apiKey:s.global.apiKey, model:s.global.model,
        temperature: editMode ? 1.0 : 0.7, messages:msgs, maxTokens: editMode ? 2000 : 700 });
      s.chat.push({role:'assistant', content:res.text||'(пусто)'}); save();
    }catch(e){ s.chat.push({role:'assistant', content:'Ошибка: '+e.message}); save(); }
    finally{ send.disabled=false; }
  };
  send.onclick=doSend;
  input.onkeydown=(e)=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); doSend(); } };
  const clr=document.getElementById('chatClear');
  if(clr) clr.onclick=()=>{ if(confirm('Очистить переписку с ИИ?')){ const s=getState(); s.chat=[]; save(); } };
}
