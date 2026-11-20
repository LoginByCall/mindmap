// Mind Map для macOS: окно с WKWebView над общим интерфейсом web/ (лежит в Resources/web).
// Контракт с интерфейсом — web/BRIDGE.md; Linux-двойник — mindmap.py.
// Запуск: MindMap.app/Contents/MacOS/mindmap [файл] [--pdf выход.pdf]
import Cocoa
import UniformTypeIdentifiers
@preconcurrency import WebKit

let exts = ["md", "markdown", "mm", "opml", "xmind"]
var TR: [String: String] = [:]   // словарь web/lang/<язык>.json, ключ — русская строка; пусто — русский
func tr(_ s: String) -> String { TR[s] ?? s }
struct Fail: LocalizedError { let errorDescription: String?; init(_ s: String) { errorDescription = s } }

/// Язык интерфейса по списку языков системы; нет перевода — английский. ponytail: zh-Hant тоже получает упрощённый китайский.
func uiLang(_ prefs: [String], have: [String]) -> String {
    for p in prefs {
        let c = String(p.split(separator: "-").first ?? "").lowercased()
        if c == "ru" || have.contains(c + ".json") { return c }
    }
    return "en"
}

func name(_ p: String) -> String { (p as NSString).lastPathComponent }
func ext(_ p: String) -> String { (p as NSString).pathExtension.lowercased() }
func readFile(_ p: String) throws -> [String: Any] {
    ["path": p, "name": name(p), "data": try Data(contentsOf: URL(fileURLWithPath: p)).base64EncodedString()]
}
func writeFile(_ p: String, _ b64: String) throws -> [String: Any] {
    guard let d = Data(base64Encoded: b64) else { throw Fail("base64") }
    try d.write(to: URL(fileURLWithPath: p), options: .atomic)   // временный файл + переименование: старый не портится
    return ["path": p, "name": name(p)]
}

enum Link { case web(URL), map(String), show(String) }
/// Куда ведёт ссылка из карты (как link_target в mindmap.py). Относительный путь — от папки карты.
func linkTarget(_ href: String, base: String?) throws -> Link {
    let scheme = href.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression).map { href[$0].dropLast().lowercased() }
    let pathPart = { (s: String) -> String in   // как urlsplit(...).path + unquote: без ?запроса и #якоря
        let s = s.firstIndex(where: { $0 == "?" || $0 == "#" }).map { String(s[..<$0]) } ?? s
        return s.removingPercentEncoding ?? s
    }
    var p: String
    switch scheme {
    case "http", "https", "mailto", "ftp":
        if let u = URL(string: href) { return .web(u) }
        throw Fail(tr("Неподдерживаемая ссылка:") + " " + href)
    case "file":
        var s = String(href.dropFirst(5))
        if s.hasPrefix("//") { s = String(s.dropFirst(2)); s = s.firstIndex(of: "/").map { String(s[$0...]) } ?? "/" }   // без хоста
        p = pathPart(s)
    case nil:
        p = (pathPart(href) as NSString).expandingTildeInPath
        if !p.hasPrefix("/") {
            guard let b = base else { throw Fail(tr("Относительная ссылка считается от папки карты — сначала сохраните карту")) }
            p = ((b as NSString).deletingLastPathComponent as NSString).appendingPathComponent(p)
        }
    default:   // javascript:, data: и прочее — не трогаем
        throw Fail(tr("Неподдерживаемая ссылка:") + " " + href)
    }
    p = URL(fileURLWithPath: p).standardized.path
    var dir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: p, isDirectory: &dir) else { throw Fail(tr("Нет такого файла или папки:") + " " + p) }
    return !dir.boolValue && exts.contains(ext(p)) ? .map(p) : .show(p)
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var win: NSWindow!
    var web: WKWebView!
    var dirty = false, started = false
    var start: String?, pdfOut: String?
    var printDone: ((Bool) -> Void)?
    let debug = ProcessInfo.processInfo.environment["MINDMAP_DEBUG"] != nil
    func log<S: StringProtocol>(_ s: S) { FileHandle.standardError.write(Data((s + "\n").utf8)) }
    let webDir = Bundle.main.resourceURL!.appendingPathComponent("web")
    var page: URL { webDir.appendingPathComponent("index.html") }

    override init() {
        super.init()
        let args = Array(CommandLine.arguments.dropFirst())
        var i = 0, files: [String] = []
        while i < args.count {
            let a = args[i]
            if a == "--pdf", i + 1 < args.count { pdfOut = URL(fileURLWithPath: args[i + 1]).path; i += 2 }
            else if a.hasPrefix("-psn") { i += 1 }
            else if a.hasPrefix("-") { i += 2 }   // ключи NSUserDefaults: -AppleLanguages '(de)'
            else { files.append(a); i += 1 }
        }
        start = files.first.map { URL(fileURLWithPath: $0).path }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        let langDir = webDir.appendingPathComponent("lang")
        let lang = uiLang(Locale.preferredLanguages, have: (try? FileManager.default.contentsOfDirectory(atPath: langDir.path)) ?? [])
        var dict = "{}"
        if lang != "ru", let d = try? Data(contentsOf: langDir.appendingPathComponent(lang + ".json")) {
            TR = (try? JSONSerialization.jsonObject(with: d)) as? [String: String] ?? [:]
            dict = String(decoding: d, as: UTF8.self)
        }
        NSApp.mainMenu = menu()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "app")
        cfg.userContentController.addUserScript(WKUserScript(   // до app.js: словарь для интерфейса, справки и обучения
            source: "window.I18N = \(dict); document.documentElement.lang = '\(lang)';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if debug {   // MINDMAP_DEBUG=1: console.* и ошибки JS — в stderr, команды моста — тоже
            cfg.userContentController.add(self, name: "log")
            cfg.userContentController.addUserScript(WKUserScript(source: """
                for (const k of ['log', 'warn', 'error']) { const f = console[k]; console[k] = (...a) => { f(...a); webkit.messageHandlers.log.postMessage(k + ': ' + a.join(' ')); }; }
                addEventListener('error', (e) => webkit.messageHandlers.log.postMessage('JS ' + e.message + ' @' + e.filename + ':' + e.lineno));
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: cfg)
        web.navigationDelegate = self
        win = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        win.title = "Mind Map"
        win.contentView = web
        win.delegate = self
        win.center()
        win.setFrameAutosaveName("main")
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))   // картинки карты — из любой папки
    }

    /// Меню: «Выход» и «Правка» — без «Правки» в полях ввода не работают ⌘C/⌘V/⌘Z. Остальные сочетания ловит app.js.
    func menu() -> NSMenu {
        let main = NSMenu(), appM = NSMenu(), edit = NSMenu(title: tr("Правка"))
        appM.addItem(withTitle: tr("Выход"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for (t, a, k) in [(tr("Отменить"), "undo:", "z"), (tr("Повторить"), "redo:", "Z"), ("", "", ""), (tr("Вырезать"), "cut:", "x"),
                          (tr("Копировать"), "copy:", "c"), (tr("Вставить"), "paste:", "v"), (tr("Выделить всё"), "selectAll:", "a")] {
            edit.addItem(t.isEmpty ? .separator() : NSMenuItem(title: t, action: Selector(a), keyEquivalent: k))
        }
        for m in [appM, edit] { let it = NSMenuItem(); it.submenu = m; main.addItem(it) }
        return main
    }

    func application(_ a: NSApplication, open urls: [URL]) {   // Finder: двойной клик, «Открыть с помощью», бросок на значок
        guard let p = urls.first?.path else { return }
        if !started { start = p; return }   // ещё стартуем — файл заберёт ready
        do { js("openFile(\(json(try readFile(p))))") } catch { fail(error.localizedDescription) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ a: NSApplication) -> Bool { true }
    func windowShouldClose(_ w: NSWindow) -> Bool {
        if dirty && !ask(tr("Есть несохранённые изменения. Закрыть без сохранения?")) { return false }
        dirty = false
        return true
    }
    func applicationShouldTerminate(_ a: NSApplication) -> NSApplication.TerminateReply { windowShouldClose(win) ? .terminateNow : .terminateCancel }

    func ask(_ text: String) -> Bool {
        let al = NSAlert()
        al.messageText = text
        al.addButton(withTitle: tr("Да"))
        al.addButton(withTitle: tr("Нет"))
        return al.runModal() == .alertFirstButtonReturn
    }
    func fail(_ text: String) {
        if pdfOut != nil { FileHandle.standardError.write(Data((text + "\n").utf8)); exit(1) }   // тесты: без окна-ошибки
        let al = NSAlert()
        al.alertStyle = .warning
        al.messageText = text
        al.runModal()
    }
    func panel(save name: String? = nil, pdf: Bool = false) -> String? {
        let p = name == nil ? NSOpenPanel() : NSSavePanel()
        if let n = name { p.nameFieldStringValue = n }
        if pdf { p.allowedContentTypes = [.pdf] } else if name == nil { p.allowedContentTypes = exts.compactMap { UTType(filenameExtension: $0) } }
        return p.runModal() == .OK ? p.url?.path : nil
    }

    func json(_ v: Any) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: v, options: .fragmentsAllowed), as: UTF8.self) }
    func js(_ s: String) { web.evaluateJavaScript(s) }
    func reply(_ id: Int, _ v: Any) { js("bridge.reply(\(id), \(json(v)))") }

    func follow(_ href: String, _ base: String?) throws -> Any {
        switch try linkTarget(href, base: base) {
        case .web(let u): NSWorkspace.shared.open(u)
        case .map(let p): return try readFile(p)
        case .show(let p):   // «перейти», а не открыть: файл выделяется в Finder, ничего не запускается
            var dir: ObjCBool = false
            FileManager.default.fileExists(atPath: p, isDirectory: &dir)
            if dir.boolValue { NSWorkspace.shared.open(URL(fileURLWithPath: p)) } else { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
        }
        return NSNull()
    }

    func printPDF(_ path: String, _ w: Double, _ h: Double, _ done: @escaping (Bool) -> Void) {
        let k = min(1.0, 5000 / max(w, h) / 0.2646)   // PDF ограничивает страницу ~5 м; 1 CSS px = 0,75 pt
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: w * 0.75 * k, height: h * 0.75 * k)
        (info.topMargin, info.bottomMargin, info.leftMargin, info.rightMargin) = (0, 0, 0, 0)
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = URL(fileURLWithPath: path)
        let op = web.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = web.bounds   // без рамки WKWebView печатает пустую страницу
        printDone = done
        op.runModal(for: win, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        if debug { log("print: success=\(success)") }
        printDone?(success)
    }
    // тест M1: MINDMAP_SNAPSHOT=файл.png — через 3 с после загрузки снимок окна (screencapture по ssh не видит чужие окна)
    func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
        guard let out = ProcessInfo.processInfo.environment["MINDMAP_SNAPSHOT"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            self.log("window: visible=\(self.win.isVisible) onScreen=\(self.win.isOnActiveSpace) frame=\(self.win.frame)")
            v.takeSnapshot(with: nil) { img, _ in
                if let t = img?.tiffRepresentation, let png = NSBitmapImageRep(data: t)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: out))
                }
                NSApp.terminate(nil)
            }
        }
    }
    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) { if debug { log("load: \(e)") } }
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { if debug { log("load: \(e)") } }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if m.name == "log" { return log("\(m.body)") }
        if debug { log("bridge: \(m.body)".prefix(300)) }
        guard let body = m.body as? String, let msg = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any],
              let id = msg["id"] as? Int, let cmd = msg["cmd"] as? String else { return }
        let a = msg["args"] as? [String: Any] ?? [:]
        let str = { (k: String) in a[k] as? String }
        var val: Any = NSNull()
        do {
            switch cmd {
            case "ready":
                started = true
                var file: Any = NSNull()
                if let p = start {   // нет файла — новая карта с этим именем, заготовку сделает JS
                    file = FileManager.default.fileExists(atPath: p) ? try readFile(p) : ["path": p, "name": name(p), "data": NSNull()]
                }
                val = ["file": file, "pdf": pdfOut ?? NSNull()]
            case "state":
                dirty = a["dirty"] as? Bool ?? false
                win.title = (str("name") ?? "") + " — Mind Map"
                win.isDocumentEdited = dirty   // точка в кнопке закрытия
                val = true
            case "quit":
                DispatchQueue.main.async { self.win.performClose(nil) }   // как кнопка закрытия: спросит про несохранённое
                val = true
            case "confirm": val = ask(str("text") ?? "")
            case "error": throw Fail(str("text") ?? "")
            case "open": val = try panel().map(readFile) ?? NSNull()
            case "link": val = try follow(str("href") ?? "", str("base"))
            case "save_dialog":
                if var p = panel(save: str("name") ?? "mindmap.mm.md") {
                    if !exts.contains(ext(p)) { p += ".mm.md" }
                    val = p
                }
            case "save": val = try writeFile(str("path") ?? "", str("data") ?? "")
            case "pdf":
                guard let p = str("path") ?? panel(save: str("name") ?? "mindmap.pdf", pdf: true) else { break }
                let num = { (k: String) in (a[k] as? NSNumber)?.doubleValue ?? 100 }
                printPDF(p, num("w"), num("h")) { ok in
                    if !ok { self.fail(tr("Ошибка печати в PDF:") + " " + p) }
                    self.reply(id, ok ? p : NSNull())
                    if self.pdfOut != nil { NSApp.terminate(nil) }
                }
                return   // ответ придёт по завершении печати
            default: throw Fail("неизвестная команда \(cmd)")
            }
        } catch {   // файл не прочитался/не записался — показываем, данные в редакторе целы
            fail(error.localizedDescription)
        }
        reply(id, val)
    }

    // страховка: окно никогда не уходит с карты (ссылка мимо JS, брошенный файл)
    func webView(_ v: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = a.request.url, !(u.isFileURL && u.path == page.path) else { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        if u.isFileURL { js("dropUris([\(json(u.absoluteString))])") }
        else { do { _ = try follow(u.absoluteString, nil) } catch { fail(error.localizedDescription) } }
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
