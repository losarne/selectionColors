#!/bin/bash
# Selection Colors - macOS installer (After Effects, Illustrator, InDesign)
cd "$(dirname "$0")" || exit 1
SRC="$PWD/SelectionColors"
DEST_PARENT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$DEST_PARENT/SelectionColors"

finish() { echo; read -n 1 -s -r -p "Press any key to close this window..."; echo; exit "$1"; }

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Could not find the SelectionColors folder next to this installer."
  echo "Unzip the whole download first, then run this file again."
  finish 1
fi

echo "Enabling unsigned CEP extensions (PlayerDebugMode) for CSXS 9-14..."
for v in 9 10 11 12 13 14; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Copying extension to:"
echo "  $DEST"
mkdir -p "$DEST_PARENT" || { echo "Could not create $DEST_PARENT"; finish 1; }
rm -rf "$DEST"
if ! cp -R "$SRC" "$DEST"; then
  echo "Copy failed. Quit After Effects, Illustrator and InDesign and try again."
  finish 1
fi
# Downloaded files are quarantined by macOS; clear that so the panel and eyedropper can load.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo
echo "Done. Restart After Effects / Illustrator / InDesign, then open:"
echo "  Window > Extensions > Selection Colors"
finish 0
