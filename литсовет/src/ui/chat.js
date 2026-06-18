// Чат с ИИ о книге. Ассистент знает контекст проекта (жанр, синопсис,
// текущую сцену, канон) и помогает обсуждать: логику, повороты, идеи.
// Это ОБСУЖДЕНИЕ, не команда агентам (для команд — инлайн-директива).

import { getState, save } from '../state.js';
import { callLLM } from '../llm.js';
import { bibleForPrompt } from '../bible.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

export function renderChat(){
  const s = getState();
  s.chat = s.chat || [];
  setTimeout(bindChat, 0);
  const scene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  const bits = [];
  if(scene) bits.push(`открытую сцену «${esc(scene.title||'без названия')}»${scene.text?' (бриф + текст)':' (бриф)'}`);
  if(s.project.genre) bits.push('жанр');
  if(s.project.synopsis||s.project.idea) bits.push('синопсис');
  if(s.characters&&s.characters.length) bits.push('персонажей');
  if(s.bible&&s.bible.length) bits.push('канон');
  const ctxLine = bits.length ? 'Видит: ' + bits.join(', ') + '.' : 'Контекст пуст — откройте сцену.';
  return `
    <div class="chat-wrap">
      <div class="chat-ctx">
        <span class="chat-ctx-tx" data-tip="Чат — это обсуждение, а не команда агентам. Он видит открытую сцену (бриф и до ~1500 знаков её текста), жанр, синопсис, персонажей и подходящий канон, и помнит последние сообщения переписки.">ℹ ${ctxLine}</span>
        ${s.chat.length?`<button class="chat-clear" id="chatClear" title="Очистить переписку с ИИ">Очистить</button>`:''}
      </div>
      <div class="chat-log" id="chatLog">
        ${s.chat.length? s.chat.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-bubble">${esc(m.content)}</div></div>`).join('')
          : '<div class="muted" style="padding:10px">Спросите ИИ о книге: «логично ли, что Анна знает про письма?», «предложи поворот для главы 3», «какой мотив у Мартина?». Он видит вашу открытую сцену (с текстом), жанр, синопсис и канон.</div>'}
      </div>
      <div class="chat-input-row">
        <textarea id="chatInput" rows="2" placeholder="Спросить о книге…"></textarea>
        <button class="btn btn-primary" id="chatSend">→</button>
      </div>
    </div>`;
}

function contextPrompt(s){
  const scene = (s.structure||[]).find(n=>n.id===s.ui.activeScene);
  const parts = [
    'Ты — соавтор-консультант книги. Помогаешь автору обсуждать сюжет, логику, повороты, мотивы. Отвечай кратко и по делу. Ты НЕ пишешь прозу за автора — ты обсуждаешь.',
    `Жанр: ${s.project.genre||'—'}. Синопсис: ${s.project.synopsis||s.project.idea||'—'}`,
  ];
  if(s.characters&&s.characters.length) parts.push('Персонажи: '+s.characters.map(c=>`${c.name} (${c.stateNote||c.desc||'—'})`).join('; '));
  if(scene) parts.push(`Текущая сцена «${scene.title}»: ${scene.brief||''}` + (scene.text?`\nТекст сцены:\n${scene.text.slice(0,1500)}`:''));
  const bible = bibleForPrompt(s.bible, (scene?.brief||'')+' '+(s.project.synopsis||''), 6);
  if(bible) parts.push('Канон:\n'+bible);
  return parts.join('\n');
}

function bindChat(){
  const send=document.getElementById('chatSend');
  const input=document.getElementById('chatInput');
  if(!send) return;
  const doSend=async ()=>{
    const s=getState(); const text=input.value.trim();
    if(!text) return;
    if(!s.global.apiKey){ alert('Задайте API-ключ (⚙).'); return; }
    s.chat=s.chat||[]; s.chat.push({role:'user', content:text}); save();
    input.value=''; send.disabled=true;
    const log=document.getElementById('chatLog');
    if(log){ log.innerHTML+=`<div class="chat-msg assistant"><div class="chat-bubble"><span class="spinner"></span></div></div>`; log.scrollTop=log.scrollHeight; }
    try{
      const msgs=[{role:'system',content:contextPrompt(s)}, ...s.chat.slice(-10).map(m=>({role:m.role,content:m.content}))];
      const res=await callLLM({ baseURL:s.global.baseURL, apiKey:s.global.apiKey, model:s.global.model, temperature:0.7, messages:msgs, maxTokens:700 });
      s.chat.push({role:'assistant', content:res.text||'(пусто)'}); save();
    }catch(e){ s.chat.push({role:'assistant', content:'Ошибка: '+e.message}); save(); }
  };
  send.onclick=doSend;
  input.onkeydown=(e)=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); doSend(); } };
  const clr=document.getElementById('chatClear');
  if(clr) clr.onclick=()=>{ if(confirm('Очистить переписку с ИИ?')){ const s=getState(); s.chat=[]; save(); } };
}
