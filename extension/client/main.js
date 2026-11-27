/* Selection Colors — panel logic (CEP). No external libraries. */
(function () {
  "use strict";

  var cep = window.__adobe_cep__ || null;
  var POLL_MS = 400;

  var els = {
    section: document.getElementById("section"),
    toggle: document.getElementById("toggle"),
    deep: document.getElementById("deep"),
    refresh: document.getElementById("refresh"),
    list: document.getElementById("list"),
    empty: document.getElementById("empty"),
    toast: document.getElementById("toast")
  };

  var HOST = (function () {
    try {
      var n = JSON.parse(cep.getHostEnvironment()).appName;
      return n === "ILST" ? "ai" : (n === "IDSN" ? "id" : "ae");
    } catch (e) { return "ae"; }
  })();
  var TEXT = HOST === "ai" ? {
    empty: "Select objects", nodoc: "Open a document", project: "In document"
  } : HOST === "id" ? {
    empty: "Select frames or text", nodoc: "Open a document", project: "In document"
  } : {
    empty: "Select layers in a composition", nodoc: "Select layers in a composition", project: "In project"
  };
  document.documentElement.setAttribute("data-host", HOST);

  var state = {
    colors: [],
    status: "init",
    deep: readPref("deep", false),
    collapsed: readPref("collapsed", false),
    lastFp: null,
    busy: false,        // an apply / pick is in flight
    scanning: false,
    pendingRender: false,
    rescanQueued: false,
    renderedSig: null,
    ready: false
  };

  /* ---------------------------------------------------------- helpers */

  function readPref(key, fallback) {
    try {
      var v = window.localStorage.getItem("sc." + key);
      return v === null ? fallback : v === "1";
    } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { window.localStorage.setItem("sc." + key, val ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function evalJSX(script) {
    return new Promise(function (resolve) {
      if (!cep) { resolve(null); return; }
      try { cep.evalScript(script, function (res) { resolve(res); }); }
      catch (e) { resolve(null); }
    });
  }

  function parse(res) {
    if (typeof res !== "string" || !res || res === "EvalScript error.") { return null; }
    try { return JSON.parse(res); } catch (e) { return null; }
  }

  function call(fn, args) {
    var a = (args || []).map(function (x) { return JSON.stringify(x); }).join(",");
    return evalJSX(
      "(function(){try{return " + fn + "(" + a + ");}catch(e){return 'SCERR " + fn + ": ' + e + (e.line ? ' (line ' + e.line + ')' : '');}})()"
    );
  }

  /* Human-readable reason for a failed host call. */
  function describeFailure(res) {
    if (res === null || res === undefined) { return "No answer from the host app."; }
    res = String(res);
    if (res.indexOf("SCERR ") === 0) { return res.slice(6); }
    if (res === "EvalScript error.") { return "The host app reported a script error."; }
    return "Unexpected answer: " + res.slice(0, 200);
  }

  var toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2600);
  }

  /* Figma-style hex parsing: "f" → FFFFFF, "1a" → 1A1A1A, "f0a" → FF00AA, "#AABBCC", "AABBCCFF". */
  function parseHex(input) {
    var s = String(input || "").replace(/[\s#]/g, "").toUpperCase();
    if (!/^[0-9A-F]+$/.test(s)) { return null; }
    if (s.length === 1) { return s + s + s + s + s + s; }
    if (s.length === 2) { return s + s + s; }
    if (s.length === 3) { return s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; }
    if (s.length === 6) { return s; }
    if (s.length === 8) { return s.slice(0, 6); }
    return null;
  }

  var CAT_LABEL = {
    fill: ["fill", "fills"], stroke: ["stroke", "strokes"], text: ["text", "text"],
    effect: ["effect", "effects"], style: ["layer style", "layer styles"],
    solid: ["solid", "solids"], light: ["light", "lights"], gradient: ["gradient stop", "gradient stops"],
    other: ["property", "properties"]
  };
  function describeCats(cats) {
    var out = [];
    Object.keys(cats || {}).forEach(function (k) {
      var n = cats[k], l = CAT_LABEL[k] || [k, k];
      out.push(n + " " + (n === 1 ? l[0] : l[1]));
    });
    return out.join(" · ");
  }

  /* ----------------------------------------------------------- theme */

  function applyTheme() {
    if (!cep) { return; }
    try {
      var env = JSON.parse(cep.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
      var root = document.documentElement;
      var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      root.classList.toggle("light", lum > 0.5);
      root.style.setProperty("--bg", "rgb(" + r + "," + g + "," + b + ")");
      var d = lum > 0.5 ? -10 : 9, h = lum > 0.5 ? -18 : 16;
      root.style.setProperty("--row", "rgb(" + clamp(r + d) + "," + clamp(g + d) + "," + clamp(b + d) + ")");
      root.style.setProperty("--row-hover", "rgb(" + clamp(r + h) + "," + clamp(g + h) + "," + clamp(b + h) + ")");
    } catch (e) { /* keep CSS defaults */ }
  }
  function clamp(v) { return Math.max(0, Math.min(255, v)); }

  /* ---------------------------------------------------------- render */

  var ICON_TARGET =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor"/>' +
    '<path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke="currentColor" stroke-linecap="round"/></svg>';

  function editingInList() {
    var a = document.activeElement;
    return !!(a && a.classList && (a.classList.contains("hex") || a.classList.contains("opacity")) && els.list.contains(a));
  }

  function render() {
    if (editingInList()) { state.pendingRender = true; return; }
    state.pendingRender = false;

    els.section.classList.toggle("collapsed", state.collapsed);
    els.toggle.setAttribute("aria-expanded", String(!state.collapsed));
    els.deep.setAttribute("aria-pressed", String(state.deep));

    var sig = JSON.stringify([state.status, state.error || "", state.colors]);
    if (sig === state.renderedSig) {
      if (window.SCPicker) { window.SCPicker.reanchor(findRow); }
      return;
    }
    state.renderedSig = sig;

    els.list.textContent = "";
    els.empty.classList.remove("error");

    if (state.status === "ok" && state.colors.length) {
      els.empty.style.display = "none";
      state.colors.forEach(function (c) { els.list.appendChild(buildRow(c)); });
      if (window.SCPicker) { window.SCPicker.reanchor(findRow); }
      return;
    }
    if (window.SCPicker) { window.SCPicker.reanchor(findRow); }

    els.empty.style.display = "";
    if (state.status === "nodoc") {
      els.empty.textContent = TEXT.nodoc;
    } else if (state.status === "nocomp" || state.status === "nosel" || state.status === "init") {
      els.empty.textContent = TEXT.empty;
    } else if (state.status === "ok") {
      els.empty.textContent = "No colours in selection";
    } else if (state.status === "nohost") {
      els.empty.textContent = "Open this panel inside After Effects, Illustrator or InDesign (Window → Extensions).";
    } else {
      els.empty.classList.add("error");
      els.empty.textContent = state.error || "Something went wrong reading the selection.";
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", function () { boot(); });
      els.empty.appendChild(document.createElement("br"));
      els.empty.appendChild(retry);
    }
  }

  function buildRow(c) {
    var row = document.createElement("div");
    row.className = "row";
    row.setAttribute("role", "listitem");
    row.dataset.hex = c.hex;
    row.dataset.id = c.id || c.hex;

    var main = document.createElement("div");
    main.className = "cell main";

    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch";
    sw.style.background = "#" + c.hex;
    sw.title = (c.label && c.label !== "#" + c.hex) ? c.label + " \u2014 click to edit" : "Edit colour";
    sw.setAttribute("aria-haspopup", "dialog");
    sw.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) { return; }
      e.preventDefault();
      togglePicker(row, c);
    });
    sw.addEventListener("click", function (e) {
      if (e.detail === 0) { togglePicker(row, c); }   // keyboard (Enter/Space)
    });

    var op = document.createElement("input");
    op.className = "opacity";
    op.type = "text";
    op.inputMode = "numeric";
    op.maxLength = 3;
    op.placeholder = "–";
    op.value = (typeof c.opacity === "number") ? String(Math.round(c.opacity)) : "";
    op.setAttribute("aria-label", "Opacity percent");
    wireOpacityInput(op, c.opacity, c.id || c.hex);

    var input = document.createElement("input");
    input.className = "hex";
    input.type = "text";
    input.value = c.hex;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.maxLength = 9;
    input.setAttribute("aria-label", "Hex colour " + c.hex);
    wireHexInput(input, c.hex, c.id || c.hex);

    main.appendChild(sw);
    main.appendChild(op);
    main.appendChild(input);

    var count = document.createElement("div");
    count.className = "cell count";
    count.title = describeCats(c.cats);
    count.innerHTML = '<span class="num"></span><span class="unit">×</span>';
    count.firstChild.textContent = String(c.count);

    var match = document.createElement("button");
    match.type = "button";
    match.className = "match";
    match.title = "Select matching layers";
    match.innerHTML = ICON_TARGET;
    match.addEventListener("click", function () { selectMatching(c.id || c.hex); });

    row.appendChild(main);
    row.appendChild(count);
    row.appendChild(match);
    return row;
  }

  function wireHexInput(input, original, id) {
    var done = false;

    input.addEventListener("focus", function () {
      done = false;
      setTimeout(function () {
        if (document.activeElement === input && !done) { try { input.select(); } catch (e) {} }
      }, 0);
    });

    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        done = true;
        input.value = original;
        input.blur();
      }
    });

    input.addEventListener("blur", function () {
      if (!done) { commit(); }
      if (state.pendingRender) { setTimeout(render, 0); }
    });

    function commit() {
      if (done) { return; }
      done = true;
      var raw = String(input.value).trim();
      var next = parseHex(raw);
      if (!next) {
        input.value = original;
        input.blur();
        if (raw !== "" && raw.toUpperCase() !== original) { toast("Not a valid hex colour"); }
        return;
      }
      input.value = next;
      input.blur();
      if (next !== original) { applyColor(id, next); }
    }
  }

  function wireOpacityInput(input, original, id) {
    var done = false;

    input.addEventListener("focus", function () {
      done = false;
      setTimeout(function () {
        if (document.activeElement === input && !done) { try { input.select(); } catch (e) {} }
      }, 0);
    });

    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") {
        e.preventDefault();
        done = true;
        input.value = (typeof original === "number") ? String(Math.round(original)) : "";
        input.blur();
      }
    });

    input.addEventListener("blur", function () {
      if (!done) { commit(); }
      if (state.pendingRender) { setTimeout(render, 0); }
    });

    function commit() {
      if (done) { return; }
      done = true;
      var raw = String(input.value).trim();
      if (raw === "") { input.blur(); return; }
      var n = parseInt(raw, 10);
      if (isNaN(n)) {
        input.value = (typeof original === "number") ? String(Math.round(original)) : "";
        input.blur();
        toast("Not a valid opacity");
        return;
      }
      n = Math.max(0, Math.min(100, n));
      input.value = String(n);
      input.blur();
      if (n !== original) { applyOpacity(id, n); }
    }
  }

  /* ---------------------------------------------------------- actions */

  function setBusy(b) {
    state.busy = b;
    document.body.classList.toggle("busy", b);
  }

  /* All AE-mutating actions run one at a time, in order. */
  var chain = Promise.resolve();
  function enqueue(fn) {
    var p = chain.then(fn, fn);
    chain = p.then(function () {}, function () {});
    return p;
  }

  function applyColor(oldId, newHex, targetId) {
    return enqueue(function () {
      setBusy(true);
      return call("SC_apply", [oldId, newHex, state.deep, targetId || ""]).then(function (res) {
        var r = parse(res), ok = !!(r && r.ok);
        if (!r) { toast(describeFailure(res)); }
        else if (!r.ok) { toast(r.error || "Could not change colour"); }
        else if (r.failed > 0) {
          toast(r.failed + " propert" + (r.failed === 1 ? "y" : "ies") + " could not be changed" +
            (r.error ? " — " + r.error : ""));
        }
        setBusy(false);
        if (ok && r.changed > 0) { projectCache = null; }
        var result = { ok: ok, id: (r && r.id) || newHex };
        return scan(true).then(function () { return result; });
      }, function () { setBusy(false); return { ok: false }; });
    });
  }

  function applyOpacity(id, opacity) {
    return enqueue(function () {
      setBusy(true);
      return call("SC_setOpacity", [id, opacity]).then(function (res) {
        var r = parse(res), ok = !!(r && r.ok);
        if (!r) { toast(describeFailure(res)); } else if (!r.ok) { toast(r.error || "Could not change opacity"); }
        setBusy(false);
        return scan(true).then(function () { return { ok: ok }; });
      }, function () { setBusy(false); return { ok: false }; });
    });
  }

  /* ---------------------------------------------------------- picker */

  function findRow(id, hex) {
    var rows = els.list.querySelectorAll(".row"), i;
    for (i = 0; i < rows.length; i++) { if (rows[i].dataset.id === id) { return rows[i]; } }
    if (hex) {
      for (i = 0; i < rows.length; i++) { if (rows[i].dataset.hex === hex) { return rows[i]; } }
    }
    return null;
  }

  function togglePicker(row, c) {
    var P = window.SCPicker, id = c.id || c.hex;
    if (!P) { return; }
    if (P.isOpen() && P.current() === id) { P.close(); return; }
    P.open(row, { id: id, hex: c.hex, opacity: c.opacity }, {
      onCommit: applyColor,
      onOpacityCommit: applyOpacity,
      findRow: findRow,
      projectLabel: TEXT.project,
      onPreview: function (appliedId, previewHex) {
        var r = findRow(appliedId);
        if (!r) { return; }
        r.classList.add("editing");
        r.querySelector(".swatch").style.background = "#" + previewHex;
        var inp = r.querySelector(".hex");
        if (document.activeElement !== inp) { inp.value = previewHex; }
      },
      getSwatches: function () {
        return state.colors.map(function (c) { return { id: c.id || c.hex, hex: c.hex, label: c.label }; });
      },
      getProjectSwatches: getProjectSwatches,
      cachedProject: function () { return projectCache; },
      eyedropper: nativeEyedropperAvailable() ? startNativeEyedropper : null,
      onClose: function () {
        state.renderedSig = null;   // drop live-preview styling
        render();
        scan(true);
      }
    });
  }

  var projectCache = null;
  function getProjectSwatches() {
    return enqueue(function () {
      return call("SC_projectColors", [700]).then(function (res) {
        var r = parse(res);
        projectCache = (r && r.ok) ? { colors: r.colors || [], partial: !!r.partial } : { colors: [], partial: false };
        return projectCache;
      });
    });
  }

  /* ---------------------------------------------- native eyedropper (Windows) */

  function nodeRequire() {
    try { if (window.cep_node && typeof window.cep_node.require === "function") { return window.cep_node.require; } } catch (e) {}
    try { if (typeof window.require === "function") { return window.require; } } catch (e2) {}
    return null;
  }
  function nodeProcess() {
    try { return (window.cep_node && window.cep_node.process) || window.process || null; } catch (e) { return null; }
  }
  function platform() {
    var p = nodeProcess();
    if (p && p.platform) { return p.platform; }
    return /^Win/.test(navigator.platform) ? "win32" : (/^Mac/.test(navigator.platform) ? "darwin" : "");
  }
  function nativeEyedropperAvailable() {
    if (!cep || !nodeRequire()) { return false; }
    var pf = platform();
    return pf === "win32" || pf === "darwin";
  }

  /* Spawns the native eyedropper (Windows: eyedropper.ps1, macOS: eyedropper_mac.js).
     Returns { promise -> hex|null, cancel() }. */
  function startNativeEyedropper(cb) {
    var job = {}, child = null, done = false, mac = platform() === "darwin";
    job.promise = new Promise(function (resolve, reject) {
      function finish(fn, v) { if (!done) { done = true; fn(v); } }
      var buf = "", stderr = "";
      try {
        var cp = nodeRequire()("child_process");
        if (mac) {
          child = cp.spawn("/usr/bin/osascript", ["-l", "JavaScript", extensionPath() + "/native/eyedropper_mac.js"]);
        } else {
          var env = (nodeProcess() || {}).env || {};
          var root = env.SystemRoot || env.windir || "C:\\Windows";
          var exe = root + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
          var script = extensionPath().replace(/\//g, "\\") + "\\native\\eyedropper.ps1";
          child = cp.spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", script],
            { windowsHide: true });
        }
      } catch (e) { finish(reject, e); return; }
      // The macOS sampler shows instantly (no "R" line from osascript).
      if (mac && cb && cb.onReady) { setTimeout(cb.onReady, 0); }

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", function (d) {
        buf += d;
        var lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (line === "R") { if (cb && cb.onReady) { cb.onReady(); } }
          else if (line.indexOf("M ") === 0) { if (cb && cb.onMove) { cb.onMove(line.slice(2)); } }
          else if (line.indexOf("P ") === 0) { finish(resolve, line.slice(2)); }
          else if (line === "C") { finish(resolve, null); }
          else if (line.indexOf("E ") === 0) { finish(reject, new Error(line.slice(2))); }
        });
      });
      child.stderr.on("data", function (d) { stderr += d; });
      child.on("error", function (e) { finish(reject, e); });
      child.on("close", function (code) {
        if (code === 0 || code === null) { finish(resolve, null); }
        else { finish(reject, new Error((stderr || "").trim().split(/\r?\n/)[0] || ("PowerShell exited with code " + code))); }
      });
    });
    job.cancel = function () {
      if (done || !child) { return; }
      // macOS: never kill the helper while the system loupe is up (it can get stuck);
      // the panel just ignores its answer. Windows: closing the overlay is safe.
      if (mac) { done = true; return; }
      try { child.kill(); } catch (e) {}
    };
    return job;
  }

  /* ---------------------------------------------- self-update */

  var UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/losarne/selectionColors/main/latest.json";

  function nodeBuffer() {
    try { return nodeRequire()("buffer").Buffer; } catch (e) { return null; }
  }

  function compareVersions(a, b) {
    var pa = String(a || "0").split("."), pb = String(b || "0").split(".");
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x !== y) { return x > y ? 1 : -1; }
    }
    return 0;
  }

  function currentVersion() {
    try {
      var fs = nodeRequire()("fs");
      var xml = fs.readFileSync(extensionPath() + "/CSXS/manifest.xml", "utf8");
      var m = /ExtensionBundleVersion="([^"]+)"/.exec(xml);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  /* GET a URL as a string, following redirects. */
  function httpsGetText(url, redirectsLeft, cb) {
    var https = nodeRequire()("https");
    var req = https.get(url, { headers: { "User-Agent": "SelectionColors" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpsGetText(res.headers.location, redirectsLeft - 1, cb);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); cb(new Error("HTTP " + res.statusCode)); return; }
      var buf = "";
      res.setEncoding("utf8");
      res.on("data", function (d) { buf += d; });
      res.on("end", function () { cb(null, buf); });
    });
    req.on("error", cb);
    req.setTimeout(8000, function () { req.destroy(new Error("Timed out")); });
  }

  /* GET a URL as a Buffer, following redirects. */
  function httpsGetBuffer(url, redirectsLeft, cb) {
    var https = nodeRequire()("https");
    var req = https.get(url, { headers: { "User-Agent": "SelectionColors" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpsGetBuffer(res.headers.location, redirectsLeft - 1, cb);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); cb(new Error("HTTP " + res.statusCode)); return; }
      var chunks = [];
      res.on("data", function (d) { chunks.push(d); });
      res.on("end", function () { cb(null, nodeBuffer().concat(chunks)); });
    });
    req.on("error", cb);
    req.setTimeout(30000, function () { req.destroy(new Error("Timed out")); });
  }

  /* Minimal ZIP reader: central directory + stored/deflate entries, via zlib. */
  function unzipBuffer(buf) {
    var EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;
    var end = -1, lo = Math.max(0, buf.length - 65557);
    for (var p = buf.length - 22; p >= lo; p--) { if (buf.readUInt32LE(p) === EOCD) { end = p; break; } }
    if (end < 0) { throw new Error("Not a zip file"); }
    var count = buf.readUInt16LE(end + 10), cdOff = buf.readUInt32LE(end + 16);
    var zlib = nodeRequire()("zlib"), out = [], p2 = cdOff, i;
    for (i = 0; i < count; i++) {
      if (buf.readUInt32LE(p2) !== CEN) { throw new Error("Bad zip central directory"); }
      var method = buf.readUInt16LE(p2 + 10);
      var compSize = buf.readUInt32LE(p2 + 20);
      var nameLen = buf.readUInt16LE(p2 + 28), extraLen = buf.readUInt16LE(p2 + 30), commentLen = buf.readUInt16LE(p2 + 32);
      var localOff = buf.readUInt32LE(p2 + 42);
      var name = buf.toString("utf8", p2 + 46, p2 + 46 + nameLen);
      if (!/\/$/.test(name)) {
        if (buf.readUInt32LE(localOff) !== LOC) { throw new Error("Bad zip entry: " + name); }
        var lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28);
        var dataStart = localOff + 30 + lNameLen + lExtraLen;
        var comp = buf.slice(dataStart, dataStart + compSize);
        var data = method === 0 ? comp : (method === 8 ? zlib.inflateRawSync(comp) : null);
        if (!data) { throw new Error("Unsupported zip method for " + name); }
        out.push({ path: name, data: data });
      }
      p2 += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function writeExtractedFiles(files, destRoot) {
    var fs = nodeRequire()("fs"), path = nodeRequire()("path");
    for (var i = 0; i < files.length; i++) {
      var full = path.join(destRoot, files[i].path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, files[i].data);
    }
  }

  function renderUpdateBanner() {
    var el = document.getElementById("update"), textEl = document.getElementById("updateText"), btn = document.getElementById("updateInstall");
    if (!el || !textEl || !btn) { return; }
    if (!state.update || state.updateDismissed) { el.hidden = true; return; }
    el.hidden = false;
    if (state.updateStatus === "downloading") { textEl.textContent = "Downloading update…"; }
    else if (state.updateStatus === "error") { textEl.textContent = "Update failed: " + (state.updateError || "unknown error"); }
    else if (state.updateStatus === "done") { textEl.textContent = "Updated to v" + state.update.version + ". Reloading…"; }
    else { textEl.textContent = "Update available: v" + state.update.version + (state.update.notes ? " — " + state.update.notes : ""); }
    btn.hidden = state.updateStatus === "downloading" || state.updateStatus === "done";
    btn.textContent = state.updateStatus === "error" ? "Retry" : "Update";
  }

  function installUpdate() {
    if (!state.update) { return; }
    state.updateStatus = "downloading";
    renderUpdateBanner();
    httpsGetBuffer(state.update.url, 5, function (err, buf) {
      if (err) { state.updateStatus = "error"; state.updateError = err.message; renderUpdateBanner(); return; }
      try {
        var crypto = nodeRequire()("crypto");
        var hash = crypto.createHash("sha256").update(buf).digest("hex");
        if (String(state.update.sha256 || "").toLowerCase() !== hash.toLowerCase()) { throw new Error("Checksum mismatch"); }
        var files = unzipBuffer(buf);
        writeExtractedFiles(files, extensionPath());
      } catch (e) {
        state.updateStatus = "error"; state.updateError = e.message; renderUpdateBanner(); return;
      }
      state.updateStatus = "done";
      renderUpdateBanner();
      setTimeout(function () { window.location.reload(); }, 900);
    });
  }

  function checkForUpdate() {
    if (!cep || !nodeRequire()) { return; }
    var cur = currentVersion();
    if (!cur) { return; }
    httpsGetText(UPDATE_MANIFEST_URL, 3, function (err, text) {
      if (err) { return; }
      var info;
      try { info = JSON.parse(text); } catch (e) { return; }
      if (!info || !info.version || !info.url || compareVersions(info.version, cur) <= 0) { return; }
      if (window.localStorage.getItem("sc.dismissedUpdateVersion") === info.version) { return; }
      state.update = info;
      renderUpdateBanner();
    });
  }

  document.getElementById("updateInstall").addEventListener("click", installUpdate);
  document.getElementById("updateDismiss").addEventListener("click", function () {
    state.updateDismissed = true;
    try { if (state.update) { window.localStorage.setItem("sc.dismissedUpdateVersion", state.update.version); } } catch (e) {}
    renderUpdateBanner();
  });

  function selectMatching(id) {
    enqueue(function () {
      return call("SC_selectMatching", [id, state.deep]).then(function (res) {
        var r = parse(res);
        if (r && !r.ok) { toast(r.error || "Could not change selection"); }
        return scan(true);
      });
    });
  }

  /* ------------------------------------------------------------ scan */

  function scan(force) {
    if (!cep) { state.status = "nohost"; render(); return Promise.resolve(); }
    if (state.scanning) {
      if (force) { state.rescanQueued = true; }
      return Promise.resolve();
    }
    if (state.busy && !force) { return Promise.resolve(); }
    state.scanning = true;
    return call("SC_fingerprint").then(function (fp) {
      var key = String(fp) + "|" + (state.deep ? 1 : 0);
      if (!force && key === state.lastFp) { return; }
      state.lastFp = key;
      return call("SC_scan", [state.deep]).then(function (res) {
        var r = parse(res);
        if (!r) {
          state.status = "error";
          state.error = "Could not read the selection. " + describeFailure(res);
          state.colors = [];
        } else {
          state.status = r.status;
          state.error = r.error || "";
          state.colors = r.colors || [];
        }
        render();
      });
    }).then(finish, finish);

    function finish() {
      state.scanning = false;
      if (state.rescanQueued) {
        state.rescanQueued = false;
        return scan(true);
      }
    }
  }

  function poll() {
    if (state.ready && !state.busy && !document.hidden) { scan(false); }
    setTimeout(poll, POLL_MS);
  }

  /* ------------------------------------------------------------ boot */

  function extensionPath() {
    var p = decodeURI(cep.getSystemPath("extension"));
    if (/^file:\/\/\/[A-Za-z]:/.test(p)) { p = p.slice(8); }       // Windows
    else if (/^file:\/\//.test(p)) { p = p.slice(7); }             // macOS
    return p;
  }

  /* Load common.jsx + the app's host file from this extension's folder (every start,
     so the engine always runs the installed version). Resolves true when ready. */
  function ensureHost() {
    var dir = extensionPath().replace(/\\/g, "/") + "/jsx";
    var files = ["common.jsx", HOST === "ai" ? "ai.jsx" : (HOST === "id" ? "id.jsx" : "ae.jsx")];
    var script = "var __SC_LOAD = ''; SC_EXT_JSX_DIR = " + JSON.stringify(dir) + "; " +
      files.map(function (f) {
        return "try { $.evalFile(File(" + JSON.stringify(dir + "/" + f) + ")); } catch (e) { __SC_LOAD += " +
          JSON.stringify(f) + " + ': ' + e + (e.line ? ' (line ' + e.line + ')' : '') + '; '; }";
      }).join(" ") + " __SC_LOAD;";
    return evalJSX(script).then(function (loadErr) {
      return evalJSX("typeof SC_scan + ',' + typeof SC_json + ',' + (typeof SC_HOST !== 'undefined' ? SC_HOST : '?')")
        .then(function (t) {
          if (t === "function,function," + HOST) { return true; }
          var why = "";
          if (loadErr === "EvalScript error.") { why = "The host app reported a script error. "; }
          else if (loadErr && loadErr !== "undefined") { why = String(loadErr) + " "; }
          state.loadError = "Could not load the host script. " + why + "[check: " + t + "; folder: " + dir + "]";
          return false;
        });
    });
  }

  function boot() {
    return ensureHost().then(function (ok) {
      if (!ok) {
        state.status = "error";
        state.error = state.loadError;
        state.renderedSig = null;
        render();
        return;
      }
      state.renderedSig = null;
      if (!state.ready) { state.ready = true; setTimeout(poll, POLL_MS); }
      scan(true);
    });
  }

  els.toggle.addEventListener("click", function () {
    state.collapsed = !state.collapsed;
    writePref("collapsed", state.collapsed);
    render();
  });
  els.deep.addEventListener("click", function () {
    state.deep = !state.deep;
    writePref("deep", state.deep);
    render();
    scan(true);
  });
  els.refresh.addEventListener("click", function () {
    els.refresh.classList.remove("spin");
    void els.refresh.offsetWidth;
    els.refresh.classList.add("spin");
    scan(true);
  });
  window.addEventListener("focus", function () { scan(true); });
  document.documentElement.addEventListener("mouseenter", function () { if (!editingInList()) { scan(true); } });

  render();

  if (!cep) {
    state.status = "nohost";
    render();
    return;
  }

  applyTheme();
  try {
    cep.addEventListener("com.adobe.csxs.events.ThemeColorChanged", applyTheme);
  } catch (e) { /* older CEP */ }

  try {
    var flyout = '<Menu><MenuItem Id="reload" Label="Reload Panel" Enabled="true" Checked="false"/></Menu>';
    cep.invokeSync("setPanelFlyoutMenu", JSON.stringify({ extensionId: cep.getExtensionId(), menu: flyout }));
    cep.addEventListener("com.adobe.csxs.events.flyoutMenuClicked", function (e) {
      var id = e && e.data && (e.data.menuId || e.data.menuName);
      if (id === "reload") { window.location.reload(); }
    });
  } catch (e) { /* host doesn't support flyout menus */ }

  boot();
  checkForUpdate();
})();
