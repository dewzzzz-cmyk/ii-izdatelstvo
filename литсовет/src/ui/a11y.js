// Единый aria-live регион для статусных сообщений (генерация, ошибки) — вне
// перерендериваемых панелей. Панели стадий полностью пересобираются через
// innerHTML на каждом save()/рендере, а такое пересоздание узла с aria-live
// ненадёжно анонсируется скринридерами — нужен один persistent узел снаружи.
let _el;
function ensureEl(){
  if(_el) return _el;
  _el = document.createElement('div');
  _el.id = 'a11yStatus';
  _el.setAttribute('aria-live', 'polite');
  _el.setAttribute('role', 'status');
  _el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap';
  document.body.appendChild(_el);
  return _el;
}

// Анонсировать текст скринридеру. Сброс перед записью — иначе повтор той же
// строки подряд (напр. две одинаковые ошибки) не будет анонсирован повторно.
// setTimeout, не requestAnimationFrame — rAF приостанавливается в свёрнутой/
// фоновой вкладке, а статус должен долетать до AT и тогда тоже.
export function announce(text){
  const el = ensureEl();
  el.textContent = '';
  setTimeout(()=>{ el.textContent = text; }, 0);
}
