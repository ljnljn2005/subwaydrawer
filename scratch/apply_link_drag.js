/* 锚点受控的连线交互更新；每个集成口子必须唯一命中。 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "index.html");
const original = fs.readFileSync(file, "utf8");
const crlf = original.includes("\r\n");
let src = original.replace(/\r\n/g, "\n");
function swap(a, b) {
  const count = src.split(a).length - 1;
  if (count !== 1) throw new Error("Anchor count " + count + ": " + a.slice(0, 90));
  src = src.replace(a, () => b);
}
const drag = fs.readFileSync(path.join(__dirname, "link-drag.js"), "utf8").trim();
const planner = fs.readFileSync(path.join(__dirname, "link-plan.js"), "utf8");
const plan = planner.split("// BEGIN LINK PLAN")[1].split("// END LINK PLAN")[0].trim();
const start = src.lastIndexOf("/* ============================================================", src.indexOf("   13.2 连线："));
const end = src.indexOf("/* 把 A>B 那一段", start);
if (start < 0 || end < start) throw new Error("Missing link block");
src = src.slice(0, start) + "/* ============================================================\n   13.2 连线：先布置站点，再从车站圆点拖线连接\n   ============================================================ */\n" + plan + "\n" + drag + "\n" + src.slice(end);
const previewStart = src.indexOf("function renderLinkPreview()", src.indexOf("function spliceIntoLine"));
const previewEnd = src.indexOf("function addStationAt", previewStart);
if (previewStart < 0 || previewEnd < previewStart) throw new Error("Missing old preview");
src = src.slice(0, previewStart) + src.slice(previewEnd);
swap('.pin--staged{border-style:dashed}', '.pin--staged{border-style:dashed}\n.pin--free{border-style:dashed;border-color:#718096;background:#E7EDF5}\n#map.is-link-connect .pin-wrap{cursor:crosshair;touch-action:none}');
swap('#linkCard .tool[disabled]{opacity:.45}', '#linkCard .tool[disabled]{opacity:.45}\n#linkCard .lk-steps{display:flex;gap:6px;flex:0 0 100%}\n#linkCard .lk-reason{flex:1 1 100%;color:#FFCF82;line-height:1.5}');
swap('连线：先把站点定在地图上、再按点击顺序串成线路（快捷键 C）', '连线：先布置车站，再从圆点拖线接到另一站（快捷键 C）');
swap('  P = p;\n  try { lastBytes', '  linkReset();\n  P = p;\n  try { lastBytes');
swap('  P = p; hist = []; future = []; sel = { line: null, station: null };', '  linkReset();\n  P = p; hist = []; future = []; sel = { line: null, station: null };');
swap('  const d = JSON.parse(json);\n  P.lines = d.lines;', '  const d = JSON.parse(json);\n  linkReset();\n  P.lines = d.lines;');
swap('function undo() { if (!hist.length) return;', 'function undo() { if (tool === "link" && (linkDrag || linkChain.length)) { linkUndoStep(); return; } if (!hist.length) return;');
swap('  $("#tUndo").disabled = !hist.length;', '  const draft = tool === "link" && !!(linkDrag || linkChain.length);\n  $("#tUndo").disabled = !hist.length && !draft;');
swap('  $("#tUndo").title = "撤销（Ctrl+Z）" +', '  $("#tUndo").title = draft ? "撤回一步连接（Ctrl+Z）" : "撤销（Ctrl+Z）" +');
swap('    if (!e) return;\n    const ls = e.ls;', '    if (!e) {\n      if (!st.lines.length) vis.push({ st, c: "#8892A0", xfer: false, term: false, staged: false, free: true, size: 14, px: pr(st) });\n      return;\n    }\n    const ls = e.ls;');
swap('    (v.xfer && st.outTransfer ? " pin--out" : "") + (sel.station', '    (v.xfer && st.outTransfer ? " pin--out" : "") + (v.free ? " pin--free" : "") + (sel.station');
swap('  mk.on("click", (e) => { L.DomEvent.stopPropagation(e); if (tool === "link") { linkPush(id); return; } selectStation(id); });',
  '  bindLinkPointer(mk, id);\n  mk.on("click", (e) => { L.DomEvent.stopPropagation(e);\n    if (tool === "link" && (linkMode === "connect" || performance.now() < linkSuppressClickUntil)) return;\n    selectStation(id);\n  });');
swap('  const draggable = tool === "select";\n  vis.forEach((v)', '  const draggable = tool === "select" || (tool === "link" && linkMode === "place");\n  vis.forEach((v)');
swap('      (v.xfer && st.outTransfer ? 8 : 0) | (sel.station === st.id ? 16 : 0);', '      (v.xfer && st.outTransfer ? 8 : 0) | (sel.station === st.id ? 16 : 0) | (v.free ? 32 : 0);');
swap('  renderLabels(vis);\n}\n\n/* ============================================================\n   10.', '  renderLabels(vis);\n  map.getContainer().classList.toggle("is-link-connect", tool === "link" && linkMode === "connect");\n  renderLinkPreview();\n}\n\n/* ============================================================\n   10.');
swap('function renderAll() { renderMap(); renderPanels(); updateHistoryButtons(); }', 'function renderAll() { renderMap(); renderPanels(); renderLinkBar(); updateHistoryButtons(); }');
swap('    link: "连线模式：点地图落新站、点已有站复用（会成换乘站）；再点一次链尾那个站是撤回这一步"',
  '    link: linkMode === "place" ? "布置车站：点空白处放站，拖动圆点改位置；准备好后点「拖线连接」" : "拖线连接：从车站圆点按住拖到另一站，松开吸附；连接确认后保存，Ctrl+Z 撤一步"');
swap('  $("#modeText").textContent = tool === "add" ? (pendingInsert ? "插入车站" : "加站模式") : "选择 / 编辑";',
  '  $("#modeText").textContent = tool === "add" ? (pendingInsert ? "插入车站" : "加站模式") : tool === "link" ? (linkMode === "place" ? "布置车站" : "拖线连接") : "选择 / 编辑";');
swap('    if (!st.lines.length) delete P.stations[id];', '    if (!st.lines.length && !st.placed) delete P.stations[id];');
swap('  if (t !== tool) linkReset();\n  tool = t;', '  if (t !== tool) { linkReset(); if (t === "link") linkMode = "place"; }\n  tool = t;');
swap('  renderMap(); renderStatus();\n}\nfunction setInsert', '  renderMap(); renderLinkBar(); renderStatus(); updateHistoryButtons();\n}\nfunction setInsert');
swap('function setInsert(lineId, index) {\n  pendingInsert', 'function setInsert(lineId, index) {\n  linkReset();\n  pendingInsert');
swap('["C", "连线：先把站点定在地图上，再按点击顺序把它们串成线路（可并进当前线路或新建一条）；Esc 放弃", "键"]',
  '["C", "连线：先布置车站，再从圆点拖到另一站连接（可并入当前线路或新建）；Ctrl+Z 撤一步，Esc 退出", "键"]');
swap('连线模式：在地图上点站（点已有站会复用成换乘站），再点「并入」或「新建线路」提交；Esc 放弃',
  '连线模式：先布置车站，再切到「拖线连接」，从圆点拖到另一站；确认连接后保存');
swap('连线模式：拆段后的弯道 remap 不丢形状、链能攒能撤、切换工具清空、没攒够不给提交',
  '连线模式：弯道 remap 不丢形状、重复点击不误撤、草稿可撤回、没攒够不给提交');
swap('if (findNearStation(back, null, true) && findNearStation(back, null, true).id !== fid)', 'if (!findNearStation(back, null, true) || findNearStation(back, null, true).id !== fid)');
swap('if (linkChain.length !== 2) bad.push("重复点同一个站被收进了链（一条线不能重复经过）");',
  'if (linkChain.length !== 2) bad.push("不足三站却闭合或重复收站");');
swap('        linkPush(ids[1]);\n        if (linkChain.length !== 1', '        linkPush(ids[1]);\n        if (linkChain.length !== 2) bad.push("重复点链尾误撤了连接");\n        linkUndoStep();\n        if (linkChain.length !== 0');
swap('bad.push("再点链尾没撤回这一步：" + linkChain.join(","));', 'bad.push("撤一步没清掉仅有的一段连接：" + linkChain.join(","));');
swap('if (linkChain.length !== 0 || linkChain[0] !== ids[0])', 'if (linkChain.length !== 0)');
swap('孤儿 key 负对照成立；链可攒可撤、重复站被拒、切工具即清空；两处守卫都没动数据',
  '孤儿 key 负对照成立；重复点击不误撤，撤一步清除最后一段，切工具即清空；两处守卫都没动数据');
swap('  const savedHist = hist.slice(), savedFuture = future.slice();\n  const R = [];',
  '  const savedHist = hist.slice(), savedFuture = future.slice();\n  const savedLink = { chain: linkChain.slice(), closed: linkClosed, mode: linkMode, tool };\n  linkReset();\n  const R = [];');
swap('    P = savedP; sel = savedSel; settings = JSON.parse(savedSettings);\n    hist = savedHist;',
  '    linkReset();\n    P = savedP; sel = savedSel; settings = JSON.parse(savedSettings);\n    tool = savedLink.tool; linkMode = savedLink.mode; linkChain = savedLink.chain; linkClosed = savedLink.closed;\n    $$("#tSelect,#tAdd,#tLink").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === tool));\n    hist = savedHist;');
fs.writeFileSync(file, crlf ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("Applied drag connection workflow with unique anchors.");
