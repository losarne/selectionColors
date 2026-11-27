// Minimal mock of the After Effects scripting DOM, faithful to the behaviours host.jsx relies on.
(function (G) {
  var PropertyType = { PROPERTY: 6812, INDEXED_GROUP: 6813, NAMED_GROUP: 6814 };
  var PropertyValueType = { COLOR: 6418, TEXT_DOCUMENT: 6424, OneD: 6417, TwoD: 6415 };
  function clone(v) { return v && typeof v.clone === "function" ? v.clone() : (Array.isArray(v) ? v.slice() : v); }

  function Property(matchName, vt, value, opts) {
    opts = opts || {};
    this.matchName = matchName; this.name = matchName;
    this.propertyType = PropertyType.PROPERTY;
    this.propertyValueType = vt;
    this._v = clone(value);
    this._keys = (opts.keys || []).map(clone);
    this.hidden = !!opts.hidden;
    this.expressionValue = opts.expressionValue; // post-expression override
    this.layer = null;
  }
  Object.defineProperty(Property.prototype, "numKeys", { get: function () { return this._keys.length; } });
  Property.prototype._check = function () {
    if (this.hidden) throw new Error("Can not set value, property is hidden");
    if (this.layer && this.layer.locked) throw new Error("layer is locked");
  };
  Property.prototype.keyValue = function (k) {
    if (k < 1 || k > this._keys.length) throw new Error("bad key index"); return clone(this._keys[k - 1]);
  };
  Property.prototype.setValueAtKey = function (k, v) { this._check(); this._keys[k - 1] = clone(v); };
  Property.prototype.valueAtTime = function (t, pre) {
    if (this._keys.length) return clone(this._keys[0]);
    if (!pre && this.expressionValue !== undefined) return clone(this.expressionValue);
    return clone(this._v);
  };
  Object.defineProperty(Property.prototype, "value", { get: function () { return this.valueAtTime(0, false); } });
  Property.prototype.setValue = function (v) {
    this._check();
    if (this._keys.length) throw new Error("use setValueAtTime or setValueAtKey");
    this._v = clone(v);
  };

  function Group(matchName, children, opts) {
    opts = opts || {};
    this.matchName = matchName; this.name = matchName;
    this.propertyType = opts.indexed ? PropertyType.INDEXED_GROUP : PropertyType.NAMED_GROUP;
    this._children = children || [];
    this._enabled = opts.enabled === undefined ? true : opts.enabled;
    this._throwWhenDisabled = !!opts.throwWhenDisabled;
  }
  Object.defineProperty(Group.prototype, "enabled", { get: function () { return this._enabled; } });
  Object.defineProperty(Group.prototype, "numProperties", {
    get: function () {
      if (this._throwWhenDisabled && !this._enabled) throw new Error("hidden group accessed");
      return this._children.length;
    }
  });
  Group.prototype.property = function (i) {
    if (this._throwWhenDisabled && !this._enabled) throw new Error("hidden group accessed");
    return this._children[i - 1];
  };
  Group.prototype._setLayer = function (layer) {
    this._children.forEach(function (c) { if (c instanceof Group) c._setLayer(layer); else c.layer = layer; });
  };

  // ---- Text
  function TextDocument(text, chars, opts) {
    // chars: array of {applyFill, fill:[r,g,b], applyStroke, stroke:[r,g,b], strokeWidth}
    opts = opts || {};
    this.text = text;
    this._chars = chars.map(function (c) { return JSON.parse(JSON.stringify(c)); });
    this._legacy = !!opts.legacy;
    if (!this._legacy) {
      var self = this;
      this.characterRange = function (a, b) { return new CharacterRange(self, a, b); };
    }
  }
  TextDocument.prototype.clone = function () {
    return new TextDocument(this.text, this._chars, { legacy: this._legacy });
  };
  Object.defineProperty(TextDocument.prototype, "applyFill", {
    get: function () { return this._chars[0].applyFill; },
    set: function (v) { this._chars.forEach(function (c) { c.applyFill = v; }); }
  });
  Object.defineProperty(TextDocument.prototype, "applyStroke", {
    get: function () { return this._chars[0].applyStroke; },
    set: function (v) { this._chars.forEach(function (c) { c.applyStroke = v; }); }
  });
  Object.defineProperty(TextDocument.prototype, "strokeWidth", { get: function () { return this._chars[0].strokeWidth || 0; } });
  Object.defineProperty(TextDocument.prototype, "fillColor", {
    get: function () { if (!this._chars[0].applyFill) throw new Error("applyFill is not true"); return this._chars[0].fill.slice(); },
    set: function (v) { this._chars.forEach(function (c) { c.fill = v.slice(0, 3); c.applyFill = true; }); }
  });
  Object.defineProperty(TextDocument.prototype, "strokeColor", {
    get: function () { if (!this._chars[0].applyStroke) throw new Error("applyStroke is not true"); return this._chars[0].stroke.slice(); },
    set: function (v) { this._chars.forEach(function (c) { c.stroke = v.slice(0, 3); c.applyStroke = true; }); }
  });

  function CharacterRange(doc, a, b) { this._d = doc; this._a = a; this._b = b; }
  Object.defineProperty(CharacterRange.prototype, "isRangeValid", {
    get: function () { return this._a >= 0 && this._b <= this._d._chars.length && this._a <= this._b; }
  });
  function rangeAttr(name, writeFlag) {
    return {
      get: function () {
        if (!this.isRangeValid) throw new Error("range invalid");
        var cs = this._d._chars.slice(this._a, this._b), first = JSON.stringify(cs[0][name]);
        for (var i = 1; i < cs.length; i++) if (JSON.stringify(cs[i][name]) !== first) return undefined;
        return cs[0][name] === undefined ? undefined : JSON.parse(first);
      },
      set: function (v) {
        if (!this.isRangeValid) throw new Error("range invalid");
        for (var i = this._a; i < this._b; i++) {
          this._d._chars[i][name] = Array.isArray(v) ? v.slice(0, 3) : v;
          if (writeFlag) this._d._chars[i][writeFlag] = true;
        }
      }
    };
  }
  Object.defineProperty(CharacterRange.prototype, "applyFill", rangeAttr("applyFill"));
  Object.defineProperty(CharacterRange.prototype, "applyStroke", rangeAttr("applyStroke"));
  Object.defineProperty(CharacterRange.prototype, "strokeWidth", rangeAttr("strokeWidth"));
  Object.defineProperty(CharacterRange.prototype, "fillColor", rangeAttr("fill", "applyFill"));
  Object.defineProperty(CharacterRange.prototype, "strokeColor", rangeAttr("stroke", "applyStroke"));

  // ---- Items
  var nextId = 1;
  function Item() { this.id = nextId++; }
  function SolidSource(color) { this.color = color.slice(); }
  function FootageItem(mainSource) { Item.call(this); this.mainSource = mainSource; }
  function CompItem(name) { Item.call(this); this.name = name; this._layers = []; this.time = 0; }
  Object.defineProperty(CompItem.prototype, "numLayers", { get: function () { return this._layers.length; } });
  CompItem.prototype.layer = function (i) { return this._layers[i - 1]; };
  CompItem.prototype.addLayer = function (l) { this._layers.push(l); l.index = this._layers.length; l.containingComp = this; return l; };
  Object.defineProperty(CompItem.prototype, "selectedLayers", {
    get: function () { return this._layers.filter(function (l) { return l.selected; }); }
  });

  function Layer(name, groups, opts) {
    opts = opts || {};
    Group.call(this, "ADBE Layer", groups);
    this.name = name; this.selected = !!opts.selected; this.locked = !!opts.locked;
    this.nullLayer = !!opts.nullLayer; this.adjustmentLayer = !!opts.adjustmentLayer;
    if (opts.source) this.source = opts.source;
    this._setLayer(this);
  }
  Layer.prototype = Object.create(Group.prototype);

  var app = {
    undoDepth: 0, undoGroups: [],
    project: {
      activeItem: null, items: [],
      get numItems() { return this.items.length; },
      item: function (i) { return this.items[i - 1]; }
    },
    beginUndoGroup: function (n) { this.undoDepth++; this.undoGroups.push(n); },
    endUndoGroup: function () { this.undoDepth--; }
  };

  G.PropertyType = PropertyType; G.PropertyValueType = PropertyValueType;
  G.Property = Property; G.Group = Group; G.Layer = Layer;
  G.TextDocument = TextDocument; G.SolidSource = SolidSource; G.FootageItem = FootageItem; G.CompItem = CompItem;
  G.app = app;
  G.$ = { colorPicker: function (c) { return G.__pickerResult === undefined ? -1 : G.__pickerResult; } };

  // Convenience builders
  G.mk = {
    color: function (hex, a) {
      return [parseInt(hex.substr(0, 2), 16) / 255, parseInt(hex.substr(2, 2), 16) / 255, parseInt(hex.substr(4, 2), 16) / 255, a === undefined ? 1 : a];
    },
    fill: function (hex, opts) {
      return new Group("ADBE Vector Graphic - Fill", [
        new Property("ADBE Vector Fill Color", PropertyValueType.COLOR, G.mk.color(hex), opts),
        new Property("ADBE Vector Fill Opacity", PropertyValueType.OneD, 100)
      ]);
    },
    stroke: function (hex) {
      return new Group("ADBE Vector Graphic - Stroke", [
        new Property("ADBE Vector Stroke Color", PropertyValueType.COLOR, G.mk.color(hex))
      ]);
    },
    shapeLayer: function (name, items, opts) {
      return new Layer(name, [
        new Group("ADBE Root Vectors Group", [new Group("ADBE Vector Group", [new Group("ADBE Vectors Group", items, { indexed: true })])], { indexed: true }),
        new Group("ADBE Effect Parade", (opts && opts.effects) || [], { indexed: true }),
        new Group("ADBE Transform Group", [new Property("ADBE Opacity", PropertyValueType.OneD, 100)]),
        (opts && opts.styles) || G.mk.noStyles()
      ], opts);
    },
    noStyles: function () {
      return new Group("ADBE Layer Styles", [
        new Group("dropShadow/enabled", [new Property("dropShadow/color", PropertyValueType.COLOR, G.mk.color("000000"))], { enabled: false, throwWhenDisabled: true })
      ], { enabled: false, throwWhenDisabled: true });
    },
    styles: function (hex) {
      return new Group("ADBE Layer Styles", [
        new Group("ADBE Blend Options Group", [], { enabled: true }),
        new Group("dropShadow/enabled", [new Property("dropShadow/color", PropertyValueType.COLOR, G.mk.color(hex))], { enabled: true }),
        new Group("innerShadow/enabled", [new Property("innerShadow/color", PropertyValueType.COLOR, G.mk.color("ABCDEF"))], { enabled: false, throwWhenDisabled: true })
      ], { enabled: true });
    },
    effect: function (hex) {
      return new Group("ADBE Fill", [new Property("ADBE Fill-0002", PropertyValueType.COLOR, G.mk.color(hex))], { indexed: true });
    },
    textLayer: function (name, doc, opts) {
      opts = opts || {};
      var prop = new Property("ADBE Text Document", PropertyValueType.TEXT_DOCUMENT, doc, { keys: opts.keys });
      return new Layer(name, [
        new Group("ADBE Text Properties", [prop, new Group("ADBE Text Animators", [], { indexed: true })]),
        new Group("ADBE Effect Parade", [], { indexed: true }),
        G.mk.noStyles()
      ], opts);
    },
    ch: function (fillHex, strokeHex, sw) {
      var c = { applyFill: !!fillHex, fill: fillHex ? G.mk.color(fillHex).slice(0, 3) : [0, 0, 0], applyStroke: !!strokeHex, stroke: strokeHex ? G.mk.color(strokeHex).slice(0, 3) : [0, 0, 0], strokeWidth: sw === undefined ? (strokeHex ? 2 : 0) : sw };
      return c;
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
