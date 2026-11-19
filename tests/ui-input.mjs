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
  ok(await js(`edit.style.display === 'block' && edit.value === 'Мышь' && !edit.classList.contains('note')`), 'двойной клик по названию открывает правку');
  await cdp('Input.insertText', { text: 'Мышь!' }); await js(`edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`); await sleep(500);
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

  // двойной клик по списку -> одно поле, строка = пункт; Enter — новая строка, Ctrl+Enter — готово
  p = await at('Список под узлом', '.mm-notes li');
  ok(!!p, 'список под узлом отрисован');
  await click(...p, 2);
  ok(await js(`edit.style.display === 'block' && edit.classList.contains('note') && edit.value.split('\\n').length === 3 && edit.value.startsWith('мелкий шрифт')`), 'двойной клик по списку открывает весь список одним полем');
  await key('Enter');
  ok(await js(`edit.style.display === 'block' && edit.value.split('\\n').length === 4`), 'Enter в поле списка добавляет строку, а не закрывает');
  await cdp('Input.insertText', { text: '- новый пункт' });
  await key('Enter', 2);
  ok(await js(`edit.style.display === 'none' && src.value.includes('> - в Markdown: «> - пункт»\\n> - новый пункт')`), 'Ctrl+Enter сохраняет список, маркер «- » срезан');

  // Shift+Enter на узле без списка -> пустое поле под чертой, пустые строки отбрасываются
  await click(...(await at('Клавиши', '.mm-t')));
  await key('Enter', 8);
  ok(await js(`edit.style.display === 'block' && edit.value === '' && edit.classList.contains('note')`), 'Shift+Enter открывает новый список');
  await js(`edit.value = 'раз\\n\\n два '`);
  await key('Enter', 2);
  ok(await js(`src.value.includes('## Клавиши\\n> - раз\\n> - два\\n')`), 'новый список сохранён без пустых строк');

  // клик по ▾ сворачивает список, повторный — разворачивает
  await click(...(await at('Список под узлом', '[data-nt]')));
  ok(await js(`src.value.includes('## Список под узлом <!-- notes: fold -->')`) && !(await hasLi('Список под узлом')), 'клик по ▾ сворачивает список');
  await click(...(await at('Список под узлом', '[data-nt]')));
  ok(await js(`!src.value.includes('Список под узлом <!-- notes: fold -->')`) && await hasLi('Список под узлом'), 'клик по ▸ разворачивает список');

  // правый клик по списку -> «Изменить список»; клик мимо — закрывает
  await click(...(await at('Список под узлом', '.mm-notes li')), 1, 'right');
  ok(await js(`menu.style.display === 'block' && menu.textContent.startsWith('Изменить список')`), 'правый клик по списку — «Изменить список»');
  await click(1100, 700);
  ok(await js(`menu.style.display === 'none'`), 'клик мимо закрывает меню');

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
