"""python3 tests/test_i18n.py [--dump файл.json] — переводы web/lang/*.json полны и не устарели.

Ключ — русская строка из t('…') в web/app.js и web/formats.js, _('…') в mindmap.py, кнопок панели и окна справки web/index.html;
@tutorial, @help — учебная и стартовая карты (Markdown), @helpHtml — содержимое окна справки.
--dump пишет эталон с русскими значениями — исходник для перевода.
"""
import json, os, re, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
app, py, page = rd('web/app.js') + rd('web/formats.js'), rd('mindmap.py'), rd('web/index.html')
cyr = re.compile('[А-Яа-яЁё]')
keys = set(re.findall(r"\bt\('([^']+)'\)", app)) | set(re.findall(r"\b_\('([^']+)'\)", py))
bar = page[page.index('<div id="bar">'):page.index('<div id="main">')]
keys |= {s for s in re.findall(r'>([^<>]+)</button>|title="([^"]+)"', bar) for s in s if cyr.search(s)}
keys |= set(re.findall(r'class="hbox"[^>]*aria-label="([^"]+)"', page))
src = {k: k for k in keys if cyr.search(k)}
src['@tutorial'] = re.search(r'const TUTORIAL = `(.*?)`;', app, re.S)[1]
src['@help'] = re.search(r'const HELP = `(.*?)`;', app, re.S)[1]
src['@helpHtml'] = re.search(r'<div class="hbox"[^>]*>\n(.*?)\n</div>\n</div>', page, re.S)[1]
if '--dump' in sys.argv:
    json.dump(src, open(sys.argv[sys.argv.index('--dump') + 1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    sys.exit()

sys.path.insert(0, root)
from mindmap import ui_lang   # выбор языка по локали
for env, want in [({'LANG': 'de_DE.UTF-8'}, 'de'), ({'LANG': 'ru_RU.UTF-8'}, 'ru'), ({'LANG': 'it_IT.UTF-8'}, 'en'), ({'LANG': 'C.UTF-8'}, 'en'),
                  ({}, 'en'), ({'LANGUAGE': 'it:fr', 'LANG': 'ru_RU'}, 'fr'), ({'LANGUAGE': '', 'LC_ALL': 'zh_CN.UTF-8'}, 'zh')]:
    assert ui_lang(env) == want, (env, ui_lang(env), want)
slug = lambda s: re.sub(r'\s+', '-', re.sub(r'[^\w\s-]', '', s.lower().strip()))   # как slug() в app.js (без разметки)
bad = []
langs = sorted(f[:-5] for f in os.listdir(os.path.join(root, 'web', 'lang')) if f.endswith('.json'))
for lang in langs:
    tr = json.loads(rd(f'web/lang/{lang}.json'))
    bad += [f'{lang}: нет перевода «{k[:60]}»' for k in src if not tr.get(k)]
    bad += [f'{lang}: лишний ключ «{k[:60]}»' for k in tr if k not in src]
    for k in ('@tutorial', '@help'):   # якоря [..](#…) ведут на существующие ветки
        md = tr.get(k, '')
        heads = {slug(re.sub(r'^[#\-\s]+|\[[ x]\]\s*', '', l)) for l in md.split('\n')}
        bad += [f'{lang}: {k}: якорь #{a} никуда не ведёт' for a in re.findall(r'\]\(#([^)]+)\)', md) if slug(a) not in heads]
    if any(cyr.search(v) for v in tr.values()):
        bad.append(f'{lang}: в переводе осталась кириллица')
print('\n'.join(bad) or f'OK: {", ".join(langs)} — {len(src)} ключей')
sys.exit(1 if bad else 0)
