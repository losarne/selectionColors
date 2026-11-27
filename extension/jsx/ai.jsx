/*  Selection Colors - Illustrator host (ExtendScript, ES3). Needs common.jsx.
 *
 *  Sources covered (selected objects, recursing into groups):
 *    - Path fill / stroke, compound paths (all sub-paths together)
 *    - Text fill / stroke, per character (text frames, or a text selection made with the Type tool)
 *    - Gradient stops (fill or stroke gradients; a gradient is shared, so edits change it everywhere)
 *    - RGB, CMYK, Grayscale, Spot (with tint) and Lab colours
 *
 *  Colours are grouped by their exact value (e.g. CMYK numbers), not just by hex, so two
 *  different CMYK colours that look the same on screen stay separate rows.
 *  New colours are created in the document's colour mode (CMYK docs get CMYK).
 *  Spot colours are replaced per object with a process colour (the spot swatch is not edited).
 */

var SC_HOST = "ai";
var SC_SCAN_BUDGET_MS = 1500;

/* ------------------------------------------------------------ colour utils */

function SC_r2(n) { return Math.round(n * 100) / 100; }

function SC_hex255(v) {
    v = Math.round(v);
    if (v < 0) { v = 0; } else if (v > 255) { v = 255; }
    var s = v.toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
}

function SC_rgbHex(r, g, b) { return SC_hex255(r) + SC_hex255(g) + SC_hex255(b); }

function SC_convert(srcSpace, comps, dstSpace) {
    try {
        var out = app.convertSampleColor(srcSpace, comps, dstSpace, ColorConvertPurpose.defaultpurpose);
        if (out && out.length >= 3) { return out; }
    } catch (e) {}
    return null;
}

function SC_cmykToRgb(c, m, y, k) {
    var out = SC_convert(ImageColorSpace.CMYK, [c, m, y, k], ImageColorSpace.RGB);
    if (out) { return [out[0], out[1], out[2]]; }
    // naive fallback
    return [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)];
}

function SC_isDoc() {
    try { return app.documents.length > 0; } catch (e) { return false; }
}

function SC_tn(o) {
    try { return o ? o.typename : ""; } catch (e) { return ""; }
}

/* Describe a colour: { key, hex, label } or null when there's nothing to paint
   (NoColor, PatternColor; GradientColor is expanded into stops by the caller). */
function SC_desc(c) {
    var t = SC_tn(c), rgb;
    try {
        if (t === "RGBColor") {
            return {
                key: "rgb:" + SC_r2(c.red) + "," + SC_r2(c.green) + "," + SC_r2(c.blue),
                hex: SC_rgbHex(c.red, c.green, c.blue),
                label: "R" + Math.round(c.red) + " G" + Math.round(c.green) + " B" + Math.round(c.blue)
            };
        }
        if (t === "CMYKColor") {
            rgb = SC_cmykToRgb(c.cyan, c.magenta, c.yellow, c.black);
            return {
                key: "cmyk:" + SC_r2(c.cyan) + "," + SC_r2(c.magenta) + "," + SC_r2(c.yellow) + "," + SC_r2(c.black),
                hex: SC_rgbHex(rgb[0], rgb[1], rgb[2]),
                label: "C" + Math.round(c.cyan) + " M" + Math.round(c.magenta) + " Y" + Math.round(c.yellow) + " K" + Math.round(c.black)
            };
        }
        if (t === "GrayColor") {
            var v = 255 * (1 - c.gray / 100);
            return { key: "gray:" + SC_r2(c.gray), hex: SC_rgbHex(v, v, v), label: "Gray " + Math.round(c.gray) + "%" };
        }
        if (t === "SpotColor") {
            var base = SC_desc(c.spot.color), tint = c.tint, name = c.spot.name;
            if (!base) { return null; }
            var br = parseInt(base.hex.substr(0, 2), 16), bg = parseInt(base.hex.substr(2, 2), 16), bb = parseInt(base.hex.substr(4, 2), 16);
            var f = tint / 100;
            return {
                key: "spot:" + name + ":" + SC_r2(tint),
                hex: SC_rgbHex(255 - (255 - br) * f, 255 - (255 - bg) * f, 255 - (255 - bb) * f),
                label: name + (Math.round(tint) !== 100 ? " " + Math.round(tint) + "%" : "")
            };
        }
        if (t === "LabColor") {
            rgb = SC_convert(ImageColorSpace.LAB, [c.l, c.a, c.b], ImageColorSpace.RGB);
            if (!rgb) { return null; }
            return {
                key: "lab:" + SC_r2(c.l) + "," + SC_r2(c.a) + "," + SC_r2(c.b),
                hex: SC_rgbHex(rgb[0], rgb[1], rgb[2]),
                label: "L" + Math.round(c.l) + " a" + Math.round(c.a) + " b" + Math.round(c.b)
            };
        }
    } catch (e) {}
    return null;
}

/* New colour in the document's mode. Integer components so the key is stable after AI stores it. */
function SC_makeColor(hex, doc) {
    var rgb = SC_hexToRgb(hex), r = Math.round(rgb[0] * 255), g = Math.round(rgb[1] * 255), b = Math.round(rgb[2] * 255);
    var cmykDoc = false;
    try { cmykDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK); } catch (e) { cmykDoc = false; }
    if (cmykDoc) {
        var k = SC_convert(ImageColorSpace.RGB, [r, g, b], ImageColorSpace.CMYK), c = new CMYKColor();
        if (!k || k.length < 4) {
            // naive fallback
            var K = 1 - Math.max(r, g, b) / 255;
            k = (K >= 1) ? [0, 0, 0, 100] : [
                (1 - r / 255 - K) / (1 - K) * 100, (1 - g / 255 - K) / (1 - K) * 100, (1 - b / 255 - K) / (1 - K) * 100, K * 100];
        }
        c.cyan = Math.round(k[0]); c.magenta = Math.round(k[1]); c.yellow = Math.round(k[2]); c.black = Math.round(k[3]);
        return c;
    }
    var col = new RGBColor();
    col.red = r; col.green = g; col.blue = b;
    return col;
}

/* Rebuild the exact colour behind a key (used when snapping to a chip). null if unknown. */
function SC_colorFromKey(key, doc) {
    var m, c;
    key = String(key || "");
    try {
        if ((m = /^rgb:([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(key))) {
            c = new RGBColor(); c.red = parseFloat(m[1]); c.green = parseFloat(m[2]); c.blue = parseFloat(m[3]); return c;
        }
        if ((m = /^cmyk:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(key))) {
            c = new CMYKColor(); c.cyan = parseFloat(m[1]); c.magenta = parseFloat(m[2]); c.yellow = parseFloat(m[3]); c.black = parseFloat(m[4]); return c;
        }
        if ((m = /^gray:([-\d.]+)$/.exec(key))) {
            c = new GrayColor(); c.gray = parseFloat(m[1]); return c;
        }
        if ((m = /^spot:(.*):([-\d.]+)$/.exec(key))) {
            var spot = doc.spots.getByName(m[1]);
            if (!spot) { return null; }
            c = new SpotColor(); c.spot = spot; c.tint = parseFloat(m[2]); return c;
        }
    } catch (e) {}
    return null;
}

/* ------------------------------------------------------------- traversal */

/* Site kinds:
     { t:"paint", item, which:"fill"|"stroke", cat }       path / compound path paint
     { t:"text",  chars, owner, cat:"text" }                 characters of a text frame or text selection
     { t:"stop",  stop, item, which, cat:"gradient" }        one gradient stop                          */

function SC_paintOf(item, which) {
    // Returns the item's colour object for fill/stroke, or null when not painted.
    var tn = SC_tn(item), target = item;
    try {
        if (tn === "CompoundPathItem") {
            if (!item.pathItems || item.pathItems.length === 0) { return null; }
            target = item.pathItems[0];
        }
        if (which === "fill") { return target.filled ? target.fillColor : null; }
        return target.stroked ? target.strokeColor : null;
    } catch (e) { return null; }
}

function SC_addPaint(item, which, ctx) {
    var c = SC_paintOf(item, which);
    if (!c) { return; }
    if (SC_tn(c) === "GradientColor") {
        var grad = null, gname = "";
        try { grad = c.gradient; gname = grad.name; } catch (e) { grad = null; }
        if (!grad) { return; }
        if (gname && ctx.grads["g" + gname]) { return; }   // shared gradient: visit once
        if (gname) { ctx.grads["g" + gname] = true; }
        var n = 0;
        try { n = grad.gradientStops.length; } catch (e2) { n = 0; }
        for (var i = 0; i < n; i++) {
            ctx.sites.push({ t: "stop", stop: grad.gradientStops[i], item: item, which: which, cat: "gradient" });
        }
        return;
    }
    ctx.sites.push({ t: "paint", item: item, which: which, cat: which });
}

function SC_visitItem(item, ctx) {
    var tn = SC_tn(item), i, n;
    if (tn === "GroupItem") {
        try { n = item.pageItems.length; } catch (e) { n = 0; }
        for (i = 0; i < n; i++) { SC_visitItem(item.pageItems[i], ctx); }
    } else if (tn === "PathItem" || tn === "CompoundPathItem") {
        SC_addPaint(item, "fill", ctx);
        SC_addPaint(item, "stroke", ctx);
    } else if (tn === "TextFrame") {
        var chars = null;
        try { chars = item.textRange.characters; } catch (e2) { chars = null; }
        if (!chars || !chars.length) { try { chars = item.textRanges; } catch (e3) { chars = null; } }
        if (chars && chars.length) { ctx.sites.push({ t: "text", chars: chars, owner: item, cat: "text" }); }
    }
    // PlacedItem, RasterItem, SymbolItem, MeshItem, PluginItem, GraphItem, ... carry no editable colour here.
}

function SC_newCtx() { return { sites: [], grads: {} }; }

/* The object a site's opacity lives on (null for gradient stops and bare text-range selections). */
function SC_siteOwner(site) {
    if (site.t === "paint" || site.t === "stop") { return site.item; }
    if (site.t === "text") { return site.owner; }
    return null;
}
function SC_getOpac(o) {
    try { return (typeof o.opacity === "number") ? o.opacity : null; } catch (e) { return null; }
}
function SC_ownerKey(o) {
    try { return o.uuid || (SC_tn(o) + ":" + o.left + "," + o.top); } catch (e) { return null; }
}

/* Selection -> sites. Handles object selections and Type-tool text selections. */
function SC_collectSelection(doc) {
    var ctx = SC_newCtx(), sel = null;
    try { sel = doc.selection; } catch (e) { sel = null; }
    if (!sel) { return { ctx: ctx, items: [], text: false }; }
    if (SC_tn(sel) === "TextRange") {
        var chars = null;
        try { chars = sel.characters; } catch (e2) { chars = null; }
        if (chars && chars.length) { ctx.sites.push({ t: "text", chars: chars, owner: null, cat: "text" }); }
        return { ctx: ctx, items: [], text: true };
    }
    var items = [];
    for (var i = 0; i < sel.length; i++) { items.push(sel[i]); SC_visitItem(sel[i], ctx); }
    return { ctx: ctx, items: items, text: false };
}

/* ------------------------------------------------------------- reading */

function SC_charPaint(ch, which) {
    try {
        var a = ch.characterAttributes;
        return which === "fill" ? a.fillColor : a.strokeColor;
    } catch (e) { return null; }
}

/* Calls fn(desc) for each distinct colour on the site. */
function SC_siteDescs(site) {
    var out = [], seen = {}, i, n;
    function add(x) { if (x && !seen[x.key]) { seen[x.key] = true; out.push(x); } }
    try {
        if (site.t === "paint") {
            add(SC_desc(SC_paintOf(site.item, site.which)));
        } else if (site.t === "stop") {
            add(SC_desc(site.stop.color));
        } else if (site.t === "text") {
            n = site.chars.length;
            for (i = 0; i < n; i++) {
                var ch = site.chars[i];
                add(SC_desc(SC_charPaint(ch, "fill")));
                add(SC_desc(SC_charPaint(ch, "stroke")));
            }
        }
    } catch (e) {}
    return out;
}

/* ------------------------------------------------------------- writing */

function SC_setPaint(target, which, color) {
    if (which === "fill") { target.fillColor = color; } else { target.strokeColor = color; }
}

/* Returns number of values changed; throws on failure. */
function SC_applySite(site, oldKey, color) {
    var changed = 0, d, i, n;
    if (site.t === "paint") {
        d = SC_desc(SC_paintOf(site.item, site.which));
        if (!d || d.key !== oldKey) { return 0; }
        if (SC_tn(site.item) === "CompoundPathItem") {
            n = site.item.pathItems.length;
            for (i = 0; i < n; i++) { SC_setPaint(site.item.pathItems[i], site.which, color); }
        } else {
            SC_setPaint(site.item, site.which, color);
        }
        return 1;
    }
    if (site.t === "stop") {
        d = SC_desc(site.stop.color);
        if (!d || d.key !== oldKey) { return 0; }
        site.stop.color = color;
        // Re-apply the gradient so the item redraws with the edited stop.
        try {
            var gc = (site.which === "fill") ? SC_paintOf(site.item, "fill") : SC_paintOf(site.item, "stroke");
            var tgt = (SC_tn(site.item) === "CompoundPathItem") ? site.item.pathItems[0] : site.item;
            if (gc && SC_tn(gc) === "GradientColor") { SC_setPaint(tgt, site.which, gc); }
        } catch (eR) {}
        return 1;
    }
    if (site.t === "text") {
        n = site.chars.length;
        for (i = 0; i < n; i++) {
            var ch = site.chars[i];
            d = SC_desc(SC_charPaint(ch, "fill"));
            if (d && d.key === oldKey) { ch.characterAttributes.fillColor = color; changed++; }
            d = SC_desc(SC_charPaint(ch, "stroke"));
            if (d && d.key === oldKey) { ch.characterAttributes.strokeColor = color; changed++; }
        }
        return changed > 0 ? 1 : 0;
    }
    return 0;
}

/* Locked objects (e.g. inside a selected group) refuse edits: unlock, edit, relock. */
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
        var doc = app.activeDocument, sel = doc.selection, parts = [doc.name];
        if (!sel) { return parts.join("|") + "|0"; }
        if (SC_tn(sel) === "TextRange") {
            try { return parts.join("|") + "|text:" + sel.characters.length + ":" + sel.contents.length; } catch (eT) { return parts.join("|") + "|text"; }
        }
        parts.push(sel.length);
        var n = Math.min(sel.length, 30);
        for (var i = 0; i < n; i++) {
            var it = sel[i], id = "";
            try { id = it.uuid; } catch (eU) { id = ""; }
            if (!id) {
                try { id = it.typename + ":" + Math.round(it.left) + "," + Math.round(it.top) + "," + Math.round(it.width) + "," + Math.round(it.height); }
                catch (eP) { id = SC_tn(it); }
            }
            parts.push(id);
        }
        return parts.join("|");
    } catch (e) { return "err:" + e.toString(); }
}

function SC_scan(deep) {
    try {
        if (!SC_isDoc()) { return SC_json({ status: "nodoc", colors: [] }); }
        var doc = app.activeDocument, got = SC_collectSelection(doc);
        if (!got.text && got.items.length === 0) { return SC_json({ status: "nosel", colors: [] }); }

        var t0 = new Date().getTime(), map = {}, list = [], partial = false, i, j;
        var sites = got.ctx.sites;
        for (i = 0; i < sites.length; i++) {
            if (new Date().getTime() - t0 > SC_SCAN_BUDGET_MS) { partial = true; break; }
            var ds = SC_siteDescs(sites[i]);
            var owner = SC_siteOwner(sites[i]), op = owner ? SC_getOpac(owner) : null;
            for (j = 0; j < ds.length; j++) {
                var d = ds[j], e = map["k" + d.key];
                if (!e) {
                    e = { id: d.key, hex: d.hex, label: d.label, count: 0, order: list.length, cats: {}, opMin: null, opMax: null };
                    map["k" + d.key] = e;
                    list.push(e);
                }
                e.count++;
                e.cats[sites[i].cat] = (e.cats[sites[i].cat] || 0) + 1;
                if (op !== null) {
                    e.opMin = e.opMin === null ? op : Math.min(e.opMin, op);
                    e.opMax = e.opMax === null ? op : Math.max(e.opMax, op);
                }
            }
        }
        for (i = 0; i < list.length; i++) {
            list[i].opacity = (list[i].opMin !== null && list[i].opMin === list[i].opMax) ? SC_r2(list[i].opMin) : null;
            delete list[i].opMin; delete list[i].opMax;
        }
        list.sort(function (a, b) { return (b.count - a.count) || (a.order - b.order); });
        return SC_json({ status: "ok", layers: got.items.length, colors: list, partial: partial });
    } catch (err) {
        return SC_json({ status: "error", error: err.toString() + (err.line ? " (line " + err.line + ")" : ""), colors: [] });
    }
}

function SC_apply(oldKey, newHex, deep, targetKey) {
    oldKey = String(oldKey);
    newHex = String(newHex).toUpperCase();
    if (!SC_isHex6(newHex)) { return SC_json({ ok: false, error: "Invalid hex" }); }
    if (!SC_isDoc()) { return SC_json({ ok: false, error: "No open document" }); }

    var doc = app.activeDocument, got = SC_collectSelection(doc);
    if (!got.text && got.items.length === 0) { return SC_json({ ok: false, error: "Nothing selected" }); }

    var color = (targetKey ? SC_colorFromKey(targetKey, doc) : null) || SC_makeColor(newHex, doc);
    var nd = SC_desc(color), newKey = nd ? nd.key : "";
    if (newKey === oldKey) { return SC_json({ ok: true, changed: 0, failed: 0, id: newKey }); }

    var sites = got.ctx.sites, changed = 0, failed = 0, firstError = "", unlocked = [], i;
    try {
        for (i = 0; i < sites.length; i++) {
            SC_unlockFor(sites[i], unlocked);
            try {
                changed += SC_applySite(sites[i], oldKey, color);
            } catch (e) {
                failed++;
                if (!firstError) { firstError = e.toString(); }
            }
        }
    } finally {
        for (i = 0; i < unlocked.length; i++) { try { unlocked[i].locked = true; } catch (eR) {} }
    }
    try { app.redraw(); } catch (eD) {}
    return SC_json({ ok: true, changed: changed, failed: failed, error: firstError, id: newKey });
}

/* Sets opacity (0-100) on every distinct object behind this colour in the selection. */
function SC_setOpacity(key, opacity) {
    key = String(key);
    opacity = Math.max(0, Math.min(100, Math.round(Number(opacity))));
    if (!SC_isDoc()) { return SC_json({ ok: false, error: "No open document" }); }
    var doc = app.activeDocument, got = SC_collectSelection(doc);
    if (!got.text && got.items.length === 0) { return SC_json({ ok: false, error: "Nothing selected" }); }
    var sites = got.ctx.sites, seen = {}, changed = 0, i, j;
    for (i = 0; i < sites.length; i++) {
        var ds = SC_siteDescs(sites[i]), match = false;
        for (j = 0; j < ds.length; j++) { if (ds[j].key === key) { match = true; break; } }
        if (!match) { continue; }
        var owner = SC_siteOwner(sites[i]);
        if (!owner) { continue; }
        var ok2 = SC_ownerKey(owner);
        if (!ok2 || seen[ok2]) { continue; }
        seen[ok2] = true;
        try { owner.opacity = opacity; changed++; } catch (e) {}
    }
    try { app.redraw(); } catch (eD) {}
    return SC_json({ ok: true, changed: changed });
}

/* Narrow the selection to objects using this colour (like Figma's "select matching layers"). */
function SC_selectMatching(key, deep) {
    key = String(key);
    try {
        if (!SC_isDoc()) { return SC_json({ ok: false, error: "No open document" }); }
        var doc = app.activeDocument, sel = doc.selection;
        if (!sel || SC_tn(sel) === "TextRange") { return SC_json({ ok: true, selected: 0 }); }
        var items = [], keep = [], i, j, k;
        for (i = 0; i < sel.length; i++) { items.push(sel[i]); }
        for (i = 0; i < items.length; i++) {
            var ctx = SC_newCtx(), hit = false;
            SC_visitItem(items[i], ctx);
            for (j = 0; j < ctx.sites.length && !hit; j++) {
                var ds = SC_siteDescs(ctx.sites[j]);
                for (k = 0; k < ds.length; k++) { if (ds[k].key === key) { hit = true; break; } }
            }
            if (hit) { keep.push(items[i]); }
        }
        if (keep.length === 0) { return SC_json({ ok: true, selected: 0 }); }
        doc.selection = keep;
        return SC_json({ ok: true, selected: keep.length });
    } catch (e) {
        return SC_json({ ok: false, error: e.toString() });
    }
}

/* Every colour used in the active document (all layers), most used first. Time-boxed. */
function SC_projectColors(budgetMs) {
    try {
        if (!SC_isDoc()) { return SC_json({ ok: true, colors: [], partial: false }); }
        var t0 = new Date().getTime(), budget = (typeof budgetMs === "number" && budgetMs > 0) ? budgetMs : 600;
        var doc = app.activeDocument, ctx = SC_newCtx(), map = {}, list = [], partial = false, i;
        var stack = [];
        try { for (i = doc.layers.length - 1; i >= 0; i--) { stack.push(doc.layers[i]); } } catch (eL) {}

        walk:
        while (stack.length) {
            var layer = stack.pop(), n = 0, j;
            try { for (j = layer.layers.length - 1; j >= 0; j--) { stack.push(layer.layers[j]); } } catch (eS) {}
            try { n = layer.pageItems.length; } catch (eN) { n = 0; }
            for (j = 0; j < n; j++) {
                if (new Date().getTime() - t0 > budget) { partial = true; break walk; }
                ctx.sites = [];
                SC_visitItem(layer.pageItems[j], ctx);
                for (var s = 0; s < ctx.sites.length; s++) {
                    var ds = SC_siteDescs(ctx.sites[s]);
                    for (var q = 0; q < ds.length; q++) {
                        var e = map["k" + ds[q].key];
                        if (!e) { e = { id: ds[q].key, hex: ds[q].hex, label: ds[q].label, count: 0, order: list.length }; map["k" + ds[q].key] = e; list.push(e); }
                        e.count++;
                    }
                }
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
