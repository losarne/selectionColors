/*  Selection Colors - host loader. Picks the After Effects, Illustrator or InDesign implementation.
 *  The panel may set SC_EXT_JSX_DIR before evaluating this file (fallback load path). */
(function () {
    var dir = "";
    try { if (typeof SC_EXT_JSX_DIR === "string" && SC_EXT_JSX_DIR) { dir = SC_EXT_JSX_DIR; } } catch (e0) {}
    if (!dir) { try { dir = File($.fileName).parent.fsName; } catch (e1) { dir = ""; } }
    var name = "";
    try { name = BridgeTalk.appName; } catch (e2) { name = ""; }
    var impl = (name === "illustrator") ? "ai.jsx" : (name === "indesign" ? "id.jsx" : "ae.jsx");
    // Auto-run by the manifest's ScriptPath on every panel launch, outside any caller's
    // try/catch: an uncaught error here can leave the ExtendScript engine unable to run
    // anything at all for the rest of the session, so every step below is guarded.
    try { $.evalFile(File(dir + "/common.jsx")); } catch (e3) {}
    try { $.evalFile(File(dir + "/" + impl)); } catch (e4) {}
})();
