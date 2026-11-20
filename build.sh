#!/bin/sh
# ./build.sh [версия] — собирает dist/mindmap_<версия>_all.deb и dist/mindmap.run
# GTK3/WebKit2GTK не вкладываются — берутся из системы (Depends в .deb).
set -eu
umask 022
cd "$(dirname "$0")"
VER=${1:-0.3.2}
MAINT="$(git config user.name || echo mindmap) <$(git config user.email || echo mindmap@localhost)>"
DEPS='python3 (>= 3.8), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1'
mkdir -p dist && rm -f dist/mindmap_*.deb dist/mindmap.run   # .dmg кладёт macos/build.sh — не трогаем
tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT

# файлы приложения: без тестов
app="$tmp/app" && mkdir -p "$app"
cp mindmap.py "$app/" && chmod 755 "$app/mindmap.py"
cp -r web "$app/" && rm -f "$app/web/mdtree.test.js" "$app/web/BRIDGE.md"

# ---------- .deb ----------
r="$tmp/deb"
mkdir -p "$r/DEBIAN" "$r/usr/bin" "$r/usr/share/applications" "$r/usr/share/doc/mindmap" \
  "$r/usr/share/mime/packages" "$r/usr/share/icons/hicolor/scalable/apps"
cp -r "$app" "$r/usr/share/mindmap"
ln -s ../share/mindmap/mindmap.py "$r/usr/bin/mindmap"   # mindmap.py ищет web/ по realpath — симлинк годится
cp web/icon.svg "$r/usr/share/icons/hicolor/scalable/apps/mindmap.svg"
# ярлык; text/markdown — только в «Открыть с помощью», своё — у *.mm.md
cat > "$r/usr/share/applications/mindmap.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Mind Map
GenericName=Mind map editor
GenericName[ru]=Редактор интеллект-карт
GenericName[es]=Editor de mapas mentales
GenericName[fr]=Éditeur de cartes mentales
GenericName[de]=Mindmap-Editor
GenericName[zh_CN]=思维导图编辑器
Comment=Mind maps in Markdown, FreeMind, OPML and XMind
Comment[ru]=Интеллект-карты в Markdown, FreeMind, OPML и XMind
Comment[es]=Mapas mentales en Markdown, FreeMind, OPML y XMind
Comment[fr]=Cartes mentales en Markdown, FreeMind, OPML et XMind
Comment[de]=Mindmaps in Markdown, FreeMind, OPML und XMind
Comment[zh_CN]=Markdown、FreeMind、OPML 和 XMind 格式的思维导图
Exec=mindmap %f
Icon=mindmap
Terminal=false
StartupWMClass=mindmap
MimeType=text/x-markmap;application/x-freemind;text/x-opml+xml;application/vnd.xmind.workbook;text/markdown;
Categories=Office;
Keywords=mindmap;markmap;markdown;freemind;freeplane;xmind;opml;интеллект-карта;mapa mental;carte mentale;思维导图;
EOF
# типы файлов: *.mm.md — соглашение markmap (обычный Markdown, но со своим типом — двойной клик открывает карту);
# FreeMind и XMind в shared-mime-info нет: *.mm без этого — troff, *.xmind — zip
cat > "$r/usr/share/mime/packages/mindmap.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="text/x-markmap">
    <comment>Mind map (Markdown)</comment>
    <comment xml:lang="ru">Интеллект-карта (Markdown)</comment>
    <comment xml:lang="es">Mapa mental (Markdown)</comment>
    <comment xml:lang="fr">Carte mentale (Markdown)</comment>
    <comment xml:lang="de">Mindmap (Markdown)</comment>
    <comment xml:lang="zh_CN">思维导图（Markdown）</comment>
    <sub-class-of type="text/markdown"/>
    <icon name="mindmap"/>
    <glob pattern="*.mm.md"/>
  </mime-type>
  <mime-type type="application/x-freemind">
    <comment>FreeMind mind map</comment>
    <comment xml:lang="ru">Интеллект-карта FreeMind</comment>
    <comment xml:lang="es">Mapa mental de FreeMind</comment>
    <comment xml:lang="fr">Carte mentale FreeMind</comment>
    <comment xml:lang="de">FreeMind-Mindmap</comment>
    <comment xml:lang="zh_CN">FreeMind 思维导图</comment>
    <sub-class-of type="application/xml"/>
    <icon name="mindmap"/>
    <glob pattern="*.mm" weight="60"/>
    <magic><match type="string" offset="0" value="&lt;map version"/></magic>
  </mime-type>
  <mime-type type="application/vnd.xmind.workbook">
    <comment>XMind workbook</comment>
    <comment xml:lang="ru">Интеллект-карта XMind</comment>
    <comment xml:lang="es">Libro de trabajo de XMind</comment>
    <comment xml:lang="fr">Classeur XMind</comment>
    <comment xml:lang="de">XMind-Arbeitsmappe</comment>
    <comment xml:lang="zh_CN">XMind 工作簿</comment>
    <sub-class-of type="application/zip"/>
    <icon name="mindmap"/>
    <glob pattern="*.xmind"/>
  </mime-type>
</mime-info>
EOF
{ echo 'Mind Map — лицензия MIT:'; echo; cat LICENSE; echo; echo 'Сторонние компоненты в /usr/share/mindmap/web/vendor:'
  for f in web/vendor/LICENSE.*; do echo; echo "== ${f##*.} =="; cat "$f"; done; } > "$r/usr/share/doc/mindmap/copyright"
printf 'mindmap (%s) unstable; urgency=low\n\n  * Сборка из git %s.\n\n -- %s  %s\n' \
  "$VER" "$(git rev-parse --short HEAD)" "$MAINT" "$(date -R)" | gzip -9n > "$r/usr/share/doc/mindmap/changelog.gz"
cat > "$r/DEBIAN/control" <<EOF
Package: mindmap
Version: $VER
Architecture: all
Maintainer: $MAINT
Depends: $DEPS
Section: editors
Priority: optional
Installed-Size: $(du -sk "$r/usr" | cut -f1)
Description: lightweight offline mind map editor based on markmap
 View and edit mind maps: Markdown (*.mm.md), FreeMind, OPML, XMind;
 PDF export. GTK3 + WebKit2GTK, works offline.
 UI languages: English, Russian, Spanish, French, German, Chinese.
EOF
fakeroot dpkg-deb --build "$r" "dist/mindmap_${VER}_all.deb" >/dev/null

# ---------- самораспаковывающийся mindmap.run ----------
tar czf "$tmp/app.tgz" -C "$app" .
hash=$(sha256sum "$tmp/app.tgz" | cut -c1-12)
cat > dist/mindmap.run <<EOF
#!/bin/sh
# Mind Map $VER — распаковывается в кэш при первом запуске. Нужны: $DEPS
set -e
d="\${XDG_CACHE_HOME:-\$HOME/.cache}/mindmap/$hash"
if [ ! -f "\$d/mindmap.py" ]; then
  mkdir -p "\$d.tmp" && tail -n +\$(( \$(grep -an '^__ARCHIVE__\$' "\$0" | cut -d: -f1) + 1 )) "\$0" | tar xz -C "\$d.tmp"
  rm -rf "\$d" && mv "\$d.tmp" "\$d"
fi
exec python3 "\$d/mindmap.py" "\$@"
__ARCHIVE__
EOF
cat "$tmp/app.tgz" >> dist/mindmap.run && chmod 755 dist/mindmap.run
ls -l dist
