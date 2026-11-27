#!/bin/bash
# Selection Colors - macOS uninstaller
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SelectionColors"
if [ -d "$DEST" ]; then
  rm -rf "$DEST" && echo "Removed $DEST"
else
  echo "Not installed."
fi
echo "PlayerDebugMode was left on, since other unsigned extensions may rely on it."
echo
read -n 1 -s -r -p "Press any key to close this window..."; echo
