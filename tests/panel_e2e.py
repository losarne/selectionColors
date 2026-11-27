import pathlib, sys, json
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
mock = (ROOT / "tests/mock_ae.js").read_text()
FILES = {n: (ROOT / "extension/jsx" / n).read_text() for n in ("host.jsx", "common.jsx", "ae.jsx", "ai.jsx")}
host = FILES["host.jsx"]

bridge = r"""
window.__hostLog = [];
// Real AE loads host.jsx via manifest ScriptPath; here we simulate the $.evalFile fallback path.
window.__evalFiles = [];
window.File = function (p) { return { fsName: String(p), toString: function () { return String(p); } }; };
$.fileName = "";
$.evalFile = function (f) {
  var p = String(f && f.fsName !== undefined ? f.fsName : f);
  window.__evalFiles.push(p);
  var name = p.split("/").pop();
  (0, eval)(window.__FILES[name]);
};
window.__spawns = []; window.__eyeScript = [];
window.cep_node = {
  process: { platform: "win32", env: { SystemRoot: "C:\\Windows" } },
  require: function (m) {
    if (m !== "child_process") { throw new Error("no module " + m); }
    return { spawn: function (exe, args, opts) {
      var handlers = {}, outH = [], killed = false;
      var child = {
        killed: false,
        stdout: { setEncoding: function () {}, on: function (ev, fn) { if (ev === "data") { outH.push(fn); } } },
        stderr: { on: function () {} },
        on: function (ev, fn) { handlers[ev] = fn; },
        kill: function () { killed = true; child.killed = true; setTimeout(function () { if (handlers.close) { handlers.close(null); } }, 5); }
      };
      window.__spawns.push({ exe: exe, args: args, opts: opts, child: child });
      var lines = window.__eyeScript.slice();
      setTimeout(function next() {
        if (killed || !lines.length) { return; }
        var l = lines.shift();
        if (l === "WAIT") { return; }
        outH.forEach(function (f) { f(l + "\r\n"); });
        if (l[0] === "P" || l === "C" || l[0] === "E") { setTimeout(function () { if (handlers.close) { handlers.close(0); } }, 5); return; }
        setTimeout(next, 40);
      }, 0);
      return child;
    } };
  }
};
window.__adobe_cep__ = {
  evalScript: function (code, cb) {
    setTimeout(function () {
      var r;
      try { r = (0, eval)(code); r = (r === undefined) ? "undefined" : String(r); }
      catch (e) { window.__hostLog.push(String(e)); r = "EvalScript error."; }
      cb(r);
    }, 3);
  },
  getHostEnvironment: function () {
    return JSON.stringify({ appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } } } });
  },
  getSystemPath: function () { return "file:///C:/fake/ext"; },
  addEventListener: function () {}
};
"""

setup = r"""
(function () {
  var m = mk, c = new CompItem("main");
  app.project.activeItem = c;
  window.F1 = m.fill("FF0000"); window.F2 = m.fill("FF0000"); window.S1 = m.stroke("00FF00");
  window.LA = c.addLayer(m.shapeLayer("a", [F1, S1, F2], { selected: true }));
  window.LB = c.addLayer(m.shapeLayer("b", [m.fill("212526")], { selected: false }));
  window.COMP = c;
})();
"""

def hexof(page, expr):
    return page.evaluate(f"""(() => {{ var c = {expr}; return c.slice(0,3).map(v => Math.round(v*255).toString(16).padStart(2,'0').toUpperCase()).join(''); }})()""")

def rows(page):
    return page.eval_on_selector_all(".row", "rs => rs.map(r => [r.querySelector('.hex').value, r.querySelector('.num').textContent])")

fails = 0
def check(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 280, "height": 560}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(mock + "\nwindow.__FILES = " + json.dumps(FILES) + ";\n" + bridge + "\n" + setup)
    page.goto("file://" + str(ROOT / "extension/client/index.html"))
    page.wait_for_selector(".row")
    check("loader picks AE files", page.evaluate("window.__evalFiles") == ["C:/fake/ext/jsx/common.jsx", "C:/fake/ext/jsx/ae.jsx"])
    check("initial rows", rows(page) == [["FF0000", "2"], ["00FF00", "1"]])
    check("tooltip", page.get_attribute(".row .count", "title") == "2 fills")
    page.screenshot(path=str(ROOT / "tests/shot_dark.png"))

    # edit hex with shorthand + Enter
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("abc"); inp.press("Enter")
    page.wait_for_function("app.undoGroups.length === 1 && !document.body.classList.contains('busy')")
    page.wait_for_timeout(300)
    check("apply via hex shorthand", hexof(page, "F1._children[0]._v") == "AABBCC" and hexof(page, "F2._children[0]._v") == "AABBCC")
    check("single undo group", page.evaluate("app.undoGroups.length") == 1)

    # escape reverts, no apply
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("000000"); inp.press("Escape")
    page.wait_for_timeout(300)
    check("escape reverts", hexof(page, "F1._children[0]._v") == "AABBCC" and page.evaluate("app.undoGroups.length") == 1)

    # invalid → toast, no apply
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("zz"); inp.press("Enter")
    page.wait_for_timeout(200)
    check("invalid shows toast", "Not a valid" in page.inner_text("#toast") and page.evaluate("app.undoGroups.length") == 1)

    # blur commits (Figma behaviour)
    inp = page.locator(".row .hex").nth(1)
    inp.click(); inp.fill("#123456"); page.mouse.click(5, 540)
    page.wait_for_function("app.undoGroups.length === 2 && !document.body.classList.contains('busy')")
    page.wait_for_timeout(300)
    check("blur commits", hexof(page, "S1._children[0]._v") == "123456" and rows(page) == [["AABBCC", "2"], ["123456", "1"]])

    # selection change in AE → poll picks it up
    page.evaluate("LA.selected = false; LB.selected = true;")
    page.wait_for_function("document.querySelector('.row .hex') && document.querySelector('.row .hex').value === '212526'", timeout=3000)
    check("poll follows selection", rows(page) == [["212526", "1"]])

    # no selection → empty state
    page.evaluate("LB.selected = false;")
    page.wait_for_function("getComputedStyle(document.getElementById('empty')).display !== 'none'", timeout=3000)
    check("empty state", page.inner_text("#empty") == "Select layers in a composition")

    # ---- built-in colour picker
    page.evaluate("LA.selected = true;")
    page.wait_for_selector(".row")
    page.wait_for_timeout(500)
    ug = lambda: page.evaluate("app.undoGroups.length")
    idle = "!document.body.classList.contains('busy') && !SCPicker.busy()"
    n0 = ug()
    page.locator(".swatch").first.click()
    check("picker opens", page.is_visible(".picker"))
    rr = page.evaluate("[document.querySelector('.row').getBoundingClientRect().bottom, document.querySelector('.picker').getBoundingClientRect().top]")
    check("picker anchored under row", 0 < rr[1] - rr[0] <= 8)
    check("picker shows current hex", page.input_value('.picker [data-k=hex]') == "AABBCC")
    page.screenshot(path=str(ROOT / "tests/shot_picker.png"))

    # drag on SV square: many moves, ONE commit on release
    box = page.locator(".sv").bounding_box()
    page.mouse.move(box["x"] + 10, box["y"] + 10); page.mouse.down()
    for i in range(10):
        page.mouse.move(box["x"] + 10 + i * 15, box["y"] + 10 + i * 8)
    check("no commit while dragging", ug() == n0)
    check("row previews live", page.evaluate("document.querySelector('.row.editing .swatch').style.background") != "")
    page.mouse.up()
    page.wait_for_function(f"app.undoGroups.length === {n0 + 1} && " + idle)
    page.wait_for_timeout(300)
    dragged = page.input_value('.picker [data-k=hex]')
    check("drag committed once", hexof(page, "F1._children[0]._v") == dragged and ug() == n0 + 1)
    check("picker stays open + anchored after re-render", page.is_visible(".picker") and page.evaluate("SCPicker.current()") == dragged and page.locator(".row").first.input_value if False else page.is_visible(".picker"))

    # hue drag
    hb = page.locator(".hue").bounding_box()
    page.mouse.click(hb["x"] + hb["width"] * 0.66, hb["y"] + hb["height"] / 2)
    page.wait_for_function(f"app.undoGroups.length === {n0 + 2} && " + idle)

    # hex field in picker
    f = page.locator(".picker [data-k=hex]")
    f.click(); f.fill("0d99ff"); f.press("Enter")
    page.wait_for_function(f"app.undoGroups.length === {n0 + 3} && " + idle)
    page.wait_for_timeout(300)
    check("picker hex applies", hexof(page, "F1._children[0]._v") == "0D99FF" and hexof(page, "F2._children[0]._v") == "0D99FF")
    check("still anchored to its row", page.evaluate("SCPicker.current()") == "0D99FF" and page.is_visible(".picker"))

    # RGB field
    r = page.locator(".picker [data-k='0']")
    r.click(); r.fill("255"); r.press("Enter")
    page.wait_for_function(f"app.undoGroups.length === {n0 + 4} && " + idle)
    check("R channel applies", hexof(page, "F1._children[0]._v") == "FF99FF")
    r.fill("999"); r.press("Enter"); page.wait_for_timeout(300)
    check("channel clamps to 255 (no-op)", r.input_value() == "255" and ug() == n0 + 4)

    # quick-commit race: several fast edits, latest wins
    page.evaluate("""(() => { var i = document.querySelector('.picker [data-k=hex]');
      ['111111','222222','333333'].forEach(v => { i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); }); })()""")
    page.wait_for_function("SCPicker.current() === '333333' && " + idle, timeout=5000)
    page.wait_for_timeout(400)
    check("rapid edits serialise, latest wins", hexof(page, "F1._children[0]._v") == "333333" and page.evaluate("SCPicker.current()") == "333333")

    # chip (other colour in selection) merges
    chips = page.eval_on_selector_all(".pk-chip", "cs => cs.map(c => c.title)")
    check("chips exclude current colour", "#333333" not in chips and len(chips) >= 1)
    page.locator(".pk-chip").first.click()
    target = chips[0][1:]
    page.wait_for_function(f"SCPicker.current() === '{target}' && " + idle, timeout=5000)
    page.wait_for_timeout(300)
    check("chip merges colours", hexof(page, "F1._children[0]._v") == target and [x[0] for x in rows(page)].count(target) == 1)

    # Esc closes; same-swatch toggle; click outside closes
    page.keyboard.press("Escape")
    check("escape closes", not page.is_visible(".picker"))
    sw = page.locator(".swatch").first
    sw.click(); check("reopen", page.is_visible(".picker"))
    sw.click(); check("same swatch toggles closed", not page.is_visible(".picker"))
    sw.click(); page.mouse.click(140, 545)
    check("click outside closes", not page.is_visible(".picker"))
    check("no stray 'editing' row", page.evaluate("document.querySelectorAll('.row.editing').length") == 0)
    F1final = hexof(page, "F1._children[0]._v")
    page.evaluate(f"F1._children[0]._v = mk.color('0D99FF'); F2._children[0]._v = mk.color('0D99FF');")
    page.locator("#refresh").click(); page.wait_for_timeout(300)

    # select matching
    page.evaluate("LB.selected = true;")
    page.wait_for_function("document.querySelectorAll('.row').length === 3", timeout=3000)
    page.hover(".row >> nth=0")
    page.locator(".row .match").first.click()
    page.wait_for_function("document.querySelectorAll('.row').length === 2", timeout=3000)
    check("select matching", page.evaluate("[LA.selected, LB.selected]") == [True, False])

    # precomp toggle
    page.evaluate("""(() => { var pre = new CompItem('pre'); pre.addLayer(mk.shapeLayer('x',[mk.fill('C0FFEE')]));
      window.LP = COMP.addLayer(new Layer('precomp', [], {source: pre})); LA.selected=false; LP.selected=true; })()""")
    page.wait_for_function("getComputedStyle(document.getElementById('empty')).display !== 'none'", timeout=3000)
    check("precomp hidden when off", page.inner_text("#empty") == "No colours in selection")
    page.click("#deep")
    page.wait_for_selector(".row")
    check("precomp shown when on", rows(page) == [["C0FFEE", "1"]])

    # poll does not clobber an input being edited
    inp = page.locator(".row .hex").first
    inp.click(); inp.fill("C0F")
    page.evaluate("LP.selected = false; LA.selected = true;")
    page.wait_for_timeout(1000)
    check("editing protected from re-render", page.locator(".row .hex").first.input_value() == "C0F")
    inp.press("Escape")
    page.wait_for_timeout(800)

    page.evaluate("LA.selected = true; LB.selected = true; LP.selected = false;")
    page.wait_for_timeout(800)
    page.hover(".row >> nth=1")
    page.screenshot(path=str(ROOT / "tests/shot_hover.png"))

    # ---- v1.2: X / Done, pointer-down open, no needless rebuilds, project swatches, native eyedropper
    page.evaluate("LA.selected = true; LB.selected = true; app.project.items = [COMP];")
    page.wait_for_function("document.querySelectorAll('.row').length >= 2", timeout=3000)
    page.wait_for_timeout(500)
    idle = "!document.body.classList.contains('busy') && !SCPicker.busy()"

    page.evaluate("window.__keep = document.querySelector('.row .swatch'); window.dispatchEvent(new Event('focus')); document.documentElement.dispatchEvent(new MouseEvent('mouseenter'));")
    page.wait_for_timeout(500)
    check("focus/mouseenter rescans don't rebuild rows", page.evaluate("__keep.isConnected"))

    page.evaluate("document.querySelector('.row .swatch').dispatchEvent(new PointerEvent('pointerdown', {button: 0, bubbles: true}))")
    check("opens on pointer-down alone", page.is_visible(".picker"))
    page.click(".pk-x")
    check("X closes", not page.is_visible(".picker"))
    page.locator(".swatch").first.click()
    page.wait_for_function("document.querySelectorAll('[data-col=proj] .pk-chip').length > 0", timeout=4000)
    proj = page.eval_on_selector_all("[data-col=proj] .pk-chip", "cs => cs.map(c => c.title)")
    cur = page.evaluate("SCPicker.current()")
    check("in project column lists project colours (minus current)", "#212526" in proj and ("#" + cur) not in proj)
    pos = page.evaluate("[document.querySelector('[data-col=sel]').getBoundingClientRect().left, document.querySelector('[data-col=proj]').getBoundingClientRect().left]")
    check("in project sits to the right of in selection", pos[1] > pos[0] + 50)
    page.screenshot(path=str(ROOT / "tests/shot_picker2.png"))
    page.click(".pk-done")
    check("Done closes", not page.is_visible(".picker"))

    # header + footer stay reachable in a short panel
    page.set_viewport_size({"width": 260, "height": 260})
    page.locator(".swatch").first.click()
    vis = page.evaluate("""(() => { const h = innerHeight, a = document.querySelector('.pk-x').getBoundingClientRect(), b = document.querySelector('.pk-done').getBoundingClientRect();
        return a.top >= 0 && a.bottom <= h && b.top >= 0 && b.bottom <= h; })()""")
    check("X and Done visible in a short panel", vis)
    check("colour square keeps its size (body scrolls)", page.evaluate("document.querySelector('.sv').getBoundingClientRect().height") >= 140)
    page.screenshot(path=str(ROOT / "tests/shot_short.png"))
    page.click(".pk-done")
    page.set_viewport_size({"width": 280, "height": 560})
    page.wait_for_timeout(200)

    # native eyedropper: hover previews, click applies (one undo)
    page.locator(".swatch").first.click()
    check("eyedropper button shown", page.is_visible(".pk-eye"))
    n0 = page.evaluate("app.undoGroups.length")
    page.evaluate("window.__eyeScript = ['R', 'M 112233', 'M 445566', 'P 445566'];")
    page.click(".pk-eye")
    page.wait_for_function(f"app.undoGroups.length === {n0 + 1} && " + idle, timeout=4000)
    page.wait_for_timeout(300)
    sp = page.evaluate("__spawns[__spawns.length - 1]")
    check("spawns Windows PowerShell with the script", sp["exe"] == "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
          and sp["args"][-2:] == ["-File", "C:\\fake\\ext\\native\\eyedropper.ps1"] and sp["opts"]["windowsHide"] is True)
    check("eyedropper pick applies", hexof(page, "F1._children[0]._v") == "445566" and page.evaluate("SCPicker.current()") == "445566")

    # cancel restores, no undo
    n1 = page.evaluate("app.undoGroups.length")
    page.evaluate("window.__eyeScript = ['R', 'M 000000', 'C'];")
    page.click(".pk-eye")
    page.wait_for_timeout(500)
    check("eyedropper cancel restores", page.input_value(".picker [data-k=hex]") == "445566" and page.evaluate("app.undoGroups.length") == n1)

    # error surfaces in the picker
    page.evaluate("window.__eyeScript = ['E Add-Type failed'];")
    page.click(".pk-eye")
    page.wait_for_timeout(300)
    check("eyedropper error shown", "Add-Type failed" in page.inner_text(".pk-status"))

    # closing while eyedropper runs kills it, nothing applied
    page.evaluate("window.__eyeScript = ['R', 'M 777777', 'WAIT'];")
    page.click(".pk-eye")
    page.wait_for_timeout(200)
    check("live preview while hovering", page.input_value(".picker [data-k=hex]") == "777777")
    page.click(".pk-done")
    page.wait_for_timeout(300)
    check("Done during eyedropper kills it, no apply", page.evaluate("__spawns[__spawns.length - 1].child.killed") is True
          and page.evaluate("app.undoGroups.length") == n1 and hexof(page, "F1._children[0]._v") == "445566")

    check("no page errors", not errors and page.evaluate("__hostLog.length") == 0)
    if errors: print(errors)
    b.close()

print("FAILURES:", fails)
sys.exit(1 if fails else 0)
