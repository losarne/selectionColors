const vm = require("vm"), fs = require("fs"), assert = require("assert");
const path = require("path"), root = path.resolve(__dirname, "..");

function env() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(root + "/tests/mock_ae.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/common.jsx", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(root + "/extension/jsx/ae.jsx", "utf8"), ctx);
  return ctx;
}
const J = (s) => JSON.parse(s);
const hexOf = (c) => c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase()).join("");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

test("no comp / no selection", () => {
  const G = env();
  assert.strictEqual(J(G.SC_scan(false)).status, "nocomp");
  G.app.project.activeItem = new G.CompItem("c");
  assert.strictEqual(J(G.SC_scan(false)).status, "nosel");
  assert.strictEqual(G.SC_fingerprint().indexOf("|") > 0, true);
});

test("shape fills/strokes are grouped and counted; unapplied layer styles are not touched", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  c.addLayer(m.shapeLayer("a", [m.fill("FF0000"), m.stroke("00FF00"), m.fill("FF0000")], { selected: true }));
  c.addLayer(m.shapeLayer("b", [m.fill("0000FF")], { selected: false }));
  const r = J(G.SC_scan(false));
  assert.strictEqual(r.status, "ok");
  assert.deepStrictEqual(r.colors.map((x) => [x.hex, x.count]), [["FF0000", 2], ["00FF00", 1]]);
  assert.deepStrictEqual(r.colors[0].cats, { fill: 2 });
  assert.deepStrictEqual(r.colors[1].cats, { stroke: 1 });
});

test("apply replaces all matches, preserves alpha, single undo group", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const f1 = m.fill("FF0000"), f2 = m.fill("FF0000"), other = m.fill("00FF00");
  f2._children[0]._v[3] = 0.5;
  c.addLayer(m.shapeLayer("a", [f1, f2, other], { selected: true }));
  const r = J(G.SC_apply("FF0000", "123456", false));
  assert.deepStrictEqual([r.ok, r.changed, r.failed], [true, 2, 0]);
  assert.strictEqual(hexOf(f1._children[0]._v), "123456");
  assert.strictEqual(f2._children[0]._v[3], 0.5);
  assert.strictEqual(f2._children[0]._v.length, 4);
  assert.strictEqual(hexOf(other._children[0]._v), "00FF00");
  assert.strictEqual(G.app.undoDepth, 0);
  assert.strictEqual(G.app.undoGroups.length, 1);
});

test("keyframes: lists every key value; replaces only matching keys", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const f = m.fill("000000", { keys: [m.color("FF0000"), m.color("0000FF"), m.color("FF0000")] });
  c.addLayer(m.shapeLayer("a", [f], { selected: true }));
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((x) => x.hex).sort(), ["0000FF", "FF0000"]);
  assert.strictEqual(r.colors.find((x) => x.hex === "FF0000").count, 1); // one property
  const a = J(G.SC_apply("FF0000", "ABCDEF", false));
  assert.strictEqual(a.changed, 2);
  assert.deepStrictEqual(f._children[0]._keys.map(hexOf), ["ABCDEF", "0000FF", "ABCDEF"]);
});

test("expressions: uses pre-expression value", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const f = m.fill("111111"); f._children[0].expressionValue = m.color("999999");
  c.addLayer(m.shapeLayer("a", [f], { selected: true }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((x) => x.hex), ["111111"]);
});

test("effects + applied layer styles are included and categorised", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  c.addLayer(m.shapeLayer("a", [], { selected: true, effects: [m.effect("AA0000")], styles: m.styles("00AA00") }));
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((x) => [x.hex, Object.keys(x.cats)[0]]).sort(), [["00AA00", "style"], ["AA0000", "effect"]]);
  assert.ok(!r.colors.some((x) => x.hex === "ABCDEF"), "disabled style must be skipped");
});

test("text: uniform fill, stroke off/zero-width ignored", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const doc = new G.TextDocument("Hi", [m.ch("FFFFFF", "FF0000", 0), m.ch("FFFFFF", "FF0000", 0)]);
  c.addLayer(m.textLayer("t", doc, { selected: true }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((x) => x.hex), ["FFFFFF"]);
});

test("text: mixed per-character colours are split and replaced per run only", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const doc = new G.TextDocument("Hello", [m.ch("FF0000"), m.ch("FF0000"), m.ch("0000FF", "00FF00"), m.ch("0000FF"), m.ch(null)]);
  const layer = c.addLayer(m.textLayer("t", doc, { selected: true }));
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((x) => x.hex).sort(), ["0000FF", "00FF00", "FF0000"]);
  const a = J(G.SC_apply("FF0000", "222222", false));
  assert.deepStrictEqual([a.changed, a.failed], [1, 0]);
  const chars = layer._children[0]._children[0]._v._chars;
  assert.deepStrictEqual(chars.map((ch) => ch.applyFill ? hexOf(ch.fill) : "-"), ["222222", "222222", "0000FF", "0000FF", "-"]);
  assert.deepStrictEqual(chars.map((ch) => ch.applyStroke), [false, false, true, false, false], "stroke flags untouched");
  // stroke recolour does not enable stroke elsewhere
  J(G.SC_apply("00FF00", "333333", false));
  const chars2 = layer._children[0]._children[0]._v._chars;
  assert.deepStrictEqual(chars2.map((ch) => ch.applyFill ? hexOf(ch.fill) : "-"), ["222222", "222222", "0000FF", "0000FF", "-"]);
  assert.deepStrictEqual(chars2.map((ch) => ch.applyStroke ? hexOf(ch.stroke) : "-"), ["-", "-", "333333", "-", "-"]);
});

test("text: keyframed source text", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const d1 = new G.TextDocument("A", [m.ch("FF0000")]), d2 = new G.TextDocument("B", [m.ch("00FF00")]);
  const layer = c.addLayer(m.textLayer("t", d1, { selected: true, keys: [d1, d2] }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((x) => x.hex).sort(), ["00FF00", "FF0000"]);
  J(G.SC_apply("00FF00", "444444", false));
  const keys = layer._children[0]._children[0]._keys;
  assert.deepStrictEqual(keys.map((d) => hexOf(d._chars[0].fill)), ["FF0000", "444444"]);
});

test("text: legacy (pre-24.3) docs, fill off does not throw", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  c.addLayer(m.textLayer("t1", new G.TextDocument("x", [m.ch(null)], { legacy: true }), { selected: true }));
  const d = new G.TextDocument("y", [m.ch("ABABAB")], { legacy: true });
  const l2 = c.addLayer(m.textLayer("t2", d, { selected: true }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((x) => x.hex), ["ABABAB"]);
  J(G.SC_apply("ABABAB", "010203", false));
  assert.strictEqual(hexOf(l2._children[0]._children[0]._v._chars[0].fill), "010203");
});

test("empty text layer is ignored", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  c.addLayer(m.textLayer("t", new G.TextDocument("", [m.ch("FF0000")]), { selected: true }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors, []);
});

test("solids: counted once per source; null/adjustment skipped; apply changes source", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const solid = new G.FootageItem(new G.SolidSource(m.color("FFAA00").slice(0, 3)));
  const nul = new G.FootageItem(new G.SolidSource([1, 1, 1]));
  const adj = new G.FootageItem(new G.SolidSource([0, 1, 1]));
  c.addLayer(new G.Layer("s1", [], { selected: true, source: solid }));
  c.addLayer(new G.Layer("s2", [], { selected: true, source: solid }));
  c.addLayer(new G.Layer("n", [], { selected: true, source: nul, nullLayer: true }));
  c.addLayer(new G.Layer("adj", [], { selected: true, source: adj, adjustmentLayer: true }));
  const r = J(G.SC_scan(false));
  assert.deepStrictEqual(r.colors.map((x) => [x.hex, x.count]), [["FFAA00", 1]]);
  J(G.SC_apply("FFAA00", "00AAFF", false));
  assert.strictEqual(hexOf(solid.mainSource.color), "00AAFF");
  assert.strictEqual(solid.mainSource.color.length, 3);
});

test("locked layers are edited then re-locked", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const f = m.fill("FF0000");
  const l = c.addLayer(m.shapeLayer("a", [f], { selected: true, locked: true }));
  const r = J(G.SC_apply("FF0000", "00FF00", false));
  assert.deepStrictEqual([r.changed, r.failed], [1, 0]);
  assert.strictEqual(l.locked, true);
  assert.strictEqual(hexOf(f._children[0]._v), "00FF00");
});

test("hidden property failure is reported; other sites still change", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const bad = m.fill("FF0000", { hidden: true }), good = m.fill("FF0000");
  c.addLayer(m.shapeLayer("a", [bad, good], { selected: true }));
  const r = J(G.SC_apply("FF0000", "00FF00", false));
  assert.deepStrictEqual([r.changed, r.failed], [1, 1]);
  assert.ok(/hidden/.test(r.error));
  assert.strictEqual(G.app.undoDepth, 0);
});

test("precomps: off by default, recursive when on, visited once", () => {
  const G = env(), m = G.mk, c = new G.CompItem("main"), pre = new G.CompItem("pre"), pre2 = new G.CompItem("pre2");
  G.app.project.activeItem = c;
  const inner = m.fill("C0FFEE");
  pre2.addLayer(m.shapeLayer("deep", [inner]));
  pre.addLayer(m.shapeLayer("in", [m.fill("BADA55")]));
  pre.addLayer(new G.Layer("nested", [], { source: pre2 }));
  c.addLayer(new G.Layer("p1", [], { selected: true, source: pre }));
  c.addLayer(new G.Layer("p2", [], { selected: true, source: pre }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors, []);
  const r = J(G.SC_scan(true));
  assert.deepStrictEqual(r.colors.map((x) => [x.hex, x.count]).sort(), [["BADA55", 1], ["C0FFEE", 1]]);
  J(G.SC_apply("C0FFEE", "FFFFFF", true));
  assert.strictEqual(hexOf(inner._children[0]._v), "FFFFFF");
});

test("select matching narrows selection; no match leaves it alone", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const a = c.addLayer(m.shapeLayer("a", [m.fill("FF0000")], { selected: true }));
  const b = c.addLayer(m.shapeLayer("b", [m.fill("00FF00")], { selected: true }));
  assert.strictEqual(J(G.SC_selectMatching("ff0000", false)).selected, 1);
  assert.deepStrictEqual([a.selected, b.selected], [true, false]);
  b.selected = true;
  assert.strictEqual(J(G.SC_selectMatching("123123", false)).selected, 0);
  assert.deepStrictEqual([a.selected, b.selected], [true, true]);
});

test("input validation + same colour no-op", () => {
  const G = env();
  G.app.project.activeItem = new G.CompItem("c");
  assert.strictEqual(J(G.SC_apply("XYZ", "FFFFFF", false)).ok, false);
  assert.strictEqual(J(G.SC_apply("ffffff", "FFFFFF", false)).changed, 0);
  assert.strictEqual(G.app.undoGroups.length, 0);
});

test("colour picker: cancel → empty, value → padded hex", () => {
  const G = env();
  assert.strictEqual(G.SC_pickColor("FF0000"), "");
  G.__pickerResult = 0x00ff;
  assert.strictEqual(G.SC_pickColor("FF0000"), "0000FF");
});

test("HDR / out-of-range values clamp for display", () => {
  const G = env(), m = G.mk, c = new G.CompItem("c"); G.app.project.activeItem = c;
  const f = m.fill("000000"); f._children[0]._v = [1.7, -0.2, 0.5, 1];
  c.addLayer(m.shapeLayer("a", [f], { selected: true }));
  assert.deepStrictEqual(J(G.SC_scan(false)).colors.map((x) => x.hex), ["FF0080"]);
});

test("JSON escaping survives quotes, backslashes and control chars", () => {
  const G = env();
  const s = G.SC_json({ a: 'q"\\\n\t\u0001 ', n: NaN, arr: [1, null, true] });
  assert.deepStrictEqual(JSON.parse(s), { a: 'q"\\\n\t\u0001 ', n: null, arr: [1, null, true] });
});

test("project colours: all comps, counted, sorted, partial when over budget", () => {
  const G = env(), m = G.mk;
  const c1 = new G.CompItem("c1"), c2 = new G.CompItem("c2"), solid = new G.FootageItem(new G.SolidSource([0, 0, 1]));
  c1.addLayer(m.shapeLayer("a", [m.fill("FF0000"), m.stroke("00FF00")]));
  c2.addLayer(m.shapeLayer("b", [m.fill("FF0000")]));
  c2.addLayer(new G.Layer("s", [], { source: solid }));
  c2.addLayer(new G.Layer("s2", [], { source: solid }));
  G.app.project.items = [solid, c1, c2];
  const r = J(G.SC_projectColors(5000));
  assert.deepStrictEqual([r.ok, r.partial], [true, false]);
  assert.deepStrictEqual(r.colors.map((c) => c.hex), ["FF0000", "00FF00", "0000FF"]);
  assert.deepStrictEqual(r.colors[0], { id: "FF0000", hex: "FF0000", label: "#FF0000" });
  // budget exhausted -> partial, still valid JSON
  const realDate = G.Date; let t = 0;
  G.Date = function () { return { getTime: () => (t += 1000) }; };
  const p = J(G.SC_projectColors(10));
  G.Date = realDate;
  assert.strictEqual(p.partial, true);
  assert.ok(Array.isArray(p.colors));
});

test("project colours: empty project", () => {
  const G = env();
  assert.deepStrictEqual(J(G.SC_projectColors(500)), { ok: true, colors: [], partial: false });
});

console.log(`\n${passed} passed`);
