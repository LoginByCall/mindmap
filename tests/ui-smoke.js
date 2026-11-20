const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
const elOf = (text) => [...svg.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === text);
const log = (...a) => console.log('SMOKE', ...a);
(async () => {
  try {
    await sleep(800);
    const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); log('ok', m); };
    ok(svg.querySelectorAll('g.markmap-node').length > 5, 'help map rendered');
    // регрессия: обёртка строк в t() однажды вклеила «t(» в узел без списка
    ok(!/t\(|\)[▸▾]/.test(svg.textContent), 'no stray t( in rendered nodes');
    // правый клик по узлу -> меню
    const g = elOf('Мышь'); const r = g.getBoundingClientRect();
    g.querySelector('foreignObject').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    ok(menu.style.display === 'block' && menu.textContent.includes('Добавить дочернюю'), 'context menu shown');
    // регрессия: клик по пустому холсту (d3-zoom глушит всплытие mousedown) должен скрыть меню
    svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 50, view: window }));
    ok(menu.style.display === 'none', 'click outside hides menu');
    g.querySelector('foreignObject').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    // цвет из палитры
    menu.querySelector('.sw span').click(); await sleep(400);
    ok(src.value.includes('## Мышь <!-- color: #e15759 -->'), 'color applied to source');
    // Tab -> новая дочерняя, ввод текста, Enter
    key('Tab'); await sleep(800);
    ok(!!editing && editing.box.isContentEditable, 'inline editor opened');
    editing.box.textContent = 'Новый **пункт**'; editing.box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400);
    ok(src.value.includes('- Новый **пункт**'), 'child added via graph');
    ok(!!elOf('Новый **пункт**').querySelector('strong'), 'markdown rendered in node');
    // Enter -> соседняя, Esc отменяет переименование
    key('Enter'); await sleep(500);
    editing.box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    ok(src.value.includes('- Новая ветка'), 'sibling added');
    ok(elOf('Новая ветка').querySelector('.mm-t').textContent === 'Новая ветка' && !svg.querySelector('[contenteditable]'), 'Esc restores node view');
    // Del удаляет, Ctrl+Z возвращает
    key('Delete'); await sleep(300);
    ok(!src.value.includes('Новая ветка'), 'deleted');
    key('z', { ctrlKey: true }); await sleep(300);
    ok(src.value.includes('Новая ветка'), 'undo works');
    // правка исходника -> карта
    cmds.toggleSrc(); ok(!src.classList.contains('hidden'), 'source shown');
    src.value = '# A\n\n- B\n  - C\n- D <!-- color: #59a14f -->\n'; src.dispatchEvent(new Event('input')); await sleep(800);
    ok(svg.querySelectorAll('g.markmap-node').length === 4, 'source edit re-rendered map');
    // свёртка по кружку
    const b = elOf('B'); b.querySelector('circle').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(600);
    ok(src.value.includes('- B <!-- markmap: fold -->'), 'fold synced to source');
    // Alt+↓ перемещение
    sel = root.children[0]; key('ArrowDown', { altKey: true }); await sleep(300);
    ok(root.children.map((c) => c.text).join() === 'D,B', 'move down');
    log('ALL PASSED');
  } catch (e) { log(e.message); }
  document.title = 'SMOKE-DONE';
})();
