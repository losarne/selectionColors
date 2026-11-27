/* Selection Colors — built-in colour picker popover (Figma-style). */
(function () {
  "use strict";

  /* ------------------------------------------------------------ colour math */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function hexToRgb(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgbToHex(r, g, b) {
    return [r, g, b].map(function (x) {
      return clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }
  function hsvToRgb(h, s, v) {
    function f(n) { var k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) { h = ((g - b) / d) % 6; }
      else if (max === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60;
      if (h < 0) { h += 360; }
    }
    return [h, max === 0 ? 0 : d / max, max];
  }
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

  /* ------------------------------------------------------------------- DOM */
  var EYE =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.2 2.6a1.9 1.9 0 0 1 2.7 2.7l-1.4 1.4.7.7-1 1-.7-.7-4.9 4.9H3.5v-2.1l4.9-4.9-.7-.7 1-1 .7.7z" fill="none" stroke="currentColor" stroke-linejoin="round"/></svg>';
  var X =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  var el = document.createElement("div");
  el.className = "picker";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Colour picker");
  el.hidden = true;
  el.innerHTML =
    '<div class="pk-head">' +
      '<span class="pk-title">Color</span>' +
      '<button type="button" class="pk-x tool" title="Close">' + X + '</button>' +
    '</div>' +
    '<div class="pk-body">' +
      '<div class="sv" tabindex="0" aria-label="Saturation and brightness"><div class="sv-w"></div><div class="sv-b"></div><div class="knob sv-knob"></div></div>' +
      '<div class="pk-row">' +
        '<button type="button" class="pk-eye tool" title="Pick colour from screen">' + EYE + '</button>' +
        '<div class="hue" tabindex="0" aria-label="Hue"><div class="knob hue-knob"></div></div>' +
      '</div>' +
      '<div class="pk-status" hidden></div>' +
      '<div class="pk-fields">' +
        '<label class="pk-f pk-hex"><input data-k="hex" spellcheck="false" autocomplete="off" maxlength="9"><span>Hex</span></label>' +
        '<label class="pk-f"><input data-k="0" inputmode="numeric" maxlength="3"><span>R</span></label>' +
        '<label class="pk-f"><input data-k="1" inputmode="numeric" maxlength="3"><span>G</span></label>' +
        '<label class="pk-f"><input data-k="2" inputmode="numeric" maxlength="3"><span>B</span></label>' +
      '</div>' +
      '<label class="pk-f pk-op pk-opacity-row"><input data-k="opacity" inputmode="numeric" maxlength="3" placeholder="Mixed"><span>Opacity %</span></label>' +
      '<div class="pk-sw-wrap">' +
        '<div class="pk-col" data-col="sel"><div class="pk-label">In selection</div><div class="pk-sw"></div></div>' +
        '<div class="pk-col" data-col="proj"><div class="pk-label"><span class="pk-proj-label">In project</span> <span class="pk-note"></span></div><div class="pk-sw"></div></div>' +
      '</div>' +
    '</div>' +
    '<div class="pk-foot"><button type="button" class="pk-done">Done</button></div>';
  document.body.appendChild(el);

  var q = function (s) { return el.querySelector(s); };
  var sv = q(".sv"), svKnob = q(".sv-knob"), hue = q(".hue"), hueKnob = q(".hue-knob");
  var eye = q(".pk-eye"), statusEl = q(".pk-status");
  var selBox = q('[data-col="sel"] .pk-sw'), projBox = q('[data-col="proj"] .pk-sw'), projNote = q('[data-col="proj"] .pk-note'), projLabel = q(".pk-proj-label");
  var inHex = q('[data-k="hex"]'), inCh = [q('[data-k="0"]'), q('[data-k="1"]'), q('[data-k="2"]')];
  var inOp = q('[data-k="opacity"]');

  /* ----------------------------------------------------------------- state */
  var st = {
    open: false, h: 0, s: 0, v: 0,
    appliedId: null,    // host id of the colour currently applied (what we replace FROM)
    appliedHex: null,   // its hex (display)
    inflight: false, queued: false,
    target: null,       // exact colour id to snap to (chip click); null = use the hex
    opacity: null, appliedOpacity: null,  // 0-100, or null when mixed/unknown (AE: always null)
    anchor: null, opts: null,
    project: null,      // { colors: [], partial: bool } or null while loading
    projectReq: 0,
    eyeJob: null        // running native eyedropper { cancel() }
  };

  function hex() { var c = hsvToRgb(st.h, st.s, st.v); return rgbToHex(c[0], c[1], c[2]); }

  function paint(skipInput) {
    var cur = hex(), rgb = hexToRgb(cur);
    sv.style.backgroundColor = "hsl(" + st.h + ",100%,50%)";
    svKnob.style.left = (st.s * 100) + "%";
    svKnob.style.top = ((1 - st.v) * 100) + "%";
    svKnob.style.backgroundColor = "#" + cur;
    hueKnob.style.left = (st.h / 360 * 100) + "%";
    hueKnob.style.backgroundColor = "hsl(" + st.h + ",100%,50%)";
    if (skipInput !== inHex) { inHex.value = cur; }
    for (var i = 0; i < 3; i++) { if (skipInput !== inCh[i]) { inCh[i].value = String(rgb[i]); } }
    if (st.opts && st.opts.onPreview) { st.opts.onPreview(st.appliedId, cur); }
  }

  function setHex(h, keepHue) {
    var rgb = hexToRgb(h), hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    // Keep hue (and saturation) stable for greys/black so the knobs don't jump.
    if (!(keepHue && hsv[1] === 0)) { st.h = hsv[0]; }
    if (!(keepHue && hsv[2] === 0)) { st.s = hsv[1]; }
    st.v = hsv[2];
  }

  function status(msg, isError) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
  }

  /* Apply current colour to AE (serialised; latest value wins). */
  function commit(targetId) {
    if (!st.opts || !st.appliedId) { return; }
    if (targetId !== undefined) { st.target = targetId || null; }
    var target = hex(), targetKey = st.target;
    if (targetKey ? targetKey === st.appliedId : target === st.appliedHex) { return; }
    if (st.inflight) { st.queued = true; return; }
    st.inflight = true;
    var fromId = st.appliedId, fromHex = st.appliedHex;
    st.appliedHex = target;   // optimistic
    st.target = null;
    Promise.resolve(st.opts.onCommit(fromId, target, targetKey)).then(function (res) {
      if (res && res.ok) { st.appliedId = res.id || target; }
      else { st.appliedHex = fromHex; }
    }, function () { st.appliedHex = fromHex; }).then(function () {
      st.inflight = false;
      if (st.open && st.opts.findRow) { reanchor(st.opts.findRow); }
      if (st.queued) { st.queued = false; commit(); }
      else { refreshProject(600); }
    });
  }

  /* -------------------------------------------------------------- dragging */
  function drag(area, onMove) {
    area.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) { return; }
      e.preventDefault();
      area.focus();
      try { area.setPointerCapture(e.pointerId); } catch (x) {}
      onMove(e);
      function move(ev) { onMove(ev); }
      function up(ev) {
        area.removeEventListener("pointermove", move);
        area.removeEventListener("pointerup", up);
        area.removeEventListener("pointercancel", up);
        try { area.releasePointerCapture(ev.pointerId); } catch (x) {}
        commit();
      }
      area.addEventListener("pointermove", move);
      area.addEventListener("pointerup", up);
      area.addEventListener("pointercancel", up);
    });
  }
  drag(sv, function (e) {
    var r = sv.getBoundingClientRect();
    st.s = clamp((e.clientX - r.left) / r.width, 0, 1);
    st.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    st.target = null; paint();
  });
  drag(hue, function (e) {
    var r = hue.getBoundingClientRect();
    st.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
    if (st.h >= 360) { st.h = 359.999; }
    st.target = null; paint();
  });

  // Keyboard nudging (commits after a short pause so held keys = one change)
  var nudgeTimer = null;
  function nudged() { st.target = null; paint(); clearTimeout(nudgeTimer); nudgeTimer = setTimeout(commit, 350); }
  sv.addEventListener("keydown", function (e) {
    var d = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowLeft") { st.s = clamp(st.s - d, 0, 1); }
    else if (e.key === "ArrowRight") { st.s = clamp(st.s + d, 0, 1); }
    else if (e.key === "ArrowUp") { st.v = clamp(st.v + d, 0, 1); }
    else if (e.key === "ArrowDown") { st.v = clamp(st.v - d, 0, 1); }
    else { return; }
    e.preventDefault(); e.stopPropagation(); nudged();
  });
  hue.addEventListener("keydown", function (e) {
    var d = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { st.h = (st.h - d + 360) % 360; }
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") { st.h = (st.h + d) % 360; }
    else { return; }
    e.preventDefault(); e.stopPropagation(); nudged();
  });

  /* ---------------------------------------------------------------- fields */
  inHex.addEventListener("focus", function () { setTimeout(function () { if (document.activeElement === inHex) { inHex.select(); } }, 0); });
  inHex.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyHexField(); inHex.select(); }
  });
  inHex.addEventListener("blur", applyHexField);
  function applyHexField() {
    var h = parseHex(inHex.value);
    if (!h) { inHex.value = hex(); return; }
    if (h !== hex()) { setHex(h, true); paint(); commit(null); } else { inHex.value = h; }
  }

  inCh.forEach(function (input, idx) {
    input.addEventListener("focus", function () { setTimeout(function () { if (document.activeElement === input) { input.select(); } }, 0); });
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); applyChannel(input, idx); input.select(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        var n = parseInt(input.value, 10); if (isNaN(n)) { n = 0; }
        n = clamp(n + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 255);
        input.value = String(n);
        var rgb = hexToRgb(hex()); rgb[idx] = n;
        setHex(rgbToHex(rgb[0], rgb[1], rgb[2]), true);
        paint(input); clearTimeout(nudgeTimer); nudgeTimer = setTimeout(commit, 350);
      }
    });
    input.addEventListener("blur", function () { applyChannel(input, idx); });
  });

  function paintOpacity() { inOp.value = (st.opacity === null) ? "" : String(Math.round(st.opacity)); }

  function commitOpacity(v) {
    if (!st.opts || !st.opts.onOpacityCommit || !st.appliedId) { return; }
    v = Math.max(0, Math.min(100, Math.round(v)));
    if (v === st.appliedOpacity) { return; }
    var prev = st.appliedOpacity;
    st.opacity = st.appliedOpacity = v;   // optimistic
    Promise.resolve(st.opts.onOpacityCommit(st.appliedId, v)).then(function (res) {
      if (!res || !res.ok) { st.opacity = st.appliedOpacity = prev; paintOpacity(); }
    }, function () { st.opacity = st.appliedOpacity = prev; paintOpacity(); });
  }

  inOp.addEventListener("focus", function () { setTimeout(function () { if (document.activeElement === inOp) { inOp.select(); } }, 0); });
  inOp.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyOpacityField(); inOp.select(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      var n = parseInt(inOp.value, 10); if (isNaN(n)) { n = st.opacity === null ? 100 : st.opacity; }
      n = clamp(n + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 100);
      inOp.value = String(n);
      commitOpacity(n);
    }
  });
  inOp.addEventListener("blur", applyOpacityField);
  function applyOpacityField() {
    var raw = inOp.value.trim();
    if (raw === "") { paintOpacity(); return; }
    var n = parseInt(raw, 10);
    if (isNaN(n)) { paintOpacity(); return; }
    commitOpacity(n);
  }
  function applyChannel(input, idx) {
    var n = parseInt(input.value, 10), rgb = hexToRgb(hex());
    if (isNaN(n)) { input.value = String(rgb[idx]); return; }
    n = clamp(n, 0, 255);
    input.value = String(n);
    if (n === rgb[idx]) { return; }
    rgb[idx] = n;
    setHex(rgbToHex(rgb[0], rgb[1], rgb[2]), true);
    paint(input); commit(null);
  }

  /* ------------------------------------------------------------ eyedropper */
  function eyeAvailable() {
    return !!((st.opts && st.opts.eyedropper) || ("EyeDropper" in window));
  }

  function stopEye() {
    if (st.eyeJob) { try { st.eyeJob.cancel(); } catch (e) {} st.eyeJob = null; }
    eye.classList.remove("active");
  }

  eye.addEventListener("click", function () {
    if (st.eyeJob) { stopEye(); status(""); return; }
    var before = hex();

    // Native (Windows) eyedropper provided by the panel
    if (st.opts && st.opts.eyedropper) {
      eye.classList.add("active");
      status("Starting eyedropper…");
      var job = st.opts.eyedropper({
        onReady: function () { if (st.eyeJob === job) { status("Click anywhere to pick · Esc to cancel"); } },
        onMove: function (h) {
          if (st.eyeJob !== job) { return; }
          var p = parseHex(h);
          if (p) { setHex(p, true); paint(); }
        }
      });
      st.eyeJob = job;
      job.promise.then(function (h) {
        if (st.eyeJob !== job) { return; }
        st.eyeJob = null; eye.classList.remove("active"); status("");
        var p = parseHex(h);
        if (p) { setHex(p, true); paint(); commit(null); }
        else { setHex(before, true); paint(); }          // cancelled: restore
      }, function (err) {
        if (st.eyeJob !== job) { return; }
        st.eyeJob = null; eye.classList.remove("active");
        setHex(before, true); paint();
        status("Eyedropper failed: " + ((err && err.message) || err), true);
      });
      return;
    }

    // Browser EyeDropper API (where the host supports it)
    try {
      new window.EyeDropper().open().then(function (res) {
        var p = parseHex(res && res.sRGBHex);
        if (p) { setHex(p, true); paint(); commit(null); }
      }, function (err) {
        if (err && err.name && err.name !== "AbortError") { status("Eyedropper isn't supported here", true); }
      });
    } catch (e) { status("Eyedropper isn't supported here", true); }
  });

  /* -------------------------------------------------------------- swatches */
  function norm(x) {
    return typeof x === "string" ? { id: x, hex: x, label: "#" + x } : { id: x.id || x.hex, hex: x.hex, label: x.label || "#" + x.hex };
  }

  function fillChips(box, list, empty) {
    box.textContent = "";
    if (!list.length) {
      var m = document.createElement("span");
      m.className = "pk-empty";
      m.textContent = empty;
      box.appendChild(m);
      return;
    }
    list.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pk-chip";
      b.title = (c.label && c.label !== "#" + c.hex) ? c.label + "  \u00b7  #" + c.hex : "#" + c.hex;
      b.dataset.id = c.id;
      b.style.backgroundColor = "#" + c.hex;
      b.addEventListener("click", function () { setHex(c.hex, false); paint(); commit(c.id); });
      box.appendChild(b);
    });
  }

  function renderSwatches() {
    var cur = st.appliedId;
    var sel = (st.opts && st.opts.getSwatches ? st.opts.getSwatches() : []).map(norm).filter(function (c) { return c.id !== cur; });
    fillChips(selBox, sel.slice(0, 40), "None");
    if (!st.project) {
      fillChips(projBox, [], "Loading…");
      projNote.textContent = "";
    } else {
      fillChips(projBox, st.project.colors.map(norm).filter(function (c) { return c.id !== cur; }).slice(0, 40), "None");
      projNote.textContent = st.project.partial ? "(partial)" : "";
      projNote.title = st.project.partial ? "Large project: only part of it was scanned" : "";
    }
  }

  var projTimer = null;
  function refreshProject(delay) {
    clearTimeout(projTimer);
    if (!st.opts || !st.opts.getProjectSwatches) { return; }
    projTimer = setTimeout(function () {
      if (!st.open) { return; }
      var id = ++st.projectReq;
      Promise.resolve(st.opts.getProjectSwatches()).then(function (res) {
        if (!st.open || id !== st.projectReq) { return; }
        st.project = res && res.colors ? res : { colors: [], partial: false };
        renderSwatches();
        position();
      }, function () {});
    }, delay || 0);
  }

  /* ----------------------------------------------------------- positioning */
  function position() {
    if (!st.open || !st.anchor) { return; }
    var r = st.anchor.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight, M = 6;
    var w = clamp(Math.round(r.width), Math.min(220, W - 2 * M), W - 2 * M);
    el.style.width = w + "px";
    var left = clamp(r.left, M, W - w - M);
    var h = el.offsetHeight, top = r.bottom + 6;
    if (top + h > H - M) {
      top = (r.top - 6 - h >= M) ? r.top - 6 - h : clamp(H - h - M, M, H);
    }
    el.style.left = left + "px";
    el.style.top = top + "px";
  }
  window.addEventListener("resize", position);
  window.addEventListener("scroll", function (e) { if (!el.contains(e.target)) { position(); } }, true);

  /* -------------------------------------------------------- open / close */
  function onOutside(e) {
    if (!st.open) { return; }
    if (el.contains(e.target)) { return; }
    if (e.target.closest && e.target.closest(".swatch")) { return; } // swatch toggles itself
    close();
  }
  function onKey(e) {
    if (st.open && e.key === "Escape") { e.preventDefault(); close(); }
  }
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  q(".pk-x").addEventListener("click", function () { close(); });
  q(".pk-done").addEventListener("click", function () { close(); });

  function open(anchor, color, opts) {
    var wasOpen = st.open;
    if (wasOpen) { finishEdits(); }
    stopEye(); status("");
    st.opts = opts || {};
    st.anchor = anchor;
    st.appliedId = color.id;
    st.appliedHex = color.hex;
    st.opacity = st.appliedOpacity = (typeof color.opacity === "number") ? color.opacity : null;
    paintOpacity();
    st.open = true;
    projLabel.textContent = st.opts.projectLabel || "In project";
    st.project = (st.opts.cachedProject && st.opts.cachedProject()) || null;
    eye.style.display = eyeAvailable() ? "" : "none";
    setHex(color.hex, false);
    el.hidden = false;
    paint();
    renderSwatches();
    position();
    refreshProject(st.project ? 250 : 0);
    if (!wasOpen) { sv.focus({ preventScroll: true }); }
  }

  /* Commit anything typed / nudged but not yet applied. */
  function finishEdits() {
    var a = document.activeElement;
    if (a === inHex) { applyHexField(); }
    else if (a === inOp) { applyOpacityField(); }
    else { for (var i = 0; i < 3; i++) { if (a === inCh[i]) { applyChannel(a, i); } } }
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; commit(); }
  }

  function close() {
    if (!st.open) { return; }
    finishEdits();
    stopEye();
    status("");
    clearTimeout(projTimer);
    st.open = false;
    el.hidden = true;
    if (st.opts && st.opts.onClose) { st.opts.onClose(); }
  }

  /* Called by the panel after it re-renders the list. */
  function reanchor(findRow) {
    if (!st.open) { return; }
    var row = findRow(st.appliedId, st.appliedHex);
    if (!row) {
      if (!st.inflight && !st.eyeJob) { close(); }
      return;
    }
    st.anchor = row;
    renderSwatches();
    position();
    if (st.opts.onPreview) { st.opts.onPreview(st.appliedId, hex()); }
  }

  window.SCPicker = {
    open: open,
    close: close,
    reanchor: reanchor,
    isOpen: function () { return st.open; },
    current: function () { return st.open ? st.appliedId : null; },
    busy: function () { return st.inflight; },
    _math: { hsvToRgb: hsvToRgb, rgbToHsv: rgbToHsv, rgbToHex: rgbToHex, hexToRgb: hexToRgb, parseHex: parseHex }
  };
})();
