/*  Selection Colors - host loader. Picks the After Effects, Illustrator or InDesign implementation.
 *  The panel may set SC_EXT_JSX_DIR before evaluating this file (fallback load path). */
(function () {
    var dir = "";
    try { if (typeof SC_EXT_JSX_DIR === "string" && SC_EXT_JSX_DIR) { dir = SC_EXT_JSX_DIR; } } catch (e0) {}
    if (!dir) { try { dir = File($.fileName).parent.fsName; } catch (e1) { dir = ""; } }
    var name = "";
    try { name = BridgeTalk.appName; } catch (e2) { name = ""; }
    var impl = (name === "illustrator") ? "ai.jsx" : (name === "indesign" ? "id.jsx" : "ae.jsx");
    $.evalFile(File(dir + "/common.jsx"));
    $.evalFile(File(dir + "/" + impl));
})();
