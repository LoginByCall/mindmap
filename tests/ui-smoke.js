const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
const elOf = (text) => [...svg.querySelectorAll('g.markmap-node')].find((g) => g.__data__.payload.ref.text === text);
const log = (...a) => console.log('SMOKE', ...a);
const until = async (f, ms = 3000) => { for (let t = 0; t < ms && !f(); t += 100) await sleep(100); return f(); };   // отрисовка под нагрузкой бывает медленнее
(async () => {
  try {
    await sleep(800);
    const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); log('ok', m); };
    ok(svg.querySelectorAll('g.markmap-node').length > 5, 'help map rendered');
    ok(/^Mind Map \d+\.\d+\.\d+ · github\.com\/LoginByCall\/mindmap$/.test(document.querySelector('#help .about')?.textContent), 'about: version + GitHub in help');
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
    ok(await until(() => elOf('Новый **пункт**')?.querySelector('strong')), 'markdown rendered in node');
    // Enter -> соседняя, Esc отменяет переименование
    key('Enter'); await sleep(500);
    editing.box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    ok(src.value.includes('- Новая ветка'), 'sibling added');
    ok(elOf('Новая ветка').querySelector('.mm-t').textContent === 'Новая ветка' && !svg.querySelector('[contenteditable]'), 'Esc restores node view');
    // Ctrl+Enter — та же правка, что F2
    key('Enter', { ctrlKey: true, code: 'Enter' }); await sleep(300);
    ok(editing?.n === sel, 'Ctrl+Enter starts editing');
    editing.box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    // Del удаляет, Ctrl+Z возвращает; латинская буква важнее physical code (немецкая Z — KeyY)
    key('Delete'); await sleep(300);
    ok(!src.value.includes('Новая ветка'), 'deleted');
    key('z', { ctrlKey: true, code: 'KeyY' }); await sleep(300);
    ok(src.value.includes('Новая ветка'), 'undo works with German Z');
    sel = elOf('Новая ветка').__data__.payload.ref;
    key('Delete'); await sleep(300);
    key('я', { ctrlKey: true, code: 'KeyZ' }); await sleep(300);
    ok(src.value.includes('Новая ветка'), 'undo works with Russian layout');
    let quit = false; const realQuit = cmds.quit; cmds.quit = () => { quit = true; };
    key('a', { ctrlKey: true, code: 'KeyQ' }); cmds.quit = realQuit;
    ok(!quit, 'AZERTY Ctrl+A does not become Ctrl+Q');
    // правка исходника -> карта
    key('у', { ctrlKey: true, code: 'KeyE' }); ok(!src.classList.contains('hidden'), 'source shown with Russian layout');
    src.value = '# A\n\n- B\n  - C\n- D <!-- color: #59a14f -->\n'; src.dispatchEvent(new Event('input')); await sleep(800);
    ok(svg.querySelectorAll('g.markmap-node').length === 4, 'source edit re-rendered map');
    // свёртка по кружку
    const b = elOf('B'); b.querySelector('circle').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(600);
    ok(src.value.includes('- B <!-- markmap: fold -->'), 'fold synced to source');
    // Alt+↓ перемещение
    sel = root.children[0]; key('ArrowDown', { altKey: true }); await sleep(300);
    ok(root.children.map((c) => c.text).join() === 'D,B', 'move down');
    // новый файл из командной строки: карта-заготовка с именем без расширения (у карт markmap оно двойное)
    await loadFile({ path: '/a/план.mm.md', name: 'план.mm.md', data: null }); ok(src.value === '# план\n', 'new map named план');
    await loadFile({ path: '/a/c.mm', name: 'c.mm', data: null }); ok(src.value === '# c\n', 'new map named c');
    await loadFile({ path: '/a/recent.md', name: 'recent.md', data: formats.b64(new TextEncoder().encode('# Recent\n')) });
    ok(recent[0]?.path === '/a/recent.md', 'opened file added to recent files');
    for (let i = 0; i < 12; i++) rememberFile({ path: `/a/${i}.md`, name: `${i}.md` });
    rememberFile({ path: '/a/C# 100%.md', name: 'C# 100%.md' });
    cmds.file();
    const recentDetails = menu.querySelector('details.recent'); recentDetails.open = true;
    const recentItems = [...recentDetails.querySelectorAll('.it')];
    ok(recentItems.length === 10 && recentItems[0].textContent === 'C# 100%.md' && JSON.parse(localStorage.recentFiles).length === 10, 'recent files capped at 10 newest and persisted');
    let recentHref = '';
    bridge.call = async (cmd, a) => cmd === 'link' ? (recentHref = a.href, { path: '/a/C# 100%.md', name: 'C# 100%.md', data: formats.b64(new TextEncoder().encode('# Recent special\n')) }) : null;
    recentItems[0].click(); await sleep(500);
    ok(recentHref === '/a/C%23%20100%25.md' && file?.path === '/a/C# 100%.md' && root.text === 'Recent special', 'recent menu item opens its exact encoded path');
    log('ALL PASSED');
  } catch (e) { log(e.message); }
  document.title = 'SMOKE-DONE';
})();
