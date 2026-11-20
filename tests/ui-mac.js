// подключается после app.js с navigator.platform = 'MacIntel': подписи клавиш — ⌘ ⌥ ⇧, Ctrl нигде не осталось
setTimeout(() => {
  const log = (...a) => console.log('SMOKE', ...a);
  const help = document.querySelector('#help').textContent, map = src.value;
  const bad = [help, map, ...[...document.querySelectorAll('#bar button')].map((b) => b.title)].find((s) => /Ctrl|Alt\+/.test(s));
  if (bad) log('FAIL Ctrl/Alt left:', bad.match(/.{0,30}(Ctrl|Alt\+).{0,20}/)[0]);
  else if (!help.includes('⇧⌘S') || !help.includes('⌥↑') || !map.includes('⌘E')) log('FAIL no ⌘ labels');
  else log('ALL PASSED');
  document.title = 'SMOKE-DONE';
}, 800);
