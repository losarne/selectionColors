const vm = require("vm"), fs = require("fs"), assert = require("assert");
const path = require("path"), root = path.resolve(__dirname, "..");

function env() {
  const ctx = vm.createContext({ console, Proxy });
  vm.runInContext(fs.readFileSync(root + "/tests/mock_id.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/common.jsx", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/id.jsx", "utf8"), ctx);
  return ctx;
}
const J = (s) => JSON.parse(s);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); process.exitCode = 1; }
}

test("host id + no doc / no selection", () => {
  const G = env();
  assert.strictEqual(G.SC_HOST, "id");
  assert.strictEqual(J(G.SC_scan(false)).status, "nodoc");
  G.mkid.doc();
  assert.strictEqual(J(G.SC_scan(false)).status, "nosel");
  G.app.selection = [new G.InsertionPoint()];
  assert.strictEqual(J(G.SC_scan(false)).status, "nosel", "a blinking cursor is not a selection");
});

test("frames: fill/stroke by swatch + tint; None and zero-weight strokes ignored; images skipped", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.cmyk("C=0 M=100 Y=100 K=0", [0, 100, 100, 0]), pms = m.cmyk("PANTONE 185 C", [0, 91, 76, 0], G.ColorModel.SPOT);
  const a = new G.Rectangle({ fill: red, stroke: pms, strokeWeight: 2 });
  const b = new G.Oval({ fill: red, fillTint: 50, stroke: red, strokeWeight: 0 });
  const c = new G.Rectangle({ fill: new G.Tint(pms, 40) });
  G.app.selection = [a, b, c, new G.Image()];
  const r = J(G.SC_scan(false));
  const ids = r.colors.map((x) => [x.id, x.count]);
  assert.deepStrictEqual(ids, [["c" + red.id + ":100", 1], ["c" + pms.id + ":100", 1], ["c" + red.id + ":50", 1], ["c" + pms.id + ":40", 1]]);
  assert.strictEqual(r.colors[0].hex, "FF0000");
  assert.strictEqual(r.colors[0].label, "C=0 M=100 Y=100 K=0");
  assert.strictEqual(r.colors[1].label, "PANTONE 185 C (C=0 M=91 Y=76 K=0)");
  assert.strictEqual(r.colors[2].hex, "FF8080");
  assert.strictEqual(r.colors[3].label, "PANTONE 185 C 40% (C=0 M=91 Y=76 K=0)");
});

test("apply in RGB: adds 'R=.. G=.. B=..' colour, tint reset, one undo step, id comes back", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000");
  const a = new G.Rectangle({ fill: red, fillTint: 50 }), b = new G.Rectangle({ fill: red });
  G.app.selection = [a, b];
  const r = J(G.SC_apply("c" + red.id + ":50", "0d99ff", false));
  assert.deepStrictEqual([r.ok, r.changed, r.failed], [true, 1, 0]);
  assert.strictEqual(a.fillColor.name, "R=13 G=153 B=255");
  assert.strictEqual(a.fillTint, 100);
  assert.strictEqual(b.fillColor, red, "the untinted red is a different row and stays");
  assert.strictEqual(JSON.stringify(G.app.undo), '["Selection Colors"]');
  assert.strictEqual(r.id, "c" + a.fillColor.id + ":100");
  assert.ok(J(G.SC_scan(false)).colors.some((c) => c.id === r.id));
});

test("existing colour with identical values is reused (no duplicate swatches)", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), brand = m.rgb("Brand blue", "0D99FF");
  const a = new G.Rectangle({ fill: red });
  G.app.selection = [a];
  const n = d.colors.length;
  J(G.SC_apply("c" + red.id + ":100", "0D99FF", false));
  assert.strictEqual(a.fillColor, brand);
  assert.strictEqual(d.colors.length, n);
});

test("CMYK colours stay CMYK: converted by InDesign, rounded, named; temp colour cleaned up on reuse", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.cmyk("C=0 M=100 Y=100 K=0", [0, 100, 100, 0]);
  const a = new G.Rectangle({ fill: red }), b = new G.Rectangle({ fill: red });
  G.app.selection = [a];
  const n = d.colors.length;
  J(G.SC_apply("c" + red.id + ":100", "00FFFF", false));
  const c = a.fillColor;
  assert.strictEqual(c.space, "CMYK");
  assert.strictEqual(JSON.stringify(c.colorValue), "[100,0,0,0]");
  assert.strictEqual(c.name, "C=100 M=0 Y=0 K=0");
  assert.strictEqual(d.colors.length, n + 1);
  G.app.selection = [b];
  J(G.SC_apply("c" + red.id + ":100", "00FFFF", false));
  assert.strictEqual(b.fillColor, c, "second time reuses it");
  assert.strictEqual(d.colors.length, n + 1, "temporary conversion colour removed");
});

test("name already taken by a different colour gets a suffix", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const fake = m.rgb("R=0 G=0 B=0", "010101"), red = m.rgb("Red", "FF0000");
  const a = new G.Rectangle({ fill: red });
  G.app.selection = [a];
  J(G.SC_apply("c" + red.id + ":100", "000000", false));
  assert.strictEqual(a.fillColor.name, "R=0 G=0 B=0 2");
  assert.notStrictEqual(a.fillColor, fake);
});

test("text: style runs walked; matching runs recoloured even as runs merge; strokes too", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), blue = m.rgb("Blue", "0000FF"), black = m.rgb("Black", "000000");
  const st = new G.Story([m.ch(red), m.ch(red), m.ch(blue), m.ch(red, { stroke: red }), m.ch(blue), m.ch(red), m.ch(black)]);
  const tf = new G.TextFrame(st, 0, 7, {});
  G.app.selection = [tf];
  const r = J(G.SC_scan(false));
  const red1 = r.colors.find((c) => c.hex === "FF0000");
  assert.deepStrictEqual(red1.cats, { text: 1 });
  const ap = J(G.SC_apply("c" + red.id + ":100", "0000FF", false));
  assert.deepStrictEqual([ap.changed, ap.failed], [1, 0]);
  assert.ok(st.chars.slice(0, 6).every((c) => c.fill === blue), "all red fills now blue");
  assert.strictEqual(st.chars[3].stroke, blue, "stroke recoloured");
  assert.strictEqual(st.chars[6].fill, black);
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((c) => c.hex).sort(), ["000000", "0000FF"]);
});

test("text selection (Type tool) only touches the selected characters", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000");
  const st = new G.Story([m.ch(red), m.ch(red), m.ch(red), m.ch(red)]);
  G.app.selection = [new G.Character(st, 1, 3)];
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((c) => c.hex), ["FF0000"]);
  J(G.SC_apply("c" + red.id + ":100", "00FF00", false));
  assert.deepStrictEqual(st.chars.map((c) => c.fill.name), ["Red", "R=0 G=255 B=0", "R=0 G=255 B=0", "Red"]);
  assert.ok(G.SC_fingerprint().indexOf("Character:1:2") > 0);
});

test("gradient stops: once per gradient, edited in place", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), blue = m.rgb("Blue", "0000FF"), grad = new G.Gradient([red, blue]);
  G.app.selection = [new G.Rectangle({ fill: grad }), new G.Rectangle({ fill: grad })];
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((c) => [c.hex, c.count, Object.keys(c.cats)[0]]), [["FF0000", 1, "gradient"], ["0000FF", 1, "gradient"]]);
  J(G.SC_apply("c" + blue.id + ":100", "00FF00", false));
  assert.strictEqual(grad.gradientStops[1].stopColor.name, "R=0 G=255 B=0");
  assert.strictEqual(grad.gradientStops[0].stopColor, red);
});

test("groups recurse; locked items and locked text frames are edited then relocked", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000");
  const r1 = new G.Rectangle({ fill: red }); r1.locked = true;
  const st = new G.Story([m.ch(red)]); const tf = new G.TextFrame(st, 0, 1, {}); tf.locked = true;
  G.app.selection = [new G.Group([r1, new G.Group([tf])])];
  const r = J(G.SC_apply("c" + red.id + ":100", "111111", false));
  assert.deepStrictEqual([r.changed, r.failed], [2, 0]);
  assert.deepStrictEqual([r1.locked, tf.locked], [true, true]);
  assert.strictEqual(r1.fillColor.name, "R=17 G=17 B=17");
  assert.strictEqual(st.chars[0].fill.name, "R=17 G=17 B=17");
});

test("failure on one object is reported; others still change", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000");
  const bad = new G.Rectangle({ fill: red }), good = new G.Rectangle({ fill: red });
  Object.defineProperty(bad, "fillColor", { get: () => red, set: () => { throw new Error("nope"); } });
  G.app.selection = [bad, good];
  const r = J(G.SC_apply("c" + red.id + ":100", "00FF00", false));
  assert.deepStrictEqual([r.changed, r.failed], [1, 1]);
  assert.ok(/nope/.test(r.error));
});

test("chip target: exact swatch + tint applied", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), pms = m.cmyk("PANTONE 185 C", [0, 91, 76, 0], G.ColorModel.SPOT);
  const a = new G.Rectangle({ fill: red });
  G.app.selection = [a];
  const n = d.colors.length;
  const r = J(G.SC_apply("c" + red.id + ":100", "FF8080", false, "c" + pms.id + ":40"));
  assert.strictEqual(r.id, "c" + pms.id + ":40");
  assert.deepStrictEqual([a.fillColor, a.fillTint], [pms, 40]);
  assert.strictEqual(d.colors.length, n, "no new swatch");
});

test("select matching narrows the selection; text selection is left alone", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), blue = m.rgb("Blue", "0000FF");
  const a = new G.Rectangle({ fill: red }), b = new G.Rectangle({ fill: blue });
  G.app.selection = [a, b];
  assert.strictEqual(J(G.SC_selectMatching("c" + blue.id + ":100", false)).selected, 1);
  assert.ok(G.app.selection.length === 1 && G.app.selection[0] === b);
  const ch = new G.Character(new G.Story([m.ch(red)]), 0, 1);
  G.app.selection = [ch];
  assert.strictEqual(J(G.SC_selectMatching("c" + red.id + ":100", false)).selected, 0);
  assert.strictEqual(G.app.selection[0], ch);
});

test("document colours: items (not groups twice) + all stories, sorted", () => {
  const G = env(), m = G.mkid, d = m.doc();
  const red = m.rgb("Red", "FF0000"), blue = m.rgb("Blue", "0000FF"), green = m.rgb("Green", "00FF00");
  const r1 = new G.Rectangle({ fill: red }), r2 = new G.Rectangle({ fill: red });
  const g = new G.Group([r1]);
  const st = new G.Story([m.ch(blue), m.ch(green)]);
  d.allPageItems = [g, r1, r2, new G.Image()];
  d.stories = [new G.StoryObj(st)];
  const r = J(G.SC_projectColors(5000));
  assert.deepStrictEqual([r.ok, r.partial], [true, false]);
  assert.deepStrictEqual(r.colors.map((c) => [c.hex, c.id]), [["FF0000", "c" + red.id + ":100"], ["0000FF", "c" + blue.id + ":100"], ["00FF00", "c" + green.id + ":100"]]);
});

console.log(`\n${passed} passed`);
