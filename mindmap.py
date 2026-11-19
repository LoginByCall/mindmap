#!/usr/bin/env python3
"""Лёгкий просмотрщик/редактор mind map на markmap (GTK3 + WebKit2GTK).

Запуск:  mindmap.py [файл.md|.mm|.opml|.xmind] [--pdf выход.pdf]
"""
import gettext
import io
import json
import os
import sys
import urllib.parse
import uuid
import zipfile
import xml.etree.ElementTree as ET

# Дерево обмена с JS: {"text", "color", "fold", "children": [...]}


# ---------- FreeMind / Freeplane (.mm, XML) ----------
def mm_read(data):
    def conv(e):
        text = e.get('TEXT')
        if text is None:  # Freeplane: текст в <richcontent TYPE="NODE"><html>...
            rc = e.find('richcontent')
            text = ' '.join(''.join(rc.itertext()).split()) if rc is not None else ''
        edge = e.find('edge')
        color = (edge.get('COLOR') if edge is not None else None) or e.get('COLOR')
        note = e.find("richcontent[@TYPE='NOTE']")
        notes = []
        if note is not None:  # заметка FreeMind: пункты <li> или строки текста
            lis = note.findall('.//li')
            notes = [' '.join(''.join(li.itertext()).split()) for li in lis] if lis else \
                [ln.strip() for ln in ''.join(note.itertext()).splitlines() if ln.strip()]
        return {'text': text, 'color': color, 'fold': e.get('FOLDED') == 'true', 'notes': notes,
                'children': [conv(c) for c in e.findall('node')]}
    node = ET.fromstring(data).find('node')
    if node is None:
        raise ValueError('В файле нет узла <node>')
    return conv(node)


def mm_write(tree):
    def conv(n, parent):
        e = ET.SubElement(parent, 'node', TEXT=n['text'])
        if n.get('color'):
            e.set('COLOR', n['color'])
            ET.SubElement(e, 'edge', COLOR=n['color'])
        if n.get('fold') and n['children']:
            e.set('FOLDED', 'true')
        if n.get('notes'):
            ul = ET.SubElement(ET.SubElement(ET.SubElement(e, 'richcontent', TYPE='NOTE'), 'html'), 'body')
            ul = ET.SubElement(ul, 'ul')
            for t in n['notes']:
                ET.SubElement(ul, 'li').text = t
        for c in n['children']:
            conv(c, e)
    m = ET.Element('map', version='1.0.1')
    conv(tree, m)
    return ET.tostring(m, encoding='utf-8')


# ---------- OPML (XML) ----------
def opml_read(data):
    r = ET.fromstring(data)
    def conv(e):
        return {'text': e.get('text', ''), 'color': e.get('color'), 'fold': False,
                'notes': [ln.strip() for ln in e.get('_note', '').splitlines() if ln.strip()],
                'children': [conv(c) for c in e.findall('outline')]}
    outs = r.findall('body/outline')
    if len(outs) == 1:
        return conv(outs[0])
    return {'text': r.findtext('head/title') or '', 'children': [conv(o) for o in outs]}


def opml_write(tree):
    r = ET.Element('opml', version='2.0')
    ET.SubElement(ET.SubElement(r, 'head'), 'title').text = tree['text']
    def conv(n, parent):
        e = ET.SubElement(parent, 'outline', text=n['text'])
        if n.get('color'):
            e.set('color', n['color'])  # нестандартный атрибут, OPML это допускает
        if n.get('notes'):
            e.set('_note', '\n'.join(n['notes']))  # соглашение OmniOutliner/Workflowy
        for c in n['children']:
            conv(c, e)
    conv(tree, ET.SubElement(r, 'body'))
    return ET.tostring(r, encoding='utf-8', xml_declaration=True)


# ---------- XMind Zen / 2020+ (zip + content.json) ----------
def xmind_read(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    if 'content.json' not in z.namelist():
        raise ValueError('Поддерживается XMind 2020+ (content.json); XMind 8 (content.xml) — нет')
    def conv(t):
        note = t.get('notes', {}).get('plain', {}).get('content', '')
        return {'text': t.get('title', ''), 'color': None, 'fold': t.get('branch') == 'folded',
                'notes': [ln.strip() for ln in note.splitlines() if ln.strip()],
                'children': [conv(c) for c in t.get('children', {}).get('attached', [])]}
    return conv(json.loads(z.read('content.json'))[0]['rootTopic'])


def xmind_write(tree):
    def conv(n):
        d = {'id': uuid.uuid4().hex, 'class': 'topic', 'title': n['text']}
        if n.get('notes'):
            d['notes'] = {'plain': {'content': '\n'.join(n['notes'])}}
        if n['children']:
            d['children'] = {'attached': [conv(c) for c in n['children']]}
            if n.get('fold'):
                d['branch'] = 'folded'
        return d
    content = [{'id': uuid.uuid4().hex, 'class': 'sheet', 'title': tree['text'] or 'Sheet 1', 'rootTopic': conv(tree)}]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('content.json', json.dumps(content, ensure_ascii=False))
        z.writestr('metadata.json', '{}')
        z.writestr('manifest.json', json.dumps({'file-entries': {'content.json': {}, 'metadata.json': {}}}))
    return buf.getvalue()


READERS = {'.mm': mm_read, '.opml': opml_read, '.xmind': xmind_read}
WRITERS = {'.mm': mm_write, '.opml': opml_write, '.xmind': xmind_write}
EXTS = ['.md', '.markdown', '.mm', '.opml', '.xmind']


def load(path):
    ext = os.path.splitext(path)[1].lower()
    with open(path, 'rb') as f:
        data = f.read()
    res = {'path': path, 'name': os.path.basename(path)}
    if ext in READERS:
        res['tree'] = READERS[ext](data)
    else:
        res['md'] = data.decode('utf-8')
    return res


def save(path, md, tree):
    ext = os.path.splitext(path)[1].lower()
    data = WRITERS[ext](tree) if ext in WRITERS else md.encode('utf-8')
    tmp = path + '.tmp'  # атомарная запись: при сбое старый файл не портится
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)
    return {'path': path, 'name': os.path.basename(path)}


def link_target(href, base):
    """Куда ведёт ссылка из карты: ('web', url) | ('map', путь) | ('show', путь). Относительный путь — от папки карты."""
    u = urllib.parse.urlsplit(href)
    if u.scheme in ('http', 'https', 'mailto', 'ftp'):
        return 'web', href
    if u.scheme == 'file':
        p = urllib.parse.unquote(u.path)
    elif u.scheme:  # javascript:, data: и прочее — не трогаем
        raise ValueError(f'Неподдерживаемая ссылка: {href}')
    else:
        p = os.path.expanduser(urllib.parse.unquote(u.path))
        if not os.path.isabs(p):
            if not base:
                raise ValueError('Относительная ссылка считается от папки карты — сначала сохраните карту')
            p = os.path.join(os.path.dirname(base), p)
    p = os.path.normpath(p)
    if not os.path.exists(p):
        raise FileNotFoundError(f'Нет такого файла или папки: {p}')
    return ('map' if os.path.isfile(p) and os.path.splitext(p)[1].lower() in EXTS else 'show'), p


# ---------- GUI ----------
def main():
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('Gdk', '3.0')
    gi.require_version('WebKit2', '4.1')
    from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2

    here = os.path.dirname(os.path.realpath(__file__))
    args = sys.argv[1:]
    pdf_out = None
    if '--pdf' in args:
        i = args.index('--pdf')
        pdf_out = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    start = os.path.abspath(args[0]) if args else None

    win = Gtk.Window(title='Mind Map')
    win.set_default_size(1200, 800)
    win.set_icon_name('x-office-drawing')
    ucm = WebKit2.UserContentManager()
    view = WebKit2.WebView.new_with_user_content_manager(ucm)
    if os.environ.get('MINDMAP_DEBUG'):  # инспектор WebKit и console.log в stdout
        view.get_settings().set_enable_developer_extras(True)
        view.get_settings().set_enable_write_console_messages_to_stdout(True)
    win.add(view)
    state = {'dirty': False}

    def error(msg):
        d = Gtk.MessageDialog(transient_for=win, modal=True, message_type=Gtk.MessageType.ERROR,
                              buttons=Gtk.ButtonsType.OK, text=str(msg))
        d.run()
        d.destroy()

    def ask(text):
        d = Gtk.MessageDialog(transient_for=win, modal=True, message_type=Gtk.MessageType.QUESTION,
                              buttons=Gtk.ButtonsType.YES_NO, text=text)
        ok = d.run() == Gtk.ResponseType.YES
        d.destroy()
        return ok

    def chooser(action, name=None, pdf=False):
        dlg = Gtk.FileChooserNative.new('Сохранить' if action == Gtk.FileChooserAction.SAVE else 'Открыть',
                                        win, action, None, None)
        filters = [('PDF', ['*.pdf'])] if pdf else [
            ('Mind map (md, mm, opml, xmind)', ['*' + e for e in EXTS]),
            ('Markdown', ['*.md', '*.markdown']), ('FreeMind / Freeplane', ['*.mm']),
            ('OPML', ['*.opml']), ('XMind', ['*.xmind'])]
        for title, pats in filters:
            f = Gtk.FileFilter()
            f.set_name(title)
            for p in pats:
                f.add_pattern(p)
            dlg.add_filter(f)
        if action == Gtk.FileChooserAction.SAVE:
            dlg.set_do_overwrite_confirmation(True)
            dlg.set_current_name(name or 'mindmap.md')
        path = dlg.get_filename() if dlg.run() == Gtk.ResponseType.ACCEPT else None
        dlg.destroy()
        return path

    def print_pdf(path, w, h, done):
        # ponytail: имя виртуального принтера GTK локализовано — берём перевод из домена gtk30
        k = min(1.0, 5000 / max(w, h) / 0.2646)  # PDF ограничивает страницу ~5 м
        ps = Gtk.PrintSettings()
        ps.set_printer(gettext.dgettext('gtk30', 'Print to File'))
        ps.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, 'pdf')
        ps.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, GLib.filename_to_uri(path))
        setup = Gtk.PageSetup()
        setup.set_paper_size(Gtk.PaperSize.new_custom('mindmap', 'mindmap', w * 0.2646 * k, h * 0.2646 * k, Gtk.Unit.MM))
        for m in ('top', 'bottom', 'left', 'right'):
            getattr(setup, f'set_{m}_margin')(0, Gtk.Unit.MM)
        op = WebKit2.PrintOperation.new(view)
        op.set_print_settings(ps)
        op.set_page_setup(setup)
        op.connect('finished', lambda *_: done(path))
        op.connect('failed', lambda _op, err: (error(f'Ошибка печати в PDF: {err.message}'), done(None)))
        op.print_()

    def show_in_files(path):
        # «перейти», а не открыть: файл выделяется в файловом менеджере, ничего не запускается
        uri = GLib.filename_to_uri(path)
        try:
            Gio.bus_get_sync(Gio.BusType.SESSION).call_sync(
                'org.freedesktop.FileManager1', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1',
                'ShowFolders' if os.path.isdir(path) else 'ShowItems', GLib.Variant('(ass)', ([uri], '')),
                None, Gio.DBusCallFlags.NONE, 3000)
        except GLib.Error:  # нет FileManager1 — просто папка
            Gtk.show_uri_on_window(win, GLib.filename_to_uri(path if os.path.isdir(path) else os.path.dirname(path)), Gdk.CURRENT_TIME)

    def follow(href, base):
        kind, t = link_target(href, base)
        if kind == 'web':
            Gtk.show_uri_on_window(win, t, Gdk.CURRENT_TIME)
        elif kind == 'show':
            show_in_files(t)
        else:
            return load(t)
        return None

    page = os.path.join(here, 'web', 'index.html')
    page_uri = GLib.filename_to_uri(page)

    def on_policy(_view, decision, kind):
        # страховка: окно никогда не уходит с карты (ссылка мимо JS, брошенный файл)
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri()
        try:
            if GLib.filename_from_uri(uri.split('#')[0])[0] == page:
                return False
        except GLib.Error:  # не file:
            pass
        decision.ignore()
        if uri.startswith('file:'):
            view.evaluate_javascript(f'dropUris([{json.dumps(uri)}])', -1, None, None, None, None, None)
        else:
            try:
                follow(uri, None)
            except Exception as e:
                error(e)
        return True
    view.connect('decide-policy', on_policy)

    def reply(mid, val):
        view.evaluate_javascript(f'bridge.reply({mid}, {json.dumps(val, ensure_ascii=False)})', -1, None, None, None, None, None)

    def on_message(_ucm, res):
        msg = json.loads(res.get_js_value().to_string())
        mid, cmd, a = msg['id'], msg['cmd'], msg['args']
        try:
            if cmd == 'ready':
                val = {'file': load(start) if start and os.path.exists(start) else None, 'pdf': pdf_out}
                if start and not os.path.exists(start):  # новый файл с указанным именем
                    val['file'] = {'path': start, 'name': os.path.basename(start), 'md': '# ' + os.path.splitext(os.path.basename(start))[0] + '\n'}
            elif cmd == 'state':
                state['dirty'] = a['dirty']
                win.set_title(('● ' if a['dirty'] else '') + a['name'] + ' — Mind Map')
                val = True
            elif cmd == 'quit':
                GLib.idle_add(win.close)  # как кнопка закрытия: delete-event спросит про несохранённое
                val = True
            elif cmd == 'confirm':
                val = ask(a['text'])
            elif cmd == 'open':
                p = chooser(Gtk.FileChooserAction.OPEN)
                val = load(p) if p else None
            elif cmd == 'link':
                val = follow(a['href'], a.get('base'))
            elif cmd == 'save_dialog':
                p = chooser(Gtk.FileChooserAction.SAVE, a.get('name'))
                if p and os.path.splitext(p)[1].lower() not in EXTS:
                    p += '.md'
                val = p
            elif cmd == 'save':
                val = save(a['path'], a['md'], a['tree'])
            elif cmd == 'pdf':
                p = a.get('path') or chooser(Gtk.FileChooserAction.SAVE, a.get('name'), pdf=True)
                if not p:
                    val = None
                else:
                    def done(path):
                        reply(mid, path)
                        if pdf_out:
                            Gtk.main_quit()
                    print_pdf(p, a['w'], a['h'], done)
                    return  # ответ придёт по завершении печати
            else:
                raise ValueError(f'неизвестная команда {cmd}')
        except Exception as e:  # файл не прочитался/не записался — показываем, данные в редакторе целы
            error(e)
            val = None
            if pdf_out:
                sys.exit(1)
        reply(mid, val)

    ucm.connect('script-message-received::app', on_message)
    ucm.register_script_message_handler('app')

    def on_close(*_):
        return state['dirty'] and not ask('Есть несохранённые изменения. Закрыть без сохранения?')
    win.connect('delete-event', on_close)
    win.connect('destroy', Gtk.main_quit)
    view.load_uri(page_uri)
    win.show_all()
    Gtk.main()


if __name__ == '__main__':
    main()
