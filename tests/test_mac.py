"""python3 tests/test_mac.py [dist/MindMap-<версия>.dmg] — проверка macOS-сборки на Маке по ssh (MAC=user@host).

Ставит .dmg во временную папку /tmp на Маке и после удаляет. Проверяет:
M9 — бинарник universal, .dmg ≤ 10 МБ; M3 — PDF одной страницей, нижняя и самая длинная ветки внутри;
M2 — .mm/.opml/.xmind открываются (байты из Swift, разбор в formats.js); M5 — язык по -AppleLanguages;
M1 — окно со стартовой картой (снимок экрана кладётся в dist/mac-screen.png — посмотреть глазами).
Нужны poppler-utils (pdfinfo, pdftotext) здесь и пользователь, вошедший в графический сеанс там.
Дисплей Мака будится (caffeinate -u): со спящим экраном WebKit не рисует кадры и карта не достраивается.
"""
import glob, os, re, subprocess, sys, tempfile, unicodedata

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MAC = os.environ.get('MAC', 'alexander@192.168.88.250')
dmg = sys.argv[1] if len(sys.argv) > 1 else max(glob.glob(os.path.join(root, 'dist', 'MindMap-*.dmg')), key=os.path.getmtime)
T = '/tmp/mm-test'
WAKE = 'caffeinate -u -t 2'   # «пользователь здесь» — дисплей просыпается
fails = 0


def ok(c, msg):
    global fails
    fails += not c
    print(('ok  ' if c else 'FAIL') + ' ' + msg, flush=True)


def ssh(cmd, timeout=120):
    r = subprocess.run(['ssh', MAC, cmd], capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


def pdf(args, lang='ru', name='out.pdf'):
    """Экспорт в PDF через «open» (графический сеанс); возвращает (pdfinfo, pdftotext -bbox) или None."""
    rc, out = ssh(f'rm -f {T}/{name}; {WAKE}; open -W -n -a {T}/MindMap.app --args {args} --pdf {T}/{name} -AppleLanguages "({lang})"'
                  f' & p=$!; for i in $(seq 60); do [ -s {T}/{name} ] && ! kill -0 $p 2>/dev/null && break; sleep 1; done; kill $p 2>/dev/null; ls {T}/{name}')
    if rc:
        return None
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['scp', '-q', f'{MAC}:{T}/{name}', d], check=True)
        p = os.path.join(d, name)
        return (subprocess.run(['pdfinfo', p], capture_output=True, text=True).stdout,
                # NFKC: шрифты CJK в PDF отдают часть иероглифов знаками ключей Канси (⿏ вместо 鼠) — на странице всё верно
                unicodedata.normalize('NFKC', subprocess.run(['pdftotext', '-bbox', p, '-'], capture_output=True, text=True).stdout))


ssh(f'rm -rf {T}; mkdir {T}')
subprocess.run(['scp', '-q', dmg] + glob.glob(os.path.join(root, 'tests', 'fixtures', 'out.*')) + [f'{MAC}:{T}/'], check=True)
rc, out = ssh(f'cd {T} && hdiutil attach -quiet -nobrowse -mountpoint {T}/vol {os.path.basename(dmg)} && cp -R vol/MindMap.app . && hdiutil detach -quiet vol'
              f' && lipo -archs MindMap.app/Contents/MacOS/mindmap && codesign -v MindMap.app && echo signed')
try:
    ok(rc == 0 and 'x86_64 arm64' in out and 'signed' in out, f'M9: universal, ad-hoc подпись цела — {out.strip()}')
    ok(os.path.getsize(dmg) <= 10e6, f'M9: .dmg {os.path.getsize(dmg) / 1e6:.1f} МБ ≤ 10')

    r = pdf('')
    ok(r is not None, 'M3: PDF стартовой карты создан')
    if r:
        info, words = r
        W, H = map(float, re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info).groups())
        box = {w: tuple(map(float, b)) for *b, w in re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<', words)}
        ok(int(re.search(r'Pages:\s+(\d+)', info)[1]) == 1, f'M3: одна страница ({W:.0f}x{H:.0f} pt)')
        for w in ('отметку', 'сдвиг'):   # конец нижней и конец самой длинной ветки
            ok(w in box and box[w][2] <= W and box[w][3] <= H, f'M3: «{w}» внутри страницы {box.get(w)}')
    for n in ('out.mm', 'out.opml', 'out.xmind'):
        r = pdf(f'{T}/{n}', name=n + '.pdf')
        ok(r is not None and 'Свёрнут' in r[1], f'M2: {n} открыт и разобран')
    for lang, word in (('de', 'Maus'), ('zh-Hans', '鼠标'), ('ja', 'Mouse'), ('ru', 'Мышь')):
        r = pdf('', lang=lang, name=lang + '.pdf')
        ok(r is not None and word in r[1], f'M5: -AppleLanguages ({lang}) → «{word}»')

    # M1: обычный запуск — окно видно, через 3 с карта нарисована (снимок делает само приложение: screencapture по ssh
    # без разрешения «Запись экрана» видит только обои)
    shot = os.path.join(root, 'dist', 'mac-screen.png')
    rc, out = ssh(f'{WAKE}; open -W -n --env MINDMAP_SNAPSHOT={T}/screen.png --stderr {T}/m1.txt -a {T}/MindMap.app --args -AppleLanguages "(ru)"'
                  f' & p=$!; for i in $(seq 20); do kill -0 $p 2>/dev/null || break; sleep 1; done; kill $p 2>/dev/null; cat {T}/m1.txt')
    subprocess.run(['scp', '-q', f'{MAC}:{T}/screen.png', shot])
    ok('visible=true' in out and os.path.exists(shot), f'M1: окно видно, снимок карты — dist/mac-screen.png ({out.strip()})')
finally:
    ssh(f'hdiutil detach -quiet {T}/vol 2>/dev/null; rm -rf {T}')
sys.exit(1 if fails else 0)
