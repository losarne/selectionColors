// Selection Colors — macOS eyedropper (JavaScript for Automation, run with: osascript -l JavaScript)
// Shows the system colour sampler (magnifier loupe) and prints one line on stdout:
//   P RRGGBB = picked | C = cancelled | E message = error
ObjC.import("AppKit");

function hex2(v) {
  var n = Math.max(0, Math.min(255, Math.round(v * 255)));
  return (n < 16 ? "0" : "") + n.toString(16).toUpperCase();
}

function run() {
  try {
    if (typeof $.NSColorSampler === "undefined") { return "E macOS 10.15 or newer is needed for the eyedropper"; }

    var app = $.NSApplication.sharedApplication;
    try { app.setActivationPolicy(1); } catch (e0) {}   // accessory: no Dock icon

    var done = false, out = "C";
    var sampler = $.NSColorSampler.alloc.init;
    sampler.showSamplerWithSelectionHandler(function (color) {
      try {
        if (color && !(color.isNil && color.isNil())) {
          var c = color.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
          if (c && !(c.isNil && c.isNil())) {
            out = "P " + hex2(c.redComponent) + hex2(c.greenComponent) + hex2(c.blueComponent);
          }
        }
      } catch (e1) {
        out = "E " + e1;
      }
      done = true;
    });

    // The handler arrives on the main thread: keep the run loop turning until it does.
    var loop = $.NSRunLoop.currentRunLoop;
    while (!done) {
      loop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.05));
    }
    return out;
  } catch (e) {
    return "E " + e;
  }
}
