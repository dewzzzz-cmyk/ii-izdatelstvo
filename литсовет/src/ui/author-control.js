// Авторский контроль (спека 8): редакторский стоп, узел «рука автора»,
// суммаризация главы на стопе.

import { getState, save } from '../state.js';
import { summarizeChapter } from '../memory.js';

// Глава текущей сцены и её сцены.
export function chapterOf(state, scene){
  if(!scene.chapterId) return null;
  return (state.structure||[]).find(n=>n.type==='chapter' && n.id===scene.chapterId) || null;
}
export function scenesOfChapter(state, chapterId){
  const nodes = state.structure||[];
  const ci = nodes.findIndex(n=>n.id===chapterId);
  if(ci<0) return [];
  const out=[];
  for(let i=ci+1;i<nodes.length;i++){ if(nodes[i].type==='chapter') break; if(nodes[i].type==='scene') out.push(nodes[i]); }
  return out;
}

// Все сцены главы написаны?
export function chapterComplete(state, chapterId){
  const sc = scenesOfChapter(state, chapterId);
  return sc.length>0 && sc.every(s=>s.status==='done');
}

// Глава уже «закрыта» автором (стоп пройден)?
export function chapterClosed(state, chapterId){
  const ch = (state.structure||[]).find(n=>n.id===chapterId);
  return !!(ch && ch.closed);
}

// В режиме Режиссёр требуется «рука автора»: ≥1 абзац переписан вручную.
export function needsAuthorHand(state){ return state.project.mode==='director'; }

// Закрыть главу: пометить closed, суммаризировать главу в память.
export async function closeChapter(state, chapterId){
  const ch = (state.structure||[]).find(n=>n.id===chapterId);
  if(!ch) return;
  ch.closed = true;
  try{ await summarizeChapter(state, ch); }catch(e){ console.warn('chapter summary failed', e); }
  save();
}

// Следующая глава (для блокировки до закрытия предыдущей).
export function isChapterLocked(state, chapterId){
  const chapters = (state.structure||[]).filter(n=>n.type==='chapter');
  const idx = chapters.findIndex(c=>c.id===chapterId);
  if(idx<=0) return false;              // первая глава не блокируется
  return !chapters[idx-1].closed;        // заблокирована, пока предыдущая не закрыта
}
