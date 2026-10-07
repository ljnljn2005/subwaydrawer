"use strict";
const fs = require("node:fs"), path = require("node:path");
const app = path.join(__dirname, "..", "index.html");
let src = fs.readFileSync(app, "utf8");
function replaceBlock(file, begin, end) {
  const source = fs.readFileSync(path.join(__dirname, file), "utf8");
  const a = source.indexOf(begin), b = source.indexOf(end, a);
  const x = src.indexOf(begin), y = src.indexOf(end, x);
  if (a < 0 || b < a || x < 0 || y < x || src.indexOf(begin, x + 1) >= 0) throw new Error("marker mismatch " + begin);
  src = src.slice(0, x) + source.slice(a, b + end.length).replace(/\r\n/g, "\n") + src.slice(y + end.length);
}
replaceBlock("nav-plan.js", "// BEGIN NAV PLAN", "// END NAV PLAN");
replaceBlock("navigation-ui.js", "// BEGIN NAV PLAYBACK", "// END NAV PLAYBACK");
replaceBlock("navigation-ui.js", "// BEGIN NAV UI", "// END NAV UI");
replaceBlock("navigation-tests.js", "// BEGIN NAVIGATION TESTS", "// END NAVIGATION TESTS");
function replaceOnce(a, b) { if (src.split(a).length !== 2) throw new Error("anchor mismatch " + a); src = src.replace(a, () => b); }
if (!src.includes('t.tagName === "SELECT" || t.isContentEditable')) {
  replaceOnce('t.tagName === "TEXTAREA" || t.isContentEditable', 't.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable');
  replaceOnce('      if (e.key === "Escape") t.blur();', '      if (e.key === "Escape") { if (nav && $("#navCard").contains(t)) navClose(); else t.blur(); }');
}
const renderStart = src.indexOf('function renderMap() {'), renderEnd = src.indexOf('function renderAll()', renderStart);
const render = src.slice(renderStart, renderEnd);
if (!render.includes('navRefreshGeometry();')) {
  if (render.split('  renderLinkPreview();').length !== 2) throw new Error("render anchor mismatch");
  src = src.slice(0, renderStart) + render.replace('  renderLinkPreview();', () => '  renderLinkPreview();\n  navRefreshGeometry();') + src.slice(renderEnd);
}
new (require("node:vm").Script)([...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter(Boolean).at(-1));
fs.writeFileSync(app, src, "utf8"); console.log("Navigation sources refreshed");
