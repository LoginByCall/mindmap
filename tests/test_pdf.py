"""python3 tests/test_pdf.py — экспорт в PDF в настоящем GTK/WebKit: карта целиком на одной странице.

Регрессия: WebKitGTK печатает CSS px в ~1,07 раза крупнее страницы — низ и правый край карты обрезались.
Заодно — открытие .mm/.opml/.xmind через оболочку: байты из Python, разбор в web/formats.js внутри WebKitGTK.
Нужны дисплей (X11/Wayland) и poppler-utils (pdfinfo, pdftotext).
"""
import os, re, subprocess, sys, tempfile

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
with tempfile.TemporaryDirectory() as d:
    pdf = os.path.join(d, 'help.pdf')
    subprocess.run([sys.executable, os.path.join(root, 'mindmap.py'), '--pdf', pdf], check=True, timeout=60,
                   env={**os.environ, 'LANGUAGE': 'ru'})   # без файла экспортируется стартовая карта
    info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True, check=True).stdout
    words = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True, check=True).stdout
pages = int(re.search(r'Pages:\s+(\d+)', info)[1])
W, H = map(float, re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info).groups())
box = {w: tuple(map(float, b)) for *b, w in re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<', words)}
assert pages == 1, f'страниц {pages}, ждали 1'
# «отметку» — конец самой нижней ветки, «сдвиг» — конец самой длинной (правый край)
for w in ('отметку', 'сдвиг'):
    assert w in box, f'нет слова «{w}» — обрезано?'
    x0, y0, x1, y1 = box[w]
    assert x1 <= W and y1 <= H, f'«{w}» за краем страницы {W}x{H}: {box[w]}'

fx = os.path.join(root, 'tests', 'fixtures')
with tempfile.TemporaryDirectory() as d:
    for n, word in (('out.mm', 'Свёрнут'), ('out.opml', 'Свёрнут'), ('out.xmind', 'Свёрнут'), ('freeplane.mm', 'Ветка')):
        pdf = os.path.join(d, n + '.pdf')
        subprocess.run([sys.executable, os.path.join(root, 'mindmap.py'), os.path.join(fx, n), '--pdf', pdf], check=True, timeout=60)
        text = subprocess.run(['pdftotext', pdf, '-'], capture_output=True, text=True, check=True).stdout
        assert word in text, f'{n}: нет «{word}» в PDF — файл не разобран?'
print(f'pdf: ok ({W:.0f}x{H:.0f} pt)')
