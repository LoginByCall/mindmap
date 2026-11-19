'use strict';
// Источник истины — дерево `root` (mdtree). Markdown в панели исходника — его текстовое представление.
const { Markmap, Transformer, builtInPlugins, defaultOptions } = window.markmap;
// ponytail: katex/hljs отключены — они тянут ассеты из CDN, а приложение офлайновое
const tf = new Transformer(builtInPlugins.filter((p) => !/katex|hljs/.test(p.name || '')));
const html = (t) => (t.includes('\n') ? tf.md.render(t) : tf.md.renderInline(t)) || '&nbsp;';

const $ = (id) => document.getElementById(id);
const src = $('src'), svg = $('map'), menu = $('menu'), edit = $('edit');
const PALETTE = ['#e15759', '#f28e2b', '#edc948', '#59a14f', '#76b7b2', '#4e79a7', '#b07aa1', '#ff9da7', '#9c755f', '#555555'];
const HELP = `# Mind Map

## Мышь
- двойной клик — правка названия или списка
- правый клик — меню ветки
- клик по кружку — свернуть ветку
- колесо — масштаб, перетаскивание — сдвиг

## Клавиши
- Tab / Enter — дочерняя / соседняя ветка
- Shift+Enter — список под узлом (строка = пункт, Ctrl+Enter — готово)
- F2 — правка, Del — удалить
- стрелки — навигация, Alt+стрелки — перемещение
- Ctrl+E — исходник, Ctrl+P — PDF

## Список под узлом
> - мелкий шрифт под названием
> - ▾ сворачивает, ▸ разворачивает
> - в Markdown: «> - пункт»
`;

let root, file = null, dirty = false, sel = null, clip = null, editing = null;
let lastMd = '', undo = [], redo = [], parents = new Map();

// ---------- мост к Python (GTK) ----------
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
  await mm.toggleNode(d, e.ctrlKey);
  (function sync(x) { x.payload.ref.fold = !!x.payload.fold; x.children?.forEach(sync); })(mm.state.data);
  commit(false);
};

// список под названием: мелкий шрифт, ▾/▸ сворачивает
function notesHtml(n) {
  if (!n.notes?.length) return '';
  const items = n.notesFold ? '' : '<ul>' + n.notes.map((t) => `<li>${tf.md.renderInline(t) || '&nbsp;'}</li>`).join('') + '</ul>';
  return `<div class="mm-notes"><span class="mm-nt" data-nt title="Свернуть/развернуть список">${n.notesFold ? '▸' : '▾'} ${n.notes.length}</span>${items}</div>`;
}
function toINode(n, inh) {
  const color = n.color || inh;
  return { content: `<div class="mm-t">${html(n.text)}</div>` + notesHtml(n), children: n.children.map((c) => toINode(c, color)),
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
function setDirty(v) { dirty = v; bridge.call('state', { dirty, name: file?.name || 'Без имени' }); }
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

function loadMd(md, f) {
  file = f; root = mdtree.parse(md); lastMd = src.value = md; undo = []; redo = []; sel = null;
  setDirty(false);
  return draw(true);
}
const fromTree = (t, depth = 0) => ({ text: t.text || '', kind: depth < 2 ? 'h' : 'li', color: t.color || undefined,
  fold: !!t.fold, ...(t.notes?.length && { notes: t.notes }), children: (t.children || []).map((c) => fromTree(c, depth + 1)) });
const toTree = (n) => ({ text: n.text, color: n.color || null, fold: !!n.fold, notes: n.notes || [], children: n.children.map(toTree) });
const loadFile = (r) => loadMd(r.md ?? mdtree.serialize(fromTree(r.tree)), { path: r.path, name: r.name });

// ---------- операции над ветками ----------
const newNode = (kind = 'li') => ({ text: 'Новая ветка', kind, children: [] });
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
function startEdit(n, list = false) {   // list — весь список под узлом одним полем (строка = пункт), иначе название
  const el = findEl(n); if (!el) return;
  const t = el.querySelector('.mm-t') || el.querySelector('foreignObject'), nb = el.querySelector('.mm-notes');
  let r = (list && nb ? nb : t).getBoundingClientRect();
  if (list && !nb) r = { left: r.left, top: r.bottom + 8, width: r.width };   // списка ещё нет — поле под чертой
  editing = { n, list }; edit.value = list ? (n.notes || []).join('\n') : n.text;
  edit.classList.toggle('note', list);
  edit.placeholder = list ? 'Пункт на строку · Ctrl+Enter — готово' : '';
  Object.assign(edit.style, { display: 'block', left: r.left - 5 + 'px', top: r.top - 3 + 'px', width: Math.max(r.width + 30, list ? 280 : 220) + 'px' });
  autosize(); edit.focus();
  if (list) edit.setSelectionRange(edit.value.length, edit.value.length); else edit.select();
}
function endEdit(ok) {
  if (!editing) return;
  const { n, list } = editing; editing = null; edit.style.display = 'none';
  if (!ok) return;
  if (!list) { const t = edit.value.trim(); if (t !== n.text) { n.text = t; delete n.virtual; commit(); } return; }
  const items = edit.value.split('\n').map((l) => l.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '')).filter(Boolean);
  if (items.join('\n') === (n.notes || []).join('\n')) return;
  if (items.length) { n.notes = items; n.notesFold = false; } else { delete n.notes; delete n.notesFold; }   // пустое поле = убрать список
  commit();
}
function autosize() { edit.style.height = 'auto'; edit.style.height = edit.scrollHeight + 2 + 'px'; }
edit.addEventListener('input', autosize);
edit.addEventListener('blur', () => endEdit(true));
edit.addEventListener('keydown', (e) => {
  e.stopPropagation();
  // название: Enter — готово, Shift+Enter — перенос; список: Enter — новый пункт, Ctrl+Enter — готово
  const done = e.key === 'Enter' && (editing?.list ? e.ctrlKey || e.metaKey : !e.shiftKey);
  if (done) { e.preventDefault(); endEdit(true); }
  else if (e.key === 'Escape') endEdit(false);
});

// ---------- мышь ----------
const nodeAt = (e) => e.target.closest?.('g.markmap-node')?.__data__.payload.ref;
const inNotes = (e) => !!e.target.closest?.('.mm-notes');
svg.addEventListener('click', (e) => {
  sel = nodeAt(e) || null;
  if (sel && e.target.closest('[data-nt]')) toggleNotes(sel); else highlight();
});
// capture: markmap глушит всплытие dblclick на тексте узла (foreignObject)
svg.addEventListener('dblclick', (e) => {
  const n = nodeAt(e);
  if (!n || e.target.closest('[data-nt]')) return;
  sel = n; highlight(); startEdit(n, inNotes(e));
}, true);
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const n = nodeAt(e);
  if (!n) return showMenu(canvasMenu(), e);
  sel = n; highlight();
  showMenu(inNotes(e) ? [{ t: 'Изменить список', k: 'Двойной клик', f: () => startEdit(n, true) }, '-', ...nodeMenu(n)] : nodeMenu(n), e);
});

// ---------- контекстное меню ----------
function nodeMenu(n) {
  const p = parents.get(n), i = p ? p.children.indexOf(n) : -1;
  const sw = document.createElement('div'); sw.className = 'sw';
  for (const c of PALETTE) {
    const s = document.createElement('span'); s.style.background = c; s.title = c;
    s.onclick = () => { hideMenu(); setColor(n, c); }; sw.append(s);
  }
  return [
    { t: 'Добавить дочернюю ветку', k: 'Tab', f: () => addChild(n) },
    { t: 'Добавить соседнюю ветку', k: 'Enter', f: () => addSibling(n), dis: !p },
    { t: 'Переименовать', k: 'F2', f: () => startEdit(n) },
    { t: n.notes?.length ? 'Изменить список' : 'Добавить список', k: 'Shift+Enter', f: () => startEdit(n, true) },
    { t: n.notesFold ? 'Развернуть список' : 'Свернуть список', f: () => toggleNotes(n), dis: !n.notes?.length },
    '-', { t: 'Цвет ветки', dis: true }, { el: sw },
    { t: 'Другой цвет…', f: () => pickColor(n) },
    { t: 'Сбросить цвет', f: () => setColor(n, null), dis: !n.color },
    '-',
    { t: n.fold ? 'Развернуть' : 'Свернуть', k: 'Пробел', f: () => toggle(n), dis: !n.children.length },
    { t: 'Переместить вверх', k: 'Alt+↑', f: () => move(n, -1), dis: i <= 0 },
    { t: 'Переместить вниз', k: 'Alt+↓', f: () => move(n, 1), dis: !p || i === p.children.length - 1 },
    { t: 'Повысить уровень', k: 'Alt+←', f: () => outdent(n), dis: !p || !parents.get(p) },
    { t: 'Понизить уровень', k: 'Alt+→', f: () => indent(n), dis: i <= 0 },
    '-',
    { t: 'Копировать ветку', k: 'Ctrl+C', f: () => copy(n) },
    { t: 'Вырезать ветку', k: 'Ctrl+X', f: () => cut(n), dis: !p },
    { t: 'Вставить как дочернюю', k: 'Ctrl+V', f: () => paste(n), dis: !clip },
    '-',
    { t: 'Удалить ветку', k: 'Del', f: () => remove(n), dis: !p },
  ];
}
const fileMenu = () => [
  { t: 'Новый', k: 'Ctrl+N', f: cmds.new },
  { t: 'Открыть…', k: 'Ctrl+O', f: cmds.open },
  '-',
  { t: 'Сохранить', k: 'Ctrl+S', f: cmds.save },
  { t: 'Сохранить как…', k: 'Ctrl+Shift+S', f: cmds.saveAs },
  '-',
  { t: 'Экспорт в PDF…', k: 'Ctrl+P', f: cmds.pdf },
  '-',
  { t: 'Выход', k: 'Ctrl+Q', f: cmds.quit },
];
const canvasMenu = () => [
  { t: 'Вписать в окно', k: 'Ctrl+0', f: cmds.fit },
  { t: 'Развернуть всё', f: () => foldAll(false) },
  { t: 'Свернуть всё', f: () => foldAll(true) },
  '-',
  { t: src.classList.contains('hidden') ? 'Показать исходник' : 'Скрыть исходник', k: 'Ctrl+E', f: cmds.toggleSrc },
  { t: 'Экспорт в PDF…', k: 'Ctrl+P', f: cmds.pdf },
];
function showMenu(items, e) {
  menu.replaceChildren(); menu.dataset.owner = '';
  for (const it of items) {
    if (it === '-') { menu.append(document.createElement('hr')); continue; }
    if (it.el) { menu.append(it.el); continue; }
    const d = document.createElement('div');
    d.className = 'it' + (it.dis ? ' dis' : '');
    d.append(Object.assign(document.createElement('span'), { textContent: it.t }),
      Object.assign(document.createElement('kbd'), { textContent: it.k || '' }));
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
const confirmDiscard = async () => !dirty || await bridge.call('confirm', { text: 'Несохранённые изменения будут потеряны. Продолжить?' });
async function write(path) {
  flushSrc();
  const r = await bridge.call('save', { path, md: lastMd, tree: toTree(root) });
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
  // ponytail: при печати WebKit рисует текст на ~10–15% шире экранного замера — запас справа
  const extra = 0.2 * Math.max(0, ...[...svg.querySelectorAll('foreignObject')].map((f) => +f.getAttribute('width') || 0));
  const w = b.width + 2 * pad + extra, h = b.height + 2 * pad;
  // размер страницы задаёт Python (1 CSS px = 0.2646 мм); viewBox вписывает карту в неё
  clone.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${w} ${h}`);
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  $('print').replaceChildren(clone);
  await bridge.call('pdf', { path, w, h, name: (file?.name || 'mindmap').replace(/\.[^.]+$/, '') + '.pdf' });
  $('print').replaceChildren();
}
const cmds = {
  async new() { if (await confirmDiscard()) loadMd('# Новая карта\n\n- Идея 1\n- Идея 2\n', null); },
  async open() { if (!(await confirmDiscard())) return; const r = await bridge.call('open'); if (r) loadFile(r); },
  async save() { if (file) await write(file.path); else await cmds.saveAs(); },
  async saveAs() { const p = await bridge.call('save_dialog', { name: file?.name || 'mindmap.md' }); if (p) await write(p); },
  pdf: () => exportPdf(null),
  toggleSrc() { src.classList.toggle('hidden'); $('srcBtn').classList.toggle('on'); if (!src.classList.contains('hidden')) src.focus(); },
  file() {   // повторный клик по «Файл» закрывает меню
    if (menu.style.display === 'block' && menu.dataset.owner === 'file') return hideMenu();
    const r = $('fileBtn').getBoundingClientRect();
    showMenu(fileMenu(), { clientX: r.left, clientY: r.bottom + 2 }); menu.dataset.owner = 'file';
  },
  quit: () => bridge.call('quit'),   // закрытие окна в GTK спросит про несохранённое
  fit: () => mm.fit(),
  undo: undoFn, redo: redoFn,
};
document.querySelectorAll('#bar button').forEach((b) => { b.onclick = () => cmds[b.dataset.cmd](); });

// ---------- клавиатура ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu();
  const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (c) {
    const m = { n: cmds.new, o: cmds.open, s: e.shiftKey ? cmds.saveAs : cmds.save, p: cmds.pdf, q: cmds.quit, e: cmds.toggleSrc, 0: cmds.fit }[k];
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
  if (init?.file) await loadFile(init.file); else await loadMd(HELP, null);
  if (init?.pdf) { await new Promise((r) => setTimeout(r, 400)); await exportPdf(init.pdf); }
})();
