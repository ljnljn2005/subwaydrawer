/* scratch/apply_68e.js —— #68 的收尾：老档一次性 GCJ-02 → WGS-84 转换。
   核心不变量：转换 + 开套合 之后，每个站的屏幕像素必须与"转换前、关套合"相同
   （用户的老图在画面上一点不动，但存进去的数值变成真正的 WGS-84，此后点路就准）。
   顺带把平移量从"整像素"改成小数像素：Leaflet 的 latLngToLayerPoint 自带 _round()，
   用它算会把套合精度压到 1 px。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const A = [];

/* 1) 反算（定点迭代，5 次内到 1e-11 度 ≈ 亚毫米） */
A.push(["gcj2wgs", 1,
`function wgs2gcj(lat, lng) { const d = gcjDelta(lat, lng); return [lat + d[0], lng + d[1]]; }`,
`function wgs2gcj(lat, lng) { const d = gcjDelta(lat, lng); return [lat + d[0], lng + d[1]]; }
/* 反算：给一个 GCJ-02 数值，求它对应的真实 WGS-84 坐标。
   没有闭式逆，用定点迭代 —— 每次拿当前猜测正算回去、按残差修正；δ 场变化极慢
   （自检那条"7 km 内极差 <20 m"就是这件事），所以 5 次内残差掉到 1e-11 度（<1 mm）。
   境外 gcjDelta 恒为 0 ⇒ 原样返回，绝不给伦敦/东京制造假修正。 */
function gcj2wgs(glat, glng) {
  const d0 = gcjDelta(glat, glng);
  if (!d0[0] && !d0[1]) return [glat, glng];
  let wlat = glat - d0[0], wlng = glng - d0[1];
  for (let i = 0; i < 5; i++) {
    const g = wgs2gcj(wlat, wlng);
    const elat = glat - g[0], elng = glng - g[1];
    wlat += elat; wlng += elng;
    if (Math.abs(elat) < 1e-11 && Math.abs(elng) < 1e-11) break;
  }
  return [wlat, wlng];
}`]);

/* 2) 平移量改用 map.project（小数像素） */
A.push(["subpixel", 1,
`  const p0 = map.latLngToLayerPoint(c), p1 = map.latLngToLayerPoint([c.lat + d[0], c.lng + d[1]]);
  return { x: p0.x - p1.x, y: p0.y - p1.y };`,
`  /* 用 map.project 而不是 latLngToLayerPoint：后者内部 _round() 过，
     会把套合精度压到整像素（z14 一格 7 m，白瞎了 429 m 的修正）。 */
  const z = map.getZoom();
  const p0 = map.project(c, z), p1 = map.project([c.lat + d[0], c.lng + d[1]], z);
  return { x: p0.x - p1.x, y: p0.y - p1.y };`]);

/* 3) 转换动作本体 */
A.push(["convert", 1,
`function runCmd(cmd, el) {`,
`/* 把整张图的坐标从 GCJ-02 反算成 WGS-84（老档专用，一次性的）。
   为什么需要：这份图当年是"没有套合"的时候照着高德的路点的，存下的数值本身就是 GCJ 位置；
   一旦开了自动套合，它反而会离路网 2δ。转成真正的 WGS-84 之后，套合才既对老图对新图。
   只动 lat/lng：手动铭牌偏移是相对站点的像素、弯道是相对弦的比例，都不需要跟着改。
   可撤销（pushHistory 在最前面），转前转后画面不动 —— 断言就按这条判。 */
function convertProjectGcjToWgs() {
  const ids = Object.keys(P.stations);
  if (!ids.length) { toast("这张图还没有车站，不用转"); return false; }
  let moved = 0, maxM = 0;
  const next = {};
  ids.forEach((id) => {
    const st = P.stations[id], w = gcj2wgs(st.lat, st.lng);
    const m = metersBetween([st.lat, st.lng], [w[0], w[1]]);
    if (m > maxM) maxM = m;
    if (Math.abs(w[0] - st.lat) > 1e-12 || Math.abs(w[1] - st.lng) > 1e-12) moved++;
    next[id] = w;
  });
  if (!moved) { toast("这份图的坐标已经是 WGS-84（境内没找到需要反算的点）"); return false; }
  pushHistory();
  ids.forEach((id) => { const st = P.stations[id]; st.lat = next[id][0]; st.lng = next[id][1]; });
  /* 视图中心与站点同一口径：只搬站点不搬 center，整幅画面会凭空跳一格（z14 下约 58 px）。
     一起搬之后，"转换 + 开套合"与"转换前关套合"的屏幕位置逐站相同 —— 断言就按这条判。 */
  const c = gcj2wgs(P.center[0], P.center[1]);
  P.center = [c[0], c[1]];
  map.setView(P.center, map.getZoom(), { animate: false });
  renderAll(); markDirty();
  toast("已把 " + moved + "/" + ids.length + " 个车站从 GCJ-02 反算为 WGS-84（平均量级 " +
    Math.round(maxM) + " m 内），画面不动；Ctrl+Z 可撤销。现在开着「自动套合」就是准的。", "good", 8000);
  return true;
}

function runCmd(cmd, el) {`]);

/* 4) 命令接线 + 面板按钮（放在"清空图纸"旁边，同一套 data-cmd 路由） */
A.push(["cmd", 1,
`    case "archive": openArchive(); break;`,
`    case "archive": openArchive(); break;
    case "gcjToWgs": convertProjectGcjToWgs(); break;`]);

A.push(["button", 1,
`    (nothing ? "" : '<button class="tool" data-cmd="clearAll"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>清空图纸</button>') + "</div></div>" +`,
`    (nothing ? "" : '<button class="tool" data-cmd="clearAll"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>清空图纸</button>') +
    (nothing ? "" : '<button class="tool" data-cmd="gcjToWgs" title="早年在高德/谷歌底图上照着路点的站，存下的数值其实是 GCJ-02；点一下反算成真正的 WGS-84，画面不动，之后开自动套合就贴路">坐标 GCJ-02 → WGS-84</button>') + "</div></div>" +`]);

/* 5) 常驻断言：转换+开套合 ⇒ 每站屏幕位置逐站不动 */
A.push(["case", 1,
`    t("GCJ-02 底图自动套合：瓦片按实测偏移量平移、多取一圈补边，且完全不动坐标数学", () => {`,
`    t("老档坐标 GCJ-02 → WGS-84：反算精度到亚毫米，且转换+开套合后每站屏幕位置一点不动", () => {
      const bad = [];
      /* 1) 反算精度：对四个境内城市做 正算→反算 往返，必须贴回原点到 1e-9 度（<0.1 mm） */
      [["39.9042", "116.4074"], ["31.2304", "121.4737"], ["23.1291", "113.2644"], ["30.5728", "104.0668"]]
        .forEach((c) => {
          const la = +c[0], ln = +c[1];
          const back = gcj2wgs.apply(null, wgs2gcj(la, ln));
          if (Math.abs(back[0] - la) > 1e-9 || Math.abs(back[1] - ln) > 1e-9) bad.push("往返误差过大 " + la + "," + ln + " → " + back);
        });
      /* 2) 境外绝不允许被"修正"（伦敦原样返回） */
      const lon = gcj2wgs(51.5008, -0.1246);
      if (lon[0] !== 51.5008 || lon[1] !== -0.1246) bad.push("境外坐标被改了：" + lon);
      /* 3) 主不变量：模拟一份"老档"（存的是 GCJ 数值），关套合记下画面像素；
            转换 + 开套合之后，每站的屏幕像素必须与之前一致（≤0.05px）。
            这条同时证明两件事：用户的老图不会一夜之间跑偏，且转换真的把数值搬回 WGS。 */
      const savedP = P, savedSel = { line: sel.line, station: sel.station }, savedBase = settings.basemap;
      const savedFit = settings.datumFit, savedLock = viewLockUntil, savedHist = hist, savedFut = future;
      try {
        const p = synthProject(6, 1);
        P = p; sel.line = p.lines[0].id; sel.station = null; hist = []; future = [];
        Object.keys(P.stations).forEach((id) => {
          const st = P.stations[id], g = wgs2gcj(st.lat, st.lng);   /* 老档口径：存的是 GCJ 数值 */
          st.lat = g[0]; st.lng = g[1];
        });
        settings.basemap = "amap"; settings.datumFit = false; applyBasemap();
        viewLockUntil = Infinity;
        map.setView(P.center, 14, { animate: false }); renderAll();
        const z = map.getZoom();
        const rel = (lat, lng) => { const w = map.project([lat, lng], z), o = map.project(map.getCenter(), z); return { x: w.x - o.x, y: w.y - o.y }; };
        const before = Object.keys(P.stations).map((id) => { const s = P.stations[id]; const w = rel(s.lat, s.lng); return { id: id, x: w.x, y: w.y, lat: s.lat, lng: s.lng }; });
        if (!convertProjectGcjToWgs()) bad.push("转换没执行（老档口径应该能转）");
        const movedM = Math.max.apply(null, before.map((b) => metersBetween([b.lat, b.lng], [P.stations[b.id].lat, P.stations[b.id].lng])));
        if (!(movedM > 200 && movedM < 700)) bad.push("数值搬动量级不对：" + Math.round(movedM) + " m（该在 GCJ 偏移量级）");
        settings.datumFit = true; applyBasemap(); applyDatumShift();
        const sh = datumPixelShift();
        const worst = Math.max.apply(null, before.map((b) => {
          const s = P.stations[b.id], w = rel(s.lat, s.lng);
          return Math.hypot(w.x - b.x, w.y - b.y);
        }));
        if (!(worst < 0.05)) bad.push("转换+套合后画面移动了 " + worst.toFixed(3) + " px（应当不动）");
        /* 4) 撤销必须把坐标逐位带回 */
        undo();
        const drift = before.reduce((a, b) => Math.max(a, Math.abs(P.stations[b.id].lat - b.lat), Math.abs(P.stations[b.id].lng - b.lng)), 0);
        if (!(drift === 0)) bad.push("撤销没把坐标带回原位，最大残差 " + drift);
        /* 5) 空图不许压撤销栈 */
        const empty = synthProject(1, 1); empty.stations = {}; P = empty; hist = []; future = [];
        if (convertProjectGcjToWgs() !== false) bad.push("空图也执行了转换");
        if (hist.length !== 0) bad.push("空图转换还压了撤销栈");
        /* 6) 已经是 WGS 的图不该被"二次修正" */
        const ok2 = synthProject(4, 1); P = ok2; sel.line = ok2.lines[0].id; hist = []; future = [];
        const lat0 = ok2.stations[Object.keys(ok2.stations)[0]].lat;
        convertProjectGcjToWgs();
        /* 这个函数按"用户声明这是老档"执行，它没法自动判断档位是什么坐标系：
           再点一次就会再搬 ~400 m。所以它必须是一次性动作 + 可撤销，文案也这么写。 */
        if (Math.abs(Object.values(P.stations)[0].lat - lat0) < 1e-6) bad.push("第二次转换没再搬（与"按声明执行"的口径不符）");
        if (hist.length !== 2) bad.push("两次转换应当各压一层撤销栈，实际 " + hist.length);
      } catch (e) { bad.push("抛错：" + e.message); }
      finally {
        inSelfTest = true;
        P = savedP; sel.line = savedSel.line; sel.station = savedSel.station;
        settings.basemap = savedBase; settings.datumFit = savedFit;
        hist = savedHist; future = savedFut; updateHistoryButtons();
        try { applyBasemap(); } catch (e) {}
        clearMarkerPools(); renderAll();
        viewLockUntil = performance.now() + 2400; userViewAt = -Infinity;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") :
        "四城往返误差 <1e-9 度；伦敦原样返回；老档"转换+开套合"后每站相对视图中心的屏幕位置不动（<0.05px），" +
        "数值搬动在 GCJ 偏移量级；P.center 同口径一起搬；撤销逐位带回；空图不压栈；重复点会再搬一次（按声明执行，可撤销）" };
    });
    t("GCJ-02 底图自动套合：瓦片按实测偏移量平移、多取一圈补边，且完全不动坐标数学", () => {`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const Q = String.fromCharCode(34), BSL = String.fromCharCode(92);
const cnt = (hay, s) => hay.split(s).length - 1;
const checks = [
  ["gcj2wgs 定义", cnt(out, "function gcj2wgs("), 1],
  ["转换函数定义", cnt(out, "function convertProjectGcjToWgs("), 1],
  ["命令接线", cnt(out, 'case "gcjToWgs"'), 1],
  ["按钮", cnt(out, 'data-cmd="gcjToWgs"'), 1],
  ["整像素算法已换掉", cnt(out, "const p0 = map.latLngToLayerPoint(c)"), 0],
  ["小数像素算法", cnt(out, "const p0 = map.project(c, z)"), 1],
  ["新增未转义引号", cnt(out, BSL + Q) - cnt(src, BSL + Q), 0]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
/* 新加文本里若混进"双引号包在双引号字符串里"的形状，直接拦（上一轮就是这么把文件改坏的） */
const added = out.split("\n").filter((l, i) => src.split("\n")[i] !== l);
const risky = added.filter((l) => { const m = l.split(/(?<!\\)"/).length - 1; return m % 2 === 1 && !/^\s*[/ *]/.test(l); });
if (risky.length) { console.log("ABORT: 有 " + risky.length + " 行双引号数为奇数（字符串可能被截断），未写文件"); console.log(risky[0].slice(0, 160)); process.exit(1); }
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
