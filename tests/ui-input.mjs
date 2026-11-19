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
  // автопрокрутка: у края полотна оно едет само, вдали от края — стоит; отпускание за краем не ломает перетаскивание
  b = await box('Мышь!');
  await js(`getSelection().selectAllChildren(document.querySelector('.mm-t'))`);   // выделенный текст не должен мешать
  const edge = await js(`(() => { const r = svg.getBoundingClientRect(); return [r.right - 5, r.bottom - 5]; })()`);
  await mouse('mousePressed', b[0] + 10, b[1] + b[3] / 2);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: b[0] + 30, y: b[1] + b[3] / 2 });
  const t1 = await js(`mm.g.attr('transform')`); await sleep(300);
  ok(await js(`mm.g.attr('transform')`) === t1, 'вдали от края полотно не едет');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: edge[0], y: edge[1] });
  const p1 = await js(`d3.zoomTransform(svg)`); await sleep(400); const p2 = await js(`d3.zoomTransform(svg)`);
  ok(p2.x < p1.x - 20 && p2.y < p1.y - 20, 'у правого нижнего края полотно едет влево-вверх');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: edge[0] - 200, y: edge[1] - 200 });
  const p3 = await js(`d3.zoomTransform(svg)`); await sleep(300);
  ok(await js(`d3.zoomTransform(svg).x`) === p3.x, 'ушёл от края — остановилось');
  await key('Escape');
  await mouse('mouseReleased', edge[0] - 200, edge[1] - 200); await sleep(400);
  ok(await js(`!drag && !document.querySelector('.mm-ghost')`), 'Esc отменяет перетаскивание и прокрутку');
  await js(`mm.fit()`); await sleep(400);   // вернуть вид для следующих проверок

  await key('z', 2); await key('z', 2);
  ok(await js(`src.value.indexOf('## Мышь!') < src.value.indexOf('## Клавиши')`), 'Ctrl+Z возвращает порядок');

  // нумерация (CommonMark «1.»): меню ветки, номера в карте; список под узлом — «1. » в первой строке
  const menuItem = (t) => js(`(() => { const e = [...menu.querySelectorAll('.it')].find((e) => e.firstChild.textContent === ${JSON.stringify(t)});
    const r = e.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
  await click(...(await at('Мышь!', '.mm-t')), 1, 'right');
  await click(...(await menuItem('Ветки: нумерация')));
  ok(await js(`src.value.includes('## Мышь!\\n\\n1. двойной клик') && src.value.includes('\\n2. правый клик')`), 'нумерация веток пишется в Markdown как «1.»');
  ok(await js(`[...document.querySelectorAll('.mm-num')].map((e) => e.textContent).slice(0, 2).join() === '1.,2.'`), 'номера видны в карте');
  await click(...(await at('Список под узлом', '.mm-notes li')), 2);
  await js(`getSelection().selectAllChildren(editing.box)`);
  await cdp('Input.insertText', { text: '1. первый' }); await key('Enter'); await cdp('Input.insertText', { text: 'второй' });
  await key('Enter', 2);
  ok(await js(`src.value.includes('## Список под узлом\\n> 1. первый\\n> 2. второй\\n') && !!document.querySelector('.mm-notes ol')`), '«1. » в первой строке — нумерованный список под узлом');

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
  await js(`dropUris(['file:///tmp/x%20y.pdf', 'file:///tmp/a.png', 'https://example.org'], root.children.find((c) => c.text === 'Клавиши'))`); await sleep(500);
  ok(await js(`['- [x y.pdf](</tmp/x y.pdf>)', '- ![a.png](/tmp/a.png)', '- <https://example.org>'].every((t) => src.value.includes(t))`), 'брошенные файлы и ссылки стали ветками');

  // меню «Файл»: открыть, закрыть повторным кликом
  const fb = await js(`(() => { const r = fileBtn.getBoundingClientRect(); return [r.x + 10, r.y + 10]; })()`);
  await click(...fb);
  ok(await js(`menu.style.display === 'block' && ['Справка', 'Обучение', 'Новый', 'Сохранить', 'Сохранить как…', 'Экспорт в PDF…', 'Выход'].every((t) => menu.textContent.includes(t))`), 'меню «Файл» с пунктами');
  await click(...fb);
  ok(await js(`menu.style.display === 'none'`), 'повторный клик по «Файл» закрывает меню');

  // справка: F1, «?», Esc, клик мимо; клавиши карты при открытой справке не действуют
  const md0 = await js(`src.value`);
  await click(...(await at('Мышь!', '.mm-t')));
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 }); await sleep(300);
  ok(await js(`!help.hidden && document.activeElement === help.querySelector('.hbox')`), 'F1 открывает справку');
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }); await sleep(300);
  ok(await js(`src.value`) === md0 && await js(`sel?.text`) === 'Мышь!', 'Delete при открытой справке ветку не трогает');
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
  ok(await js(`help.hidden && src.value === ${JSON.stringify(md0)} && undo.length > 0`), 'Esc закрывает справку, карта и история целы');
  const hb = await js(`(() => { const r = helpBtn.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await click(...hb);
  ok(await js(`!help.hidden`), 'кнопка «?» открывает справку');
  await click(5, 600);
  ok(await js(`help.hidden`), 'клик мимо окна закрывает справку');
  // регрессии приёмки: фокус заперт в справке; F1 из правки; двойной клик мимо справки не открывает правку
  const press = async (key, code, vk) => { await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(200); };
  await click(...hb);
  const u0 = await js(`undo.length`);
  for (let i = 0; i < 8; i++) await press('Tab', 'Tab', 9);
  await press('Enter', 'Enter', 13);
  ok(await js(`help.contains(document.activeElement) || document.activeElement === document.body`) && await js(`undo.length`) === u0,
    'Tab не уводит фокус на панель под справкой, Enter там ничего не делает');
  await press('Escape', 'Escape', 27);
  ok(await js(`help.hidden && !bar.inert && !document.querySelector('#main').inert`), 'после закрытия панель и карта снова доступны');
  await click(...(await at('Мышь!', '.mm-t')), 2);
  await press('F1', 'F1', 112);
  ok(await js(`!help.hidden && !editing`), 'F1 во время правки завершает её и открывает справку');
  const rootAt = await at('Mind Map', '.mm-t');
  ok(rootAt[0] < (await js(`help.querySelector('.hbox').getBoundingClientRect().left`)), 'корень виден слева от окна справки');
  await click(...rootAt, 2);
  ok(await js(`help.hidden && !editing && sel?.text === 'Мышь!'`), 'двойной клик мимо справки закрывает её, не открывает правку и не меняет выделение');
  await click(...hb); await press('Escape', 'Escape', 27);
  await click(...(await at('Мышь!', '.mm-t')), 2);
  ok(await js(`editing?.n.text === 'Мышь!'`), 'сразу после Esc двойной клик по ветке открывает правку');
  await press('Escape', 'Escape', 27);

  // сверка: каждая клавиша из обработчиков есть в справке
  const keys = ['Tab', 'Enter', 'Shift+Enter', 'Ctrl+Enter', 'F2', 'Delete', 'Пробел', 'Alt+↑', 'Alt+↓', 'Alt+←', 'Alt+→', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V',
    'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Esc', 'Ctrl+N', 'Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+P', 'Ctrl+E', 'Ctrl+0', 'F1', 'Ctrl+Q'];
  const missing = await js(`${JSON.stringify(keys)}.filter((k) => ![...help.querySelectorAll('kbd')].some((e) => e.textContent === k))`);
  ok(!missing.length, 'в справке есть все клавиши' + (missing.length ? ': нет ' + missing.join(', ') : ''));

  // обучение: из справки, с вопросом о несохранённом; карта не файл
  await js(`window.calls = []; bridge.call = async (cmd, a) => (calls.push([cmd, a]), cmd === 'confirm' ? true : null)`);
  await click(...hb);
  await click(...(await js(`(() => { const r = help.querySelector('.tut').getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`)));
  await sleep(800);
  ok(await js(`help.hidden && root.text === 'Обучение' && file === null && calls.some(([c]) => c === 'confirm')`), 'кнопка в справке открывает обучение, спросив о несохранённом');
  ok(await js(`src.value.split('- [ ] ').length - 1 >= 8`), 'в обучении не меньше 8 заданий-флажков');
  await click(...(await js(`(() => { const a = [...document.querySelectorAll('.mm-t a')].find((a) => a.textContent === 'ссылке на раздел 1');
    const r = a.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`)));
  ok(await js(`sel?.text === '1. Правка текста'`), 'ссылка-якорь в обучении ведёт к разделу 1');
  await js(`cmds.save()`); await sleep(300);
  ok(await js(`calls.some(([c]) => c === 'save_dialog') && !calls.some(([c]) => c === 'save')`), '«Сохранить» в обучении спрашивает имя');
} catch (e) { console.log('FAIL ' + e.stack); fails++; }
chrome.kill();
await sleep(300);
rmSync(prof, { recursive: true, force: true });
console.log(fails ? `ui-input: ${fails} FAIL` : 'ui-input: ok');
process.exit(fails ? 1 : 0);
