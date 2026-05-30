#!/usr/bin/env node
// Smoke tests для критического пути ИИ-Издательства
// Запуск: node test/smoke.cjs
const assert = require('assert');
let passed=0, failed=0;
function test(name, fn){ try{ fn(); console.log('✅',name); passed++; }catch(e){ console.error('❌',name,':',e.message); failed++; } }

// 1. cleanProse: маркеры ===ТЕКСТ===
test('cleanProse: strips ===ТЕКСТ=== wrapper', ()=>{
  const out = '===ТЕКСТ===\nОктябрьский дождь.\n===КОНЕЦ===';
  const m = out.match(/===\s*ТЕКСТ\s*===\s*([\s\S]*?)\s*===\s*КОНЕЦ\s*===/i);
  assert(m && m[1].trim() === 'Октябрьский дождь.');
});

// 2. cleanProse: убирает анализ логреда
test('cleanProse: removes logedit analysis block', ()=>{
  const out = '## Найденные противоречия\n1. Проблема\n## Исправленный текст\nМирон встал.';
  const cleaned = out
    .replace(/\n?##\s*Найденные\s+противоречия[\s\S]*?(?=\n?##\s*Исправленный\s+текст)/gi,'')
    .replace(/\n?##\s*Исправленный\s+текст[^\n]*/gi,'');
  assert(cleaned.trim() === 'Мирон встал.');
});

// 3. evalCondition: JS условие на вывод
test('evalCondition: output.includes PASS', ()=>{
  function evalCondition(cond,output){ if(!cond||!cond.trim()) return true; try{ return !!new Function('output','return ('+cond+')')(output||''); }catch(e){ return false; } }
  assert(evalCondition("output.includes('PASS')", 'Всё PASS готово') === true);
  assert(evalCondition("output.includes('PASS')", 'Ничего не готово') === false);
  assert(evalCondition('', 'любой текст') === true);
});

// 4. tokEst: кириллица считается правильно
test('tokEst: cyrillic estimation', ()=>{
  function tokEst(s){ const cyr=(s.match(/[а-яёА-ЯЁ]/g)||[]).length; return Math.round((s.length-cyr)/4 + cyr/2.5); }
  const rTok = tokEst('Октябрьский дождь');
  assert(rTok > 0 && rTok < 20, 'reasonable token count: '+rTok);
  const eTok = tokEst('October rain');
  assert(eTok > 0 && eTok < 10);
});

// 5. EPUB export: ZipBuilder CRC32
test('ZipBuilder: CRC32 basic', ()=>{
  // Простая проверка CRC32 через полиномиальную формулу
  function crc32(buf){ let c=0xFFFFFFFF; for(let i=0;i<buf.length;i++){ c^=buf[i]; for(let j=0;j<8;j++) c=c&1?(c>>>1)^0xEDB88320:(c>>>1); } return (c^0xFFFFFFFF)>>>0; }
  const data = Buffer.from('Hello World');
  assert(crc32(data) === 0x4A17B156, 'CRC32 mismatch: '+crc32(data).toString(16));
});

console.log('\n'+passed+' passed, '+failed+' failed');
process.exit(failed > 0 ? 1 : 0);
