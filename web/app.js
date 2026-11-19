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
- двойной клик — правка текста
- правый клик — меню ветки
- клик по кружку — свернуть/развернуть
- колесо — масштаб, перетаскивание — сдвиг

## Клавиши
- Tab / Enter — дочерняя / соседняя ветка
- F2 — правка, Del — удалить
- стрелки — навигация, Alt+стрелки — перемещение
- Ctrl+E — исходник, Ctrl+P — PDF
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
mm.handleClick = async (e, d) => {   // клик по кружку: свернуть/развернуть и записать в модель
  await mm.toggleNode(d, e.ctrlKey);
  (function sync(x) { x.payload.ref.fold = !!x.payload.fold; x.children?.forEach(sync); })(mm.state.data);
  commit(false);
};

function toINode(n, inh) {
  const color = n.color || inh;
  return { content: html(n.text), children: n.children.map((c) => toINode(c, color)),
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
  fold: !!t.fold, children: (t.children || []).map((c) => fromTree(c, depth + 1)) });
const toTree = (n) => ({ text: n.text, color: n.color || null, fold: !!n.fold, children: n.children.map(toTree) });
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
const copy = (n) => { clip = structuredClone(n); };
const cut = (n) => { copy(n); remove(n); };
function paste(n) { if (!clip) return; const c = structuredClone(clip); n.children.push(c); n.fold = false; sel = c; commit(); }
function pickColor(n) {
  const inp = Object.assign(document.createElement('input'), { type: 'color', value: n.color || '#4e79a7' });
  inp.addEventListener('change', () => setColor(n, inp.value));
  inp.click();
}

// ---------- правка текста прямо на карте ----------
function startEdit(n) {
  const el = findEl(n); if (!el) return;
  const r = el.querySelector('foreignObject').getBoundingClientRect();
  editing = n; edit.value = n.text;
  Object.assign(edit.style, { display: 'block', left: r.left - 5 + 'px', top: r.top - 3 + 'px', width: Math.max(r.width + 30, 220) + 'px' });
  autosize(); edit.focus(); edit.select();
}
function endEdit(ok) {
  if (!editing) return;
  const n = editing; editing = null; edit.style.display = 'none';
  const t = edit.value.trim();
  if (ok && t !== n.text) { n.text = t; delete n.virtual; commit(); }
}
function autosize() { edit.style.height = 'auto'; edit.style.height = edit.scrollHeight + 2 + 'px'; }
edit.addEventListener('input', autosize);
edit.addEventListener('blur', () => endEdit(true));
edit.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endEdit(true); }
  else if (e.key === 'Escape') endEdit(false);
});

// ---------- мышь ----------
const nodeAt = (e) => e.target.closest?.('g.markmap-node')?.__data__.payload.ref;
svg.addEventListener('click', (e) => { sel = nodeAt(e) || null; highlight(); });
svg.addEventListener('dblclick', (e) => { const n = nodeAt(e); if (n) { sel = n; highlight(); startEdit(n); } });
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const n = nodeAt(e);
  if (n) { sel = n; highlight(); showMenu(nodeMenu(n), e); } else showMenu(canvasMenu(), e);
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
const canvasMenu = () => [
  { t: 'Вписать в окно', k: 'Ctrl+0', f: cmds.fit },
  { t: 'Развернуть всё', f: () => foldAll(false) },
  { t: 'Свернуть всё', f: () => foldAll(true) },
  '-',
  { t: src.classList.contains('hidden') ? 'Показать исходник' : 'Скрыть исходник', k: 'Ctrl+E', f: cmds.toggleSrc },
  { t: 'Экспорт в PDF…', k: 'Ctrl+P', f: cmds.pdf },
];
function showMenu(items, e) {
  menu.replaceChildren();
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
document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) hideMenu(); }, true);
window.addEventListener('blur', hideMenu);

// ---------- файлы и экспорт ----------
const confirmDiscard = async () => !dirty || await bridge.call('confirm', { text: 'Несохранённые изменения будут потеряны. Продолжить?' });
async function write(path) {
  flushSrc();
  const r = await bridge.call('save', { path, md: lastMd, tree: toTree(root) });
  if (r) { file = r; setDirty(false); }
}
async function exportPdf(path) {
  const b = mm.g.node().getBBox(), pad = 20;
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
  fit: () => mm.fit(),
  undo: undoFn, redo: redoFn,
};
document.querySelectorAll('#bar button').forEach((b) => { b.onclick = () => cmds[b.dataset.cmd](); });

// ---------- клавиатура ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu();
  const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (c) {
    const m = { n: cmds.new, o: cmds.open, s: e.shiftKey ? cmds.saveAs : cmds.save, p: cmds.pdf, e: cmds.toggleSrc, 0: cmds.fit }[k];
    if (m) { e.preventDefault(); m(); return; }
  }
  if (e.target === src || editing) return;   // в текстовых полях — штатное поведение
  const n = sel, p = n && parents.get(n);
  const act = c ? { z: e.shiftKey ? redoFn : undoFn, y: redoFn, c: n && (() => copy(n)), x: n && (() => cut(n)), v: n && (() => paste(n)) }[k]
    : e.altKey ? n && { ArrowUp: () => move(n, -1), ArrowDown: () => move(n, 1), ArrowLeft: () => outdent(n), ArrowRight: () => indent(n) }[e.key]
    : n && {
      Tab: () => addChild(n), Enter: () => addSibling(n), Delete: () => remove(n), F2: () => startEdit(n), ' ': () => toggle(n),
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
