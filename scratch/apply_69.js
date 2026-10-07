/* scratch/apply_69.js —— 一次性把 #69 的视图记账归属改造落到 index.html。
   规则：每条替换的锚点必须恰好命中 1 次，否则整个脚本一个字节都不写并报错。
   （上次用 perl 改文件把 $$ 插值成了 PID，这里只用 split/join，不用正则替换。） */
const fs = require("fs");
const P = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(P, "utf8");

const A = [];

/* ---- 1. 全局：意图归属 + 记账函数从 initMap 里提到顶层（断言要能直接调） ---- */
A.push([
  "globals",
`let viewLockUntil = 0;
function viewCommitAllowed() { return !inSelfTest && performance.now() >= viewLockUntil; }`,
`let viewLockUntil = 0;
function viewCommitAllowed() { return !inSelfTest && performance.now() >= viewLockUntil; }
/* 视图记账的"谁发起"归属。时间窗是钝器：moveend 在宽限期内落地、记账的防抖回调却
   在宽限期外跑，那 700 毫秒的缝就是示例档被写成网格用例视图的那条路。真正的判据是
   "这趟移动是不是用户发起的"：
   - 地图容器上的真实输入（按下/触摸/滚轮/双击/键盘）—— 拖图、滚轮缩放、方向键平移；
   - 用户点出来的视图变化（适应全部、跳到某站、缩放按钮与 +/- 快捷键）显式调 viewByUser()；
   程序自己的 setView / fitBounds / 开档恢复 / 自检换图都不留标记，因此一律不落账。 */
let userViewAt = -Infinity;
let viewCommitArmed = 0;
function viewByUser() { userViewAt = performance.now(); }
function viewHasUserIntent() { return performance.now() - userViewAt < 4000; }
/* 比较用像素而不是 1e-6 度：setView 之后 Leaflet 给的中心是按像素取整的，同一个
   位置重新读出来能差半像素（约 13 米 @z12）。按角度判会把这种"根本没动"当成
   移动写进存档 —— 每次换窗口尺寸，你存的视图都会漂一点。 */
function viewWorthCommitting() {
  if (!P) return false;
  const c = map.getCenter(), z = map.getZoom();
  return z !== P.zoom || map.latLngToContainerPoint(c).distanceTo(map.latLngToContainerPoint(P.center)) > 0.75;
}
function commitViewNow() {
  if (!P || !viewCommitAllowed() || !viewHasUserIntent()) return;
  if (!viewWorthCommitting()) return;
  const c = map.getCenter();
  P.center = [c.lat, c.lng]; P.zoom = map.getZoom(); markDirty();
}
const commitViewSoon = debounce(commitViewNow, 700);`]);

/* ---- 2. initMap：监听真实输入 + 归属在事件时刻判定 ---- */
A.push([
  "moveend-handler",
`  map.on("moveend", debounce(() => {
    if (!P) return;
    /* 自检会临时换图纸，而且 setView 的地图动画常常在测试结束、P 已经换回用户图纸
       之后才落地 —— 那时按屏幕中心记账，会把合成图纸的视图写进用户档（实测真的污染
       过一次：示例档的 center/zoom 变成了网格用例的）。所以测试期间 + 结束后 1.5 秒
       宽限期内的视图变化一律不记账。 */
    if (!viewCommitAllowed()) return;
    const c = map.getCenter(), z = map.getZoom();
    /* 比较用像素而不是 1e-6 度：setView 之后 Leaflet 给的中心是按像素取整的，同一个
       位置重新读出来能差半像素（约 13 米 @z12）。按角度判会把这种"根本没动"当成
       移动写进存档 —— 每次换窗口尺寸，你存的视图都会漂一点。 */
    const moved = z !== P.zoom || map.latLngToContainerPoint(c).distanceTo(map.latLngToContainerPoint(P.center)) > 0.75;
    if (!moved) return;
    P.center = [c.lat, c.lng]; P.zoom = z; markDirty();
  }, 700));`,
`  /* 用户真实输入才等于"用户改了视图"。capture + passive：只听不拦，不参与 Leaflet
     自己的手势判定，也不改默认行为。 */
  ["mousedown", "touchstart", "wheel", "dblclick", "keydown"].forEach((ev) =>
    map.getContainer().addEventListener(ev, viewByUser, { capture: true, passive: true }));
  map.on("moveend", () => {
    /* 自检会临时换图纸，setView 的动画又常常在测试结束、P 已经换回用户图纸之后才落地
       —— 那时按屏幕中心记账就把合成图纸的视图写进用户档（实测污染过一次：示例档的
       center/zoom 变成了网格用例的）。归属必须在事件落地的这一刻判：以前只在防抖回调
       里判，宽限期 1.5 秒 + 防抖 700 毫秒之间正好留出一条迟到的缝。 */
    if (!P || !viewCommitAllowed() || !viewHasUserIntent()) return;
    viewCommitArmed++;
    commitViewSoon();
  });`]);

/* ---- 3~8. 用户点出来的视图变化：显式声明意图 ---- */
A.push(["fitAll", `  map.fitBounds(b.pad(0.18));`, `  viewByUser(); map.fitBounds(b.pad(0.18));`]);
A.push(["fitLine", `  if (b.isValid()) map.fitBounds(b.pad(l.stations.length < 3 ? .5 : .2));`,
        `  if (b.isValid()) { viewByUser(); map.fitBounds(b.pad(l.stations.length < 3 ? .5 : .2)); }`]);
A.push(["gotoStn", `    case "gotoStn": st && map.panTo([st.lat, st.lng], { animate: true }); break;`,
        `    case "gotoStn": if (st) { viewByUser(); map.panTo([st.lat, st.lng], { animate: true }); } break;`]);
A.push(["ctxGoto", `    if (act === "goto") return map.panTo([st.lat, st.lng], { animate: true });`,
        `    if (act === "goto") { viewByUser(); return map.panTo([st.lat, st.lng], { animate: true }); }`]);
A.push(["kbdZoom", `      case "+": case "=": map.zoomIn(); break;
      case "-": map.zoomOut(); break;`,
`      case "+": case "=": viewByUser(); map.zoomIn(); break;
      case "-": viewByUser(); map.zoomOut(); break;`]);
A.push(["zoomBtns", `  $("#zIn").addEventListener("click", () => map.zoomIn());
  $("#zOut").addEventListener("click", () => map.zoomOut());`,
`  $("#zIn").addEventListener("click", () => { viewByUser(); map.zoomIn(); });
  $("#zOut").addEventListener("click", () => { viewByUser(); map.zoomOut(); });`]);

/* ---- 9. 套件收尾：意图清零 + 宽限期抬高一个防抖周期 ---- */
A.push(["suite-end-lock",
`    map.setView(savedView[0], savedView[1], { animate: false });
    /* 视图记账再宽限 1.5 秒：Leaflet 的缩放动画事件仍可能在恢复之后才派发 */
    viewLockUntil = performance.now() + 1500;`,
`    map.setView(savedView[0], savedView[1], { animate: false });
    /* 套件期间的"用户意图"一律作废（真实的输入标记只能由真实输入重新点亮），
       视图记账再宽限 2.4 秒 = 原来的 1.5 秒 + 一个防抖周期，把迟到动画可能在
       防抖里落地的窗口整个盖住。 */
    userViewAt = -Infinity;
    viewLockUntil = performance.now() + 2400;`]);

/* ---- 10. 常驻断言：程序换图不记账 / 真实输入才记账（带两层负对照） ---- */
A.push([
  "resident-case",
`    t("跨图纸的防抖写与跨自检的视图记账都不许串档", () => {`,
`    t("视图记账只认用户发起的移动：程序换图不落账，容器上的真实输入才算", () => {
      const savedP3 = P, savedCenter = P.center.slice(), savedZoom = P.zoom;
      const savedLock = viewLockUntil, savedIntent = userViewAt, savedArmed = viewCommitArmed;
      const savedDirty = dirty, savedOwner = dirtyOwner;
      const bad = [];
      try {
        inSelfTest = false; viewLockUntil = 0; userViewAt = -Infinity;   /* 正常状态、没有用户意图 */
        /* 1) 程序发起的大幅换图：既不排记账、不改档，迟到的防抖回调也写不进去 */
        map.setView([savedCenter[0] + 0.5, savedCenter[1] + 0.5], savedZoom + 2, { animate: false });
        if (viewCommitArmed !== savedArmed) bad.push("程序发起的 setView 仍被排成记账（多 " + (viewCommitArmed - savedArmed) + " 次）");
        if (P.center[0] !== savedCenter[0] || P.zoom !== savedZoom) bad.push("程序换图当场改了存档视图");
        commitViewNow();                                                 /* 模拟迟到落地的防抖回调 */
        if (P.center[0] !== savedCenter[0] || P.zoom !== savedZoom) bad.push("排程被拒后 commitViewNow 仍把合成视图写进档");
        /* 2) 负对照甲：容器上一个真 mousedown 必须被认成用户意图 —— 监听断没断就在这验 */
        map.getContainer().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        if (performance.now() - userViewAt > 50) bad.push("容器上的 mousedown 没被记成用户意图（监听没接上）");
        /* 3) 负对照乙：有用户意图时，同一趟移动必须排上记账并且真的落到档里 */
        const armed0 = viewCommitArmed;
        map.setView([savedCenter[0] + 0.3, savedCenter[1] - 0.2], savedZoom + 1, { animate: false });
        if (viewCommitArmed !== armed0 + 1) bad.push("用户输入之后的移动没被放行（负对照失败）");
        commitViewNow();
        if (P.zoom !== savedZoom + 1 || Math.abs(P.center[1] - (savedCenter[1] - 0.2)) > 1e-9) bad.push("放行后没把新视图记进档（负对照失败）");
        if (dirty !== true) bad.push("记了账却没挂欠账（写盘链路断在这里）");
        /* 4) 门槛按像素判，不随缩放级漂移：0.3 像素的取整抖动不算移动，3 像素的平移算 */
        P.center = savedCenter.slice(); P.zoom = savedZoom;
        const pt0 = map.project(savedCenter, savedZoom);
        map.setView(map.unproject(L.point(pt0.x + 0.3, pt0.y), savedZoom), savedZoom, { animate: false });
        if (viewWorthCommitting()) bad.push("0.3 像素的取整抖动被判成'移动了'（换窗口尺寸会漂存档）");
        map.setView(map.unproject(L.point(pt0.x + 3, pt0.y), savedZoom), savedZoom, { animate: false });
        if (!viewWorthCommitting()) bad.push("3 像素的真实平移被判成'没动'（负对照失败）");
      } finally {
        P.center = savedCenter; P.zoom = savedZoom;
        dirty = savedDirty; dirtyOwner = savedOwner;      /* 排掉上面 markDirty 挂的欠账，套件结束后不许多写一版 */
        map.setView(savedCenter, savedZoom, { animate: false });
        inSelfTest = true; userViewAt = savedIntent; viewCommitArmed = savedArmed;
        viewLockUntil = performance.now() + 2400;         /* 这条自己换了三次视图，迟到的 moveend 也得盖住 */
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") :
        "程序 setView 不排账也不落盘 / mousedown 证明监听在线 / 用户意图下同一趟移动排账并挂欠账 / 亚像素不记账" };
    });
    t("跨图纸的防抖写与跨自检的视图记账都不许串档", () => {`]);

let out = src, fail = [];
for (const [label, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== 1) { fail.push(label + " 命中 " + n + " 次"); continue; }
  out = out.split(oldS).join(newS);
}
if (fail.length) { console.log("ABORT, 未写文件: " + fail.join(" | ")); process.exit(1); }
/* 残留检查：旧的防抖式记账必须彻底没了，且新钩子都在 */
const residue = (out.split("map.on(\"moveend\", debounce(").length - 1);
if (residue !== 0) { console.log("ABORT: 旧 moveend 防抖仍在"); process.exit(1); }
["viewByUser", "viewHasUserIntent", "commitViewSoon", "viewCommitArmed", "viewWorthCommitting"].forEach((k) => {
  const c = out.split(k).length - 1;
  if (c < 2) { console.log("ABORT: " + k + " 只出现 " + c + " 次"); process.exit(1); }
}
);
fs.writeFileSync(P, out, "utf8");
console.log(JSON.stringify({ wrote: true, bytesBefore: Buffer.byteLength(src), bytesAfter: Buffer.byteLength(out), viewByUserCalls: out.split("viewByUser()").length - 1 }));
