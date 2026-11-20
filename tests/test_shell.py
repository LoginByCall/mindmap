"""python3 tests/test_shell.py — Linux-оболочка mindmap.py: файлы байтами через base64, ссылки из карты.

Форматы проверяет tests/test_formats.py (web/formats.js). Те же случаи ссылок для macOS — самотест в macos/main.swift.
"""
import base64, os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import mindmap as m

# файл туда и обратно байт-в-байт, атомарная запись не оставляет .tmp
with tempfile.TemporaryDirectory() as d:
    raw = bytes(range(256)) + 'Привет'.encode()
    p = os.path.join(d, 'x.xmind')
    assert m.save(p, base64.b64encode(raw).decode()) == {'path': p, 'name': 'x.xmind'}
    r = m.load(p)
    assert base64.b64decode(r['data']) == raw and r['name'] == 'x.xmind'
    m.save(p, base64.b64encode(b'new').decode())
    assert open(p, 'rb').read() == b'new' and os.listdir(d) == ['x.xmind'], 'нет хвостов .tmp'

# ссылки из карты: сайт / карта / «перейти» к файлу; относительный путь — от папки карты
with tempfile.TemporaryDirectory() as d:
    os.makedirs(os.path.join(d, 'доки'))
    open(os.path.join(d, 'доки', 'смета 1.pdf'), 'w').close()
    open(os.path.join(d, 'сеть.md'), 'w').close()
    base = os.path.join(d, 'карта.md')
    assert m.link_target('https://a.b/c', None) == ('web', 'https://a.b/c')
    assert m.link_target('%D1%81%D0%B5%D1%82%D1%8C.md', base) == ('map', os.path.join(d, 'сеть.md'))
    assert m.link_target('./доки/смета%201.pdf', base) == ('show', os.path.join(d, 'доки', 'смета 1.pdf'))
    assert m.link_target('file://' + d + '/доки', None) == ('show', os.path.join(d, 'доки'))
    assert m.link_target('~', None) == ('show', os.path.expanduser('~'))
    for bad, b in (('javascript:alert(1)', base), ('доки', None), ('нет.pdf', base)):
        try:
            m.link_target(bad, b)
            raise AssertionError(bad)
        except (ValueError, FileNotFoundError):
            pass
print('shell: ok')
