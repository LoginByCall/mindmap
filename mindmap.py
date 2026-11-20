#!/usr/bin/env python3
"""Лёгкий просмотрщик/редактор mind map на markmap (GTK3 + WebKit2GTK).

Запуск:  mindmap.py [файл.md|.mm|.opml|.xmind] [--pdf выход.pdf]
"""
import base64
import gettext
import json
import os
import sys
import urllib.parse

TR = {}   # перевод из web/lang/<язык>.json, ключ — русская строка; пусто — русский


def _(s):
    return TR.get(s, s)


def ui_lang(env=os.environ):
    """Язык интерфейса по локали, как gettext: первая непустая из LANGUAGE (список через «:»), LC_ALL, LC_MESSAGES, LANG.
    Нет перевода — английский. ponytail: zh_TW тоже получает упрощённый китайский."""
    val = next((env[v] for v in ('LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG') if env.get(v)), '')
    have = os.listdir(os.path.join(os.path.dirname(os.path.realpath(__file__)), 'web', 'lang'))
    for loc in val.split(':'):
        code = loc.split('_')[0].split('.')[0].split('@')[0].lower()
        if code == 'ru' or code + '.json' in have:
            return code
    return 'en'


EXTS = ['.md', '.markdown', '.mm', '.opml', '.xmind']


# Файлы: оболочка только читает и пишет байты (в мосту — base64), форматы разбирает web/formats.js
def load(path):
    with open(path, 'rb') as f:
        return {'path': path, 'name': os.path.basename(path), 'data': base64.b64encode(f.read()).decode()}


def save(path, data):
    tmp = path + '.tmp'  # атомарная запись: при сбое старый файл не портится
    with open(tmp, 'wb') as f:
        f.write(base64.b64decode(data))
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
        raise ValueError(_('Неподдерживаемая ссылка:') + ' ' + href)
    else:
        p = os.path.expanduser(urllib.parse.unquote(u.path))
        if not os.path.isabs(p):
            if not base:
                raise ValueError(_('Относительная ссылка считается от папки карты — сначала сохраните карту'))
            p = os.path.join(os.path.dirname(base), p)
    p = os.path.normpath(p)
    if not os.path.exists(p):
        raise FileNotFoundError(_('Нет такого файла или папки:') + ' ' + p)
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

    GLib.set_prgname('mindmap')   # класс окна = StartupWMClass ярлыка: в доке окно встаёт к своему значку
    win = Gtk.Window(title='Mind Map')
    win.set_default_size(1200, 800)
    win.set_icon_from_file(os.path.join(here, 'web', 'icon.svg'))
    lang = ui_lang()
    if lang != 'ru':
        with open(os.path.join(here, 'web', 'lang', lang + '.json'), encoding='utf-8') as f:
            TR.update(json.load(f))
    ucm = WebKit2.UserContentManager()
    ucm.add_script(WebKit2.UserScript.new(   # до app.js: словарь для интерфейса, справки и обучения
        f'window.I18N = {json.dumps(TR, ensure_ascii=False)}; document.documentElement.lang = {json.dumps(lang)};',
        WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
    view = WebKit2.WebView.new_with_user_content_manager(ucm)
    if os.environ.get('MINDMAP_DEBUG'):  # инспектор WebKit и console.log в stdout
        view.get_settings().set_enable_developer_extras(True)
        view.get_settings().set_enable_write_console_messages_to_stdout(True)
    win.add(view)
    state = {'dirty': False}

    # щипок тачпада: WebKit сам растянул бы всю страницу — забираем жест раньше него и масштабируем карту
    pinch = state['pinch'] = Gtk.GestureZoom.new(view)   # ссылку держим: иначе жест соберёт GC
    pinch.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)

    def pinch_begin(g, _seq):
        g.set_state(Gtk.EventSequenceState.CLAIMED)
        state['scale'] = 1.0

    def pinch_scale(g, scale):
        _, x, y = g.get_bounding_box_center()
        view.evaluate_javascript(f'zoomBy({scale / state["scale"]}, {x}, {y})', -1, None, None, None, None, None)
        state['scale'] = scale
    pinch.connect('begin', pinch_begin)
    pinch.connect('scale-changed', pinch_scale)

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
        dlg = Gtk.FileChooserNative.new(_('Сохранить') if action == Gtk.FileChooserAction.SAVE else _('Открыть'),
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
            dlg.set_current_name(name or 'mindmap.mm.md')
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
        op.connect('failed', lambda _op, err: (error(_('Ошибка печати в PDF:') + ' ' + err.message), done(None)))
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
                if start and not os.path.exists(start):  # новый файл с указанным именем: карту-заготовку сделает JS
                    val['file'] = {'path': start, 'name': os.path.basename(start), 'data': None}
            elif cmd == 'state':
                state['dirty'] = a['dirty']
                win.set_title(('● ' if a['dirty'] else '') + a['name'] + ' — Mind Map')
                val = True
            elif cmd == 'quit':
                GLib.idle_add(win.close)  # как кнопка закрытия: delete-event спросит про несохранённое
                val = True
            elif cmd == 'confirm':
                val = ask(a['text'])
            elif cmd == 'error':
                raise ValueError(a['text'])
            elif cmd == 'open':
                p = chooser(Gtk.FileChooserAction.OPEN)
                val = load(p) if p else None
            elif cmd == 'link':
                val = follow(a['href'], a.get('base'))
            elif cmd == 'save_dialog':
                p = chooser(Gtk.FileChooserAction.SAVE, a.get('name'))
                if p and os.path.splitext(p)[1].lower() not in EXTS:
                    p += '.mm.md'
                val = p
            elif cmd == 'save':
                val = save(a['path'], a['data'])
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
        return state['dirty'] and not ask(_('Есть несохранённые изменения. Закрыть без сохранения?'))
    win.connect('delete-event', on_close)
    win.connect('destroy', Gtk.main_quit)
    view.load_uri(page_uri)
    win.show_all()
    Gtk.main()


if __name__ == '__main__':
    main()
