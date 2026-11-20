"""python3 tests/test_formats.py — web/formats.js в headless Chrome против эталона Python 0.3.2 (tests/fixtures).

Чтение: дерево из каждого файла = read.json. Запись: .mm/.opml — байт-в-байт с out.*; .xmind — zip читается
zipfile, content.json даёт то же дерево (id случайные). Плюс битый XML и XMind 8 — понятная ошибка.
"""
import base64, io, json, os, re, shutil, subprocess, sys, tempfile, zipfile

here = os.path.dirname(os.path.abspath(__file__))
fx = os.path.join(here, 'fixtures')
chrome = shutil.which('google-chrome') or shutil.which('chromium') or sys.exit('нужен google-chrome или chromium')
files = {n: base64.b64encode(open(os.path.join(fx, n), 'rb').read()).decode() for n in os.listdir(fx) if not n.endswith('.json')}
x8 = io.BytesIO()
with zipfile.ZipFile(x8, 'w') as z:
    z.writestr('content.xml', '<xmap-content/>')
files['x8.xmind'] = base64.b64encode(x8.getvalue()).decode()
files['bad.mm'] = base64.b64encode(b'<map><node TEXT="a"></map>').decode()
files['empty.mm'] = base64.b64encode(b'<map version="1"/>').decode()
tree = json.load(open(os.path.join(fx, 'tree.json'), encoding='utf-8'))

check = '''(async () => {
  const ext = (n) => n.slice(n.lastIndexOf('.')), res = { read: {}, write: {} };
  for (const [n, b] of Object.entries(FILES))
    try { res.read[n] = await formats[ext(n)].read(formats.unb64(b)); } catch (e) { res.read[n] = 'ERR ' + e.message; }
  for (const e of ['.mm', '.opml', '.xmind']) res.write[e] = formats.b64(formats[e].write(TREE));
  document.getElementById('out').textContent = btoa(unescape(encodeURIComponent(JSON.stringify(res))));
})().catch((e) => { document.getElementById('out').textContent = btoa(JSON.stringify('FATAL ' + e.stack)); });'''
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, 'f.html')
    shutil.copy(os.path.join(here, '..', 'web', 'formats.js'), d)
    open(p, 'w', encoding='utf-8').write(f'<meta charset="utf-8"><pre id="out"></pre><script>const FILES = {json.dumps(files)}, TREE = {json.dumps(tree)};</script>'
                                         f'<script src="formats.js"></script><script>{check}</script>')
    out = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-sandbox', f'--user-data-dir={d}/prof',
                          '--virtual-time-budget=5000', '--dump-dom', 'file://' + p], capture_output=True, text=True, timeout=120).stdout
m = re.search(r'<pre id="out">([A-Za-z0-9+/=]+)</pre>', out) or sys.exit('нет результата из Chrome:\n' + out[:600])
res = json.loads(base64.b64decode(m.group(1)))
if isinstance(res, str): sys.exit(res)
fails = 0


def ok(c, msg):
    global fails
    fails += not c
    print(('ok  ' if c else 'FAIL') + ' ' + msg)


exp = json.load(open(os.path.join(fx, 'read.json'), encoding='utf-8'))
for n, t in exp.items():
    ok(res['read'][n] == t, f'read {n}')
ok(res['read']['x8.xmind'].startswith('ERR Поддерживается XMind 2020+'), 'XMind 8 → понятная ошибка')
ok(res['read']['bad.mm'].startswith('ERR '), 'битый XML → ошибка: ' + res['read']['bad.mm'][:60])
ok(res['read']['empty.mm'] == 'ERR В файле нет узла <node>', '.mm без узла → ошибка')
for e in ('.mm', '.opml'):
    ok(base64.b64decode(res['write'][e]) == open(os.path.join(fx, 'out' + e), 'rb').read(), f'write {e} байт-в-байт с 0.3.2')
z = zipfile.ZipFile(io.BytesIO(base64.b64decode(res['write']['.xmind'])))
ok(z.testzip() is None and sorted(z.namelist()) == ['content.json', 'manifest.json', 'metadata.json'], 'write .xmind: zip цел (CRC)')
def strip(t):  # дерево из content.json без id — как читает 0.3.2
    note = t.get('notes', {}).get('plain', {}).get('content', '')
    return {'text': t.get('title', ''), 'fold': t.get('branch') == 'folded', 'notes': [s.strip() for s in note.splitlines() if s.strip()],
            'children': [strip(c) for c in t.get('children', {}).get('attached', [])]}
mine = json.loads(z.read('content.json'))[0]
ref = json.loads(zipfile.ZipFile(os.path.join(fx, 'out.xmind')).read('content.json'))[0]
ok(strip(mine['rootTopic']) == strip(ref['rootTopic']) and mine['title'] == ref['title'], 'write .xmind: то же дерево, что у 0.3.2')
sys.exit(1 if fails else 0)
