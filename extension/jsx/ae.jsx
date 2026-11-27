/*  Selection Colors - After Effects host (ExtendScript, ES3). Needs common.jsx.
 *  Finds every colour used by the selected layers and replaces them in place.
 *
 *  Sources covered:
 *    - Any colour property on the layer (shape fills/strokes, effect colours,
 *      applied layer styles, text animator colours, light colour,
 *      Essential Properties overrides, ...)
 *    - Text fill/stroke in Source Text (per-character on AE 24.3+), incl. keyframes
 *    - Solid colours (solid source item - shared by every layer using that solid)
 *    - Optional: everything inside precomps (recursive)
 *
 *  Keyframed colours: every keyframe value is collected; replacing only touches
 *  keyframes whose value matches. Expression-driven properties report and change
 *  their pre-expression value.
 */

var SC_HOST = "ae";

/* ------------------------------------------------------------------ utils */

function SC_colorToHex(c) {
    if (!c || typeof c.length !== "number" || c.length < 3) { return null; }
    for (var i = 0; i < 3; i++) {
        if (typeof c[i] !== "number" || isNaN(c[i])) { return null; }
    }
    return SC_hex2(c[0]) + SC_hex2(c[1]) + SC_hex2(c[2]);
}

/* Keep the original array length (colour props are [r,g,b,a]; text/solid are [r,g,b]). */
function SC_withRgb(old, rgb) {
    var out = [rgb[0], rgb[1], rgb[2]];
    if (old && old.length > 3) {
        for (var i = 3; i < old.length; i++) { out.push(old[i]); }
    }
    return out;
}

function SC_activeComp() {
    var c = null;
    try { c = app.project.activeItem; } catch (e) { c = null; }
    return (c && c instanceof CompItem) ? c : null;
}

function SC_selectedLayers(comp) {
    var out = [], s;
    try { s = comp.selectedLayers; } catch (e) { return out; }
    if (!s) { return out; }
    for (var i = 0; i < s.length; i++) { out.push(s[i]); }
    return out;
}

/* ------------------------------------------------------------ traversal */

function SC_categoryFor(matchName, inherited) {
    if (matchName === "ADBE Vector Fill Color") { return "fill"; }
    if (matchName === "ADBE Vector Stroke Color") { return "stroke"; }
    if (matchName === "ADBE Text Fill Color" || matchName === "ADBE Text Stroke Color") { return "text"; }
    if (matchName === "ADBE Light Color") { return "light"; }
    return inherited;
}

function SC_isEnabled(p) {
    try { return p.enabled === true; } catch (e) { return false; }
}

function SC_walkGroup(group, layer, ctx, cat, insideStyles) {
    var n = 0;
    try { n = group.numProperties; } catch (e) { return; }
    for (var i = 1; i <= n; i++) {
        var p = null, mn = "", pt;
        try { p = group.property(i); } catch (e1) { p = null; }
        if (!p) { continue; }
        try { mn = p.matchName; } catch (e2) { mn = ""; }
        try { pt = p.propertyType; } catch (e3) { continue; }

        if (pt === PropertyType.PROPERTY) {
            var vt;
            try { vt = p.propertyValueType; } catch (e4) { continue; }
            if (vt === PropertyValueType.COLOR) {
                ctx.sites.push({ t: "prop", p: p, layer: layer, cat: SC_categoryFor(mn, cat) });
            } else if (vt === PropertyValueType.TEXT_DOCUMENT) {
                ctx.sites.push({ t: "text", p: p, layer: layer, cat: "text" });
            }
        } else {
            var c = cat, styles = insideStyles;
            if (mn === "ADBE Effect Parade") { c = "effect"; }
            else if (mn === "ADBE Layer Styles") {
                // Layer styles exist on every layer; only walk the ones actually applied.
                if (!SC_isEnabled(p)) { continue; }
                c = "style";
                SC_walkStyles(p, layer, ctx);
                continue;
            }
            SC_walkGroup(p, layer, ctx, c, styles);
        }
    }
}

function SC_walkStyles(stylesGroup, layer, ctx) {
    var n = 0;
    try { n = stylesGroup.numProperties; } catch (e) { return; }
    for (var i = 1; i <= n; i++) {
        var s = null;
        try { s = stylesGroup.property(i); } catch (e1) { s = null; }
        if (!s) { continue; }
        var pt;
        try { pt = s.propertyType; } catch (e2) { continue; }
        if (pt === PropertyType.PROPERTY) { continue; }
        if (!SC_isEnabled(s)) { continue; }
        SC_walkGroup(s, layer, ctx, "style", true);
    }
}

function SC_isSolidItem(item) {
    try {
        return (item instanceof FootageItem) && item.mainSource && (item.mainSource instanceof SolidSource);
    } catch (e) { return false; }
}

function SC_visitLayer(layer, ctx) {
    SC_walkGroup(layer, layer, ctx, "other", false);

    var src = null;
    try { src = layer.source; } catch (e) { src = null; }
    if (!src) { return; }

    if (SC_isSolidItem(src)) {
        var isNull = false, isAdj = false;
        try { isNull = layer.nullLayer === true; } catch (e1) {}
        try { isAdj = layer.adjustmentLayer === true; } catch (e2) {}
        if (!isNull && !isAdj && !ctx.solids["s" + src.id]) {
            ctx.solids["s" + src.id] = true;
            ctx.sites.push({ t: "solid", item: src, layer: layer, cat: "solid" });
        }
    } else if (ctx.deep && (src instanceof CompItem)) {
        if (ctx.comps["c" + src.id]) { return; }
        ctx.comps["c" + src.id] = true;
        var nl = 0;
        try { nl = src.numLayers; } catch (e3) { nl = 0; }
        for (var i = 1; i <= nl; i++) {
            var l = null;
            try { l = src.layer(i); } catch (e4) { l = null; }
            if (l) { SC_visitLayer(l, ctx); }
        }
    }
}

function SC_newCtx(deep) {
    return { deep: !!deep, sites: [], solids: {}, comps: {} };
}

function SC_collect(layers, deep) {
    var ctx = SC_newCtx(deep);
    for (var i = 0; i < layers.length; i++) { SC_visitLayer(layers[i], ctx); }
    return ctx.sites;
}

/* ------------------------------------------------------- reading values */

function SC_rangeColor(r, which) {
    // which: "fill" | "stroke". Returns hex, null (not applied), or SC_MIXED.
    var applied, col;
    try { applied = (which === "fill") ? r.applyFill : r.applyStroke; } catch (e) { return SC_MIXED; }
    if (applied === false) { return null; }
    if (applied !== true) { return SC_MIXED; }
    if (which === "stroke") {
        var w;
        try { w = r.strokeWidth; } catch (e1) { w = undefined; }
        if (typeof w === "number" && w <= 0) { return null; }
    }
    try { col = (which === "fill") ? r.fillColor : r.strokeColor; } catch (e2) { return SC_MIXED; }
    if (col === undefined || col === null) { return SC_MIXED; }
    return SC_colorToHex(col);
}

function SC_safeRange(doc, a, b) {
    var r = null;
    try { r = doc.characterRange(a, b); } catch (e) { return null; }
    if (!r) { return null; }
    try { if (r.isRangeValid === false) { return null; } } catch (e1) { return null; }
    return r;
}

/* Split a TextDocument into runs of identical fill/stroke.
   Each run: { start, end, fill: hex|null, stroke: hex|null, legacy: bool } */
function SC_textRuns(doc) {
    var txt = "";
    try { txt = String(doc.text); } catch (e) { txt = ""; }
    var len = txt.length, runs = [];
    if (len === 0) { return runs; }

    var hasRanges = false;
    try { hasRanges = (typeof doc.characterRange === "function"); } catch (e0) { hasRanges = false; }

    if (hasRanges) {
        var whole = SC_safeRange(doc, 0, len);
        if (whole) {
            var wf = SC_rangeColor(whole, "fill"), ws = SC_rangeColor(whole, "stroke");
            if (wf !== SC_MIXED && ws !== SC_MIXED) {
                runs.push({ start: 0, end: len, fill: wf, stroke: ws, legacy: false });
                return runs;
            }
        }
        // Mixed styling: go per character and merge identical neighbours.
        var cur = null;
        for (var i = 0; i < len; i++) {
            var r = SC_safeRange(doc, i, i + 1);
            if (!r) { cur = null; continue; }
            var f = SC_rangeColor(r, "fill"), s = SC_rangeColor(r, "stroke");
            if (f === SC_MIXED) { f = null; }
            if (s === SC_MIXED) { s = null; }
            if (cur && cur.fill === f && cur.stroke === s && cur.end === i) {
                cur.end = i + 1;
            } else {
                cur = { start: i, end: i + 1, fill: f, stroke: s, legacy: false };
                runs.push(cur);
            }
        }
        return runs;
    }

    // Pre-24.3: whole-document colour only. Reading fillColor throws when applyFill is off.
    var lf = null, ls = null;
    try { if (doc.applyFill) { lf = SC_colorToHex(doc.fillColor); } } catch (e2) { lf = null; }
    try {
        if (doc.applyStroke) {
            var sw = doc.strokeWidth;
            if (!(typeof sw === "number" && sw <= 0)) { ls = SC_colorToHex(doc.strokeColor); }
        }
    } catch (e3) { ls = null; }
    runs.push({ start: 0, end: len, fill: lf, stroke: ls, legacy: true });
    return runs;
}

function SC_docHexes(doc, out) {
    var runs = SC_textRuns(doc);
    for (var i = 0; i < runs.length; i++) {
        SC_pushUnique(out, runs[i].fill);
        SC_pushUnique(out, runs[i].stroke);
    }
}

function SC_numKeys(p) {
    try { return p.numKeys || 0; } catch (e) { return 0; }
}

/* All distinct hex values a site currently holds. */
function SC_siteHexes(site) {
    var out = [], k, n;
    try {
        if (site.t === "solid") {
            SC_pushUnique(out, SC_colorToHex(site.item.mainSource.color));
        } else if (site.t === "prop") {
            n = SC_numKeys(site.p);
            if (n > 0) {
                for (k = 1; k <= n; k++) { SC_pushUnique(out, SC_colorToHex(site.p.keyValue(k))); }
            } else {
                SC_pushUnique(out, SC_colorToHex(site.p.valueAtTime(0, true)));
            }
        } else if (site.t === "text") {
            n = SC_numKeys(site.p);
            if (n > 0) {
                for (k = 1; k <= n; k++) { SC_docHexes(site.p.keyValue(k), out); }
            } else {
                SC_docHexes(site.p.valueAtTime(0, true), out);
            }
        }
    } catch (e) { /* unreadable property: ignore */ }
    return out;
}

/* ------------------------------------------------------- writing values */

/* Mutates doc in place. Returns true if anything changed. */
function SC_recolorDoc(doc, oldHex, rgb) {
    var runs = SC_textRuns(doc), changed = false, i, r;
    for (i = 0; i < runs.length; i++) {
        var run = runs[i];
        if (run.legacy) {
            if (run.fill === oldHex) { doc.fillColor = SC_withRgb(doc.fillColor, rgb); changed = true; }
            if (run.stroke === oldHex) { doc.strokeColor = SC_withRgb(doc.strokeColor, rgb); changed = true; }
            continue;
        }
        if (run.fill === oldHex) {
            r = SC_safeRange(doc, run.start, run.end);
            if (r) { r.fillColor = [rgb[0], rgb[1], rgb[2]]; changed = true; }
        }
        if (run.stroke === oldHex) {
            r = SC_safeRange(doc, run.start, run.end);
            if (r) { r.strokeColor = [rgb[0], rgb[1], rgb[2]]; changed = true; }
        }
    }
    return changed;
}

/* Returns number of values changed. Throws on failure. */
function SC_applySite(site, oldHex, rgb) {
    var changed = 0, k, n, v;
    if (site.t === "solid") {
        v = site.item.mainSource.color;
        if (SC_colorToHex(v) === oldHex) { site.item.mainSource.color = SC_withRgb(v, rgb); changed++; }
    } else if (site.t === "prop") {
        n = SC_numKeys(site.p);
        if (n > 0) {
            for (k = 1; k <= n; k++) {
                v = site.p.keyValue(k);
                if (SC_colorToHex(v) === oldHex) { site.p.setValueAtKey(k, SC_withRgb(v, rgb)); changed++; }
            }
        } else {
            v = site.p.valueAtTime(0, true);
            if (SC_colorToHex(v) === oldHex) { site.p.setValue(SC_withRgb(v, rgb)); changed++; }
        }
    } else if (site.t === "text") {
        n = SC_numKeys(site.p);
        if (n > 0) {
            for (k = 1; k <= n; k++) {
                v = site.p.keyValue(k);
                if (SC_recolorDoc(v, oldHex, rgb)) { site.p.setValueAtKey(k, v); changed++; }
            }
        } else {
            v = site.p.valueAtTime(0, true);
            if (SC_recolorDoc(v, oldHex, rgb)) { site.p.setValue(v); changed++; }
        }
    }
    return changed;
}

/* ------------------------------------------------------------ public API */

function SC_fingerprint() {
    try {
        var comp = SC_activeComp();
        if (!comp) { return "nocomp"; }
        var sel = SC_selectedLayers(comp), parts = [comp.id, comp.time];
        for (var i = 0; i < sel.length; i++) { parts.push(sel[i].index + ":" + sel[i].name); }
        return parts.join("|");
    } catch (e) { return "err:" + e.toString(); }
}

function SC_scan(deep) {
    try {
        var comp = SC_activeComp();
        if (!comp) { return SC_json({ status: "nocomp", colors: [] }); }
        var layers = SC_selectedLayers(comp);
        if (layers.length === 0) { return SC_json({ status: "nosel", colors: [] }); }

        var sites = SC_collect(layers, deep), map = {}, list = [], i, j;
        for (i = 0; i < sites.length; i++) {
            var hexes = SC_siteHexes(sites[i]);
            for (j = 0; j < hexes.length; j++) {
                var h = hexes[j], e = map["h" + h];
                if (!e) {
                    e = { id: h, hex: h, label: "#" + h, count: 0, order: list.length, cats: {} };
                    map["h" + h] = e;
                    list.push(e);
                }
                e.count++;
                e.cats[sites[i].cat] = (e.cats[sites[i].cat] || 0) + 1;
            }
        }
        list.sort(function (a, b) { return (b.count - a.count) || (a.order - b.order); });
        return SC_json({ status: "ok", layers: layers.length, colors: list });
    } catch (err) {
        return SC_json({ status: "error", error: err.toString() + (err.line ? " (line " + err.line + ")" : ""), colors: [] });
    }
}

function SC_apply(oldHex, newHex, deep) {
    oldHex = String(oldHex).toUpperCase();
    newHex = String(newHex).toUpperCase();
    if (!SC_isHex6(oldHex) || !SC_isHex6(newHex)) { return SC_json({ ok: false, error: "Invalid hex" }); }
    if (oldHex === newHex) { return SC_json({ ok: true, changed: 0, failed: 0, id: newHex }); }

    var comp = SC_activeComp();
    if (!comp) { return SC_json({ ok: false, error: "No active composition" }); }
    var layers = SC_selectedLayers(comp);
    if (layers.length === 0) { return SC_json({ ok: false, error: "No layers selected" }); }

    var rgb = SC_hexToRgb(newHex), changed = 0, failed = 0, firstError = "", unlocked = [], i;

    app.beginUndoGroup("Selection Colors: #" + oldHex + " \u2192 #" + newHex);
    try {
        var sites = SC_collect(layers, deep);
        for (i = 0; i < sites.length; i++) {
            var site = sites[i];
            // Locked layers refuse edits; unlock for the duration, relock after.
            if (site.t !== "solid") {
                try {
                    if (site.layer.locked && !SC_contains(unlocked, site.layer)) {
                        site.layer.locked = false;
                        unlocked.push(site.layer);
                    }
                } catch (eL) {}
            }
            try {
                changed += SC_applySite(site, oldHex, rgb);
            } catch (e) {
                failed++;
                if (!firstError) { firstError = e.toString(); }
            }
        }
    } finally {
        for (i = 0; i < unlocked.length; i++) {
            try { unlocked[i].locked = true; } catch (eR) {}
        }
        app.endUndoGroup();
    }
    return SC_json({ ok: true, changed: changed, failed: failed, error: firstError, id: newHex });
}

/* Narrow the layer selection to layers that use hex (like Figma's "select matching layers"). */
function SC_selectMatching(hex, deep) {
    hex = String(hex).toUpperCase();
    try {
        var comp = SC_activeComp();
        if (!comp) { return SC_json({ ok: false, error: "No active composition" }); }
        var layers = SC_selectedLayers(comp), keep = [], i, j;
        for (i = 0; i < layers.length; i++) {
            var sites = SC_collect([layers[i]], deep), hit = false;
            for (j = 0; j < sites.length && !hit; j++) {
                if (SC_contains(SC_siteHexes(sites[j]), hex)) { hit = true; }
            }
            if (hit) { keep.push(layers[i]); }
        }
        if (keep.length === 0) { return SC_json({ ok: true, selected: 0 }); }
        for (i = 0; i < layers.length; i++) {
            if (!SC_contains(keep, layers[i])) { layers[i].selected = false; }
        }
        return SC_json({ ok: true, selected: keep.length });
    } catch (e) {
        return SC_json({ ok: false, error: e.toString() });
    }
}

/* Every colour used anywhere in the project (all comps), most used first.
   Stops after budgetMs so huge projects never freeze AE; partial=true then. */
function SC_projectColors(budgetMs) {
    try {
        var t0 = new Date().getTime(), budget = (typeof budgetMs === "number" && budgetMs > 0) ? budgetMs : 600;
        var ctx = SC_newCtx(false), map = {}, list = [], partial = false, i, j, k, n;
        try { n = app.project.numItems; } catch (e0) { n = 0; }
        outer:
        for (i = 1; i <= n; i++) {
            var it = null;
            try { it = app.project.item(i); } catch (e1) { it = null; }
            if (!it || !(it instanceof CompItem)) { continue; }
            var nl = 0;
            try { nl = it.numLayers; } catch (e2) { nl = 0; }
            for (j = 1; j <= nl; j++) {
                if (new Date().getTime() - t0 > budget) { partial = true; break outer; }
                ctx.sites = [];
                var l = null;
                try { l = it.layer(j); } catch (e3) { l = null; }
                if (!l) { continue; }
                SC_visitLayer(l, ctx);
                for (k = 0; k < ctx.sites.length; k++) {
                    var hexes = SC_siteHexes(ctx.sites[k]);
                    for (var h = 0; h < hexes.length; h++) {
                        var e = map["h" + hexes[h]];
                        if (!e) { e = { hex: hexes[h], count: 0, order: list.length }; map["h" + hexes[h]] = e; list.push(e); }
                        e.count++;
                    }
                }
            }
        }
        list.sort(function (a, b) { return (b.count - a.count) || (a.order - b.order); });
        var out = [];
        for (i = 0; i < list.length; i++) { out.push({ id: list[i].hex, hex: list[i].hex, label: "#" + list[i].hex }); }
        return SC_json({ ok: true, colors: out, partial: partial });
    } catch (err) {
        return SC_json({ ok: false, colors: [], error: err.toString() });
    }
}

