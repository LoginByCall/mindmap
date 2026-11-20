# Mind Map — a lightweight editor built on markmap

[Русский](README.md) · **English** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [中文](README.zh.md)

View and edit mind maps on Linux and macOS. GTK3 + WebKit2GTK (system packages) with [markmap](https://github.com/markmap/markmap) 0.18.12 and d3 7.9.0 inside, kept locally in `web/vendor/`; no network needed.

## Running

```sh
./mindmap.py [map.mm.md|.mm|.opml|.xmind]
./mindmap.py map.mm.md --pdf map.pdf     # headless export
```

Dependencies (Debian/Ubuntu): `python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1`.

## Installation

```sh
./build.sh [version]     # default 0.4.0 → dist/mindmap_0.4.0_all.deb and dist/mindmap.run
sudo apt install ./dist/mindmap_0.4.0_all.deb
```

The package installs the `mindmap` command, a "Mind Map" launcher in the application menu, an icon and file types; apt pulls in the dependencies.

`mindmap.run` is the same in a single file, with no installation (no launcher or file types): on first start it unpacks into `~/.cache/mindmap/<hash>/`, afterwards it starts immediately. It does not include GTK/WebKit — you need the system packages listed above.

### File extension: `.mm.md`

Name your maps like `plan.mm.md` — the same way markmap names them (the VS Code extension). It is plain Markdown: GitHub will render it and any editor will open it, but it has its own type `text/x-markmap`, and a double-click opens the map. Ordinary `.md` files stay with your Markdown editor; Mind Map is available for them under "Open With". A new map is saved as `mindmap.mm.md` by default.

The package also registers `.mm` (FreeMind/Freeplane) and `.xmind` — they are not in the standard type database (`.mm` there is troff). To make Mind Map the default application:

```sh
xdg-mime default mindmap.desktop text/x-markmap application/x-freemind application/vnd.xmind.workbook text/x-opml+xml
```

## macOS

`MindMap-<version>.dmg` from the releases: open it and drag Mind Map to Applications. Universal build (Intel and Apple Silicon), macOS 11 or later. Automatically tested on macOS 14 (Intel); not tested on Apple Silicon.

The app is not signed with an Apple certificate, so macOS blocks the first launch:

- macOS 14 and earlier: right-click Mind Map in Applications → Open → Open;
- macOS 15 and later: try to open it, then System Settings → Privacy & Security → Open Anyway;
- or in Terminal: `xattr -dr com.apple.quarantine /Applications/MindMap.app`.

After that it starts normally. Double-click opens `.mm`, `.opml` and `.xmind`; `.md` via Open With. Shortcuts use ⌘ instead of Ctrl. Export without UI: `/Applications/MindMap.app/Contents/MacOS/mindmap map.mm.md --pdf map.pdf` (the map is drawn on screen, so the display must be awake).

Building runs on a Mac with Command Line Tools (`xcode-select --install`), driven from Linux over ssh:

```sh
MAC=user@host macos/build.sh [version]     # → dist/MindMap-<version>.dmg
MAC=user@host python3 tests/test_mac.py    # on the Mac: launch, PDF, formats, languages
```

## Features

- Interface, help and tutorial languages: Russian, English, Spanish, French, German, Simplified Chinese. Chosen by the system locale, English for the rest; to force one — `LANGUAGE=de mindmap`.
- Zoom: wheel, touchpad pinch, `Ctrl+=` / `Ctrl+-`; `Ctrl+0` — fit to window.
- Creating and editing a map: on the graph (double-click a title or list, right-click menu, keys) and in the Markdown source (`Ctrl+E` — show/hide). Both sides stay in sync.
- Help — `F1` or "?"; "File → Tutorial" — a practice map with checkbox tasks.
- Text is edited right in the node, with no separate field on top.
- "Grab and drag": a branch by its title — onto the top third of another branch (insert before), the bottom third (after) or the middle (make it a child). Near the canvas edge (40 px) it scrolls by itself. Esc cancels, Ctrl+Z reverts. Dragging empty space pans the canvas.
- Links: `[site](https://…)` — in the browser; `[file](./docs/budget.pdf)`, `[folder](~/Documents)` — shown in the file manager with the item selected (nothing is launched); `[map](network.md)` — opens here; `[see](#node-title)` — jumps to a node. Relative paths are resolved from the map folder.
- You can drop a file or link onto a node — a child link branch appears (an image — `![](…)`).
- CommonMark numbered lists (`1.`, `1)`, the first number is kept): "Branches: numbering" and "List: numbering" in the branch menu, "1. " on the first line in the list field. Markdown has no lettered lists.
- Images `![](photo.jpg)` in nodes, checkboxes `- [ ] to do` / `- [x] done` (a click toggles).
- A note under a node — lines `> text`, a list — `> - item`. In .mm/.opml/.xmind the note and the list are stored in a single field.
- "File" menu: new, open, save, save as, export to PDF, quit (`Ctrl+Q`, asks about unsaved changes).
- A list under the node's line — in small type, collapsed by clicking ▾/▸. Edited in one field (double-click the list, `Shift+Enter` or the menu): a line is an item, `Shift+Enter` — new line, `Enter` — done, `Esc` — cancel. Empty lines are dropped, an empty field removes the list.
- Branch context menu: add child/sibling, rename, color (palette, custom, reset), collapse, move up/down, promote/demote, copy/cut/paste, delete. On empty space: fit, expand/collapse all, source, PDF.
- Keys: `Tab`/`Enter` — child/sibling, `Shift+Enter` — list under the node, `F2` — edit, `Del` — delete, `Space` — collapse, arrows — navigate, `Alt+arrows` — move, `Ctrl+Z`/`Ctrl+Y` — undo/redo, `Ctrl+N/O/S/Shift+S/P/Q`.
- Formats: Markdown (`.mm.md`, `.md`), FreeMind/Freeplane (`.mm`, XML), OPML (`.opml`, XML), XMind 2020+ (`.xmind`). The format on save is chosen by the extension.
- PDF export: vector, a single page sized to the map.

## Markdown storage

The structure is headings, list items and paragraphs (as in markmap). Branch color — `<!-- color: #e15759 -->`, folding — the standard markmap comment `<!-- markmap: fold -->`. The color is inherited by descendants.

A list under a node is a blockquote right under the node's line (indented like the item), a collapsed one carries the `<!-- notes: fold -->` marker:

```markdown
## Goals <!-- notes: fold -->
> - deadline: May
> - budget

- First goal
  > - metric: NPS > 40
  - subgoal
```

Plain markmap will show such a blockquote as a child node — no content is lost.

## Limitations

- Editing on the graph rewrites Markdown into canonical form (lists indented by 2 spaces, blank lines around headings). A file edited only in the source is saved byte for byte.
- `.mm`/`.opml`/`.xmind` keep text, hierarchy, folding (except OPML) and color (except XMind). A list under a node is written as a note: FreeMind `richcontent NOTE`, OPML `_note`, XMind `notes`; its collapsed state does not carry over into these formats. The list is single-level. Icons, notes, relations and styles from other editors are lost on re-save.
- XMind 8 (`content.xml`) cannot be read. Opening a saved `.xmind` in XMind itself has not been tested.
- KaTeX formulas and code highlighting are disabled (they pull resources from a CDN).
- Only expanded branches go into the PDF.

## Tests

```sh
python3 tests/test_formats.py  # .mm / .opml / .xmind in web/formats.js against the 0.3.2 reference
python3 tests/test_shell.py    # mindmap.py shell: files, links
node web/mdtree.test.js      # Markdown ⇄ tree
python3 tests/test_i18n.py   # web/lang/*.json translations are complete, anchors in the maps are live
python3 tests/test_ui.py     # UI in headless Chrome (synthetic events)
python3 tests/test_pdf.py    # PDF export in real GTK: the whole map fits the page (needs a display)
node tests/ui-input.mjs      # UI with real mouse input (Chrome DevTools Protocol)
python3 tests/test_mac.py    # macOS build on the Mac over ssh (see “macOS”)
```

Debugging: `MINDMAP_DEBUG=1 ./mindmap.py` — WebKit inspector and `console.log` to stdout. On a Mac: `MINDMAP_DEBUG=1 /Applications/MindMap.app/Contents/MacOS/mindmap` — bridge commands and JS console to stderr.

## License

[MIT](LICENSE). `web/vendor/` holds markmap (MIT) and d3 (ISC); their licenses sit alongside.
