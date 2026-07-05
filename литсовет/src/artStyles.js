// Готовые художественные стили для иллюстраций — чистые данные. genres[] —
// рыхлая, не эксклюзивная подсказка «подходит жанру» в UI (см. styles.js —
// та же роль для авторских стилей прозы). promptFragment — добавляется к
// промпту картинки в generateIllustrationFor() (illustrations.js), если стиль
// выбран. В отличие от авторских стилей прозы — ВЫБОР ОДИНОЧНЫЙ (у книги один
// визуальный стиль иллюстраций, не смесь нескольких).

export const ART_STYLES = [
  { id:'watercolor',   name:'Акварель',              blurb:'Мягкие цветовые растёки, видимая текстура бумаги.', genres:['роман','любовный роман','биографическая проза'], promptFragment:'watercolor illustration, soft color bleed, visible paper texture' },
  { id:'oil',          name:'Масляная живопись',     blurb:'Густые мазки, насыщенная текстура холста.', genres:['роман','исторический роман'], promptFragment:'oil painting, thick brushstrokes, rich canvas texture' },
  { id:'comic',        name:'Графический роман',     blurb:'Чёткий контур, драматичные тени, стиль комикса.', genres:['фантастика','приключения','юмористическая проза'], promptFragment:'comic book / graphic novel line art, bold ink outlines, dramatic shading' },
  { id:'lineart',      name:'Line art',              blurb:'Чистая минималистичная линия, без штриховки.', genres:['юмористическая проза','ироничный детектив'], promptFragment:'clean minimalist line art, single continuous line style, no shading' },
  { id:'sketch',       name:'Карандашный набросок',  blurb:'Штриховка, фактура блокнота для скетчей.', genres:['рассказ','биографическая проза'], promptFragment:'pencil sketch, cross-hatching, sketchbook texture' },
  { id:'flat',         name:'Плоская иллюстрация',   blurb:'Плоские формы, ограниченная палитра, вектор.', genres:['молодёжная фантастика','сказка'], promptFragment:'flat vector illustration, simple shapes, limited color palette' },
  { id:'fantasyart',   name:'Фэнтези-концепт-арт',   blurb:'Живописный, драматичное освещение, эпический масштаб.', genres:['фэнтези','ироничное фэнтези','приключения'], promptFragment:'fantasy concept art, painterly, dramatic lighting, epic scale' },
  { id:'vintage',      name:'Винтаж',                blurb:'Печатная фактура середины века, растровые точки.', genres:['исторический роман','детектив','альтернативная история'], promptFragment:'vintage book illustration, mid-century print texture, halftone dots' },
  { id:'noir',         name:'Нуар',                  blurb:'Высокий контраст, глубокие тени, драматичный свет.', genres:['детектив','триллер','тёмная романтика'], promptFragment:'film noir style, high contrast, deep shadows, dramatic chiaroscuro' },
  { id:'childrens',    name:'Детская книга',         blurb:'Округлые формы, мягкие цвета, тёплый и лёгкий тон.', genres:['сказка'], promptFragment:"children's picture book illustration, whimsical, soft rounded shapes" },
  { id:'steampunk',    name:'Стимпанк-гравюра',      blurb:'Штриховая гравюра, викторианская техническая иллюстрация.', genres:['альтернативная история','фэнтези'], promptFragment:'steampunk engraving style, cross-hatched linework, Victorian technical illustration' },
  { id:'cyberpunk',    name:'Киберпанк',             blurb:'Неоновые акценты, глянцевые футуристичные поверхности.', genres:['фантастика','триллер'], promptFragment:'cyberpunk digital art, neon accents, glossy futuristic surfaces' },
  { id:'gothic',       name:'Готика',                blurb:'Орнаментальная детализация, мрачная атмосфера.', genres:['ужасы','мистика','тёмная романтика'], promptFragment:'gothic illustration, ornate detail, moody atmosphere' },
];

export function artStyleMatchesGenre(style, genre){
  return !!genre && (style.genres||[]).includes(genre);
}
