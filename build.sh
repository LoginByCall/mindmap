#!/bin/sh
# ./build.sh [версия] — собирает dist/mindmap_<версия>_all.deb и dist/mindmap.run
# GTK3/WebKit2GTK не вкладываются — берутся из системы (Depends в .deb).
set -eu
umask 022
cd "$(dirname "$0")"
VER=${1:-0.1.0}
MAINT="$(git config user.name || echo mindmap) <$(git config user.email || echo mindmap@localhost)>"
DEPS='python3 (>= 3.8), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1'
rm -rf dist && mkdir -p dist
tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT

# файлы приложения: без тестов
app="$tmp/app" && mkdir -p "$app"
cp mindmap.py "$app/" && chmod 755 "$app/mindmap.py"
cp -r web "$app/" && rm -f "$app/web/mdtree.test.js"

# ---------- .deb ----------
r="$tmp/deb"
mkdir -p "$r/DEBIAN" "$r/usr/bin" "$r/usr/share/applications" "$r/usr/share/doc/mindmap"
cp -r "$app" "$r/usr/share/mindmap"
ln -s ../share/mindmap/mindmap.py "$r/usr/bin/mindmap"   # mindmap.py ищет web/ по realpath — симлинк годится
cat > "$r/usr/share/applications/mindmap.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Mind Map
Comment=Редактор интеллект-карт на markmap
Exec=mindmap %f
Icon=x-office-drawing
Terminal=false
MimeType=text/markdown;application/x-freemind;text/x-opml+xml;application/vnd.xmind.workbook;
Categories=Office;
EOF
{ echo 'Сторонние компоненты в /usr/share/mindmap/web/vendor:'; for f in web/vendor/LICENSE.*; do echo; echo "== ${f##*.} =="; cat "$f"; done; } \
  > "$r/usr/share/doc/mindmap/copyright"
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
Description: лёгкий редактор интеллект-карт на markmap
 Просмотр и правка mind map: Markdown, FreeMind, OPML, XMind; экспорт в PDF.
 GTK3 + WebKit2GTK, работает без сети.
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
