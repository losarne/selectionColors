import pathlib, sys, json
src = open("panel_e2e.py").read()
exec(src.split("fails = 0")[0].split("def hexof")[0])
from playwright.sync_api import sync_playwright
def hexof(page, expr):
    return page.evaluate(f"(() => {{ var c = {expr}; return c.slice(0,3).map(v => Math.round(v*255).toString(16).padStart(2,'0').toUpperCase()).join(''); }})()")
bridge_mac = bridge.replace('platform: "win32"', 'platform: "darwin"').replace(
    'getSystemPath: function () { return "file:///C:/fake/ext"; }',
    'getSystemPath: function () { return "file:///Users/arne/Library/Application%20Support/Adobe/CEP/extensions/SelectionColors"; }')
assert bridge_mac.count("darwin") == 1 and "Application%20Support" in bridge_mac
fails = 0
def check(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 280, "height": 600})
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(mock + "\nwindow.__FILES = " + json.dumps(FILES) + ";\n" + bridge_mac + "\n" + setup)
    page.goto("file://" + str(ROOT / "extension/client/index.html"))
    page.wait_for_selector(".row")
    check("loader path decoded (spaces)", page.evaluate("__evalFiles")[0] == "/Users/arne/Library/Application Support/Adobe/CEP/extensions/SelectionColors/jsx/common.jsx")
    page.locator(".swatch").first.click()
    check("eyedropper offered on macOS", page.is_visible(".pk-eye"))
    n0 = page.evaluate("app.undoGroups.length")
    page.evaluate("window.__eyeScript = ['WAITMS', 'P 0D99FF'];".replace("'WAITMS', ", ""))
    page.click(".pk-eye")
    page.wait_for_function(f"app.undoGroups.length === {n0 + 1} && !SCPicker.busy()", timeout=4000)
    sp = page.evaluate("__spawns[__spawns.length - 1]")
    check("spawns osascript JXA", sp["exe"] == "/usr/bin/osascript" and sp["args"] == ["-l", "JavaScript", "/Users/arne/Library/Application Support/Adobe/CEP/extensions/SelectionColors/native/eyedropper_mac.js"])
    page.wait_for_timeout(300)
    check("mac pick applies", hexof(page, "F1._children[0]._v") == "0D99FF")
    # closing while the loupe is up: detach, never kill
    page.evaluate("window.__eyeScript = ['WAIT'];")
    page.click(".pk-eye"); page.wait_for_timeout(100)
    check("hint shown immediately", "Click anywhere" in page.inner_text(".pk-status"))
    page.click(".pk-done"); page.wait_for_timeout(200)
    check("close does not kill osascript", page.evaluate("__spawns[__spawns.length - 1].child.killed") is False)
    check("no page errors", not errors and page.evaluate("__hostLog.length") == 0)
    if errors: print(errors)
    b.close()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
