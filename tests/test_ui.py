"""python3 tests/test_ui.py — smoke-тест интерфейса в headless Chrome на копии web/.

rAF подменяется таймером: в headless с виртуальным временем requestAnimationFrame
может не срабатывать, а markmap его ждёт.
"""
import os, re, shutil, subprocess, sys, tempfile

here = os.path.dirname(os.path.abspath(__file__))
chrome = shutil.which('google-chrome') or shutil.which('chromium') or sys.exit('нужен google-chrome или chromium')
with tempfile.TemporaryDirectory() as d:
    web = os.path.join(d, 'web')
    shutil.copytree(os.path.join(here, '..', 'web'), web)
    shutil.copy(os.path.join(here, 'ui-smoke.js'), web)
    p = os.path.join(web, 'index.html')
    html = open(p, encoding='utf-8').read()
    html = html.replace('<script src="vendor/d3.min.js">',
                        '<script>window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);</script>'
                        '<script src="vendor/d3.min.js">')
    html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script><script src="ui-smoke.js"></script>')
    open(p, 'w', encoding='utf-8').write(html)
    out = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
                          f'--user-data-dir={d}/prof', '--window-size=1200,800', '--virtual-time-budget=20000',
                          '--enable-logging=stderr', '--v=0', '--dump-dom', 'file://' + p],
                         capture_output=True, text=True, timeout=120).stderr
lines = re.findall(r'SMOKE ([^"]*)', out)
print('\n'.join(lines))
sys.exit(0 if 'ALL PASSED' in lines else 1)
