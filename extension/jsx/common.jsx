/*  Selection Colors - shared ExtendScript helpers (ES3). Loaded before ae.jsx / ai.jsx. */

var SC_MIXED = { mixed: true };

function SC_clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

function SC_hex2(n) {
    var s = Math.round(SC_clamp01(n) * 255).toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
}

function SC_isHex6(h) { return typeof h === "string" && /^[0-9A-F]{6}$/.test(h); }

function SC_hexToRgb(h) {
    return [parseInt(h.substr(0, 2), 16) / 255,
            parseInt(h.substr(2, 2), 16) / 255,
            parseInt(h.substr(4, 2), 16) / 255];
}

function SC_quote(s) {
    s = String(s);
    var out = "\"";
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i), code = s.charCodeAt(i);
        if (ch === "\"") { out += "\\\""; }
        else if (ch === "\\") { out += "\\\\"; }
        else if (ch === "\n") { out += "\\n"; }
        else if (ch === "\r") { out += "\\r"; }
        else if (ch === "\t") { out += "\\t"; }
        else if (code < 32 || code === 0x2028 || code === 0x2029) {
            var h = code.toString(16);
            while (h.length < 4) { h = "0" + h; }
            out += "\\u" + h;
        } else { out += ch; }
    }
    return out + "\"";
}

function SC_json(v) {
    if (v === null || v === undefined) { return "null"; }
    var t = typeof v;
    if (t === "number") { return isFinite(v) ? String(v) : "null"; }
    if (t === "boolean") { return v ? "true" : "false"; }
    if (t === "string") { return SC_quote(v); }
    var parts = [], i;
    if (Object.prototype.toString.call(v) === "[object Array]") {
        for (i = 0; i < v.length; i++) { parts.push(SC_json(v[i])); }
        return "[" + parts.join(",") + "]";
    }
    for (var k in v) {
        if (v.hasOwnProperty(k)) { parts.push(SC_quote(k) + ":" + SC_json(v[k])); }
    }
    return "{" + parts.join(",") + "}";
}

function SC_contains(arr, x) {
    for (var i = 0; i < arr.length; i++) { if (arr[i] === x) { return true; } }
    return false;
}

function SC_pushUnique(arr, x) {
    if (x !== null && x !== undefined && !SC_contains(arr, x)) { arr.push(x); }
}

/* Opens the OS colour picker. Returns hex or "" if cancelled. */
function SC_pickColor(hex) {
    try {
        var start = SC_isHex6(String(hex).toUpperCase()) ? parseInt(hex, 16) : 0xFFFFFF;
        var r = $.colorPicker(start);
        if (typeof r !== "number" || r < 0) { return ""; }
        var s = r.toString(16).toUpperCase();
        while (s.length < 6) { s = "0" + s; }
        return s;
    } catch (e) { return ""; }
}

function SC_ping() { return "pong"; }
