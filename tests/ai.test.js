const vm = require("vm"), fs = require("fs"), assert = require("assert");
const path = require("path"), root = path.resolve(__dirname, "..");

function env() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(root + "/tests/mock_ai.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/common.jsx", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/ai.jsx", "utf8"), ctx);
  return ctx;
}
const J = (s) => JSON.parse(s);
const rgbHex = (c) => [c.red, c.green, c.blue].map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); process.exitCode = 1; }
}

test("host id + no doc / no selection", () => {
  const G = env();
  assert.strictEqual(G.SC_HOST, "ai");
  assert.strictEqual(J(G.SC_scan(false)).status, "nodoc");
  assert.strictEqual(G.SC_fingerprint(), "nodoc");
  G.mkai.doc();
  assert.strictEqual(J(G.SC_scan(false)).status, "nosel");
});

test("paths: fill + stroke grouped by exact value, counted, sorted", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.rgb("FF0000"), m.rgb("00FF00"));
  const b = new G.PathItem(m.rgb("FF0000"));
  m.doc({ selection: [a, b] });
  const r = J(G.SC_scan(false));
  assert.strictEqual(r.status, "ok");
  assert.deepStrictEqual(r.colors.map((c) => [c.hex, c.count, c.id]), [["FF0000", 2, "rgb:255,0,0"], ["00FF00", 1, "rgb:0,255,0"]]);
  assert.deepStrictEqual(r.colors[0].cats, { fill: 2 });
  assert.strictEqual(r.colors[0].label, "R255 G0 B0");
});

test("unfilled / NoColor ignored; groups recurse; placed items ignored", () => {
  const G = env(), m = G.mkai;
  const none = new G.PathItem();
  const inner = new G.PathItem(m.rgb("123456"));
  const g = new G.GroupItem([inner, new G.GroupItem([new G.PathItem(m.rgb("ABCDEF"))]), { typename: "PlacedItem" }]);
  m.doc({ selection: [none, g] });
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((c) => c.hex).sort(), ["123456", "ABCDEF"]);
});

test("apply in RGB doc: replaces matches only, one id back", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.rgb("FF0000"), m.rgb("FF0000")), b = new G.PathItem(m.rgb("00FF00"));
  m.doc({ selection: [a, b] });
  const r = J(G.SC_apply("rgb:255,0,0", "0d99ff", false));
  assert.deepStrictEqual([r.ok, r.changed, r.failed, r.id], [true, 2, 0, "rgb:13,153,255"]);
  assert.strictEqual(rgbHex(a.fillColor), "0D99FF");
  assert.strictEqual(rgbHex(a.strokeColor), "0D99FF");
  assert.strictEqual(rgbHex(b.fillColor), "00FF00");
  // the returned id is what the next scan reports
  assert.ok(J(G.SC_scan(false)).colors.some((c) => c.id === r.id));
});

test("CMYK doc: shows hex, keeps CMYK identity, new colours are integer CMYK", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.cmyk(0, 100, 100, 0)), b = new G.PathItem(m.cmyk(0, 100, 100, 0.4));
  m.doc({ selection: [a, b], cmyk: true });
  const r = J(G.SC_scan(false));
  assert.strictEqual(r.colors.length, 2, "visually equal but different CMYK stay separate");
  assert.strictEqual(r.colors[0].hex, "FF0000");
  assert.strictEqual(r.colors[0].label, "C0 M100 Y100 K0");
  const ap = J(G.SC_apply("cmyk:0,100,100,0", "00FFFF", false));
  assert.strictEqual(ap.changed, 1);
  const f = a.fillColor;
  assert.strictEqual(f.typename, "CMYKColor");
  assert.deepStrictEqual([f.cyan, f.magenta, f.yellow, f.black], [100, 0, 0, 0]);
  assert.strictEqual(ap.id, "cmyk:100,0,0,0");
  assert.ok(J(G.SC_scan(false)).colors.some((c) => c.id === ap.id));
  assert.strictEqual(b.fillColor.black, 0.4, "other CMYK untouched");
});

test("gray, spot (tint) and lab-less docs describe correctly", () => {
  const G = env(), m = G.mkai;
  const g = new G.PathItem(m.gray(100)), s = new G.PathItem(m.spot("PANTONE 185 C", m.rgb("FF0000"), 50));
  m.doc({ selection: [g, s] });
  const r = J(G.SC_scan(false));
  const byId = Object.fromEntries(r.colors.map((c) => [c.id, c]));
  assert.strictEqual(byId["gray:100"].hex, "000000");
  assert.strictEqual(byId["spot:PANTONE 185 C:50"].hex, "FF8080");
  assert.strictEqual(byId["spot:PANTONE 185 C:50"].label, "PANTONE 185 C 50%");
  // spot replaced per object by a process colour; spot definition untouched
  const spotDef = s._fill.spot;
  J(G.SC_apply("spot:PANTONE 185 C:50", "112233", false));
  assert.strictEqual(s.fillColor.typename, "RGBColor");
  assert.strictEqual(rgbHex(spotDef.color), "FF0000");
});

test("compound path: read once, all sub-paths recoloured", () => {
  const G = env(), m = G.mkai;
  const p1 = new G.PathItem(m.rgb("AA0000")), p2 = new G.PathItem(m.rgb("AA0000"));
  const cp = new G.CompoundPathItem([p1, p2]);
  m.doc({ selection: [cp] });
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((c) => [c.hex, c.count]), [["AA0000", 1]]);
  J(G.SC_apply("rgb:170,0,0", "00AA00", false));
  assert.deepStrictEqual([rgbHex(p1.fillColor), rgbHex(p2.fillColor)], ["00AA00", "00AA00"]);
});

test("text: per-character fill + stroke; only matching characters change", () => {
  const G = env(), m = G.mkai;
  const tf = new G.TextFrame([[m.rgb("FF0000")], [m.rgb("FF0000"), m.rgb("000000")], [m.rgb("0000FF")]]);
  m.doc({ selection: [tf] });
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((c) => c.hex).sort(), ["000000", "0000FF", "FF0000"]);
  assert.deepStrictEqual(r.colors.find((c) => c.hex === "FF0000").cats, { text: 1 });
  J(G.SC_apply("rgb:255,0,0", "00FF00", false));
  const ch = tf.textRange.characters;
  assert.deepStrictEqual(ch.map((c) => rgbHex(c.characterAttributes.fillColor)), ["00FF00", "00FF00", "0000FF"]);
  assert.strictEqual(rgbHex(ch[1].characterAttributes.strokeColor), "000000");
  assert.strictEqual(ch[0].characterAttributes.strokeColor.typename, "NoColor");
});

test("text selection made with the Type tool", () => {
  const G = env(), m = G.mkai;
  const tf = new G.TextFrame([[m.rgb("FF0000")], [m.rgb("00FF00")]]);
  m.doc({ selection: { typename: "TextRange", characters: [tf.textRange.characters[1]], contents: "b" } });
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((c) => c.hex), ["00FF00"]);
  J(G.SC_apply("rgb:0,255,0", "111111", false));
  assert.strictEqual(rgbHex(tf.textRange.characters[1].characterAttributes.fillColor), "111111");
  assert.strictEqual(rgbHex(tf.textRange.characters[0].characterAttributes.fillColor), "FF0000");
  assert.ok(G.SC_fingerprint().indexOf("text:") > 0);
});

test("gradients: stops listed once per gradient, edited in place", () => {
  const G = env(), m = G.mkai;
  const gc = m.gradient("Grad 1", [m.rgb("FF0000"), m.rgb("0000FF")]);
  const a = new G.PathItem(gc), b = new G.PathItem(gc);
  m.doc({ selection: [a, b] });
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((c) => [c.hex, c.count, Object.keys(c.cats)[0]]), [["FF0000", 1, "gradient"], ["0000FF", 1, "gradient"]]);
  const ap = J(G.SC_apply("rgb:0,0,255", "00FF00", false));
  assert.strictEqual(ap.changed, 1);
  assert.strictEqual(rgbHex(gc.gradient.gradientStops[1].color), "00FF00");
  assert.strictEqual(a.fillColor.typename, "GradientColor", "item still uses the gradient");
});

test("locked objects inside a group are edited then relocked", () => {
  const G = env(), m = G.mkai;
  const p = new G.PathItem(m.rgb("FF0000")); p.locked = true;
  const t = new G.TextFrame([[m.rgb("FF0000")]]); t.locked = true;
  m.doc({ selection: [new G.GroupItem([p, t])] });
  const r = J(G.SC_apply("rgb:255,0,0", "222222", false));
  assert.deepStrictEqual([r.changed, r.failed], [2, 0]);
  assert.deepStrictEqual([p.locked, t.locked], [true, true]);
  assert.strictEqual(rgbHex(p.fillColor), "222222");
});

test("failure on one object is reported; others still change", () => {
  const G = env(), m = G.mkai;
  const bad = new G.PathItem(m.rgb("FF0000")), good = new G.PathItem(m.rgb("FF0000"));
  Object.defineProperty(bad, "fillColor", { get: () => m.rgb("FF0000"), set: () => { throw new Error("nope"); } });
  m.doc({ selection: [bad, good] });
  const r = J(G.SC_apply("rgb:255,0,0", "00FF00", false));
  assert.deepStrictEqual([r.changed, r.failed], [1, 1]);
  assert.ok(/nope/.test(r.error));
});

test("select matching narrows selection", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.rgb("FF0000")), b = new G.PathItem(m.rgb("00FF00"));
  const d = m.doc({ selection: [a, b] });
  assert.strictEqual(J(G.SC_selectMatching("rgb:0,255,0", false)).selected, 1);
  assert.ok(d.selection.length === 1 && d.selection[0] === b);
  assert.strictEqual(J(G.SC_selectMatching("rgb:1,2,3", false)).selected, 0);
  assert.ok(d.selection.length === 1 && d.selection[0] === b);
});

test("document colours: all layers + sublayers, deduped by hex, sorted", () => {
  const G = env(), m = G.mkai;
  m.doc({ layers: [
    m.layer([new G.PathItem(m.rgb("FF0000")), new G.PathItem(m.rgb("FF0000"))], [m.layer([new G.PathItem(m.rgb("00FF00"))])]),
    m.layer([new G.GroupItem([new G.PathItem(m.rgb("0000FF"), m.rgb("FF0000"))])])
  ] });
  const r = J(G.SC_projectColors(5000));
  assert.deepStrictEqual([r.ok, r.partial], [true, false]);
  assert.deepStrictEqual(r.colors.map((c) => c.hex), ["FF0000", "00FF00", "0000FF"]);
  assert.strictEqual(r.colors[0].id, "rgb:255,0,0");
});

test("fingerprint changes with selection; apply with nothing selected is refused", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.rgb("FF0000")), d = m.doc({ selection: [a] });
  const f1 = G.SC_fingerprint();
  d.selection = [];
  assert.notStrictEqual(G.SC_fingerprint(), f1);
  assert.strictEqual(J(G.SC_apply("rgb:255,0,0", "000000", false)).ok, false);
  assert.strictEqual(J(G.SC_apply("rgb:255,0,0", "zz", false)).ok, false);
});

test("chip target: exact CMYK / spot colour is applied (not a hex approximation)", () => {
  const G = env(), m = G.mkai;
  const a = new G.PathItem(m.rgb("FF0000")), b = new G.PathItem(m.rgb("00FF00"));
  const d = m.doc({ selection: [a, b], cmyk: true });
  const pms = { name: "PANTONE 185 C", color: m.cmyk(0, 91, 76, 0) };
  d.spots = { getByName: (n) => { if (n === pms.name) { return pms; } throw new Error("No such element"); } };
  const r1 = J(G.SC_apply("rgb:255,0,0", "000000", false, "cmyk:12.5,0,3,0"));
  assert.strictEqual(r1.id, "cmyk:12.5,0,3,0");
  assert.deepStrictEqual([a.fillColor.cyan, a.fillColor.yellow], [12.5, 3]);
  const r2 = J(G.SC_apply("rgb:0,255,0", "000000", false, "spot:PANTONE 185 C:40"));
  assert.strictEqual(r2.id, "spot:PANTONE 185 C:40");
  assert.ok(b.fillColor.typename === "SpotColor" && b.fillColor.spot === pms && b.fillColor.tint === 40);
  // unknown spot falls back to the hex
  const c = new G.PathItem(m.rgb("0000FF")); d.selection = [c];
  const r3 = J(G.SC_apply("rgb:0,0,255", "FFFFFF", false, "spot:Missing:100"));
  assert.strictEqual(c.fillColor.typename, "CMYKColor");
  assert.strictEqual(r3.id, "cmyk:0,0,0,0");
});

console.log(`\n${passed} passed`);
