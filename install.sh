#!/usr/bin/env bash
# Selection Colors - one-line Mac installer.
# Run with:
#   curl -fsSL https://raw.githubusercontent.com/losarne/selectionColors/main/install.sh | bash
# Fetches the extension straight from GitHub and installs it - no zip to download,
# unzip or double-click, so there's nothing for Gatekeeper or a lost executable
# bit to block.
set -e

REPO_ZIP="https://github.com/losarne/selectionColors/archive/refs/heads/main.zip"
DEST_PARENT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$DEST_PARENT/SelectionColors"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Selection Colors - installer"
echo "Downloading..."
curl -fsSL "$REPO_ZIP" -o "$TMP/repo.zip"

echo "Unpacking..."
unzip -q "$TMP/repo.zip" -d "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name 'selectionColors-*')/extension"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Download looked wrong - could not find the extension inside it." >&2
  exit 1
fi

echo "Enabling unsigned CEP extensions (PlayerDebugMode) for CSXS 9-14..."
for v in 9 10 11 12 13 14; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Installing to:"
echo "  $DEST"
mkdir -p "$DEST_PARENT"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo
echo "Done. Quit and restart After Effects / Illustrator / InDesign, then open:"
echo "  Window > Extensions > Selection Colors"
