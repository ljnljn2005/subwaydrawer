const fs = require("fs");
const f = "D:/Coding/subwaydrawer/scratch/apply_69.js";
let s = fs.readFileSync(f, "utf8");

const a = '      case "-": map.zoomOut(); viewByUser(); break;';
const b = '      case "-": viewByUser(); map.zoomOut(); break;';
if (s.split(a).length - 1 !== 1) throw new Error("anchor1 hits=" + (s.split(a).length - 1));
s = s.split(a).join(b);

const c = [
  "        /* 4) 门槛按像素判，不随缩放级漂移：0.3 像素的取整抖动不算移动，3 像素的平移算 */",
  "        P.center = savedCenter.slice(); P.zoom = savedZoom;",
  "        const pt0 = map.project(savedCenter, savedZoom);",
  "        map.setView(map.unproject(L.point(pt0.x + 0.3, pt0.y), savedZoom), savedZoom, { animate: false });",
  "        if (viewWorthCommitting()) bad.push(\"0.3 像素的取整抖动被判成'移动了'（换窗口尺寸会漂存档）\");",
  "        map.setView(map.unproject(L.point(pt0.x + 3, pt0.y), savedZoom), savedZoom, { animate: false });",
  "        if (!viewWorthCommitting()) bad.push(\"3 像素的真实平移被判成'没动'（负对照失败）\");",
].join("\n");

const startMarker = "        /* 4) 亚像素抖动不算移动";
const endMarker = "像素门槛失效\");";
const i = s.indexOf(startMarker);
const j = s.indexOf(endMarker);
if (i < 0 || j < 0 || j < i) throw new Error("anchor2 i=" + i + " j=" + j);
s = s.slice(0, i) + c + s.slice(j + endMarker.length);
fs.writeFileSync(f, s);
console.log("patched bytes=" + s.length + " hasOld=" + (s.indexOf(startMarker) >= 0));
