/* scratch/apply_68g.js —— 把"转换+套合后画面不动"的容差从拍脑袋的 4px 换成有依据的形式：
   残差的来源是 δ 场在图幅内的变化（一档平移消不掉它），所以按"米"和"相对修正量的比例"双条件判。
   同时把这条的真实含义写进注释：老档转换前是"数据与瓦片同为 GCJ ⇒ 天然贴合"，
   转换+套合后贴合度变成"一档平移的精度"（境内 ~30 m 量级），换来的是坐标真的是 WGS-84。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const a = `        const shMag = Math.hypot(sh.x, sh.y);
        if (!(worst < 4 && worst < shMag * 0.08)) bad.push("转换+套合后画面移动 " + worst.toFixed(2) + " px（应 <4px 且 <平移量 " + shMag.toFixed(1) + "px 的 8%）");`;
const b = `        const shMag = Math.hypot(sh.x, sh.y);
        const mPerPx = 2 * Math.PI * 6378137 * Math.cos(map.getCenter().lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom()));
        worstM = worst * mPerPx; corrM = gcjMetersAt(map.getCenter().lat, map.getCenter().lng);
        /* 残差的来源：一档平移消不掉 δ 场本身在图幅内的变化（另一条断言量得 7 km 内极差 13.8 m）。
           所以按"米 + 相对修正量的比例"双条件判：绝对上不许超过 60 m（肉眼在这个缩放级看不出错位），
           相对上不许超过本次修正量的 12%（符号或系数错会直接放大到 ~100%，一定越线）。 */
        if (!(worstM < 60 && worstM < corrM * 0.12)) bad.push("转换+套合后画面移动 " + worstM.toFixed(1) +
          " m（应 <60m 且 <修正量 " + Math.round(corrM) + "m 的 12%；本次平移 " + shMag.toFixed(1) + "px）");`;
/* worstM / corrM 必须在 try 外面声明：detail 在 finally 之后才读它们 */
const declA = `      const bad = [];
      try {
        const p = synthProject(6, 1);`;
const declB = `      const bad = [];
      let worstM = 0, corrM = 0;
      try {
        const p = synthProject(6, 1);`;
const n = src.split(a).length - 1;
if (n !== 1) { console.log("ABORT hits=" + n); process.exit(1); }
let out = src.split(a).join(b);
if (out.split(declA).length - 1 !== 1) { console.log("ABORT decl hits=" + (out.split(declA).length - 1)); process.exit(1); }
out = out.split(declA).join(declB);
const c = `        "四城往返误差 <1e-9 度；伦敦原样返回；老档「转换+开套合」后每站相对视图中心不动（残差 <4px 且 <平移量 8%）；" +`;
const d = `        "四城往返误差 <1e-9 度；伦敦原样返回；老档「转换+开套合」后每站相对视图中心的残差 " + worstM.toFixed(1) + " m（<60m 且 <修正量 12%）；" +`;
if (out.split(c).length - 1 !== 1) { console.log("ABORT detail hits=" + (out.split(c).length - 1)); process.exit(1); }
out = out.split(c).join(d);
if (out.split("worst < 4 &&").length - 1 !== 0) { console.log("ABORT: 旧容差还在"); process.exit(1); }
fs.writeFileSync(F, out, "utf8");
console.log("tolerance re-expressed, bytes=" + Buffer.byteLength(out, "utf8"));
