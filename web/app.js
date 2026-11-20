'use strict';
// Источник истины — дерево `root` (mdtree). Markdown в панели исходника — его текстовое представление.
const { Markmap, Transformer, builtInPlugins, defaultOptions } = window.markmap;
// ponytail: katex/hljs отключены — они тянут ассеты из CDN, а приложение офлайновое
const tf = new Transformer(builtInPlugins.filter((p) => !/katex|hljs/.test(p.name || '')));
// file: разрешаем (ссылки на диск); javascript:/vbscript:/data: — нет, кроме data:image
tf.md.validateLink = (u) => !/^\s*(javascript|vbscript|data):/i.test(u) || /^\s*data:image\//i.test(u);
const html = (t) => (t.includes('\n') ? tf.md.render(t) : tf.md.renderInline(t)) || '&nbsp;';

const $ = (id) => document.getElementById(id);
// перевод: mindmap.py кладёт словарь web/lang/<язык>.json в window.I18N; ключ — русская строка, нет словаря — русский
const T = window.I18N || {}, t = (s) => T[s] ?? s;
// macOS: в подписях, справке и учебной карте ⌘ ⌥ ⇧ вместо Ctrl Alt Shift (keydown понимает и Ctrl, и ⌘)
const MAC = /Mac/.test(navigator.platform);
const keys = (s) => (MAC ? s.replace(/Ctrl\+Shift\+/g, '⇧⌘').replace(/Ctrl\+?/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s);
document.querySelector('#help .hbox').innerHTML = keys(T['@helpHtml'] || document.querySelector('#help .hbox').innerHTML);
for (const b of document.querySelectorAll('#bar button, #help .hbox')) {
  if (b.title) b.title = keys(t(b.title));
  if (b.ariaLabel) b.ariaLabel = t(b.ariaLabel);
  if (b.tagName === 'BUTTON') b.textContent = t(b.textContent);
}
// учебная карта: задания-флажки, каждое выполняется прямо здесь
const TUTORIAL = `# Обучение
> Сделайте задание и кликните по его ☐. Карта учебная: правьте смело, Ctrl+Z всё вернёт.
> В поле правки видна разметка: «[ ] » в начале строки — это и есть флажок.

## 1. Правка текста
- [ ] Двойной клик по этой строке — правка прямо в узле, Enter — готово
- [ ] Кликните по ветке, чтобы выделить, и нажмите F2 — тоже правка

## 2. Новые ветки
- [ ] Выделите «Песочница» и нажмите Tab — появится дочерняя ветка, введите текст и Enter
- [ ] Выделите новую ветку и нажмите Enter — появится соседняя в режиме правки; Enter ещё раз, затем Delete — удалить её
- Песочница

## 3. Порядок веток
- [ ] Схватите «Третий» мышью и бросьте на верхнюю треть «Первого» — встанет перед ним
- [ ] Выделите «Второй» и нажмите Alt+↑ / Alt+↓ — то же с клавиатуры
- Первый
- Второй
- Третий

## 4. Список и заметка под веткой
- [ ] Выделите «Покупки» и нажмите Shift+Enter, напишите пункты (новый — Shift+Enter), Enter — готово
- [ ] Правый клик по «Покупки» → «Добавить заметку»
- Покупки

## 5. Флажки и нумерация
- [ ] Правый клик по «Шаги» → «Добавить флажок»
- [ ] Правый клик по «Шаги» → «Ветки: нумерация» — пункты станут 1, 2
- Шаги
  - раз
  - два

## 6. Ссылки
- [ ] Клик по [ссылке на раздел 1](#1-правка-текста) — карта перейдёт к ветке
- [ ] [Сайт markmap](https://markmap.js.org) — откроется в браузере
- [ ] Бросьте файл из файлового менеджера на «Песочница» — появится ветка-ссылка

## 7. Исходник Markdown
- [ ] Нажмите Ctrl+E — рядом откроется Markdown; поменяйте строку там — карта обновится
- [ ] Ещё раз Ctrl+E — скрыть

## 8. Сохранение и справка
- [ ] Ctrl+S — сохранить карту (спросит имя), Ctrl+P — экспорт в PDF
- [ ] F1 или «?» — справка: все клавиши и синтаксис
`;
const src = $('src'), svg = $('map'), menu = $('menu');
const PALETTE = ['#e15759', '#f28e2b', '#edc948', '#59a14f', '#76b7b2', '#4e79a7', '#b07aa1', '#ff9da7', '#9c755f', '#555555'];
const HELP = `# Mind Map

## Мышь
- двойной клик — правка названия или списка
- правый клик — меню ветки
- клик по кружку — свернуть ветку
- колесо, щипок тачпада, Ctrl+= / Ctrl+- — масштаб; тащить ветку — порядок и уровень, пустое место — сдвиг

## Клавиши
- Tab / Enter — дочерняя / соседняя ветка
- Shift+Enter — список под узлом (строка = пункт, «1. » в начале — нумерованный)
- F2 — правка, Del — удалить
- стрелки — навигация, Alt+стрелки — перемещение
- Ctrl+E — исходник, Ctrl+P — PDF
- F1 — справка, «Файл → Обучение» — учебная карта

## Список под узлом
> - мелкий шрифт под названием
> - ▾ сворачивает, ▸ разворачивает
> - в Markdown: «> - пункт»

## Ссылки и флажки
> Заметка под узлом — строки «> текст» в Markdown.
- [сайт](https://markmap.js.org) — в браузере
- [папка](~/) — переход в файловый менеджер, [ветка](#мышь) — к узлу
- файл или ссылку можно бросить на узел
- [ ] флажок — клик ставит отметку
`;

let root, file = null, dirty = false, sel = null, clip = null, editing = null;
let lastMd = '', undo = [], redo = [], parents = new Map();

// ---------- мост к оболочке (GTK / macOS), команды — web/BRIDGE.md ----------
const bridge = window.bridge = {
  n: 0, p: {},
  call(cmd, args = {}) {
    const h = window.webkit?.messageHandlers?.app;
    if (!h) return Promise.resolve(null);
    return new Promise((r) => { const id = ++this.n; this.p[id] = r; h.postMessage(JSON.stringify({ id, cmd, args })); });
  },
  reply(id, v) { this.p[id]?.(v); delete this.p[id]; },
};

// ---------- отрисовка ----------
const mm = new Markmap(svg, { duration: 250, color: (d) => d.payload?.color || defaultOptions.color(d) });
mm.svg.on('dblclick.zoom', null);
// масштаб в f раз вокруг точки окна (щипок тачпада приходит из GTK) или вокруг центра карты (клавиши)
window.zoomBy = (f, x, y) => {
  const r = svg.getBoundingClientRect();
  mm.svg.call(mm.zoom.scaleBy, f, x == null ? null : [x - r.left, y - r.top]);
};
// WKWebView (macOS): щипок приходит жестом gesture*, а не колесом
let pinch = 1;
document.addEventListener('gesturestart', (e) => { e.preventDefault(); pinch = 1; });
document.addEventListener('gesturechange', (e) => { e.preventDefault(); zoomBy(e.scale / pinch, e.clientX, e.clientY); pinch = e.scale; });
// список под чертой: место в раскладке — по полной высоте узла (название + список),
// а «якорь» (черта, кружок, связи) — по низу названия; список под чертой.
// foreignObject растягиваем на полную высоту: WebKit при сдвиге полотна перерисовывает только
// его границы, и вылезающий за них список оставлял следы на старом месте
const relayout = mm._relayout.bind(mm);
mm._relayout = () => {
  relayout();
  const full = [];
  mm.g.selectAll('g.markmap-node > foreignObject').each(function (d) {
    const t = this.querySelector('.mm-notes') && this.querySelector('.mm-t');
    if (t) { full.push([this, d.state.size[1]]); d.state.rect.height = t.offsetHeight; }
  });
  // renderData ставит height = rect.height синхронно сразу после _relayout — перебиваем следом
  queueMicrotask(() => full.forEach(([fo, h]) => fo.setAttribute('height', h)));
};
mm.handleClick = async (e, d) => {   // клик по кружку: свернуть/развернуть и записать в модель
  await mm.toggleNode(d, e.ctrlKey || e.metaKey);   // на Mac Ctrl+клик — контекстное меню, поэтому и ⌘
  (function sync(x) { x.payload.ref.fold = !!x.payload.fold; x.children?.forEach(sync); })(mm.state.data);
  commit(false);
};

// под названием мелким шрифтом: заметка (абзац) и список, ▾/▸ сворачивает список
function notesHtml(n) {
  if (!n.notes?.length && !n.note) return '';
  const para = n.note ? `<div class="mm-para">${html(n.note)}</div>` : '';
  const items = !n.notes?.length ? '' : `<div class="mm-items"><span class="mm-nt" data-nt title="${t('Свернуть/развернуть список')}">${n.notesFold ? '▸' : '▾'} ${n.notes.length}</span>`
    + (n.notesFold ? '' : (n.notesOl ? `<ol start="${n.notesOl}">` : '<ul>') + n.notes.map((t) => `<li>${tf.md.renderInline(t) || '&nbsp;'}</li>`).join('')
      + (n.notesOl ? '</ol>' : '</ul>')) + '</div>';
  return `<div class="mm-notes">${para}${items}</div>`;
}
const CB_RE = /^\[([ xX])\]\s+/;   // флажок: «- [ ] дело», «- [x] сделано»
function titleHtml(n, num) {   // num — номер в нумерованном списке родителя
  const cb = n.text.match(CB_RE), on = cb && cb[1] !== ' ';
  return `<div class="mm-t${on ? ' mm-done' : ''}">` + (num ? `<span class="mm-num">${num}.</span> ` : '')
    + (cb ? `<span class="mm-cb" data-cb title="${t('Отметить')}">${on ? '☑' : '☐'}</span> ${html(n.text.slice(cb[0].length))}` : html(n.text)) + '</div>';
}
function toINode(n, inh, num) {
  const color = n.color || inh;
  return { content: titleHtml(n, num) + notesHtml(n), children: n.children.map((c, i) => toINode(c, color, n.ol && n.ol + i)),
    payload: { ref: n, fold: n.fold && n.children.length ? 1 : 0, color } };
}
async function draw(fit) {
  parents = new Map();
  (function idx(n) { for (const c of n.children) { parents.set(c, n); idx(c); } })(root);
  await mm.setData(toINode(root));
  if (fit) await mm.fit();
  await highlight();
}
function findD(n) {
  let r = null;
  (function w(d) { if (d.payload.ref === n) r = d; else d.children?.forEach(w); })(mm.state.data);
  return r;
}
const findEl = (n) => { const d = findD(n); return [...svg.querySelectorAll('g.markmap-node')].find((g) => g.__data__ === d); };
const highlight = () => mm.setHighlight((sel && findD(sel)) || null);

// ---------- состояние и история ----------
function setDirty(v) { dirty = v; setBase(); bridge.call('state', { dirty, name: file?.name || t('Без имени') }); }
function commit(render = true) {
  const md = mdtree.serialize(root);
  if (md === lastMd) return Promise.resolve();
  undo.push(lastMd); redo = []; lastMd = src.value = md; setDirty(true);
  return render ? draw() : Promise.resolve();
}
function restore(md) { root = mdtree.parse(md); lastMd = src.value = md; sel = null; setDirty(true); draw(); }
function undoFn() { if (undo.length) { redo.push(lastMd); restore(undo.pop()); } }
function redoFn() { if (redo.length) { undo.push(lastMd); restore(redo.pop()); } }

let srcTimer;
function flushSrc() {
  clearTimeout(srcTimer);
  if (src.value === lastMd) return;
  undo.push(lastMd); redo = []; lastMd = src.value; root = mdtree.parse(lastMd); sel = null; setDirty(true); draw();
}
src.addEventListener('input', () => { clearTimeout(srcTimer); srcTimer = setTimeout(flushSrc, 300); });
// граница исходник | карта: тянуть мышью; исходнику ≥ 120px, карте ≥ 200px
$('split').addEventListener('pointerdown', (e) => {
  const bar = e.currentTarget, left = src.getBoundingClientRect().left;
  const move = (ev) => { src.style.width = Math.max(120, Math.min(ev.clientX - left, innerWidth - left - 200)) + 'px'; };
  e.preventDefault(); bar.setPointerCapture(e.pointerId); bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
});

function loadMd(md, f) {
  file = f; root = mdtree.parse(md); lastMd = src.value = md; undo = []; redo = []; sel = null;
  setDirty(false);
  return draw(true);
}
const fromTree = (t, depth = 0) => ({ text: t.text || '', kind: depth < 2 ? 'h' : 'li', color: t.color || undefined,
  fold: !!t.fold, ...(t.notes?.length && { notes: t.notes }), children: (t.children || []).map((c) => fromTree(c, depth + 1)) });
// ponytail: в .mm/.opml/.xmind одно поле заметок — заметка-абзац уходит туда первыми строками списка (без потерь, но без различия)
const toTree = (n) => ({ text: n.text, color: n.color || null, fold: !!n.fold,
  notes: [...(n.note ? n.note.split('\n') : []), ...(n.notes || [])], children: n.children.map(toTree) });
const extOf = (p) => /\.[^./]*$/.exec(p)?.[0].toLowerCase() || '';
// файл от оболочки: {path, name, data: base64 | null — файла ещё нет}
async function loadFile(r) {
  let md;
  try {
    const b = r.data == null ? null : formats.unb64(r.data), f = formats[extOf(r.path)];
    md = !b ? `# ${r.name.replace(/(\.mm)?\.[^.]*$/, '')}\n` : f ? mdtree.serialize(fromTree(await f.read(b)))
      : new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) { return bridge.call('error', { text: `${r.name}: ${e.message}` }); }   // карта в редакторе цела
  return loadMd(md, { path: r.path, name: r.name });
}
window.openFile = async (r) => { if (await confirmDiscard()) await loadFile(r); };   // файл из Finder при открытом окне

// ---------- операции над ветками ----------
const newNode = (kind = 'li') => ({ text: t('Новая ветка'), kind, children: [] });
async function added(c) {
  sel = c; await commit();
  const d = findD(c); if (d) await mm.ensureVisible(d);
  startEdit(c);
}
function addChild(n) { const c = newNode(); n.children.push(c); n.fold = false; added(c); }
function addSibling(n) {
  const p = parents.get(n); if (!p) return addChild(n);
  const c = newNode(n.kind === 'h' ? 'h' : 'li');
  p.children.splice(p.children.indexOf(n) + 1, 0, c); added(c);
}
function remove(n) {
  const p = parents.get(n); if (!p) return;
  const i = p.children.indexOf(n); p.children.splice(i, 1);
  sel = p.children[i] || p.children[i - 1] || p; commit();
}
function move(n, dir) {
  const p = parents.get(n); if (!p) return;
  const i = p.children.indexOf(n), j = i + dir;
  if (j < 0 || j >= p.children.length) return;
  [p.children[i], p.children[j]] = [p.children[j], p.children[i]]; commit();
}
function outdent(n) {
  const p = parents.get(n), g = p && parents.get(p); if (!g) return;
  p.children.splice(p.children.indexOf(n), 1); g.children.splice(g.children.indexOf(p) + 1, 0, n); commit();
}
function indent(n) {
  const p = parents.get(n); if (!p) return;
  const i = p.children.indexOf(n), prev = p.children[i - 1]; if (!prev) return;
  p.children.splice(i, 1); prev.children.push(n); prev.fold = false; commit();
}
function setColor(n, c) { if (c) n.color = c; else delete n.color; commit(); }
function toggle(n) { if (n.children.length) { n.fold = !n.fold; commit(); } }
function foldAll(v) {
  (function w(n, top) { if (!top && n.children.length) n.fold = v; n.children.forEach((c) => w(c)); })(root, true);
  commit();
}
// нумеровать можно только пункты списка: заголовки и абзацы среди дочерних становятся пунктами
function setOl(n) { if (n.ol) delete n.ol; else { n.ol = 1; n.children.forEach((c) => { c.kind = 'li'; }); } commit(); }
function toggleCheck(n) { n.text = n.text.replace(CB_RE, (m, c) => `[${c === ' ' ? 'x' : ' '}] `); commit(); }
function setCheck(n, on) { n.text = on ? '[ ] ' + n.text : n.text.replace(CB_RE, ''); commit(); }
function toggleNotes(n) { if (n.notes?.length) { n.notesFold = !n.notesFold; commit(); } }
const copy = (n) => { clip = structuredClone(n); };
const cut = (n) => { copy(n); remove(n); };
function paste(n) { if (!clip) return; const c = structuredClone(clip); n.children.push(c); n.fold = false; sel = c; commit(); }
function pickColor(n) {
  const inp = Object.assign(document.createElement('input'), { type: 'color', value: n.color || '#4e79a7' });
  inp.addEventListener('change', () => setColor(n, inp.value));
  inp.click();
}

// ---------- правка текста прямо на карте ----------
// редактируется сам элемент узла (contenteditable): шрифт, масштаб и сдвиг полотна — как у карты
const div = (cls) => Object.assign(document.createElement('div'), { className: cls });
function startEdit(n, list = false) {   // list: true — весь список одним полем (строка = пункт), 'note' — заметка, иначе название
  const el = findEl(n); if (!el) return;
  const cls = list === 'note' ? 'mm-para' : list ? 'mm-items' : 'mm-t';
  let box = el.querySelector('.' + cls), created = null;
  if (!box) {   // заметки или списка ещё нет — пустое поле под чертой
    box = div(cls);
    let host = el.querySelector('.mm-notes');
    if (!host) { host = created = div('mm-notes'); el.querySelector('.mm-t').after(host); } else created = box;
    if (cls === 'mm-para') host.prepend(box); else host.append(box);
  }
  editing = { n, list, box, created, html: box.innerHTML };
  box.textContent = list === 'note' ? n.note || '' : list ? (n.notes || []).map((t, i) => (n.notesOl ? `${n.notesOl + i}. ` : '') + t).join('\n') : n.text;
  box.dataset.ph = list === 'note' ? t('Заметка · Shift+Enter — новая строка, Enter — готово') : list ? t('Пункт на строку · Shift+Enter — новая строка, Enter — готово') : '';
  box.classList.add('mm-edit');
  box.contentEditable = 'plaintext-only';
  box.onmousedown = (e) => e.stopPropagation();   // не отдавать d3-zoom: иначе мышью не поставить каретку
  box.focus();
  const r = document.createRange(); r.selectNodeContents(box); if (list) r.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(r);
}
function endEdit(ok) {
  if (!editing) return;
  const { n, list, box, created, html } = editing; editing = null;
  const v = box.innerText;
  box.removeAttribute('contenteditable'); box.classList.remove('mm-edit'); box.onmousedown = null;
  if (created) created.remove(); else box.innerHTML = html;   // вид — из модели; изменения придут через commit
  if (!ok) return;
  if (!list) { const t = v.trim(); if (t !== n.text) { n.text = t; delete n.virtual; commit(); } return; }
  const lines = v.split('\n').map((l) => l.trim()).filter(Boolean);
  if (list === 'note') {
    const t = lines.join('\n'); if (t === (n.note || '')) return;
    if (t) n.note = t; else delete n.note;
    return commit();
  }
  const items = lines.map((l) => l.replace(/^(?:[-*+]|\d{1,9}[.)])\s+/, '')).filter(Boolean);
  const ol = lines[0]?.match(/^(\d{1,9})[.)]\s/), olv = ol ? +ol[1] : undefined;   // «1. » в первой строке — нумерованный
  if (items.join('\n') === (n.notes || []).join('\n') && olv === n.notesOl) return;
  if (olv) n.notesOl = olv; else delete n.notesOl;
  if (items.length) { n.notes = items; n.notesFold = false; } else { delete n.notes; delete n.notesFold; delete n.notesOl; }   // пустое поле = убрать список
  commit();
}
svg.addEventListener('focusout', (e) => { if (e.target === editing?.box) endEdit(true); });
svg.addEventListener('keydown', (e) => {
  if (!editing || e.key === 'F1') return;   // F1 — справка: правку завершит toggleHelp
  e.stopPropagation();
  // название, список, заметка: Enter — готово, Shift+Enter — новая строка (новый пункт списка)
  const done = e.key === 'Enter' && !e.shiftKey;
  if (done) { e.preventDefault(); endEdit(true); }
  else if (e.key === 'Escape') endEdit(false);
});

// ---------- ссылки, картинки, перетаскивание ----------
// относительные пути (картинки) — от папки карты
const base = document.head.appendChild(document.createElement('base'));
function setBase() {
  const d = file?.path?.slice(0, file.path.lastIndexOf('/') + 1);
  if (d) base.href = 'file://' + d.split('/').map(encodeURIComponent).join('/'); else base.removeAttribute('href');
}
const slug = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
const plain = (t) => { const d = div(''); d.innerHTML = html(t.replace(CB_RE, '')); return d.textContent; };
async function followLink(href) {
  if (href.startsWith('#')) {   // [текст](#название-узла): переход к узлу, свёрнутые предки раскрываются
    let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* как есть */ }
    let n = null; const s = slug(id);
    (function w(x) { if (!n && slug(plain(x.text)) === s) n = x; else x.children.forEach(w); })(root);
    if (!n) return;
    let p = parents.get(n), open = false;
    for (; p; p = parents.get(p)) if (p.fold) { p.fold = false; open = true; }
    if (open) await commit();
    return go(n);
  }
  const r = await bridge.call('link', { href, base: file?.path || null });   // сайт — браузер, файл — файловый менеджер, карта — сюда
  if (r && await confirmDiscard()) loadFile(r);
}
// картинка догрузилась — пересчитать размеры узлов (markmap меряет их при отрисовке)
let imgTimer;
svg.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') { clearTimeout(imgTimer); imgTimer = setTimeout(() => mm.renderData(), 50); } }, true);
// брошенный файл/ссылка -> дочерняя ветка-ссылка; путь внутри папки карты — относительный
window.dropUris = (uris, n = sel || root) => {
  const dir = file?.path?.slice(0, file.path.lastIndexOf('/') + 1);
  for (const u of uris) {
    let text = `<${u}>`;
    if (u.startsWith('file:')) {
      const p = decodeURIComponent(new URL(u).pathname), rel = dir && p.startsWith(dir) ? p.slice(dir.length) : p;
      const name = (p.split('/').filter(Boolean).pop() || p).replace(/[[\]]/g, '\\$&'), href = /[\s()<>]/.test(rel) ? `<${rel}>` : rel;
      text = (/\.(png|jpe?g|gif|webp|svg)$/i.test(p) ? '!' : '') + `[${name}](${href})`;
    }
    n.children.push({ text, kind: 'li', children: [] });
  }
  n.fold = false; sel = n.children.at(-1); commit();
};
document.addEventListener('dragover', (e) => { if (e.target !== src) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (e.target === src) return;
  e.preventDefault();
  const uris = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => /^[a-z][\w+.-]*:\S+$/i.test(l));
  if (uris.length) dropUris(uris, nodeAt(e) || root);
});

// ---------- мышь ----------
const nodeAt = (e) => e.target.closest?.('g.markmap-node')?.__data__.payload.ref;
// где внутри узла: false — название, true — список, 'note' — заметка
const inNotes = (e) => (e.target.closest?.('.mm-para') ? 'note' : !!e.target.closest?.('.mm-notes'));
svg.addEventListener('click', (e) => {
  sel = nodeAt(e) || null;
  const a = e.target.closest?.('a[href]');
  if (a) { e.preventDefault(); highlight(); followLink(a.getAttribute('href')); }
  else if (sel && e.target.closest('[data-nt]')) toggleNotes(sel);
  else if (sel && e.target.closest('[data-cb]')) toggleCheck(sel);
  else highlight();
});
// capture: markmap глушит всплытие dblclick на тексте узла (foreignObject)
svg.addEventListener('dblclick', (e) => {
  if (performance.now() - helpClosed < 600) return;   // двойной клик мимо справки: первый закрыл её, второй — не правка
  const n = nodeAt(e);
  if (!n || e.target.closest('[data-nt], [data-cb], a') || editing?.box.contains(e.target)) return;   // в поле — выделение слова
  sel = n; highlight(); startEdit(n, inNotes(e));
}, true);
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const n = nodeAt(e);
  if (!n) return showMenu(canvasMenu(), e);
  sel = n; highlight();
  const w = inNotes(e);
  showMenu(w ? [{ t: w === 'note' ? t('Изменить заметку') : t('Изменить список'), k: t('Двойной клик'), f: () => startEdit(n, w) }, '-', ...nodeMenu(n)] : nodeMenu(n), e);
});

// ---------- «схватил и тащи»: порядок и уровень веток ----------
// верхняя треть названия цели — вставить перед ней, нижняя — после, середина — дочерней
let drag = null, noClick = false;
const mark = document.body.appendChild(div('mm-drop'));
svg.addEventListener('mousedown', (e) => {
  noClick = false;
  if (e.button !== 0 || editing || !e.target.closest('foreignObject') || e.target.closest('a, [data-nt], [data-cb]')) return;
  const n = nodeAt(e); if (!n || !parents.get(n)) return;   // корень не таскается — за него двигается полотно
  e.stopPropagation();   // не отдавать d3-zoom: за ветку тащится ветка, а не полотно
  drag = { n, x: e.clientX, y: e.clientY };
}, true);
function dropAt(e) {
  const g = document.elementFromPoint(e.clientX, e.clientY)?.closest('g.markmap-node'); if (!g) return null;
  const t = g.__data__.payload.ref;
  for (let x = t; x; x = parents.get(x)) if (x === drag.n) return null;   // в себя и в своих потомков нельзя
  const r = g.querySelector('.mm-t').getBoundingClientRect(), k = (e.clientY - r.top) / r.height;
  const where = !parents.get(t) ? 'in' : k < 1 / 3 ? 'before' : k > 2 / 3 ? 'after' : 'in';
  const y = where === 'before' ? r.top - 3 : g.querySelector('foreignObject').getBoundingClientRect().bottom + 1;   // «после» — под списком
  Object.assign(mark.style, { display: 'block', left: r.left - 4 + 'px', width: r.width + 8 + 'px',
    top: (where === 'in' ? r.top - 3 : y) + 'px', height: where === 'in' ? r.height + 6 + 'px' : '0' });
  mark.className = 'mm-drop ' + where;
  return { t, where };
}
function endDrag() { clearInterval(drag?.scroll); drag?.ghost?.remove(); mark.style.display = 'none'; document.body.classList.remove('dragging'); drag = null; }
// автопрокрутка: курсор ближе EDGE к краю полотна — полотно едет туда, чем ближе, тем быстрее
const EDGE = 40, SPEED = 18;   // px зоны, px за такт (~60 в секунду)
function autoScroll() {
  const r = svg.getBoundingClientRect(), { clientX: x, clientY: y } = drag.at;
  const v = (d) => (d < EDGE ? SPEED * (1 - Math.max(d, 0) / EDGE) : 0);
  const dx = v(x - r.left) - v(r.right - x), dy = v(y - r.top) - v(r.bottom - y);
  if (!dx && !dy) return;
  const k = d3.zoomTransform(svg).k;
  mm.svg.call(mm.zoom.translateBy, dx / k, dy / k);   // translateBy — в единицах карты, а сдвиг нужен в пикселях экрана
  drag.to = dropAt(drag.at);   // цели под курсором сместились
  if (!drag.to) mark.style.display = 'none';
}
document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (!(e.buttons & 1)) return endDrag();   // кнопку отпустили за окном
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;   // ещё клик, а не перетаскивание
    drag.ghost = document.body.appendChild(div('mm-ghost')); drag.ghost.textContent = plain(drag.n.text);
    document.body.classList.add('dragging'); getSelection().removeAllRanges();
  }
  Object.assign(drag.ghost.style, { left: e.clientX + 12 + 'px', top: e.clientY + 8 + 'px' });
  drag.at = { clientX: e.clientX, clientY: e.clientY };
  drag.scroll ||= setInterval(autoScroll, 16);
  drag.to = dropAt(e);
  if (!drag.to) mark.style.display = 'none';
});
document.addEventListener('mouseup', () => {
  if (!drag) return;
  const { n, ghost, to } = drag; endDrag();
  if (!ghost) return;
  noClick = true;   // отпускание после перетаскивания — не клик по узлу под курсором
  if (to) moveTo(n, to);
});
// выделенный текст узла браузер тащит сам (нативный drag) — тогда mousemove не приходят; пока тащим ветку — запрещено
svg.addEventListener('dragstart', (e) => { if (drag) e.preventDefault(); });
svg.addEventListener('click', (e) => {
  if (noClick || performance.now() - helpClosed < 600) { noClick = false; e.stopImmediatePropagation(); }
}, true);
function moveTo(n, { t, where }) {
  const p = parents.get(n); p.children.splice(p.children.indexOf(n), 1);
  if (where === 'in') {
    const sib = t.children[0]; t.children.push(n); t.fold = false; n.kind = sib?.kind || 'li';
  } else {
    const q = parents.get(t); q.children.splice(q.children.indexOf(t) + (where === 'after'), 0, n); n.kind = t.kind;
  }
  sel = n; commit();   // то же место — commit ничего не запишет
}

// ---------- контекстное меню ----------
function nodeMenu(n) {
  const p = parents.get(n), i = p ? p.children.indexOf(n) : -1;
  const sw = document.createElement('div'); sw.className = 'sw';
  for (const c of PALETTE) {
    const s = document.createElement('span'); s.style.background = c; s.title = c;
    s.onclick = () => { hideMenu(); setColor(n, c); }; sw.append(s);
  }
  return [
    { t: t('Добавить дочернюю ветку'), k: 'Tab', f: () => addChild(n) },
    { t: t('Добавить соседнюю ветку'), k: 'Enter', f: () => addSibling(n), dis: !p },
    { t: t('Переименовать'), k: 'F2', f: () => startEdit(n) },
    { t: n.notes?.length ? t('Изменить список') : t('Добавить список'), k: 'Shift+Enter', f: () => startEdit(n, true) },
    { t: n.notesFold ? t('Развернуть список') : t('Свернуть список'), f: () => toggleNotes(n), dis: !n.notes?.length },
    { t: n.notesOl ? t('Список: маркеры') : t('Список: нумерация'), f: () => { if (n.notesOl) delete n.notesOl; else n.notesOl = 1; commit(); }, dis: !n.notes?.length },
    { t: n.ol ? t('Ветки: маркеры') : t('Ветки: нумерация'), f: () => setOl(n), dis: !n.children.length },
    { t: n.note ? t('Изменить заметку') : t('Добавить заметку'), f: () => startEdit(n, 'note') },
    { t: CB_RE.test(n.text) ? t('Убрать флажок') : t('Добавить флажок'), f: () => setCheck(n, !CB_RE.test(n.text)) },
    '-', { t: t('Цвет ветки'), dis: true }, { el: sw },
    { t: t('Другой цвет…'), f: () => pickColor(n) },
    { t: t('Сбросить цвет'), f: () => setColor(n, null), dis: !n.color },
    '-',
    { t: n.fold ? t('Развернуть') : t('Свернуть'), k: t('Пробел'), f: () => toggle(n), dis: !n.children.length },
    { t: t('Переместить вверх'), k: 'Alt+↑', f: () => move(n, -1), dis: i <= 0 },
    { t: t('Переместить вниз'), k: 'Alt+↓', f: () => move(n, 1), dis: !p || i === p.children.length - 1 },
    { t: t('Повысить уровень'), k: 'Alt+←', f: () => outdent(n), dis: !p || !parents.get(p) },
    { t: t('Понизить уровень'), k: 'Alt+→', f: () => indent(n), dis: i <= 0 },
    '-',
    { t: t('Копировать ветку'), k: 'Ctrl+C', f: () => copy(n) },
    { t: t('Вырезать ветку'), k: 'Ctrl+X', f: () => cut(n), dis: !p },
    { t: t('Вставить как дочернюю'), k: 'Ctrl+V', f: () => paste(n), dis: !clip },
    '-',
    { t: t('Удалить ветку'), k: 'Del', f: () => remove(n), dis: !p },
  ];
}
const fileMenu = () => [
  { t: t('Справка'), k: 'F1', f: cmds.help },
  { t: t('Обучение'), f: cmds.tutorial },
  '-',
  { t: t('Новый'), k: 'Ctrl+N', f: cmds.new },
  { t: t('Открыть…'), k: 'Ctrl+O', f: cmds.open },
  '-',
  { t: t('Сохранить'), k: 'Ctrl+S', f: cmds.save },
  { t: t('Сохранить как…'), k: 'Ctrl+Shift+S', f: cmds.saveAs },
  '-',
  { t: t('Экспорт в PDF…'), k: 'Ctrl+P', f: cmds.pdf },
  '-',
  { t: t('Выход'), k: 'Ctrl+Q', f: cmds.quit },
];
const canvasMenu = () => [
  { t: t('Вписать в окно'), k: 'Ctrl+0', f: cmds.fit },
  { t: t('Развернуть всё'), f: () => foldAll(false) },
  { t: t('Свернуть всё'), f: () => foldAll(true) },
  '-',
  { t: src.classList.contains('hidden') ? t('Показать исходник') : t('Скрыть исходник'), k: 'Ctrl+E', f: cmds.toggleSrc },
  { t: t('Экспорт в PDF…'), k: 'Ctrl+P', f: cmds.pdf },
];
function showMenu(items, e) {
  menu.replaceChildren(); menu.dataset.owner = '';
  for (const it of items) {
    if (it === '-') { menu.append(document.createElement('hr')); continue; }
    if (it.el) { menu.append(it.el); continue; }
    const d = document.createElement('div');
    d.className = 'it' + (it.dis ? ' dis' : '');
    d.append(Object.assign(document.createElement('span'), { textContent: it.t }),
      Object.assign(document.createElement('kbd'), { textContent: keys(it.k || '') }));
    d.onclick = () => { hideMenu(); it.f(); };
    menu.append(d);
  }
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(0, Math.min(e.clientX, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(0, Math.min(e.clientY, innerHeight - r.height - 4)) + 'px';
}
const hideMenu = () => { menu.style.display = 'none'; };
// capture: d3-zoom на холсте глушит всплытие mousedown
document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target) && e.target.id !== 'fileBtn') hideMenu(); }, true);
window.addEventListener('blur', hideMenu);

// ---------- файлы и экспорт ----------
const confirmDiscard = async () => !dirty || await bridge.call('confirm', { text: t('Несохранённые изменения будут потеряны. Продолжить?') });
async function write(path) {
  flushSrc();
  const f = formats[extOf(path)], data = f ? f.write(toTree(root)) : new TextEncoder().encode(lastMd);
  const r = await bridge.call('save', { path, data: formats.b64(data) });
  if (r) { file = r; setDirty(false); }
}
async function exportPdf(path) {
  const g = mm.g.node().getBBox(), s = mm.state.rect, pad = 20;
  const b = { x: Math.min(g.x, s.x1), y: Math.min(g.y, s.y1) };
  b.width = Math.max(g.x + g.width, s.x2) - b.x; b.height = Math.max(g.y + g.height, s.y2) - b.y;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelector('g').removeAttribute('transform');
  clone.querySelector('.markmap-highlight')?.replaceChildren();
  const w = b.width + 2 * pad, h = b.height + 2 * pad;
  // размер страницы задаёт оболочка (1 CSS px = 0.2646 мм); viewBox вписывает карту в неё
  clone.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${w} ${h}`);
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  $('print').replaceChildren(clone);
  await bridge.call('pdf', { path, w, h, name: (file?.name || 'mindmap').replace(/\.[^.]+$/, '') + '.pdf' });
  $('print').replaceChildren();
}
const cmds = {
  async new() { if (await confirmDiscard()) loadMd(`# ${t('Новая карта')}\n\n- ${t('Идея')} 1\n- ${t('Идея')} 2\n`, null); },
  async open() { if (!(await confirmDiscard())) return; const r = await bridge.call('open'); if (r) loadFile(r); },
  async save() { if (file) await write(file.path); else await cmds.saveAs(); },
  async saveAs() { const p = await bridge.call('save_dialog', { name: file?.name || 'mindmap.mm.md' }); if (p) await write(p); },
  pdf: () => exportPdf(null),
  toggleSrc() { src.classList.toggle('hidden'); $('srcBtn').classList.toggle('on'); if (!src.classList.contains('hidden')) src.focus(); },
  file() {   // повторный клик по «Файл» закрывает меню
    if (menu.style.display === 'block' && menu.dataset.owner === 'file') return hideMenu();
    const r = $('fileBtn').getBoundingClientRect();
    showMenu(fileMenu(), { clientX: r.left, clientY: r.bottom + 2 }); menu.dataset.owner = 'file';
  },
  help: () => toggleHelp(),
  async tutorial() { if (await confirmDiscard()) { toggleHelp(false); loadMd(keys(T['@tutorial'] || TUTORIAL), null); } },   // не файл: «Сохранить» спросит имя
  quit: () => bridge.call('quit'),   // закрытие окна в оболочке спросит про несохранённое
  fit: () => mm.fit(),
  zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8),
  undo: undoFn, redo: redoFn,
};
document.querySelectorAll('#bar button, #help [data-cmd]').forEach((b) => { b.onclick = () => cmds[b.dataset.cmd](); });

// ---------- справка (F1) ----------
const help = $('help');
let helpClosed = 0;
function toggleHelp(v = help.hidden) {
  help.hidden = !v;
  $('bar').inert = $('main').inert = v;   // фокус (Tab) не уходит под затемнение
  if (v) { hideMenu(); if (editing) endEdit(true); help.querySelector('.hbox').focus(); }
}
// клик мимо окна; второй клик двойного (если он был) карта не получает — ни правки, ни смены выделения
help.addEventListener('click', (e) => { if (e.target === help) { toggleHelp(false); helpClosed = performance.now(); } });
help.querySelector('.x').onclick = () => toggleHelp(false);

// ---------- клавиатура ----------
document.addEventListener('keydown', (e) => {
  if (!help.hidden) {   // справка поверх: клавиши карты не действуют
    if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); toggleHelp(false); }
    return;
  }
  if (e.key === 'F1') { e.preventDefault(); return toggleHelp(true); }
  if (e.key === 'Escape') { hideMenu(); endDrag(); }
  const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (c) {
    const m = { n: cmds.new, o: cmds.open, s: e.shiftKey ? cmds.saveAs : cmds.save, p: cmds.pdf, q: cmds.quit, e: cmds.toggleSrc, 0: cmds.fit,
      '=': cmds.zoomIn, '+': cmds.zoomIn, '-': cmds.zoomOut }[k];
    if (m) { e.preventDefault(); m(); return; }
  }
  if (e.target === src || editing) return;   // в текстовых полях — штатное поведение
  const n = sel, p = n && parents.get(n);
  const act = c ? { z: e.shiftKey ? redoFn : undoFn, y: redoFn, c: n && (() => copy(n)), x: n && (() => cut(n)), v: n && (() => paste(n)) }[k]
    : e.altKey ? n && { ArrowUp: () => move(n, -1), ArrowDown: () => move(n, 1), ArrowLeft: () => outdent(n), ArrowRight: () => indent(n) }[e.key]
    : n && {
      Tab: () => addChild(n), Enter: () => (e.shiftKey ? startEdit(n, true) : addSibling(n)), Delete: () => remove(n), F2: () => startEdit(n), ' ': () => toggle(n),
      ArrowLeft: () => p && go(p), ArrowRight: () => n.children.length && !n.fold && go(n.children[0]),
      ArrowUp: () => p && go(p.children[p.children.indexOf(n) - 1]), ArrowDown: () => p && go(p.children[p.children.indexOf(n) + 1]),
    }[e.key];
  if (act) { e.preventDefault(); act(); }
});
function go(n) { if (!n) return; sel = n; highlight(); const d = findD(n); if (d) mm.ensureVisible(d); }

// ---------- старт ----------
(async () => {
  const init = await bridge.call('ready');
  if (init?.file) await loadFile(init.file); else await loadMd(keys(T['@help'] || HELP), null);
  if (init?.pdf) { await new Promise((r) => setTimeout(r, 400)); await exportPdf(init.pdf); }
})();
