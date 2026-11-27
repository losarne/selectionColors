# Selection Colors - handoff from Claude chat (2026-11-27)

Figma's "Selection colors" module as a CEP panel for **After Effects, Illustrator and InDesign** (Windows + macOS).
Lists every colour in the current selection; edit hex / built-in picker / eyedropper / chips; one undo step per edit.
Current version: **1.5.1** (`extension/CSXS/manifest.xml`).

## Layout
- `extension/` - the CEP extension (what gets installed)
  - `CSXS/manifest.xml` - hosts AEFT [22+], ILST [26+], IDSN [17+]; `--enable-nodejs` (needed for eyedropper)
  - `.debug` - remote-debug ports: AEFT 8099, ILST 8098, IDSN 8097
  - `client/` - panel UI: `main.js` (host bridge, list, scan/poll, apply queue), `picker.js` (colour picker popover), `style.css`
  - `jsx/` - ExtendScript (ES3, pure ASCII): `common.jsx` (JSON/hex helpers), `ae.jsx`, `ai.jsx`, `id.jsx`, `host.jsx` (loader, used by manifest ScriptPath)
  - `native/` - eyedropper helpers: Windows `eyedropper.ps1` + `Eyedropper.cs` (frozen-screen overlay, compiled by Add-Type, C# 5), macOS `eyedropper_mac.js` (JXA, NSColorSampler)
- `tools/` - installers (`install_windows.bat`, `install_mac.command`, uninstallers), end-user `README.txt`, `inspect_panel.html` (live probe of a running panel)
- `tests/` - mocks of each app's scripting DOM + tests

## Host API (same in ae/ai/id.jsx; all return JSON strings)
`SC_fingerprint()`, `SC_scan(deep)`, `SC_apply(oldId, newHex, deep, targetId)`, `SC_selectMatching(id, deep)`, `SC_projectColors(budgetMs)`, global `SC_HOST` = "ae" | "ai" | "id".
Colour ids: AE = hex; AI = exact value key (`rgb:`, `cmyk:`, `gray:`, `spot:name:tint`, `lab:`); ID = `c<colorId>:<tint>`.
The panel loads `common.jsx` + the app's file itself on every start (`ensureHost` in main.js), and wraps every host call in try/catch returning `SCERR ...`.

## Tests
```
npm i acorn                      # ES3 syntax check of jsx
node tests/host.test.js          # AE host, 22 tests
node tests/ai.test.js            # Illustrator host, 16 tests
node tests/id.test.js            # InDesign host, 14 tests
pip install playwright && playwright install chromium
python tests/panel_e2e.py        # panel in AE mode (+ picker, eyedropper protocol via fake child_process)
python tests/panel_ai_e2e.py ; python tests/panel_id_e2e.py ; python tests/panel_mac_e2e.py ; python tests/panel_errors_e2e.py
```
All green at handoff. Note: these test against MOCKS of the Adobe DOMs - never yet run inside a real app.

## OPEN BUG (the reason for handoff) - InDesign 2026 (21.6), Windows
Panel shows: "Could not read the selection. The host app reported a script error."
Live probe via the debug port (localhost:8097, CDP Runtime.evaluate -> `__adobe_cep__.evalScript`) showed **every** evalScript
returns `"EvalScript error."` - even `1+1`, `'hi'`, `$.version`, `typeof app`. Host env reports `IDSN 21.6`.
The panel's startup check (`typeof SC_scan + ',' + typeof SC_json + ',' + SC_HOST` -> must equal `function,function,id`) had passed,
otherwise it would have shown "Could not load the host script". So the engine worked at startup, then started failing.
Next steps:
1. Check whether InDesign has a modal dialog open (any open dialog makes evalScript fail) - close it, click Retry in the panel.
2. Restart InDesign, open the panel, run `tools/inspect_panel.html` (PORT 8097) to see which call first breaks the engine.
3. Suspects if it reproduces: something in the first `SC_fingerprint()` / `SC_scan()` in id.jsx that InDesign 21.6 doesn't
   like (e.g. `obj.constructor.name` on DOM objects - InDesign's documented way is `obj.reflect.name`), or loading via `$.evalFile`
   inside the panel's ensureHost. Bisect with the probe.
Not yet verified in real apps either: AE/AI behaviour after the 1.3 loader change, the Windows eyedropper (C# overlay), the macOS JXA eyedropper.

## Self-update (implemented)
The panel checks `latest.json` at repo root (raw.githubusercontent.com/losarne/selectionColors/main/latest.json)
on every boot via Node's `https` (through the existing `cep_node` bridge, same path the eyedropper's `child_process`
already uses - no manifest change needed). If `latest.json`'s `version` is newer than the installed
`CSXS/manifest.xml` version, a banner offers "Update": downloads `url` with Node, verifies `sha256`, unzips in
memory (`main.js`'s own minimal ZIP reader, stored+deflate via `zlib`), overwrites the extension folder, then
`location.reload()`s the panel (this alone reloads the jsx too, since `ensureHost()` already re-evaluates the
jsx files from disk on every boot - no host app restart needed).

Cutting a release:
1. Bump `ExtensionBundleVersion` in `extension/CSXS/manifest.xml`.
2. Zip the *contents* of `extension/` directly (no wrapping folder) - e.g.
   `Compress-Archive -Path extension\* -DestinationPath release.zip`.
3. `Get-FileHash release.zip -Algorithm SHA256` for the checksum.
4. Upload `release.zip` as a GitHub Release asset, copy its direct download URL.
5. Edit `latest.json` at repo root: `{ "version": "<new>", "url": "<asset url>", "sha256": "<hash>", "notes": "<short>" }`, commit, push.
Until `latest.json`'s `url`/`sha256` are filled in, the banner never appears (version compare is <= 0 or the fields are missing).
