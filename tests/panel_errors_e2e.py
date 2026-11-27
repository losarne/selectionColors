import pathlib, sys, json
src = open("panel_e2e.py").read()
exec(src.split("fails = 0")[0].split("def hexof")[0])
from playwright.sync_api import sync_playwright
fails = 0
def check(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 280, "height": 500})
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    broken = dict(FILES); broken["ae.jsx"] = "function SC_scan( { syntax error"
    page.add_init_script(mock + "\nwindow.__FILES = " + json.dumps(broken) + ";\nwindow.__GOOD = " + json.dumps(FILES) + ";\n" + bridge + "\n" + setup)
    page.goto("file://" + str(ROOT / "extension/client/index.html"))
    page.wait_for_selector(".empty.error .retry", timeout=5000)
    msg = page.inner_text("#empty")
    check("load failure names the file + reason", "Could not load the host script" in msg and "ae.jsx" in msg and "SyntaxError" in msg)
    check("shows the folder it loaded from", "C:/fake/ext/jsx" in msg)
    page.evaluate("window.__FILES = window.__GOOD;")
    page.click(".retry")
    page.wait_for_selector(".row", timeout=5000)
    check("Retry recovers", page.evaluate("document.querySelectorAll('.row').length") == 2)

    # an exception inside a host call comes back as text (not a vague message)
    page.evaluate("window.SC_json = undefined;")
    page.locator("#refresh").click()
    page.wait_for_selector(".empty.error", timeout=5000)
    msg = page.inner_text("#empty")
    check("host-call error is readable", msg.startswith("Could not read the selection.") and "SC_" in msg and "TypeError" in msg)
    check("no page errors", not errors)
    if errors: print(errors)
    b.close()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
