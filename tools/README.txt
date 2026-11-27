SELECTION COLORS for After Effects, Illustrator and InDesign  (v1.5.4)
Figma's "Selection colors" module, as a panel for AE 2022+, Illustrator 2022+ and InDesign 2022+.

INSTALL - WINDOWS
  1. Close After Effects, Illustrator and InDesign.
  2. Double-click install_windows.bat
  3. Start the app  ->  Window > Extensions > Selection Colors

INSTALL - MAC
  1. Quit After Effects, Illustrator and InDesign.
  2. Open Terminal and paste:
       curl -fsSL https://raw.githubusercontent.com/losarne/selectionColors/main/install.sh | bash
     (Installs straight from GitHub - no zip to download or double-click, so there's no Gatekeeper
     warning and no "appropriate access privileges" error to run into.)
  3. Start the app  ->  Window > Extensions > Selection Colors

  If you'd rather use the files in this folder instead of the one-liner above:
  open Terminal, type  bash  and a space, drag install_mac.command into the window, press Enter.
  (Double-clicking it instead will likely hit a Gatekeeper warning, or an "appropriate access
  privileges" error since zips built on Windows lose the Mac executable bit - see MANUAL INSTALL
  below if so.)

  Updating: just run the installer again - it replaces the old version.

  MANUAL INSTALL - MAC (if install_mac.command won't run at all, e.g. "appropriate access privileges")
  1. Quit After Effects, Illustrator and InDesign.
  2. Open Terminal and run, once:
       for v in 9 10 11 12 13 14; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
  3. In Finder, copy the SelectionColors folder (the one next to this README, containing CSXS/client/jsx/native)
     to:  ~/Library/Application Support/Adobe/CEP/extensions/
     (Go menu > Go to Folder..., paste that path, create "extensions" if it's missing, then drop the
     SelectionColors folder inside it. Replace any existing SelectionColors folder there.)
  4. In Terminal, run (fixes a "cannot be opened" warning on the eyedropper later):
       xattr -dr com.apple.quarantine ~/Library/Application\ Support/Adobe/CEP/extensions/SelectionColors
  5. Start the app  ->  Window > Extensions > Selection Colors

USE
  AE: select layers in a comp.
  Illustrator / InDesign: select objects, or text with the Type tool. Every colour they use is listed, most used first.
  - Type in the hex field, then Enter (or click away) to replace that colour everywhere in the selection.
    Figma shorthands work: "f" = FFFFFF, "1a" = 1A1A1A, "f0a" = FF00AA. Esc cancels.
  - Click the swatch to open the colour picker right under the row:
      drag in the square / hue bar (applied when you let go = one undo step per drag),
      type Hex or R G B (arrow keys nudge, Shift = x10).
      "In selection" / "In project" ("In document") chips: click one to use exactly that colour
      (the same swatch in InDesign, the same CMYK/spot values in Illustrator).
      Close with X (top right) or Done (bottom right).
  - Eyedropper (pipette icon): click any pixel on any monitor to use it. Esc cancels.
      Windows: the screen freezes and a magnifier follows the cursor. First use takes a second
               or two (it compiles a small helper into your Temp folder).
      Mac:     the built-in macOS magnifier loupe (macOS 10.15+).
  - Hover a row and click the crosshair to narrow the layer selection to layers using that colour.
  - The number is how many properties use the colour (hover for a breakdown: fills, strokes, text...).
  - Stacked-squares button: also include everything inside precomps.
  - Every change is a single undo step (Ctrl+Z).

WHAT IT READS / CHANGES  -  AFTER EFFECTS
  Shape fills and strokes, text fill and stroke (per character in AE 24.3+), text animator colours,
  effect colour controls, applied layer styles, light colour, Essential Graphics colour overrides,
  and solid colours.
  - Keyframed colours: every keyframe is listed; only the keyframes that match are changed.
  - Locked layers are unlocked for the edit and re-locked afterwards.

WHAT IT READS / CHANGES  -  ILLUSTRATOR
  Path and compound-path fill/stroke, text fill/stroke (per character), gradient stops,
  inside groups too. RGB, CMYK, Grayscale, Spot and Lab colours.
  - Colours are grouped by their exact values: two CMYK mixes that look identical stay separate rows
    (hover the swatch to see the CMYK / spot values).
  - New colours are made in the document's mode: in a CMYK document, the hex you type is converted
    to CMYK with Illustrator's colour settings, so the row can show a slightly different hex afterwards.
  - Spot colours are replaced on the objects with a process colour; the spot swatch itself is not edited.
  - Gradients are shared: editing a stop changes that gradient everywhere it is used.
  - Not read: colours set only in the Appearance panel / graphic styles, patterns, meshes,
    symbols, placed images.
  - "In document" (picker) lists every colour used in the open document.
  - The whole change is one undo step.

WHAT IT READS / CHANGES  -  INDESIGN
  Frame, shape and line fill/stroke, text fill/stroke (text in selected frames, or a text
  selection), gradient stops, inside groups too. Process, spot and tint swatches, unnamed colours.
  - Rows are swatch + tint (hover the swatch for the swatch name and values).
  - Only the selected objects change; swatches themselves are not edited. A typed hex reuses an
    existing colour with the same values, or adds one named the InDesign way ("C=100 M=0 Y=0 K=0").
    CMYK colours stay CMYK (converted with InDesign's colour settings).
  - Hex shown for CMYK/Lab swatches is an on-screen approximation.
  - Gradients are shared: editing a stop changes that gradient swatch everywhere.
  - Not read: table cell fills, images, effects.
  - The whole change is one undo step.

GOOD TO KNOW (AFTER EFFECTS)
  - Solids: changing a solid's colour changes the solid in the Project panel, so every layer using it changes.
  - Precomps (when that option is on): edits change the precomp itself, so every instance of it changes.
  - Expressions: the panel shows and edits the value underneath the expression.
  - Gradient fills/strokes are not supported (AE's scripting API cannot read or write gradient stops).
  - Before AE 24.3, text with mixed colours is treated as one colour (the first character's).
  - Needs After Effects 2022 or newer.
  - "In project" scans every comp; very large projects are scanned partially (marked "partial")
    so After Effects never freezes.
  - AE colours have no alpha (opacity is a separate property), so the column shows usage count instead of %.

UNINSTALL
  Windows: run uninstall_windows.bat      Mac: run uninstall_mac.command
