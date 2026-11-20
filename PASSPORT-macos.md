# Паспорт задачи: Mind Map для macOS

**Статус:** закрыта. Выпущены v0.4.0 (macOS) и v0.4.1 (сопровождение). Установлено 0.4.1: этот ПК (Ubuntu, .deb), iMac (`/Applications/MindMap.app`).

## Критические требования (дословно)

- «И затем портируй версию для mac os»
- Оболочка: «Swift + WKWebView»
- Распространение: «Без подписи»
- Проверка: «Импользуй мой iMac (посмотри в проекте AnyPC»

## Критерии приёмки

| # | Критерий | Проверка |
|---|---|---|
| M1 | `.app` запускается на iMac (macOS 14, x86_64), стартовая карта видна за ≤ 3 с | запуск по ssh + скриншот `screencapture` |
| M2 | Открытие и сохранение `.mm.md`, `.md`, `.mm`, `.opml`, `.xmind` дают на Mac и Linux одинаковые байты (общий JS) | node-тест форматов + сравнение файлов с iMac |
| M3 | Экспорт в PDF: одна страница, нижняя и самая длинная ветки внутри страницы (как `tests/test_pdf.py`) | `MindMap.app/Contents/MacOS/mindmap --pdf` на iMac + pdftotext на Linux |
| M4 | Двойной клик по `.mm.md` / `.mm` / `.opml` / `.xmind` в Finder открывает карту | вручную на iMac (карточка) |
| M5 | Язык интерфейса — по языку системы (ru/en/es/fr/de/zh, прочие → en) | запуск с `-AppleLanguages '(de)'` |
| M6 | Сочетания с ⌘ вместо Ctrl (⌘S, ⌘Z, ⌘Q…); правка текста в полях: копирование, вставка, отмена | вручную + тест keydown с metaKey |
| M7 | Щипок тачпада/мыши Magic — масштаб карты, а не страницы | вручную на iMac |
| M8 | Linux-версия после переноса форматов в JS проходит все прежние тесты | прогон 6 тестов |
| M9 | `.dmg` ≤ 10 МБ; бинарник universal (x86_64 + arm64) | `lipo -info`, размер. arm64 — **не проверяется** (нет устройства) |
| M10 | README (6 языков): установка на Mac и первый запуск неподписанного приложения | ревью |

## Допущения

- [измерено: 2026-11-20, iMac] WKWebView на macOS 14 — `DecompressionStream('deflate-raw')` есть; WebKitGTK 2.52 — тоже (`.xmind` открывается в test_pdf.py).
- [ПРЕДПОЛОЖЕНИЕ] Щипок в WKWebView приходит в страницу событиями `gesturestart/gesturechange` → обработчик в app.js; проверка — ручная (M7), нужен трекпад (у Magic Mouse щипка нет).
- [измерено: 2026-11-20, iMac] Печать `printOperation` + `jobDisposition = .save` + `runModal(for:)` учитывает `@media print`, страница ровно w×h·0,75 pt, без множителя WebKitGTK (M3).
- [измерено: 2026-11-20, iMac] Со спящим дисплеем WebKit не рисует кадры — карта не достраивается, `--pdf` висит. Тест будит дисплей `caffeinate -u`.
- [измерено: 2026-11-20, iMac] `screencapture` по ssh без разрешения «Запись экрана» видит только обои → M1 снимает само приложение (`MINDMAP_SNAPSHOT`).
- [измерено: 2026-11-20, iMac] CLT 16.2: лишний `usr/include/swift/module.modulemap` (2023, ничей) ломает `import WebKit` → `-vfsoverlay` в macos/build.sh, root не нужен.
- [ПРЕДПОЛОЖЕНИЕ] Приложение, запущенное по ssh тем же пользователем (`open`), появляется в его графической сессии — iMac: пользователь `alexander` в консоли.
- [измерено: 2026-11-20, iMac] macOS 14.8.1 (23J30), x86_64, Command Line Tools без Xcode, Swift 6.0.3, SDK 15.2, python3 есть, node нет.
- Доступ: `ssh alexander@192.168.88.250`. Правило из AnyPC: сборку и проверку класть архивом в `/tmp/<каталог>` и после удалять.

## Решение (ADR)

- **Контекст:** на macOS нет WebKit2GTK; интерфейс (`web/`) общий, оболочку пишем заново.
- **Варианты:** Python + pywebview (повтор `mindmap.py`, ~40 МБ) · Swift + WKWebView (нативно, ~3 МБ, форматы — в JS).
- **Выбор владельца:** Swift + WKWebView.
- **Следствия:** чтение/запись `.mm/.opml/.xmind` и разбор ссылок переезжают из `mindmap.py` в `web/formats.js`; обе оболочки только читают/пишут байты, показывают диалоги и печатают. Контракт моста `bridge.call(cmd, args)` — общий, описать в `web/BRIDGE.md`.

## Затронутые контракты

- Мост JS ⇄ оболочка (внутренний): `ready, state, quit, confirm, open, link, save_dialog, save, pdf` — меняется: `open/save` начинают передавать байты (base64 для `.xmind`), разбор форматов — в JS. NOTIFY.
- Форматы файлов (внешний, A2 #9): **не меняются** — байты на выходе должны совпасть с 0.3.2 (M2).

## Этапы

1. **Форматы в JS.** `web/formats.js`: `mm/opml/xmind` чтение/запись (XML — DOMParser/XMLSerializer; zip — свой store-only писатель + CRC32, чтение через `DecompressionStream`). Node-тест вместо `test_formats.py` на тех же данных + сравнение с выводом Python 0.3.2 байт-в-байт. `mindmap.py` отдаёт/принимает байты. Опыт на iMac: `DecompressionStream` в WKWebView. Конец этапа: M8.
2. **Контракт моста.** `web/BRIDGE.md` (≤ 1 стр.): команды, аргументы, ответы, что делает оболочка. Сочетания: ⌘ = Ctrl (app.js уже понимает `metaKey` в keydown, стр. ~605; проверить клик по кружку `e.ctrlKey` стр. 134), в справке на Mac «Ctrl+» → «⌘».
3. **Оболочка Swift.** `macos/main.swift` (~300 строк, один файл): NSApplication/NSWindow/WKWebView, `WKScriptMessageHandler` «app», NSOpenPanel/NSSavePanel, NSAlert, NSWorkspace (сайт — браузер, файл — `activateFileViewerSelecting`), печать в PDF, меню (приложение, «Правка» для полей ввода, ⌘Q), закрытие с вопросом о несохранённом, `application(_:open:)` для Finder, язык — `Locale.preferredLanguages`, словарь — `WKUserScript` до app.js, `--pdf` без окна для тестов.
4. **Сборка.** `macos/build.sh` на iMac по ssh: `swiftc` для x86_64 и arm64 → `lipo`, `.app` (Info.plist: типы файлов `*.mm.md`, `.mm`, `.opml`, `.xmind`; значок `.icns` из `web/icon.svg` — PNG делаем на Linux `rsvg-convert`, `iconutil` на Mac), `codesign -s -` (ad-hoc), `.dmg` через `hdiutil`. Забрать `.dmg` в `dist/`, `/tmp/<каталог>` на iMac удалить.
5. **Проверка на iMac.** Автоматически: M1 (запуск + `screencapture`), M3 (PDF), M5 (языки), M2 (файлы). Вручную — карточка ИЗМЕРЕНИЕ для владельца: M4, M6, M7, первый запуск неподписанного (Gatekeeper).
6. **Документы и выпуск.** README ×6 — раздел macOS; `.github` не нужен (сборка на iMac). Выпуск 0.4.0 — только по слову владельца.

## Лог решений

- [2026-11-20] ASK — оболочка Swift + WKWebView (владелец), вместо рекомендованного pywebview.
- [2026-11-20] ASK — без подписи Apple (владелец).
- [2026-11-20] ASK — проверка на iMac владельца по ssh (владелец), не GitHub Actions.
- [2026-11-20] AUTO — сборка тоже на iMac (CLT есть, Xcode не нужен); CI не заводим.
- [2026-11-20] AUTO — задача не влезала в остаток окна сессии 0.3.x: паспорт записан, работа — с новой сессии.
- [2026-11-20] NOTIFY — мост: `open/save/link/ready` передают байты base64, новая команда `error`, `openFile` (web/BRIDGE.md). Формат файлов не менялся: .mm/.opml байт-в-байт с 0.3.2.
- [2026-11-20] AUTO — `.xmind` пишется stored-zip (без сжатия): свой zip-писатель короче, чем deflate через CompressionStream с асинхронностью.
- [2026-11-20] AUTO — старый test_formats.py → tests/test_shell.py (оболочка) + tests/test_formats.py (JS); те же случаи ссылок — самотест Swift при сборке.
- [2026-11-20] AUTO — минимум macOS 11 (UTType, printOperation); на Mac несохранённое — точка в кнопке закрытия, без «●» в заголовке.
- [2026-11-20] AUTO — дефект (владелец, ИЗМЕРЕНИЕ #1): SIGSEGV при закрытии окна — окно освобождалось при закрытии, а applicationShouldTerminate обращался к нему. `isReleasedWhenClosed = false`; регрессия — test_mac.py закрывает окно и ждёт `exit: ok` (без исправления — FAIL).
- [2026-11-20] AUTO — владелец: граница «исходник | карта» не двигается — разделителя не было и на Linux (ширина 38 %). Добавлен `#split`, тянется мышью; регрессия — ui-input.mjs (настоящая мышь).
- [2026-11-20] ASK — владелец: «A, запоминай ширину и выпускай». Ширина исходника — в localStorage; переживает перезапуск в WebKitGTK и WKWebView [измерено: пробники, 2026-11-20]. Выпуск v0.4.0.
- [2026-11-20] AUTO — нестабильная проверка ui-smoke «markdown rendered in node» (фикс. 400 мс) → опрос до 3 с.
- [2026-11-20] AUTO — владелец: в Ubuntu App Center «??????» в описании. Причина — русское Description установленной 0.2.0 (App Center берёт описание из dpkg, кириллицу не показывает); в 0.3.0+ оно уже ASCII. Регрессия — test_shell.py (Description в build.sh только ASCII).
- [2026-11-20] AUTO — иконка, издатель, лицензия, дата в App Center для локального .deb — «Unknown» всегда: зашито в app-center (`AppTitle.fromLocalDeb`, `published => null`) и PackageKit apt (`"unknown"`, apt-job.cpp:806). Не чиним.
- [2026-11-20] AUTO — в .deb добавлено поле `Homepage` (ссылка «Developer website»).
- [2026-11-20] AUTO — «О программе» — строка «Mind Map <версия> · github.com/LoginByCall/mindmap» под заголовком справки, без перевода; отдельного окна нет. Версия — одна: `const VERSION` в web/app.js, build.sh и macos/build.sh берут её оттуда. Регрессия — ui-smoke.js.
- [2026-11-20] ASK — владелец: «выпускай 0.4.1». Выпуск v0.4.1 (.deb, .run, .dmg), установка на этом ПК (pkexec apt-get) и на iMac (замена .app по ssh).

## Верификация

| # | Статус | Чем |
|---|---|---|
| M1 | ✓ V1 | test_mac.py: окно видно, снимок карты через 3 с |
| M2 | ✓ V1 | test_formats.py (байт-в-байт .mm/.opml), test_pdf.py (GTK), test_mac.py (Mac) |
| M3 | ✓ V1 | test_mac.py: 1 страница 850×368 pt, ветки внутри |
| M4 | ✓ V2 | владелец на iMac: «на мак ок» |
| M5 | ✓ V1 | test_mac.py: de, zh-Hans, ja→en, ru |
| M6 | ✓ V2 | подписи ⌘ — test_ui.py; поведение — владелец на iMac |
| M7 | ✓ V2 | владелец на iMac: «на мак ок» (пункт про щипок отдельно не подтверждался) |
| M8 | ✓ V1 | Linux: test_i18n, test_formats, test_shell, test_ui, test_pdf, mdtree, ui-input |
| M9 | ✓ V0 | .dmg 0,9 МБ, x86_64+arm64; arm64 не запускался |
| M10 | ✓ | README ×6, раздел macOS |

## СЛЕДУЮЩИЙ ШАГ

- Нет. Следующий выпуск: поднять `VERSION` в web/app.js и номер в README ×6, `./build.sh`, `macos/build.sh`, `gh release create`.

## Ожидает человека

- Глазами: справка (F1) в 0.4.1 на ПК и на iMac показывает версию, клик по ссылке открывает браузер (в настоящих окнах не проверялось).
- M7 (щипок) отдельно не подтверждён.

## Риски

- WKWebView печатает иначе, чем WebKitGTK → PDF обрезан/мелкий → митигация: метки-замер как в 0.3.2, тест M3 на iMac.
- arm64 не проверить → бинарник собираем universal, в README честно: «на Apple Silicon не проверено».
- Gatekeeper на новых macOS ужесточается (15+: только через «Настройки → Конфиденциальность») → инструкция в README; если откажет совсем — вопрос владельцу о Developer ID.
- Перенос форматов в JS ломает совместимость файлов → сравнение байт-в-байт с выводом 0.3.2 (M2) до замены Python-кода.
