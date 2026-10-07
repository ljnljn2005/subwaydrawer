/* scratch/apply_68c.js —— 给底图套合加一道用户开关（默认开）。
   为什么必须有：老档可能是在"没有套合"的时候对着高德点的 —— 那存进去的数值本身就是
   GCJ 位置。这时再自动把瓦片挪过来，等于把这些档推离路网 2δ。所以套合必须可关，
   并且设置里要说清楚"你的坐标到底是哪种坐标系"。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const A = [];

/* 1) 默认值 */
A.push(["default", 1,
`  stack: true, snap: true, predict: true, cullLabels: true, showBadges: true, pngScale: 2`,
`  stack: true, snap: true, predict: true, cullLabels: true, showBadges: true, pngScale: 2, datumFit: true`]);

/* 2) 判据读开关 */
A.push(["gate", 1,
`function datumBasemapOn() {
  const b = bmById(settings.basemap);
  return !!(b && b.gcj);
}`,
`function datumBasemapOn() {
  if (settings.datumFit === false) return false;
  const b = bmById(settings.basemap);
  return !!(b && b.gcj);
}`]);

/* 3) 设置面板：紧跟在"缩放太小隐藏站名"那条后面加一行 */
A.push(["ui", 1,
`缩放太小放不下时隐藏普通站名（换乘站铭牌始终保留，宁可盖住线）</label>" +`,
`缩放太小放不下时隐藏普通站名（换乘站铭牌始终保留，宁可盖住线）</label>" +
    '<label class="chk" style="--c:var(--signal)"><input type="checkbox" id="setDatum"' + (settings.datumFit !== false ? " checked" : "") + ">自动套合 GCJ-02 底图（把路网挪到站点这边；若你是早年在高德上照着路点的站，关掉更准）</label>" +`]);

/* 4) 读回开关 */
A.push(["read", 1,
`        settings.cullLabels = $("#setCull", s).checked;`,
`        settings.cullLabels = $("#setCull", s).checked;
        settings.datumFit = $("#setDatum", s).checked;`]);

/* 5) 提示文案改成指向这个开关 */
A.push(["toast", 1,
`已自动把底图整体平移对齐你的站点（形状与相互关系不受影响，站点坐标仍是 WGS-84）；不想套合可改用天地图 / OSM / Carto，或在设置里关掉。`,
`已自动把底图整体平移对齐你的站点（形状与相互关系不受影响，站点坐标仍是 WGS-84）；若这份图是早年在高德上照着路点的，请在设置里关掉"自动套合"。`]);

/* 6) 断言补两格真值表：开关关掉 ⇒ 境内底图也必须不平移、不多取瓦片 */
A.push(["case", 1,
`        /* 6) 负对照乙：把 gcj 标记摘掉，套合必须整条失效 —— 证明判据真的读那个标记，
              而不是"永远在平移"。摘完必须还原。 */`,
`        /* 5b) 负对照：用户开关关掉 ⇒ 即便是境内底图也必须一点不平移、不多取瓦片
              （老档是照着高德点的，套合反而把它们推离路网 2δ，所以这条必须有）。 */
        const savedFit = settings.datumFit;
        try {
          settings.datumFit = false; settings.basemap = "amap"; applyBasemap();
          const s5 = datumPixelShift();
          if (s5.x !== 0 || s5.y !== 0) bad.push("关了自动套合还在平移：" + s5.x + "," + s5.y);
          if ((map.getPane("tilePane").style.transform || "") !== "") bad.push("关了自动套合却没清掉 transform");
          const raw5 = L.TileLayer.prototype._getTiledPixelBounds.call(tileLayer, map.getCenter());
          if (tileLayer._getTiledPixelBounds(map.getCenter()).max.x !== raw5.max.x) bad.push("关了自动套合还在多取瓦片");
        } finally { settings.datumFit = savedFit; settings.basemap = "amap"; applyBasemap(); }
        /* 6) 负对照乙：把 gcj 标记摘掉，套合必须整条失效 —— 证明判据真的读那个标记，
              而不是"永远在平移"。摘完必须还原。 */`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const Q = String.fromCharCode(34), BSL = String.fromCharCode(92);
const cnt = (hay, s) => hay.split(s).length - 1;
const checks = [
  ["setDatum 出现数（id + 读回）", cnt(out, "setDatum"), 2],
  ["datumFit 出现数", cnt(out, "datumFit"), 7],
  ["新增反转义引号", cnt(out, BSL + Q) - cnt(src, BSL + Q), 0]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
