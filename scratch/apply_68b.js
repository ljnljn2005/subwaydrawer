/* scratch/apply_68b.js —— #68 GCJ-02 底图自动套合（修正版：carto-light 才存在的 id、
   提示文案不再用坏掉的 ${px} 拼接、shiftTileLayer 调用点数按 3 计）。
   锚点/计数任何一条不对就一个字节都不写。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const A = [];

A.push(["core", 1,
`function gcjMetersAt(lat, lng) { return metersBetween([lat, lng], wgs2gcj(lat, lng)); }`,
`function gcjMetersAt(lat, lng) { return metersBetween([lat, lng], wgs2gcj(lat, lng)); }
/* ===== GCJ-02 底图自动套合 =====
   境内的高德 / Google 瓦片本身是 GCJ-02 编码的：真实位置 R 的那条路被画在
   layerPoint(R+δ) 上，而我们的图元按 WGS-84 画在 layerPoint(R) ⇒ 看上去错开 δ
   （实测东部 ~408 m）。要套准有两条路：
   - 动图元：得改 55 个换算口子（35 处 latLngToContainerPoint、14 处 containerPointToLatLng、
     4 处 L.marker、若干投影），而且 marker 拖拽是 Leaflet 自己按像素反算 latlng 的 ——
     显示一动，拖完就把 δ 烤进存档，那是数据污染。
   - 动瓦片（这里选的）：给 tilePane 一个常量平移，把"路"挪到图元这边来。
     Leaflet 的坐标数学完全不被触碰：点击、拖拽、存档、导出口径一律不变。
   δ 随纬度缓慢变化，自检里那条"7 km 跨度内极差 <20 m"保证了一屏之内按图中心平移一档就够。 */
function datumBasemapOn() {
  const b = bmById(settings.basemap);
  return !!(b && b.gcj);
}
function datumPixelShift() {
  if (!datumBasemapOn() || typeof map === "undefined" || !map) return { x: 0, y: 0 };
  const c = map.getCenter(), d = gcjDelta(c.lat, c.lng);
  if (!d[0] && !d[1]) return { x: 0, y: 0 };
  const p0 = map.latLngToLayerPoint(c), p1 = map.latLngToLayerPoint([c.lat + d[0], c.lng + d[1]]);
  return { x: p0.x - p1.x, y: p0.y - p1.y };
}
let datumShiftApplied = { x: 0, y: 0 };
function applyDatumShift() {
  const pane = map.getPane("tilePane");
  if (!pane) return;
  const s = datumPixelShift();
  datumShiftApplied = s;
  pane.style.transform = (s.x || s.y) ? "translate3d(" + s.x.toFixed(2) + "px," + s.y.toFixed(2) + "px,0)" : "";
}
/* 平移会在另一侧露出 |shift| 宽的空带 ⇒ 让瓦片多取一圈正好盖住。
   _getTiledPixelBounds 是 GridLayer 专为"取哪些瓦片"留的覆写点（Leaflet 1.x 稳定存在），
   子类覆写不碰任何内部状态；这里实时算 shift，保证与 CSS 用的是同一个值。 */
const ShiftTiles = L.TileLayer.extend({
  _getTiledPixelBounds: function (center) {
    const b = L.TileLayer.prototype._getTiledPixelBounds.call(this, center);
    const s = datumPixelShift();
    const pad = L.point(Math.abs(Math.round(s.x)) + 1, Math.abs(Math.round(s.y)) + 1);
    if (!pad.x && !pad.y) return b;
    return L.bounds(b.min.subtract(pad), b.max.add(pad));
  }
});
const shiftTileLayer = (url, opts) => new ShiftTiles(url, opts);`]);

A.push(["layers", 3, `L.tileLayer(`, `shiftTileLayer(`]);

A.push(["apply-call", 1,
`  if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }`,
`  applyDatumShiftSafe();
  if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }`]);

A.push(["safe-fn", 1,
`function applyBasemap() {`,
`/* 套合失败绝不能连累切图：任何一步抛错都只是"回到不套合的样子"。 */
function applyDatumShiftSafe() { try { applyDatumShift(); } catch (e) { console.warn("[datum] 套合跳过：" + e.message); } }

function applyBasemap() {`]);

A.push(["hooks", 1,
`  map.on("zoomend", () => { $("#sZoom").textContent = map.getZoom(); renderMap(); });`,
`  map.on("zoomend", () => { $("#sZoom").textContent = map.getZoom(); renderMap(); });
  /* 视图停稳后重算一档平移（平移量按图中心取，一屏内极差 <20 m，见上面注释）。
     挂在 moveend 而不是 move：拖动中每帧改 tilePane 的 transform 会让瓦片跟着抖。 */
  map.on("moveend zoomend resize viewreset", applyDatumShiftSafe);`]);

A.push(["toast", 1,
`所以站字会整排压到路外；要套准路网请改用天地图 / OSM / Carto。形状与相互关系不受影响。`,
`已自动把底图整体平移对齐你的站点（形状与相互关系不受影响，站点坐标仍是 WGS-84）；不想套合可改用天地图 / OSM / Carto，或在设置里关掉。`]);

A.push(["case", 1,
`    t("拖拽改站序：弯道只休眠不删除，曲线计数跟着画面，重复访问的站不会动错那一个", () => {`,
`    t("GCJ-02 底图自动套合：瓦片按实测偏移量平移、多取一圈补边，且完全不动坐标数学", () => {
      const bad = [];
      const savedBase = settings.basemap, savedLock = viewLockUntil;
      try {
        /* 1) 幅度独立核对：像素平移必须等于"实测米数 ÷ 该缩放级米/像素"。
              米/像素这里按 Web Mercator 公式另算一遍，不走 latLngToLayerPoint 那条路，
              免得断言变成"自己跟自己比"。 */
        settings.basemap = "amap"; applyBasemap();
        const c = map.getCenter(), z = map.getZoom();
        const s = datumPixelShift();
        const res = 2 * Math.PI * 6378137 * Math.cos(c.lat * Math.PI / 180) / (256 * Math.pow(2, z));
        const wantPx = gcjMetersAt(c.lat, c.lng) / res;
        const got = Math.hypot(s.x, s.y);
        if (!(got > wantPx * 0.94 && got < wantPx * 1.06)) bad.push("平移 " + got.toFixed(1) + "px 与独立算出的 " + wantPx.toFixed(1) + "px 对不上（差 " + ((got / wantPx - 1) * 100).toFixed(1) + "%）");
        if (!(Math.abs(s.x) > 1 || Math.abs(s.y) > 1)) bad.push("境内底图平移几乎为 0，套合没生效");
        /* 2) 接线：tilePane 上必须真的挂着同一条 transform */
        const tf = map.getPane("tilePane").style.transform || "";
        if (tf.indexOf("translate3d") !== 0) bad.push("tilePane 没有平移变换：" + (tf || "（空）"));
        const nums = tf.replace(/[^0-9.,-]+/g, "").split(",").slice(0, 2).map(Number);
        if (Math.abs(nums[0] - s.x) > 0.6 || Math.abs(nums[1] - s.y) > 0.6) bad.push("CSS 里的平移与算出的不是一回事：" + tf);
        /* 3) 补边：子类取的瓦片范围必须严格大于父类的，否则另一侧会露底 */
        const raw = L.TileLayer.prototype._getTiledPixelBounds.call(tileLayer, map.getCenter());
        const wide = tileLayer._getTiledPixelBounds(map.getCenter());
        if (!(wide.max.x - raw.max.x > 1 && raw.min.x - wide.min.x > 1)) bad.push("没有多取一圈瓦片，平移后边缘会露底");
        /* 4) 坐标数学一点没动：像素往返必须逐位相同（动了图元侧就会在这里露馅） */
        const rt = map.containerPointToLatLng(map.latLngToContainerPoint([c.lat + 0.01, c.lng - 0.02]));
        if (Math.abs(rt.lat - (c.lat + 0.01)) > 1e-9 || Math.abs(rt.lng - (c.lng - 0.02)) > 1e-9) bad.push("Leaflet 的坐标换算被碰了：" + rt.lat + "," + rt.lng);
        /* 5) 负对照甲：换到 WGS-84 底图（Carto，免密钥）平移必须归零、transform 必须清空、
              也不再多取瓦片 */
        settings.basemap = "carto-light"; applyBasemap();
        const s2 = datumPixelShift();
        if (s2.x !== 0 || s2.y !== 0) bad.push("非 GCJ 底图还在平移：" + s2.x + "," + s2.y);
        if ((map.getPane("tilePane").style.transform || "") !== "") bad.push("切回 WGS-84 底图却没清掉 transform");
        const raw3 = L.TileLayer.prototype._getTiledPixelBounds.call(tileLayer, map.getCenter());
        const wide3 = tileLayer._getTiledPixelBounds(map.getCenter());
        if (wide3.max.x !== raw3.max.x) bad.push("WGS-84 底图下还在多取瓦片（白花流量）");
        /* 6) 负对照乙：把 gcj 标记摘掉，套合必须整条失效 —— 证明判据真的读那个标记，
              而不是"永远在平移"。摘完必须还原。 */
        const amap = bmById("amap"), flag = amap.gcj;
        try {
          amap.gcj = false; settings.basemap = "amap"; applyBasemap();
          const s4 = datumPixelShift();
          if (s4.x !== 0 || s4.y !== 0) bad.push("摘掉 gcj 标记后还在平移（判据没接上标记）");
        } finally { amap.gcj = flag; }
      } catch (e) { bad.push("抛错：" + e.message); }
      finally {
        settings.basemap = savedBase; inSelfTest = true;
        try { applyBasemap(); } catch (e) {}
        viewLockUntil = performance.now() + 2400; userViewAt = -Infinity;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") :
        "平移量与独立算出的米/像素比值吻合；tilePane 挂上同一条 transform；子类比父类多取一圈；像素往返逐位相同（坐标数学没动）；换到 Carto 归零+清空+不再多取；摘掉 gcj 标记整条失效（负对照）" };
    });
    t("拖拽改站序：弯道只休眠不删除，曲线计数跟着画面，重复访问的站不会动错那一个", () => {`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const Q = String.fromCharCode(34), BSL = String.fromCharCode(92);
const cnt = (hay, s) => hay.split(s).length - 1;
const checks = [
  ["shiftTileLayer 出现数（3 调用 + 1 定义）", cnt(out, "shiftTileLayer("), 3],
  ["工厂定义", cnt(out, "const shiftTileLayer = (url, opts) => new ShiftTiles(url, opts);"), 1],
  ["残留的 L.tileLayer(", cnt(out, "L.tileLayer("), 0],
  ["applyDatumShiftSafe 出现数", cnt(out, "applyDatumShiftSafe"), 3],
  ["carto-light 这个 id 真的存在", cnt(out, "{ id: " + Q + "carto-light" + Q), 1],
  ["坏掉的模板占位没混进来", cnt(out, "${px}"), 0],
  ["新增反转义引号", cnt(out, BSL + Q) - cnt(src, BSL + Q), 0]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
