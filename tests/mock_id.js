// Minimal mock of the InDesign scripting DOM. Swatches are references; textStyleRanges is a LIVE
// collection whose runs re-merge after every edit (like InDesign).
(function (G) {
  G.ColorModel = { PROCESS: "PROCESS", SPOT: "SPOT", REGISTRATION: "REGISTRATION" };
  G.ColorSpace = { RGB: "RGB", CMYK: "CMYK", LAB: "LAB" };
  G.UndoModes = { ENTIRE_SCRIPT: "ENTIRE_SCRIPT" };
  G.ScriptLanguage = { JAVASCRIPT: "JAVASCRIPT" };
  G.BridgeTalk = { appName: "indesign" };
  var nextId = 100, DOC = null;

  function Swatch(name) { this.id = nextId++; this.name = name; this.isValid = true; }          // "None"
  function Color(p) {
    this.id = nextId++; this.isValid = true; this._name = p.name || "";
    this.model = p.model || G.ColorModel.PROCESS; this._space = p.space; this.colorValue = p.colorValue.slice();
  }
  Object.defineProperty(Color.prototype, "name", {
    get: function () { return this._name; },
    set: function (n) {
      var self = this;
      if (DOC && DOC.colors.some(function (c) { return c !== self && c._name === n; })) { throw new Error("The name \"" + n + "\" is already in use"); }
      this._name = n;
    }
  });
  Object.defineProperty(Color.prototype, "space", {
    get: function () { return this._space; },
    set: function (sp) {
      if (sp === this._space) { return; }
      if (this._space === "RGB" && sp === "CMYK") {   // pretend colour management: non-integer output
        var r = this.colorValue[0] / 255, g = this.colorValue[1] / 255, b = this.colorValue[2] / 255, k = 1 - Math.max(r, g, b);
        this.colorValue = k >= 1 ? [0, 0, 0, 100] : [(1 - r - k) / (1 - k) * 100 + 0.3, (1 - g - k) / (1 - k) * 100, (1 - b - k) / (1 - k) * 100, k * 100];
      } else { throw new Error("conversion not mocked"); }
      this._space = sp;
    }
  });
  Color.prototype.remove = function () {
    this.isValid = false;
    var i = DOC.colors.indexOf(this); if (i >= 0) { DOC.colors.splice(i, 1); }
  };
  function Tint(base, v) { this.id = nextId++; this.isValid = true; this.baseColor = base; this.tintValue = v; this.name = base.name + " " + v + "%"; }
  function Gradient(colors) { this.id = nextId++; this.isValid = true; this.name = "Grad"; this.gradientStops = colors.map(function (c) { return { stopColor: c }; }); }
  G.Swatch = Swatch; G.Color = Color; G.Tint = Tint; G.Gradient = Gradient;

  function paintProps(o, opts) {
    o.id = nextId++; o.isValid = true; o.locked = false;
    var f = opts.fill || DOC.none, s = opts.stroke || DOC.none;
    var ft = opts.fillTint === undefined ? -1 : opts.fillTint, st = opts.strokeTint === undefined ? -1 : opts.strokeTint;
    o.strokeWeight = opts.strokeWeight === undefined ? (opts.stroke ? 1 : 0) : opts.strokeWeight;
    function guard() { if (o.locked) { throw new Error("Cannot modify a locked object"); } }
    Object.defineProperty(o, "fillColor", { configurable: true, get: function () { return f; }, set: function (v) { guard(); f = v; } });
    Object.defineProperty(o, "strokeColor", { configurable: true, get: function () { return s; }, set: function (v) { guard(); s = v; } });
    Object.defineProperty(o, "fillTint", { configurable: true, get: function () { return ft; }, set: function (v) { guard(); ft = v; } });
    Object.defineProperty(o, "strokeTint", { configurable: true, get: function () { return st; }, set: function (v) { guard(); st = v; } });
  }
  function Rectangle(o) { paintProps(this, o || {}); }
  function Oval(o) { paintProps(this, o || {}); }
  function GraphicLine(o) { paintProps(this, o || {}); }
  function Image() { this.id = nextId++; this.isValid = true; }
  function Group(items) { this.id = nextId++; this.isValid = true; this.locked = false; this.pageItems = items; }

  // ---- text
  function sameAttrs(a, b) {
    return a.fill === b.fill && a.fillTint === b.fillTint && a.stroke === b.stroke && a.strokeTint === b.strokeTint && a.strokeWeight === b.strokeWeight;
  }
  function Story(chars) { this.chars = chars; }   // chars: [{fill, fillTint, stroke, strokeTint, strokeWeight}]
  function TextStyleRange(story, a, b, owner) {
    this._s = story; this._a = a; this._b = b; this._owner = owner; this.isValid = true;
    var self = this;
    function def(name, key) {
      Object.defineProperty(self, name, {
        get: function () { return story.chars[a][key]; },
        set: function (v) {
          if (owner && owner.locked) { throw new Error("Cannot modify a locked object"); }
          for (var i = a; i < b; i++) { story.chars[i][key] = v; }
          story.edits = (story.edits || 0) + 1;
        }
      });
    }
    def("fillColor", "fill"); def("fillTint", "fillTint"); def("strokeColor", "stroke"); def("strokeTint", "strokeTint");
    def("strokeWeight", "strokeWeight");
  }
  function liveRuns(story, a, b, owner) {
    function compute() {
      var runs = [], start = a;
      for (var i = a + 1; i <= b; i++) {
        if (i === b || !sameAttrs(story.chars[i], story.chars[i - 1])) { runs.push(new TextStyleRange(story, start, i, owner)); start = i; }
      }
      return runs;
    }
    return new Proxy({}, {
      get: function (t, p) {
        if (p === "length") { return compute().length; }
        if (typeof p === "string" && /^\d+$/.test(p)) { return compute()[+p]; }
        return undefined;
      }
    });
  }
  function Text(story, a, b, owner) {
    this.isValid = true; this.index = a; this.characters = { length: b - a }; this.contents = "x".repeat(b - a);
    var self = this;
    Object.defineProperty(this, "textStyleRanges", { get: function () { return liveRuns(story, a, b, owner || self._owner); } });
  }
  function Character(story, a, b) { Text.call(this, story, a, b); }
  function InsertionPoint() { this.isValid = true; this.index = 3; this.characters = { length: 0 }; }
  function TextFrame(story, a, b, o) {
    paintProps(this, o || {});
    this.texts = [new Text(story, a, b, this)];
  }
  function StoryObj(story) { Text.call(this, story, 0, story.chars.length); }
  G.Rectangle = Rectangle; G.Oval = Oval; G.GraphicLine = GraphicLine; G.Image = Image; G.Group = Group;
  G.Story = Story; G.TextFrame = TextFrame; G.Text = Text; G.Character = Character; G.InsertionPoint = InsertionPoint;
  G.StoryObj = StoryObj;

  G.app = {
    documents: [], activeDocument: null, selection: [], undo: [],
    doScript: function (fn, lang, args, mode, name) {
      if (typeof fn !== "function" || lang !== "JAVASCRIPT" || mode !== "ENTIRE_SCRIPT") { throw new Error("bad doScript call"); }
      this.undo.push(name); fn();
    }
  };

  G.mkid = {
    doc: function () {
      var d = { name: "Doc.indd", colors: [], stories: [], allPageItems: [] };
      d.colors.add = function (p) { var c = new Color(p); d.colors.push(c); if (p.name) { c.name = p.name; } return c; };
      d.colors.itemByID = function (id) {
        for (var i = 0; i < d.colors.length; i++) { if (d.colors[i].id === id) { return d.colors[i]; } }
        return { isValid: false };
      };
      DOC = d;
      d.none = new Swatch("None");
      G.app.documents = [d]; G.app.activeDocument = d; G.app.selection = [];
      return d;
    },
    rgb: function (name, hex) {
      return DOC.colors.add({ name: name, model: G.ColorModel.PROCESS, space: "RGB",
        colorValue: [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)] });
    },
    cmyk: function (name, v, model) { return DOC.colors.add({ name: name, model: model || G.ColorModel.PROCESS, space: "CMYK", colorValue: v }); },
    ch: function (fill, opts) {
      opts = opts || {};
      return { fill: fill, fillTint: opts.fillTint === undefined ? -1 : opts.fillTint, stroke: opts.stroke || DOC.none,
        strokeTint: -1, strokeWeight: opts.stroke ? 1 : 0 };
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
