"use strict";
const fs = require("node:fs");
const appPath = require("node:path").join(__dirname, "..", "index.html");
let src = fs.readFileSync(appPath, "utf8");
function replace(anchor, replacement) {
  if (src.split(anchor).length !== 2) throw new Error("Unique anchor mismatch: " + anchor.slice(0, 110));
  src = src.replace(anchor, () => replacement);
}
const extract = (file, begin, end) => {
  const s = fs.readFileSync(require("node:path").join(__dirname, file), "utf8");
  const a = s.indexOf(begin), b = s.indexOf(end, a);
  if (a < 0 || b < a) throw new Error("Source markers missing");
  return s.slice(a, b + end.length);
};
replace('      <button class="tool tool--icon" id="tNewLine"',
  '      <button class="tool" id="tNavigate" title="选择起点终点，模拟乘车导航（快捷键 R）"><svg viewBox="0 0 24 24"><path d="M5 18V8a4 4 0 014-4h6a4 4 0 014 4v10H5zM8 8h8M8 12h8M7 21l2-3M17 21l-2-3"/></svg><span>导航</span></button>\n      <button class="tool tool--icon" id="tNewLine"');
replace('      <div id="map"></div>', '      <div id="map"></div>\n      <section id="navCard" aria-label="模拟导航" hidden></section>');
replace('/* 注意：不要给 .leaflet-pane 统一设 z-index:auto', `#navCard[hidden]{display:none}
#navCard{position:absolute;left:12px;bottom:12px;z-index:800;width:340px;max-width:calc(100% - 24px);max-height:calc(100% - 66px);overflow:auto;
  padding:12px;background:rgba(16,20,26,.97);border:1px solid #394351;border-radius:9px;box-shadow:0 8px 28px #0007;color:var(--text);font-size:12px}
.nav-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;font-size:14px}
.nav-head .x{font-size:14px;padding:4px;color:var(--text-mid)}
.nav-fields{display:grid;grid-template-columns:42px minmax(0,1fr) 28px;gap:7px;align-items:center}
.nav-fields label{color:var(--text-mid);font-size:11px}
.nav-fields label[for=navTo]{grid-column:1}
.nav-fields #navSwap{grid-column:3;grid-row:1 / span 2;height:100%;padding:0;min-width:0}
#navCard select{min-width:0;max-width:100%;height:29px;border:1px solid var(--rule);border-radius:3px;background:var(--ink-600);color:var(--text);font-size:12px;padding:0 5px}
.nav-options{display:flex;gap:12px;margin:9px 0;color:var(--text-mid);flex-wrap:wrap}
.nav-options label{display:flex;gap:5px;align-items:center}
.nav-summary{color:#FFCD84;line-height:1.5}
.nav-itinerary{max-height:94px;overflow:auto;margin:7px 0}
.nav-trip{display:flex;gap:7px;line-height:1.6;color:var(--text-mid);padding:3px 0}
.nav-trip i{width:4px;min-height:31px;flex:none;border-radius:3px}
.nav-trip span{min-width:0;overflow-wrap:anywhere}.nav-trip b{color:var(--text);font-weight:600}
.nav-live{min-height:20px;line-height:1.6;color:var(--text);overflow-wrap:anywhere}
.nav-live[data-state=finished]{color:var(--live)}
#navProgress{width:100%;height:5px;display:block;margin:7px 0 10px;accent-color:var(--signal)}
.nav-controls{display:flex;gap:6px;flex-wrap:wrap}.nav-controls .btn{min-width:0;padding:6px 10px;height:30px;font-size:12px}
.nav-controls button:disabled{opacity:.4;cursor:default}
.nav-toggles{display:flex;gap:13px;margin:10px 0 7px;flex-wrap:wrap;color:var(--text-mid)}
.nav-toggles label{display:flex;gap:4px;align-items:center}.nav-toggles input{accent-color:var(--signal)}
.nav-note{display:block;font-size:10px;line-height:1.5;color:var(--text-dim)}
.nav-train-wrap{background:none!important;border:0!important}
.nav-train{width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:#FFCA67;color:#15202C;
  border:2px solid #FFF;border-radius:7px;box-shadow:0 2px 8px #000a;font-size:16px;line-height:1}
/* 注意：不要给 .leaflet-pane 统一设 z-index:auto`);
const plan = extract("nav-plan.js", "// BEGIN NAV PLAN", "// END NAV PLAN");
const playback = extract("navigation-ui.js", "// BEGIN NAV PLAYBACK", "// END NAV PLAYBACK");
const ui = extract("navigation-ui.js", "// BEGIN NAV UI", "// END NAV UI");
replace('/* ============================================================\n   9. 地图渲染', plan + '\n\n' + playback + '\n\n' + ui + '\n\n/* ============================================================\n   9. 地图渲染');
replace('  map.on("click", onMapClick);', '  navBindMap();\n  map.on("click", onMapClick);');
replace('function viewCommitAllowed() { return !inSelfTest && performance.now() >= viewLockUntil; }',
  'function viewCommitAllowed() { return !inSelfTest && !navProgrammaticView && performance.now() >= viewLockUntil; }');
['pushHistory()', 'openProject(id)', 'createProject(name, asTemplate)', 'restore(json)', 'setInsert(lineId, index)'].forEach((name) => {
  replace('function ' + name + ' {', 'function ' + name + ' {\n  navClose();');
});
replace('function setTool(t) {', 'function setTool(t) {\n  if (t !== "select") navClose();');
replace('      case "g": openDiagram(); break;', '      case "g": openDiagram(); break;\n      case "r": openNavigation(); break;');
replace('      case "escape": linkReset();', '      case "escape": navClose(); linkReset();');
replace('  $("#tDiagram").addEventListener("click", openDiagram);', '  $("#tDiagram").addEventListener("click", openDiagram);\n  $("#tNavigate").addEventListener("click", openNavigation);');
replace('  ["Del", "删除选中的车站；未选车站时删除选中线路", "键"],',
  '  ["R", "模拟导航：选择出发站和到达站，规划换乘并沿线路模拟乘车，可暂停、继续、重来", "键"],\n  ["Del", "删除选中的车站；未选车站时删除选中线路", "键"],');
replace('  const savedLink = { chain: linkChain.slice(),', '  const savedNav = navSuspend();\n  const savedLink = { chain: linkChain.slice(),');
replace('    linkReset();\n    P = savedP; sel = savedSel; settings = JSON.parse(savedSettings);',
  '    navClose(); linkReset();\n    P = savedP; sel = savedSel; settings = JSON.parse(savedSettings);');
replace('    fillProjSelect();\n    /* 自检里的写失败演练', '    fillProjSelect();\n    navRestore(savedNav);\n    /* 自检里的写失败演练');
replace('dg = spy("openDiagram"), hp = spy("openHelp"), fa = spy("fitAll");', 'dg = spy("openDiagram"), hp = spy("openHelp"), fa = spy("fitAll"), nr = spy("openNavigation");');
replace('          "Del": () => { const sid', '          "R": () => { const b = nr(); press({ key: "r" }); return nr() === b + 1; },\n          "Del": () => { const sid');
replace('"N": \'"n"\', "G": \'"g"\', "Del":', '"N": \'"n"\', "G": \'"g"\', "R": \'"r"\', "Del":');
const tests = extract("navigation-tests.js", "// BEGIN NAVIGATION TESTS", "// END NAVIGATION TESTS");
replace('    t("弯道坐标往返（像素↔弦相对）",', tests + '\n\n    t("弯道坐标往返（像素↔弦相对）",');
// Check the complete inline script before writing any file.
const script = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter(Boolean).at(-1);
new (require("node:vm").Script)(script);
fs.writeFileSync(appPath, src, "utf8");
console.log("Navigation integrated");
