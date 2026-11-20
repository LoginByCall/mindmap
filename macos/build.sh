#!/bin/sh
# macos/build.sh [версия] — собирает dist/MindMap.dmg (universal x86_64 + arm64, ad-hoc подпись) на Маке по ssh.
# Здесь (Linux): значок PNG из web/icon.svg и архив исходников. На Маке (нужны только Command Line Tools):
# swiftc, lipo, iconutil, codesign, hdiutil во временной папке /tmp, которая после удаляется.
set -eu
cd "$(dirname "$0")/.."
VER=${1:-0.4.0}
MAC=${MAC:-alexander@192.168.88.250}
tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
s="$tmp/src" && mkdir -p "$s/MindMap.iconset"
cp macos/main.swift "$s/"
cp -r web "$s/" && rm -f "$s/web/mdtree.test.js" "$s/web/BRIDGE.md"

# значок: все размеры .iconset (iconutil соберёт .icns)
python3 - "$s/MindMap.iconset" <<'EOF'
import sys, gi
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf
for n in (16, 32, 128, 256, 512):
    for k, suf in ((1, ''), (2, '@2x')):
        GdkPixbuf.Pixbuf.new_from_file_at_size('web/icon.svg', n * k, n * k).savev(f'{sys.argv[1]}/icon_{n}x{n}{suf}.png', 'png', [], [])
EOF

# .md — только «Открыть с помощью»; .mm/.opml/.xmind — открываются двойным кликом
cat > "$s/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Mind Map</string>
<key>CFBundleDisplayName</key><string>Mind Map</string>
<key>CFBundleExecutable</key><string>mindmap</string>
<key>CFBundleIdentifier</key><string>io.github.loginbycall.mindmap</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VER</string>
<key>CFBundleVersion</key><string>$VER</string>
<key>CFBundleIconFile</key><string>mindmap</string>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleLocalizations</key><array><string>en</string><string>ru</string><string>es</string><string>fr</string><string>de</string><string>zh-Hans</string></array>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleDocumentTypes</key><array>
 <dict><key>CFBundleTypeName</key><string>Mind map</string><key>CFBundleTypeRole</key><string>Editor</string>
  <key>LSHandlerRank</key><string>Default</string><key>CFBundleTypeIconFile</key><string>mindmap</string>
  <key>CFBundleTypeExtensions</key><array><string>mm</string><string>opml</string><string>xmind</string></array></dict>
 <dict><key>CFBundleTypeName</key><string>Markdown</string><key>CFBundleTypeRole</key><string>Editor</string>
  <key>LSHandlerRank</key><string>Alternate</string>
  <key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string></array></dict>
</array>
</dict></plist>
EOF

# ponytail: CLT 16.2 на Маке с лишним include/swift/module.modulemap (хвост старой версии) не собирает WebKit —
# прячем файл через vfsoverlay; на исправной установке подмена безвредна
d=/tmp/mm-build.$$
tar -C "$s" -czf - . | ssh "$MAC" "set -e; rm -rf $d; mkdir $d; trap 'rm -rf $d' EXIT; cd $d; tar xzf -
  : > empty.modulemap
  printf '%s' '{\"version\":0,\"roots\":[{\"type\":\"directory\",\"name\":\"/Library/Developer/CommandLineTools/usr/include/swift\",\"contents\":[{\"type\":\"file\",\"name\":\"module.modulemap\",\"external-contents\":\"$d/empty.modulemap\"}]}]}' > vfs.yaml
  for a in x86_64 arm64; do swiftc -O -target \$a-apple-macos11 -vfsoverlay vfs.yaml main.swift -o mindmap-\$a >&2; done
  A=dmg/MindMap.app/Contents; mkdir -p \$A/MacOS \$A/Resources
  lipo -create -output \$A/MacOS/mindmap mindmap-x86_64 mindmap-arm64
  cp Info.plist \$A/; cp -R web \$A/Resources/
  iconutil -c icns MindMap.iconset -o \$A/Resources/mindmap.icns
  codesign --force -s - dmg/MindMap.app >&2
  ln -s /Applications dmg/Applications
  hdiutil create -quiet -volname 'Mind Map' -srcfolder dmg -format UDZO MindMap.dmg
  cat MindMap.dmg" > "$tmp/MindMap.dmg"
mkdir -p dist && mv "$tmp/MindMap.dmg" "dist/MindMap-$VER.dmg"
ls -l "dist/MindMap-$VER.dmg"
