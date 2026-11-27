import pathlib, sys, json
src = open("panel_e2e.py").read()
exec(src.split("setup = r\"\"\"")[0])          # imports, FILES, bridge
from playwright.sync_api import sync_playwright
mock_ai = (ROOT / "tests/mock_ai.js").read_text()
bridge_ai = bridge.replace('red: 35, green: 35, blue: 35 } } } });', 'red: 50, green: 50, blue: 50 } } }, appName: "ILST" });')
assert bridge_ai != bridge
setup_ai = r"""
(function () {
  window.$ = window.$ || {};
  var m = mkai;
  window.A1 = new PathItem(m.cmyk(0, 100, 100, 0));
  window.A2 = new PathItem(m.cmyk(0, 100, 100, 0), m.cmyk(0, 0, 0, 100));
  window.B  = new PathItem(null, m.cmyk(100, 0, 0, 0));
  window.T  = new TextFrame([[m.cmyk(0, 100, 100, 0)], [m.cmyk(0, 0, 0, 100)]]);
  window.DOC = m.doc({ cmyk: true, selection: [A1, A2, B, T], layers: [m.layer([A1, A2, B, T, new PathItem(m.cmyk(0, 0, 100, 0))])] });
})();
"""
fails = 0
def check(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1
def rows(page):
    return page.eval_on_selector_all(".row", "rs => rs.map(r => [r.querySelector('.hex').value, r.querySelector('.num').textContent])")
def cmyk(page, expr):
    return page.evaluate(f"(() => {{ var c = {expr}; return [c.typename, c.cyan, c.magenta, c.yellow, c.black]; }})()")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 280, "height": 600}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("window.$ = {};\n" + mock_ai + "\nwindow.__FILES = " + json.dumps(FILES) + ";\n" + bridge_ai + "\n" + setup_ai)
    page.goto("file://" + str(ROOT / "extension/client/index.html"))
    page.wait_for_selector(".row")
    check("loader picks Illustrator files", page.evaluate("__evalFiles") == ["C:/fake/ext/jsx/common.jsx", "C:/fake/ext/jsx/ai.jsx"])
    check("rows (CMYK shown as hex)", rows(page) == [["FF0000", "3"], ["000000", "2"], ["00FFFF", "1"]])
    check("tooltip has CMYK values", "C0 M100 Y100 K0" in page.get_attribute(".row .swatch", "title"))
    check("count breakdown", page.get_attribute(".row .count", "title") == "2 fills · 1 text")
    check("precomp toggle hidden", not page.is_visible("#deep"))
    page.screenshot(path=str(ROOT / "tests/shot_ai.png"))

    # inline hex edit -> integer CMYK, merges with the existing cyan
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("0ff"); inp.press("Enter")
    page.wait_for_function("document.querySelectorAll('.row').length === 2", timeout=4000)
    check("hex edit writes CMYK", cmyk(page, "A1.fillColor") == ["CMYKColor", 100, 0, 0, 0] and cmyk(page, "T.textRange.characters[0].characterAttributes.fillColor") == ["CMYKColor", 100, 0, 0, 0])
    check("merged rows", rows(page) == [["00FFFF", "4"], ["000000", "2"]])

    # picker: open, apply, stays anchored to the row via the NEW id
    page.locator(".swatch").first.click()
    check("picker 'In document' label", page.inner_text("[data-col=proj] .pk-label").startswith("In document"))
    page.wait_for_function("document.querySelectorAll('[data-col=proj] .pk-chip').length > 0", timeout=4000)
    proj = page.eval_on_selector_all("[data-col=proj] .pk-chip", "cs => cs.map(c => c.dataset.id)")
    check("document colours listed (by exact id)", "cmyk:0,0,100,0" in proj and "cmyk:0,0,0,100" in proj and "cmyk:100,0,0,0" not in proj)
    titles = page.eval_on_selector_all("[data-col=proj] .pk-chip", "cs => cs.map(c => c.title)")
    check("chip tooltip shows CMYK + hex", any(t.startswith("C0 M0 Y100 K0") and t.endswith("#FFFF00") for t in titles))
    f = page.locator(".picker [data-k=hex]")
    f.click(); f.fill("ffff00"); f.press("Enter")
    page.wait_for_function("SCPicker.current() === 'cmyk:0,0,100,0' && !SCPicker.busy()", timeout=4000)
    page.wait_for_timeout(300)
    check("picker re-anchored to new CMYK id", page.is_visible(".picker") and page.evaluate("document.querySelector('.row.editing') && document.querySelector('.row.editing').dataset.id") == "cmyk:0,0,100,0")
    check("stroke of B changed too", cmyk(page, "B.strokeColor") == ["CMYKColor", 0, 0, 100, 0])
    # chip snaps to the exact CMYK (black K100), not a hex conversion
    page.locator("[data-col=proj] .pk-chip[data-id='cmyk:0,0,0,100']").click()
    page.wait_for_function("SCPicker.current() === 'cmyk:0,0,0,100' && !SCPicker.busy()", timeout=4000)
    page.wait_for_timeout(300)
    check("chip applies exact CMYK", cmyk(page, "A1.fillColor") == ["CMYKColor", 0, 0, 0, 100])
    page.click(".pk-done")
    page.evaluate("A1.fillColor = mkai.cmyk(0, 0, 100, 0);")
    page.locator("#refresh").click(); page.wait_for_timeout(400)

    # select matching
    page.hover(".row[data-id='cmyk:0,0,0,100']"); page.locator(".row[data-id='cmyk:0,0,0,100'] .match").click()
    page.wait_for_timeout(600)
    check("select matching (black: A2 stroke, B stroke, text)", page.evaluate("DOC.selection.length === 3 && DOC.selection[0] === A2 && DOC.selection[1] === B && DOC.selection[2] === T"))

    # empty states
    page.evaluate("DOC.selection = [];")
    page.wait_for_function("getComputedStyle(document.getElementById('empty')).display !== 'none'", timeout=3000)
    check("empty: Select objects", page.inner_text("#empty") == "Select objects")
    page.evaluate("app.documents = []; app.activeDocument = null;")
    page.wait_for_function("document.getElementById('empty').textContent === 'Open a document'", timeout=3000)
    check("no document message", True)
    check("no page errors", not errors and page.evaluate("__hostLog.length") == 0)
    if errors: print(errors)
    b.close()
print("FAILURES:", fails)
sys.exit(1 if fails else 0)
