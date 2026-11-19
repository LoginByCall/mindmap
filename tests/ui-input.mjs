// node tests/ui-input.mjs — проверка НАСТОЯЩИМ вводом мыши (Chrome DevTools Protocol).
// Синтетические события обходят d3-zoom/markmap и не ловят глушение всплытия — здесь ловим.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const page = 'file://' + join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html');
const prof = mkdtempSync(join(tmpdir(), 'mm-ui-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  `--user-data-dir=${prof}`, '--window-size=1200,800', page], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0, fails = 0;
const pending = {};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pending[id] = r; ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const mouse = async (type, x, y, clickCount = 1, button = 'left') => cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
async function click(x, y, n = 1, button = 'left') {
  for (let i = 1; i <= n; i++) { await mouse('mousePressed', x, y, i, button); await mouse('mouseReleased', x, y, i, button); }
  await sleep(500);
}
async function key(k, modifiers = 0) {   // настоящая клавиша; modifiers: 2 = Ctrl, 8 = Shift
  const vk = { Enter: 13 }[k];
  const plain = k === 'Enter' && !(modifiers & 2);
  await cdp('Input.dispatchKeyEvent', { type: plain ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: vk, modifiers, ...(plain && { text: '\r' }) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk, modifiers });
  await sleep(500);
}
const hasLi = (text) => js(`!![...document.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === ${JSON.stringify(text)})?.querySelector('.mm-notes li')`);
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// центр элемента по селектору внутри узла с данным текстом
const at = (text, sel) => js(`(() => {
  const g = [...document.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === ${JSON.stringify(text)});
  const el = g && g.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const r = el.getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 30), r.y + r.height / 2];
})()`);

try {
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try {
      const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page');
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r)); }
    } catch { /* Chrome ещё стартует */ }
  }
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending[d.id]?.(d); delete pending[d.id]; });
  await sleep(1500);
  ok(await js(`document.querySelectorAll('g.markmap-node').length`) > 5, 'карта отрисована');

  // двойной клик по названию узла -> правка названия
  let p = await at('Мышь', '.mm-t');
  await click(...p, 2);
  ok(await js(`!!editing && editing.box.innerText === 'Мышь' && !editing.list`), 'двойной клик по названию открывает правку');
  ok(await js(`editing.box.closest('g.markmap-node') && !document.querySelector('textarea:not(#src)')`), 'правка — в самом узле, без поля поверх');
  await click(...(await at('Мышь', '.mm-t')));
  ok(await js(`!!editing && document.activeElement === editing.box`), 'клик внутри поля не закрывает правку');
  await js(`getSelection().selectAllChildren(editing.box)`);
  await cdp('Input.insertText', { text: 'Мышь!' }); await key('Enter'); await sleep(500);
  ok(await js(`src.value.includes('## Мышь!')`), 'новое название попало в исходник');

  // список под чертой: верх списка ниже черты узла; названия и списки разных узлов не пересекаются
  ok(await js(`(() => {
    const g = [...document.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === 'Список под узлом');
    return g.querySelector('.mm-nt').getBoundingClientRect().top >= g.querySelector('line').getBoundingClientRect().bottom;   // первая строка списка (▾) ниже черты
  })()`), 'список размещён под чертой');
  ok(await js(`(() => {
    const rs = [...document.querySelectorAll('.mm-t, .mm-notes')].map((e) => e.getBoundingClientRect());
    return rs.every((a, i) => rs.every((b, j) => j <= i || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5 || a.right <= b.left + 0.5 || b.right <= a.left + 0.5));
  })()`), 'названия и списки не налезают друг на друга');
  // список не вылезает за foreignObject: иначе WebKit при сдвиге полотна оставляет следы
  const notesInside = `[...document.querySelectorAll('.mm-notes')].every((n) => n.getBoundingClientRect().bottom <= n.closest('foreignObject').getBoundingClientRect().bottom + 0.5)`;
  ok(await js(notesInside), 'список внутри границ foreignObject');

  // двойной клик по списку -> одно поле, строка = пункт; Enter — новая строка, Ctrl+Enter — готово
  p = await at('Список под узлом', '.mm-notes li');
  ok(!!p, 'список под узлом отрисован');
  await click(...p, 2);
  ok(await js(`!!editing && editing.list && editing.box.innerText.split('\\n').length === 3 && editing.box.innerText.startsWith('мелкий шрифт')`), 'двойной клик по списку открывает весь список одним полем');
  await key('Enter');
  ok(await js(`!!editing && editing.box.innerText.replace(/\\n$/, '').split('\\n').length === 4`), 'Enter в поле списка добавляет строку, а не закрывает');
  await cdp('Input.insertText', { text: '- новый пункт' });
  await key('Enter', 2);
  ok(await js(`!editing && src.value.includes('> - в Markdown: «> - пункт»\\n> - новый пункт')`), 'Ctrl+Enter сохраняет список, маркер «- » срезан');

  // Shift+Enter на узле без списка -> пустое поле под чертой, пустые строки отбрасываются
  await click(...(await at('Клавиши', '.mm-t')));
  await key('Enter', 8);
  ok(await js(`!!editing && editing.box.innerText === '' && editing.list`), 'Shift+Enter открывает новый список');
  await js(`editing.box.textContent = 'раз\\n\\n два '`);
  await key('Enter', 2);
  ok(await js(`src.value.includes('## Клавиши\\n> - раз\\n> - два\\n')`), 'новый список сохранён без пустых строк');

  // клик по ▾ сворачивает список, повторный — разворачивает
  await click(...(await at('Список под узлом', '[data-nt]')));
  ok(await js(`src.value.includes('## Список под узлом <!-- notes: fold -->')`) && !(await hasLi('Список под узлом')), 'клик по ▾ сворачивает список');
  await click(...(await at('Список под узлом', '[data-nt]')));
  ok(await js(`!src.value.includes('Список под узлом <!-- notes: fold -->')`) && await hasLi('Список под узлом'), 'клик по ▸ разворачивает список');
  ok(await js(notesInside), 'после перерисовки список по-прежнему внутри foreignObject');

  // правый клик по списку -> «Изменить список»; клик мимо — закрывает
  await click(...(await at('Список под узлом', '.mm-notes li')), 1, 'right');
  ok(await js(`menu.style.display === 'block' && menu.textContent.startsWith('Изменить список')`), 'правый клик по списку — «Изменить список»');
  await click(1100, 700);
  ok(await js(`menu.style.display === 'none'`), 'клик мимо закрывает меню');

  // «схватил и тащи»: верхняя треть цели — перед ней, середина — дочерней; полотно при этом не едет
  const box = (t) => js(`(() => { const g = [...document.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === ${JSON.stringify(t)});
    const r = g.querySelector('.mm-t').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
  async function dragTo(from, x, y) {
    await mouse('mousePressed', ...from);
    for (let i = 1; i <= 5; i++) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1,
      x: from[0] + (x - from[0]) * i / 5, y: from[1] + (y - from[1]) * i / 5 });
    const shown = await js(`[document.querySelector('.mm-ghost')?.textContent, mark.className, mark.style.display]`);
    await mouse('mouseReleased', x, y); await sleep(600);
    return shown;
  }
  const tf0 = await js(`mm.g.attr('transform')`);
  let a = await box('Клавиши'), b = await box('Мышь!');
  let shown = await dragTo([a[0] + 10, a[1] + a[3] / 2], b[0] + 10, b[1] + 2);
  ok(shown[0] === 'Клавиши' && shown[1] === 'mm-drop before' && shown[2] === 'block', 'при перетаскивании видны ветка у курсора и черта «перед»');
  ok(await js(`src.value.indexOf('## Клавиши') < src.value.indexOf('## Мышь!') && sel?.text === 'Клавиши'`), 'ветка перенесена перед целью и выделена');
  ok(await js(`mm.g.attr('transform')`) === tf0, 'полотно не сдвинулось');
  a = await box('Клавиши'); b = await box('Мышь!');
  await dragTo([a[0] + 10, a[1] + a[3] / 2], b[0] + 10, b[1] + b[3] / 2);
  ok(await js(`src.value.includes('- Клавиши\\n  > - раз') && parents.get(sel)?.text === 'Мышь!'`), 'на середину цели — стала дочерней, со своим списком');
  const before = await js(`src.value`);
  a = await box('Клавиши'); b = await box('Мышь!');
  shown = await dragTo([b[0] + 10, b[1] + b[3] / 2], a[0] + 10, a[1] + a[3] / 2);
  ok(shown[2] === 'none' && await js(`src.value`) === before, 'в своего потомка не переносится');
  await key('z', 2); await key('z', 2);
  ok(await js(`src.value.indexOf('## Мышь!') < src.value.indexOf('## Клавиши')`), 'Ctrl+Z возвращает порядок');

  // флажок: клик по ☐ ставит отметку в исходнике
  await click(...(await at('[ ] флажок — клик ставит отметку', '[data-cb]')));
  ok(await js(`src.value.includes('- [x] флажок — клик ставит отметку')`), 'клик по флажку отмечает');

  // ссылки: окно не уходит с карты; сайт — в мост, якорь — переход к узлу
  await js(`window.calls = []; const c0 = bridge.call.bind(bridge); bridge.call = (cmd, a) => (calls.push([cmd, a]), c0(cmd, a))`);
  const link = (t) => js(`(() => { const a = [...document.querySelectorAll('.mm-t a')].find((a) => a.textContent === ${JSON.stringify(t)});
    const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await click(...(await link('сайт')));
  ok(await js(`location.href.endsWith('index.html') && calls.some(([c, a]) => c === 'link' && a.href === 'https://markmap.js.org')`), 'ссылка на сайт уходит в мост, окно на месте');
  const lp = await link('ветка');
  ok(await js(`document.elementFromPoint(${lp}).closest('a')?.textContent === 'ветка'`), 'соседний узел не перекрывает ссылку (внешний div markmap 9999px)');
  await click(...lp);
  ok(await js(`sel && sel.text === 'Мышь!' && location.href.endsWith('index.html')`), 'ссылка #мышь переходит к узлу');

  // заметка: двойной клик — правка абзаца, Ctrl+Enter — в исходник строками «> »
  await click(...(await at('Ссылки и флажки', '.mm-para')), 2);
  ok(await js(`editing?.list === 'note' && editing.box.innerText.startsWith('Заметка под узлом')`), 'двойной клик по заметке открывает её правку');
  await js(`getSelection().selectAllChildren(editing.box)`);
  await cdp('Input.insertText', { text: 'первая' }); await key('Enter'); await cdp('Input.insertText', { text: 'вторая' });
  await key('Enter', 2);
  ok(await js(`src.value.includes('## Ссылки и флажки\\n> первая\\n> вторая\\n')`), 'заметка сохранена строками «> »');

  // брошенные файлы: ссылка (пробелы — в <>), картинка — ![]
  await js(`dropUris(['file:///tmp/x%20y.pdf', 'file:///tmp/a.png', 'https://example.org'], root.children[0])`); await sleep(500);
  ok(await js(`['- [x y.pdf](</tmp/x y.pdf>)', '- ![a.png](/tmp/a.png)', '- <https://example.org>'].every((t) => src.value.includes(t))`), 'брошенные файлы и ссылки стали ветками');

  // меню «Файл»: открыть, закрыть повторным кликом
  const fb = await js(`(() => { const r = fileBtn.getBoundingClientRect(); return [r.x + 10, r.y + 10]; })()`);
  await click(...fb);
  ok(await js(`menu.style.display === 'block' && ['Новый', 'Сохранить', 'Сохранить как…', 'Экспорт в PDF…', 'Выход'].every((t) => menu.textContent.includes(t))`), 'меню «Файл» с пунктами');
  await click(...fb);
  ok(await js(`menu.style.display === 'none'`), 'повторный клик по «Файл» закрывает меню');
} catch (e) { console.log('FAIL ' + e.stack); fails++; }
chrome.kill();
await sleep(300);
rmSync(prof, { recursive: true, force: true });
console.log(fails ? `ui-input: ${fails} FAIL` : 'ui-input: ok');
process.exit(fails ? 1 : 0);
