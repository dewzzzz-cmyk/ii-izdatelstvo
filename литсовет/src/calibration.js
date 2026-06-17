// Калибровка порога Оценщика по вкусу автора (спека 6.1).
// Автор вслепую оценивает прозу; порог подтягивается к его среднему,
// чтобы «7 из 10» не висело без шкалы.

import { getState, save } from './state.js';

export function calibrationState(){
  const s = getState();
  s.global.calibration = s.global.calibration || { ratings: [] };
  return s.global.calibration;
}

// Сцены-кандидаты для слепой оценки: готовые, ещё не оценённые автором.
export function uncalibratedScenes(state){
  const rated = new Set((state.global.calibration?.ratings||[]).map(r=>r.sceneId));
  return (state.structure||[]).filter(n=>n.type==='scene' && n.status==='done' && n.text && !rated.has(n.id));
}

// Записать слепую оценку автора и подтянуть порог.
export function recordRating(sceneId, authorScore){
  const s = getState();
  const cal = calibrationState();
  const scene = (s.structure||[]).find(n=>n.id===sceneId);
  const evalScore = scene?.lastEval?.weighted ?? null;
  cal.ratings.push({ sceneId, authorScore, evalScore, at: Date.now() });
  if(cal.ratings.length > 50) cal.ratings.shift();

  // Подстройка порога: сравниваем средний балл автора со средним баллом Оценщика
  // по тем же сценам. Если автор строже — поднимаем порог, мягче — опускаем.
  const paired = cal.ratings.filter(r=>typeof r.evalScore==='number');
  if(paired.length >= 3){
    const aAvg = paired.reduce((a,r)=>a+r.authorScore,0)/paired.length;
    const eAvg = paired.reduce((a,r)=>a+r.evalScore,0)/paired.length;
    const diff = eAvg - aAvg; // >0: Оценщик добрее автора → поднять порог
    let t = s.global.evaluatorThreshold ?? 7;
    t = Math.max(5, Math.min(9, t + Math.sign(diff)*Math.min(1, Math.abs(diff)*0.5)));
    s.global.evaluatorThreshold = Math.round(t*10)/10;
    cal.lastAdjust = { authorAvg:Math.round(aAvg*10)/10, evalAvg:Math.round(eAvg*10)/10, threshold:s.global.evaluatorThreshold };
  }
  save();
  return cal.lastAdjust;
}
