// Minimal mock of the Illustrator scripting DOM (colours are value objects, like in AI).
(function (G) {
  G.DocumentColorSpace = { RGB: 1, CMYK: 2 };
  G.ImageColorSpace = { GrayScale: 1, RGB: 2, CMYK: 3, LAB: 4 };
  G.ColorConvertPurpose = { defaultpurpose: 1 };
  G.BridgeTalk = { appName: "illustrator" };

  function RGBColor() { this.typename = "RGBColor"; this.red = 0; this.green = 0; this.blue = 0; }
  function CMYKColor() { this.typename = "CMYKColor"; this.cyan = 0; this.magenta = 0; this.yellow = 0; this.black = 0; }
  function GrayColor() { this.typename = "GrayColor"; this.gray = 0; }
  function NoColor() { this.typename = "NoColor"; }
  function SpotColor() { this.typename = "SpotColor"; this.spot = null; this.tint = 100; }
  function GradientColor() { this.typename = "GradientColor"; this.gradient = null; }
  function clone(c) {
    if (!c) { return c; }
    var o = new c.constructor();
    for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) { o[k] = c[k]; } }  // spot / gradient stay references
    return o;
  }
  G.RGBColor = RGBColor; G.CMYKColor = CMYKColor; G.GrayColor = GrayColor; G.NoColor = NoColor;
  G.SpotColor = SpotColor; G.GradientColor = GradientColor;

  function paintable(obj) {
    obj._fill = new NoColor(); obj._stroke = new NoColor(); obj.filled = false; obj.stroked = false; obj.locked = false;
    Object.defineProperty(obj, "fillColor", { configurable: true,
      get: function () { return clone(this._fill); },
      set: function (c) { if (this.locked) { throw new Error("Target layer cannot be modified"); } this._fill = clone(c); this.filled = c.typename !== "NoColor"; }
    });
    Object.defineProperty(obj, "strokeColor", { configurable: true,
      get: function () { return clone(this._stroke); },
      set: function (c) { if (this.locked) { throw new Error("Target layer cannot be modified"); } this._stroke = clone(c); this.stroked = c.typename !== "NoColor"; }
    });
  }
  function PathItem(fill, stroke) {
    this.typename = "PathItem"; paintable(this);
    if (fill) { this.fillColor = fill; }
    if (stroke) { this.strokeColor = stroke; }
    this.left = 0; this.top = 0; this.width = 10; this.height = 10;
  }
  function CompoundPathItem(paths) { this.typename = "CompoundPathItem"; this.pathItems = paths; this.locked = false; this.left = 0; this.top = 0; this.width = 1; this.height = 1; }
  function GroupItem(items) { this.typename = "GroupItem"; this.pageItems = items; this.locked = false; this.left = 0; this.top = 0; this.width = 1; this.height = 1; }
  function Char(fill, stroke, frame) {
    var self = this; this.typename = "TextRange";
    this.characterAttributes = {};
    var f = fill || new NoColor(), s = stroke || new NoColor();
    Object.defineProperty(this.characterAttributes, "fillColor", {
      get: function () { return clone(f); },
      set: function (c) { if (frame.locked) { throw new Error("locked"); } f = clone(c); }
    });
    Object.defineProperty(this.characterAttributes, "strokeColor", {
      get: function () { return clone(s); },
      set: function (c) { if (frame.locked) { throw new Error("locked"); } s = clone(c); }
    });
  }
  function TextFrame(specs) {
    this.typename = "TextFrame"; this.locked = false; this.left = 0; this.top = 0; this.width = 1; this.height = 1;
    var self = this;
    var chars = specs.map(function (sp) { return new Char(sp[0], sp[1], self); });
    this.textRange = { typename: "TextRange", characters: chars, contents: "x" };
  }
  G.PathItem = PathItem; G.CompoundPathItem = CompoundPathItem; G.GroupItem = GroupItem; G.TextFrame = TextFrame;

  G.app = {
    documents: [], activeDocument: null, redraws: 0,
    redraw: function () { this.redraws++; },
    convertSampleColor: function (src, a, dst) {
      if (src === dst) { return a.slice(); }
      if (src === G.ImageColorSpace.CMYK && dst === G.ImageColorSpace.RGB) {
        return [255 * (1 - a[0] / 100) * (1 - a[3] / 100), 255 * (1 - a[1] / 100) * (1 - a[3] / 100), 255 * (1 - a[2] / 100) * (1 - a[3] / 100)];
      }
      if (src === G.ImageColorSpace.RGB && dst === G.ImageColorSpace.CMYK) {
        var r = a[0] / 255, g = a[1] / 255, b = a[2] / 255, k = 1 - Math.max(r, g, b);
        if (k >= 1) { return [0, 0, 0, 100]; }
        return [(1 - r - k) / (1 - k) * 100, (1 - g - k) / (1 - k) * 100, (1 - b - k) / (1 - k) * 100, k * 100];
      }
      throw new Error("conversion not mocked");
    }
  };

  G.mkai = {
    rgb: function (hex) { var c = new RGBColor(); c.red = parseInt(hex.substr(0, 2), 16); c.green = parseInt(hex.substr(2, 2), 16); c.blue = parseInt(hex.substr(4, 2), 16); return c; },
    cmyk: function (c_, m, y, k) { var c = new CMYKColor(); c.cyan = c_; c.magenta = m; c.yellow = y; c.black = k; return c; },
    gray: function (g) { var c = new GrayColor(); c.gray = g; return c; },
    spot: function (name, base, tint) { var c = new SpotColor(); c.spot = { name: name, color: base }; c.tint = tint === undefined ? 100 : tint; return c; },
    gradient: function (name, colors) {
      var c = new GradientColor(); c.gradient = { name: name, gradientStops: colors.map(function (x) { return { color: x }; }) }; return c;
    },
    doc: function (opts) {
      opts = opts || {};
      var d = {
        name: opts.name || "Untitled-1",
        documentColorSpace: opts.cmyk ? G.DocumentColorSpace.CMYK : G.DocumentColorSpace.RGB,
        selection: opts.selection || [],
        layers: opts.layers || []
      };
      G.app.documents = [d]; G.app.activeDocument = d;
      return d;
    },
    layer: function (items, sub) { return { pageItems: items, layers: sub || [] }; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
