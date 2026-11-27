import pathlib, sys, json
src = open("panel_e2e.py").read()
exec(src.split("setup = r\"\"\"")[0])
from playwright.sync_api import sync_playwright
FILES["id.jsx"] = (ROOT / "extension/jsx/id.jsx").read_text()
mock_id = (ROOT / "tests/mock_id.js").read_text()
bridge_id = bridge.replace('red: 35, green: 35, blue: 35 } } } });', 'red: 83, green: 83, blue: 83 } } }, appName: "IDSN" });')
assert bridge_id != bridge
setup_id = r"""
(function () {
  window.$ = window.$ || {};
  var m = mkid, d = m.doc();
  window.DOC = d;
  window.RED = m.cmyk("C=0 M=100 Y=100 K=0", [0, 100, 100, 0]);
  window.PMS = m.cmyk("PANTONE 185 C", [0, 91, 76, 0], ColorModel.SPOT);
  window.PAPER = m.cmyk("Paper", [0, 0, 0, 0]);
  window.R1 = new Rectangle({ fill: RED, stroke: PMS, strokeWeight: 1 });
  window.R2 = new Oval({ fill: RED });
  window.ST = new Story([m.ch(RED), m.ch(RED), m.ch(PMS)]);
  window.TF = new TextFrame(ST, 0, 3, { fill: PAPER });
  d.allPageItems = [R1, R2, TF];
  d.stories = [new StoryObj(ST)];
  app.selection = [R1, R2, TF];
})();
"""
fails = 0
def check(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1
def rows(page):
    return page.eval_on_selector_all(".row", "rs => rs.map(r => [r.querySelector('.hex').value, r.querySelector('.num').textContent])")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 280, "height": 640}, device_scale_factor=2)
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("window.$ = {};\n" + mock_id + "\nwindow.__FILES = " + json.dumps(FILES) + ";\n" + bridge_id + "\n" + setup_id)
    page.goto("file://" + str(ROOT / "extension/client/index.html"))
    page.wait_for_selector(".row")
    check("loader picks InDesign files", page.evaluate("__evalFiles") == ["C:/fake/ext/jsx/common.jsx", "C:/fake/ext/jsx/id.jsx"])
    check("rows", rows(page) == [["FF0000", "3"], ["FF173D", "2"], ["FFFFFF", "1"]])
    check("swatch tooltip = swatch name", page.get_attribute(".row .swatch", "title").startswith("C=0 M=100 Y=100 K=0"))
    check("spot tooltip shows values", "PANTONE 185 C (C=0 M=91 Y=76 K=0)" in page.get_attribute(".row >> nth=1 >> .swatch", "title"))
    check("breakdown", page.get_attribute(".row .count", "title") == "2 fills · 1 text")
    check("precomp toggle hidden", not page.is_visible("#deep"))
    page.screenshot(path=str(ROOT / "tests/shot_id.png"))

    # inline hex edit: new CMYK swatch named the InDesign way, one undo step
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("00ffff"); inp.press("Enter")
    page.wait_for_function("app.undo.length === 1 && !document.body.classList.contains('busy')", timeout=4000)
    page.wait_for_timeout(300)
    check("hex edit -> 'C=100 M=0 Y=0 K=0' on frames + text", page.evaluate("R1.fillColor.name === 'C=100 M=0 Y=0 K=0' && R2.fillColor === R1.fillColor && ST.chars[0].fill === R1.fillColor && ST.chars[1].fill === R1.fillColor"))
    check("spot untouched", page.evaluate("R1.strokeColor === PMS && ST.chars[2].fill === PMS"))

    # picker chip snaps to the exact spot swatch, no new swatch created
    n = page.evaluate("DOC.colors.length")
    page.locator(".swatch").first.click()
    check("'In document' label", page.inner_text("[data-col=proj] .pk-label").startswith("In document"))
    pid = page.evaluate("'c' + PMS.id + ':100'")
    page.locator(f"[data-col=sel] .pk-chip[data-id='{pid}']").click()
    page.wait_for_function(f"SCPicker.current() === '{pid}' && !SCPicker.busy()", timeout=4000)
    page.wait_for_timeout(300)
    check("chip applies the spot swatch itself", page.evaluate("R1.fillColor === PMS && R2.fillColor === PMS && ST.chars[0].fill === PMS"))
    check("no swatch clutter", page.evaluate("DOC.colors.length") == n)
    check("one undo step per edit", page.evaluate("app.undo.length") == 2)
    page.click(".pk-done")

    # text selection with the Type tool
    page.evaluate("app.selection = [new Character(ST, 0, 1)];")
    page.wait_for_function("document.querySelectorAll('.row').length === 1", timeout=3000)
    check("text selection rows", rows(page) == [["FF173D", "1"]])

    page.evaluate("app.selection = [];")
    page.wait_for_function("document.getElementById('empty').textContent === 'Select frames or text'", timeout=3000)
    check("empty state text", True)
    check("no page errors", not errors and page.evaluate("__hostLog.length") == 0)
    if errors: print(errors)
    b.close()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
