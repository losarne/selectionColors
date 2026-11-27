/*  Selection Colors - InDesign host (ExtendScript, ES3). Needs common.jsx.
 *
 *  Sources covered (selected objects, recursing into groups):
 *    - Frame / shape / line fill and stroke (incl. text frames)
 *    - Text fill and stroke (text in selected frames, or a text selection), by style run
 *    - Gradient stops (a gradient swatch is shared: editing a stop changes it everywhere)
 *    - Process, spot, tint swatches and unnamed colours (RGB, CMYK, Lab)
 *
 *  Identity = swatch + effective tint, so two swatches that look alike stay separate rows.
 *  Edits re-point the selected objects to another colour (only the selection changes):
 *  an existing document colour with the same values is reused, otherwise a process colour named
 *  the InDesign way ("C=0 M=100 Y=100 K=0" / "R=255 G=0 B=0") is added, in the old colour's space.
 *  Every edit is a single undo step (doScript + UndoModes.ENTIRE_SCRIPT).
 */

var SC_HOST = "id";
var SC_SCAN_BUDGET_MS = 1500;

/* ------------------------------------------------------------ helpers */

function SC_r2(n) { return Math.round(n * 100) / 100; }

function SC_hex255(v) {
    v = Math.round(v);
    if (v < 0) { v = 0; } else if (v > 255) { v = 255; }
    var s = v.toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
}
function SC_rgbHex(r, g, b) { return SC_hex255(r) + SC_hex255(g) + SC_hex255(b); }

function SC_cn(o) { try { return o ? o.constructor.name : ""; } catch (e) { return ""; } }
function SC_valid(o) { try { return !!(o && o.isValid); } catch (e) { return false; } }
function SC_isDoc() { try { return app.documents.length > 0; } catch (e) { return false; } }

function SC_cmykToRgb(c, m, y, k) {
    return [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)];
}

function SC_labToRgb(L, a, b) {
    var fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
    function f(t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; }
    var X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz);
    function gam(c) { return c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c; }
    return [gam(X * 3.2406 + Y * -1.5372 + Z * -0.4986) * 255,
            gam(X * -0.9689 + Y * 1.8758 + Z * 0.0415) * 255,
            gam(X * 0.0557 + Y * -0.2040 + Z * 1.0570) * 255];
}

/* RGB 0..255 of a Color object (approximate for CMYK/Lab: display only). */
function SC_colorRgb(col) {
    var v = col.colorValue, sp = col.space;
    if (sp == ColorSpace.RGB) { return [v[0], v[1], v[2]]; }
    if (sp == ColorSpace.CMYK) { return SC_cmykToRgb(v[0], v[1], v[2], v[3]); }
    if (sp == ColorSpace.LAB) { return SC_labToRgb(v[0], v[1], v[2]); }
    return null;
}

function SC_valuesLabel(col) {
    var v = col.colorValue, sp = col.space;
    if (sp == ColorSpace.RGB) { return "R=" + Math.round(v[0]) + " G=" + Math.round(v[1]) + " B=" + Math.round(v[2]); }
    if (sp == ColorSpace.CMYK) { return "C=" + Math.round(v[0]) + " M=" + Math.round(v[1]) + " Y=" + Math.round(v[2]) + " K=" + Math.round(v[3]); }
    if (sp == ColorSpace.LAB) { return "L=" + Math.round(v[0]) + " a=" + Math.round(v[1]) + " b=" + Math.round(v[2]); }
    return "";
}

/* Describe a swatch as applied (with the object's tint): { key, hex, label, color, tint } or null. */
function SC_swatchDesc(sw, objTint) {
    if (!SC_valid(sw)) { return null; }
    var cn = SC_cn(sw), base = sw, t = 100;
    try {
        if (cn === "Tint") { base = sw.baseColor; t = sw.tintValue; cn = SC_cn(base); }
        if (cn !== "Color" || !SC_valid(base)) { return null; }        // None, Gradient, MixedInk...
        if (typeof objTint === "number" && objTint >= 0) { t = objTint; } // -1 = "use swatch tint"
        var rgb = SC_colorRgb(base);
        if (!rgb) { return null; }
        var f = t / 100, hex = SC_rgbHex(255 - (255 - rgb[0]) * f, 255 - (255 - rgb[1]) * f, 255 - (255 - rgb[2]) * f);
        var name = "";
        try { name = base.name; } catch (eN) { name = ""; }
        var label = (name ? name : SC_valuesLabel(base)) + (Math.round(t) !== 100 ? " " + Math.round(t) + "%" : "");
        if (name && name.indexOf("=") < 0) { label += " (" + SC_valuesLabel(base) + ")"; }
        return { key: "c" + base.id + ":" + SC_r2(t), hex: hex, label: label, color: base, tint: t };
    } catch (e) { return null; }
}

/* ------------------------------------------------------------- traversal */

/* Site kinds:
     { t:"paint", item, which }       object fill / stroke
     { t:"text",  text, owner }       a Text object (frame text or text selection), walked by style run
     { t:"stop",  stop }              gradient stop                                                   */

var SC_SHAPES = { Rectangle: 1, Oval: 1, Polygon: 1, GraphicLine: 1, TextFrame: 1 };

function SC_strokeVisible(o) {
    try { var w = o.strokeWeight; return !(typeof w === "number" && w <= 0); } catch (e) { return true; }
}

function SC_addPaint(item, which, ctx) {
    var sw = null;
    try {
        if (which === "stroke" && !SC_strokeVisible(item)) { return; }
        sw = (which === "fill") ? item.fillColor : item.strokeColor;
    } catch (e) { return; }
    if (!SC_valid(sw)) { return; }
    if (SC_cn(sw) === "Gradient") {
        var gid = "g" + sw.id;
        if (ctx.grads[gid]) { return; }
        ctx.grads[gid] = true;
        var n = 0;
        try { n = sw.gradientStops.length; } catch (e2) { n = 0; }
        for (var i = 0; i < n; i++) { ctx.sites.push({ t: "stop", stop: sw.gradientStops[i], cat: "gradient" }); }
        return;
    }
    ctx.sites.push({ t: "paint", item: item, which: which, cat: which });
}

function SC_visitItem(item, ctx, withText) {
    var cn = SC_cn(item), i, n;
    if (cn === "Group") {
        try { n = item.pageItems.length; } catch (e) { n = 0; }
        for (i = 0; i < n; i++) { SC_visitItem(item.pageItems[i], ctx, withText); }
        return;
    }
    if (!SC_SHAPES[cn]) { return; }   // images, buttons, EPS, ... carry no editable swatch here
    SC_addPaint(item, "fill", ctx);
    SC_addPaint(item, "stroke", ctx);
    if (cn === "TextFrame" && withText) {
        var tx = null;
        try { tx = item.texts[0]; } catch (e3) { tx = null; }
        if (SC_valid(tx)) { ctx.sites.push({ t: "text", text: tx, owner: item, cat: "text" }); }
    }
}

function SC_newCtx() { return { sites: [], grads: {} }; }

function SC_isTextSel(o) {
    var cn = SC_cn(o);
    return cn === "Text" || cn === "Character" || cn === "Word" || cn === "Line" || cn === "Paragraph" ||
        cn === "TextStyleRange" || cn === "TextColumn" || cn === "Story";
}

function SC_collectSelection() {
    var ctx = SC_newCtx(), sel = null, items = [], text = false, i;
    try { sel = app.selection; } catch (e) { sel = null; }
    if (!sel || !sel.length) { return { ctx: ctx, items: items, text: false }; }
    for (i = 0; i < sel.length; i++) {
        var s = sel[i];
        if (SC_isTextSel(s)) {
            var len = 0;
            try { len = s.characters.length; } catch (eL) { try { len = String(s.contents).length; } catch (eC) { len = 0; } }
            if (len > 0) { ctx.sites.push({ t: "text", text: s, owner: null, cat: "text" }); text = true; }
        } else if (SC_cn(s) !== "InsertionPoint") {
            items.push(s);
            SC_visitItem(s, ctx, true);
        }
    }
    return { ctx: ctx, items: items, text: text };
}

/* ------------------------------------------------------------- reading */

function SC_rangeDesc(r, which) {
    try {
        if (which === "stroke" && !SC_strokeVisible(r)) { return null; }
        return which === "fill" ? SC_swatchDesc(r.fillColor, r.fillTint) : SC_swatchDesc(r.strokeColor, r.strokeTint);
    } catch (e) { return null; }
}

function SC_siteDescs(site) {
    var out = [], seen = {};
    function add(d) { if (d && !seen[d.key]) { seen[d.key] = true; out.push(d); } }
    try {
        if (site.t === "paint") {
            add(site.which === "fill" ? SC_swatchDesc(site.item.fillColor, site.item.fillTint)
                                      : SC_swatchDesc(site.item.strokeColor, site.item.strokeTint));
        } else if (site.t === "stop") {
            add(SC_swatchDesc(site.stop.stopColor, -1));
        } else if (site.t === "text") {
            var runs = site.text.textStyleRanges, n = runs.length;
            for (var i = 0; i < n; i++) { add(SC_rangeDesc(runs[i], "fill")); add(SC_rangeDesc(runs[i], "stroke")); }
        }
    } catch (e) {}
    return out;
}

/* ------------------------------------------------------------- writing */

function SC_sameValues(a, b) {
    if (!a || !b || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (Math.abs(a[i] - b[i]) > 0.005) { return false; } }
    return true;
}

/* Existing process colour with exactly these values, or a new one (named like InDesign does). */
function SC_findOrMakeColor(doc, hex, cmyk) {
    var rgb = SC_hexToRgb(hex), r = Math.round(rgb[0] * 255), g = Math.round(rgb[1] * 255), b = Math.round(rgb[2] * 255);
    var space = cmyk ? ColorSpace.CMYK : ColorSpace.RGB, values, temp = null, i;

    if (cmyk) {
        // Let InDesign convert with the document's colour settings.
        temp = doc.colors.add({ model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [r, g, b] });
        temp.space = ColorSpace.CMYK;
        var cv = temp.colorValue;
        values = [Math.round(cv[0]), Math.round(cv[1]), Math.round(cv[2]), Math.round(cv[3])];
    } else {
        values = [r, g, b];
    }

    var cols = doc.colors, n = cols.length;
    for (i = 0; i < n; i++) {
        var c = cols[i];
        if (temp && c.id === temp.id) { continue; }
        try {
            if (c.model == ColorModel.PROCESS && c.space == space && SC_sameValues(c.colorValue, values)) {
                if (temp) { temp.remove(); }
                return c;
            }
        } catch (e) {}
    }

    var name = cmyk ? "C=" + values[0] + " M=" + values[1] + " Y=" + values[2] + " K=" + values[3]
                    : "R=" + values[0] + " G=" + values[1] + " B=" + values[2];
    var col = temp;
    if (col) { col.colorValue = values; }
    else { col = doc.colors.add({ model: ColorModel.PROCESS, space: space, colorValue: values }); }
    var nm = name, k = 2;
    while (true) {
        try { col.name = nm; break; }
        catch (eN) { nm = name + " " + k; k++; if (k > 50) { break; } }
    }
    return col;
}

/* Resolve a target key ("c<id>:<tint>") to { color, tint }, or null. */
function SC_fromKey(doc, key) {
    var m = /^c(\d+):([\d.]+)$/.exec(String(key || ""));
    if (!m) { return null; }
    try {
        var col = doc.colors.itemByID(parseInt(m[1], 10));
        if (!SC_valid(col)) { return null; }
        return { color: col, tint: parseFloat(m[2]) };
    } catch (e) { return null; }
}

function SC_setPaint(obj, which, color, tint) {
    if (which === "fill") { obj.fillColor = color; obj.fillTint = tint; }
    else { obj.strokeColor = color; obj.strokeTint = tint; }
}

/* Returns 1 if the site changed; throws on failure. */
function SC_applySite(site, oldKey, color, tint) {
    var d;
    if (site.t === "paint") {
        d = (site.which === "fill") ? SC_swatchDesc(site.item.fillColor, site.item.fillTint)
                                    : SC_swatchDesc(site.item.strokeColor, site.item.strokeTint);
        if (!d || d.key !== oldKey) { return 0; }
        SC_setPaint(site.item, site.which, color, tint);
        return 1;
    }
    if (site.t === "stop") {
        d = SC_swatchDesc(site.stop.stopColor, -1);
        if (!d || d.key !== oldKey) { return 0; }
        site.stop.stopColor = color;
        return 1;
    }
    if (site.t === "text") {
        // Back to front: recolouring a run can merge it with its neighbours, which renumbers later runs only.
        var runs = site.text.textStyleRanges, changed = 0;
        for (var i = runs.length - 1; i >= 0; i--) {
            var r = runs[i];
            d = SC_rangeDesc(r, "fill");
            if (d && d.key === oldKey) { SC_setPaint(r, "fill", color, tint); changed++; }
            if (i >= runs.length) { continue; }
            r = runs[i];
            d = SC_rangeDesc(r, "stroke");
            if (d && d.key === oldKey) { SC_setPaint(r, "stroke", color, tint); changed++; }
        }
        return changed > 0 ? 1 : 0;
    }
    return 0;
}

function SC_unlockFor(site, unlocked) {
    var objs = [];
    if (site.item) { objs.push(site.item); }
    if (site.owner) { objs.push(site.owner); }
    for (var i = 0; i < objs.length; i++) {
        try {
            if (objs[i].locked && !SC_contains(unlocked, objs[i])) { objs[i].locked = false; unlocked.push(objs[i]); }
        } catch (e) {}
    }
}

/* ------------------------------------------------------------ public API */

function SC_fingerprint() {
    try {
        if (!SC_isDoc()) { return "nodoc"; }
        var doc = app.activeDocument, sel = app.selection, parts = [doc.name, sel ? sel.length : 0];
        var n = sel ? Math.min(sel.length, 30) : 0;
        for (var i = 0; i < n; i++) {
            var s = sel[i], id;
            try {
                id = SC_isTextSel(s) || SC_cn(s) === "InsertionPoint"
                    ? SC_cn(s) + ":" + s.index + ":" + s.characters.length
                    : SC_cn(s) + ":" + s.id;
            } catch (e1) { id = SC_cn(s); }
            parts.push(id);
        }
        return parts.join("|");
    } catch (e) { return "err:" + e.toString(); }
}

function SC_scan(deep) {
    try {
        if (!SC_isDoc()) { return SC_json({ status: "nodoc", colors: [] }); }
        var got = SC_collectSelection();
        if (!got.text && got.items.length === 0) { return SC_json({ status: "nosel", colors: [] }); }
        var t0 = new Date().getTime(), map = {}, list = [], partial = false, i, j, sites = got.ctx.sites;
        for (i = 0; i < sites.length; i++) {
            if (new Date().getTime() - t0 > SC_SCAN_BUDGET_MS) { partial = true; break; }
            var ds = SC_siteDescs(sites[i]);
            for (j = 0; j < ds.length; j++) {
                var d = ds[j], e = map["k" + d.key];
                if (!e) {
                    e = { id: d.key, hex: d.hex, label: d.label, count: 0, order: list.length, cats: {} };
                    map["k" + d.key] = e;
                    list.push(e);
                }
                e.count++;
                e.cats[sites[i].cat] = (e.cats[sites[i].cat] || 0) + 1;
            }
        }
        list.sort(function (a, b) { return (b.count - a.count) || (a.order - b.order); });
        return SC_json({ status: "ok", layers: got.items.length, colors: list, partial: partial });
    } catch (err) {
        return SC_json({ status: "error", error: err.toString() + (err.line ? " (line " + err.line + ")" : ""), colors: [] });
    }
}

function SC_applyImpl(oldKey, newHex, targetKey) {
    var doc = app.activeDocument, got = SC_collectSelection();
    if (!got.text && got.items.length === 0) { return { ok: false, error: "Nothing selected" }; }

    var color = null, tint = 100, target = targetKey ? SC_fromKey(doc, targetKey) : null;
    if (target) {
        color = target.color; tint = target.tint;
    } else {
        var cmyk = false, old = SC_fromKey(doc, oldKey);
        try { cmyk = !!(old && old.color.space == ColorSpace.CMYK); } catch (eS) { cmyk = false; }
        color = SC_findOrMakeColor(doc, newHex, cmyk);
    }
    var newKey = "c" + color.id + ":" + SC_r2(tint);
    if (newKey === oldKey) { return { ok: true, changed: 0, failed: 0, id: newKey }; }

    var sites = got.ctx.sites, changed = 0, failed = 0, firstError = "", unlocked = [], i;
    try {
        for (i = 0; i < sites.length; i++) {
            SC_unlockFor(sites[i], unlocked);
            try { changed += SC_applySite(sites[i], oldKey, color, tint); }
            catch (e) { failed++; if (!firstError) { firstError = e.toString(); } }
        }
    } finally {
        for (i = 0; i < unlocked.length; i++) { try { unlocked[i].locked = true; } catch (eR) {} }
    }
    return { ok: true, changed: changed, failed: failed, error: firstError, id: newKey };
}

function SC_apply(oldKey, newHex, deep, targetKey) {
    oldKey = String(oldKey);
    newHex = String(newHex).toUpperCase();
    if (!SC_isHex6(newHex)) { return SC_json({ ok: false, error: "Invalid hex" }); }
    if (!SC_isDoc()) { return SC_json({ ok: false, error: "No open document" }); }
    var result = null;
    try {
        app.doScript(function () { result = SC_applyImpl(oldKey, newHex, targetKey); },
            ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "Selection Colors");
    } catch (e) {
        if (!result) { result = { ok: false, error: e.toString() }; }
    }
    return SC_json(result || { ok: false, error: "No result" });
}

function SC_selectMatching(key, deep) {
    key = String(key);
    try {
        if (!SC_isDoc()) { return SC_json({ ok: false, error: "No open document" }); }
        var sel = app.selection, keep = [], i, j, k;
        if (!sel || !sel.length) { return SC_json({ ok: true, selected: 0 }); }
        for (i = 0; i < sel.length; i++) {
            if (SC_isTextSel(sel[i]) || SC_cn(sel[i]) === "InsertionPoint") { return SC_json({ ok: true, selected: 0 }); }
            var ctx = SC_newCtx(), hit = false;
            SC_visitItem(sel[i], ctx, true);
            for (j = 0; j < ctx.sites.length && !hit; j++) {
                var ds = SC_siteDescs(ctx.sites[j]);
                for (k = 0; k < ds.length; k++) { if (ds[k].key === key) { hit = true; break; } }
            }
            if (hit) { keep.push(sel[i]); }
        }
        if (keep.length === 0) { return SC_json({ ok: true, selected: 0 }); }
        app.selection = keep;
        return SC_json({ ok: true, selected: keep.length });
    } catch (e) {
        return SC_json({ ok: false, error: e.toString() });
    }
}

/* Every colour used in the document (objects + all stories), most used first. Time-boxed. */
function SC_projectColors(budgetMs) {
    try {
        if (!SC_isDoc()) { return SC_json({ ok: true, colors: [], partial: false }); }
        var t0 = new Date().getTime(), budget = (typeof budgetMs === "number" && budgetMs > 0) ? budgetMs : 600;
        var doc = app.activeDocument, ctx = SC_newCtx(), map = {}, list = [], partial = false, i, s, q;
        function tally() {
            for (s = 0; s < ctx.sites.length; s++) {
                var ds = SC_siteDescs(ctx.sites[s]);
                for (q = 0; q < ds.length; q++) {
                    var e = map["k" + ds[q].key];
                    if (!e) { e = { id: ds[q].key, hex: ds[q].hex, label: ds[q].label, count: 0, order: list.length }; map["k" + ds[q].key] = e; list.push(e); }
                    e.count++;
                }
            }
            ctx.sites = [];
        }
        var items = [];
        try { items = doc.allPageItems; } catch (eA) { items = []; }
        for (i = 0; i < items.length; i++) {
            if (new Date().getTime() - t0 > budget) { partial = true; break; }
            if (SC_cn(items[i]) === "Group") { continue; }   // children are listed separately
            SC_visitItem(items[i], ctx, false);
            tally();
        }
        if (!partial) {
            var ns = 0;
            try { ns = doc.stories.length; } catch (eS) { ns = 0; }
            for (i = 0; i < ns; i++) {
                if (new Date().getTime() - t0 > budget) { partial = true; break; }
                ctx.sites.push({ t: "text", text: doc.stories[i], cat: "text" });
                tally();
            }
        }
        list.sort(function (a, b) { return (b.count - a.count) || (a.order - b.order); });
        var out = [];
        for (i = 0; i < list.length; i++) { out.push({ id: list[i].id, hex: list[i].hex, label: list[i].label }); }
        return SC_json({ ok: true, colors: out, partial: partial });
    } catch (err) {
        return SC_json({ ok: false, colors: [], error: err.toString() });
    }
}
