// Всплывающие подсказки с задержкой 5 секунд перед показом.
// Любой элемент с атрибутом data-tip="текст" получает подсказку.

const DELAY = 5000; // мс — по требованию: 5 секунд hover перед показом
let _tip, _timer, _cur;

function ensureEl(){
  if(_tip) return _tip;
  _tip = document.createElement('div');
  _tip.className = 'tip-pop';
  _tip.style.display = 'none';
  document.body.appendChild(_tip);
  return _tip;
}

function show(target){
  const text = target.getAttribute('data-tip');
  if(!text) return;
  const el = ensureEl();
  el.textContent = text;
  el.style.display = 'block';
  const r = target.getBoundingClientRect();
  // позиционируем над элементом, при нехватке места — под ним
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
  const top = r.top - el.offsetHeight - 8;
  el.style.top = (top < 8 ? r.bottom + 8 : top) + 'px';
}
function hide(){ if(_tip) _tip.style.display='none'; clearTimeout(_timer); _cur=null; }

export function initTooltips(){
  document.addEventListener('mouseover', e=>{
    const t = e.target.closest('[data-tip]');
    if(!t || t===_cur) return;
    hide(); _cur = t;
    _timer = setTimeout(()=>{ if(_cur===t && document.body.contains(t)) show(t); }, DELAY);
  });
  document.addEventListener('mouseout', e=>{
    const t = e.target.closest('[data-tip]');
    if(t && t===_cur) hide();
  });
  // прячем при скролле/клике
  document.addEventListener('scroll', hide, true);
  document.addEventListener('mousedown', hide, true);
}
