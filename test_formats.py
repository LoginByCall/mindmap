"""python3 test_formats.py — круговой прогон форматов .mm / .opml / .xmind."""
import mindmap as m

T = {'text': 'Корень & <xml>', 'color': '#e15759', 'fold': False, 'children': [
    {'text': 'Ветка\nв две строки', 'color': None, 'fold': True, 'notes': ['пункт 1', 'пункт & 2'], 'children': [
        {'text': 'лист', 'color': '#4e79a7', 'fold': False, 'children': []}]},
    {'text': 'вторая', 'color': None, 'fold': False, 'children': []}]}


def strip(t, color=True, fold=True):
    return {'text': t['text'], 'color': t.get('color') if color else None, 'notes': t.get('notes') or [],
            'fold': bool(t.get('fold')) if fold else False,
            'children': [strip(c, color, fold) for c in t['children']]}


assert strip(m.mm_read(m.mm_write(T))) == strip(T)
assert strip(m.opml_read(m.opml_write(T)), fold=False) == strip(T, fold=False)
assert strip(m.xmind_read(m.xmind_write(T)), color=False) == strip(T, color=False)
# Freeplane: текст в richcontent, цвет ветки в <edge>
fp = b'<map><node><richcontent TYPE="NODE"><html><body><p>Rich</p></body></html></richcontent><edge COLOR="#ff0000"/></node></map>'
assert m.mm_read(fp)['text'] == 'Rich' and m.mm_read(fp)['color'] == '#ff0000'
# заметка FreeMind без списка -> пункты по строкам
fn = b'<map><node TEXT="a"><richcontent TYPE="NOTE"><html><body><p>one</p>\n<p>two</p></body></html></richcontent></node></map>'
assert m.mm_read(fn)['notes'] == ['one', 'two'], m.mm_read(fn)['notes']
# OPML с несколькими верхними пунктами -> корень из <title>
o = m.opml_read(b'<opml><head><title>T</title></head><body><outline text="a"/><outline text="b"/></body></opml>')
assert o['text'] == 'T' and [c['text'] for c in o['children']] == ['a', 'b']
try:
    m.mm_read(b'<map/>')
    raise AssertionError('пустой .mm должен давать ошибку')
except ValueError:
    pass
# save/load через диск: формат выбирается по расширению
import os, tempfile
with tempfile.TemporaryDirectory() as d:
    for ext in ('.mm', '.opml', '.xmind'):
        m.save(os.path.join(d, 'x' + ext), '', T)
        assert m.load(os.path.join(d, 'x' + ext))['tree']['text'] == T['text']
    m.save(os.path.join(d, 'x.md'), '# Привет\n', T)
    assert m.load(os.path.join(d, 'x.md'))['md'] == '# Привет\n'
    assert sorted(os.listdir(d)) == ['x.md', 'x.mm', 'x.opml', 'x.xmind'], 'нет хвостов .tmp'

# ссылки из карты: сайт / карта / «перейти» к файлу; относительный путь — от папки карты
import tempfile
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
print('formats: ok')
