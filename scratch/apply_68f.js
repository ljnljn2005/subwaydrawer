/* scratch/apply_68f.js —— 修 GCJ 公式的 1/3 → 2/3（用户实测对发现的），
   并把"公开量级"那组自校准的假闸门换成用户实测的坐标对做外部校准。
   顺带修转换用例里两处我自己写错的期望（0.05px 精度要求、hist 计数）。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const lines = src.split("\n");

/* 1) 只在 tl / to 这两行里把 ") / 3;" 换成 ") * 2 / 3;" */
let fixed = 0;
lines.forEach((ln, i) => {
  if (!/^\s*const (tl|to) = \(x, y\) =>/.test(ln)) return;
  const n = ln.split(") / 3;").length - 1;
  if (n !== 3) throw new Error("第 " + (i + 1) + " 行 / 3 出现 " + n + " 次（应为 3）");
  lines[i] = ln.split(") / 3;").join(") * 2 / 3;");
  fixed += n;
});
if (fixed !== 6) throw new Error("只改了 " + fixed + " 处（应为 6）");
let out = lines.join("\n");
const A = [];

/* 2) 量级表换成修正后的真值，并加外部实测校准 */
A.push(["table", 1,
`      const T = [[31.23, 121.47, 408], [39.90, 116.40, 439], [23.13, 113.26, 459], [30.57, 104.07, 327]];`,
`      /* 这组数字以前是"我自己公式的输出"被当成公开量级写进去的（falsify 教训的现行犯）：
            正弦项少乘了 2/3 里的 2，量级偏小 10~25%，而断言照样绿。现在改成两件事：
            (a) 下面这组量级按修正后的公式重算（482/556/622/364），
            (b) 真正的外部校准是用户实测的同一地点坐标对。 */
      const T = [[31.23, 121.47, 482], [39.90, 116.40, 556], [23.13, 113.26, 622], [30.57, 104.07, 364]];`]);

A.push(["groundtruth", 1,
`      if (gcjMetersAt(51.5, -0.12) !== 0) bad.push("境外坐标不该有 GCJ 偏移");`,
`      if (gcjMetersAt(51.5, -0.12) !== 0) bad.push("境外坐标不该有 GCJ 偏移");
      /* 外部校准（用户 2026-10-07 实测：同一地点 天地图 116.819944,39.939883 / 高德 116.826124,39.941594）。
         公开公式是对真实加密的近似，允许几十米残差 —— 阈值 120 m 既能抓住"少乘 2/3"这类
         数量级错误（那次差 180 m），又不会把近似本身的误差当 bug。 */
      const GT_W = [39.939883, 116.819944], GT_G = [39.941594, 116.826124];
      const mAt = (p, q) => metersBetween(p, q);
      const e1 = Math.round(mAt(wgs2gcj(GT_W[0], GT_W[1]), GT_G));
      if (!(e1 < 120)) bad.push("正算与用户实测差 " + e1 + " m（公式或系数有问题）");
      const e2 = Math.round(mAt(gcj2wgs(GT_G[0], GT_G[1]), GT_W));
      if (!(e2 < 120)) bad.push("反算与用户实测差 " + e2 + " m");
      const rtErr = Math.round(mAt(gcj2wgs.apply(null, wgs2gcj(GT_W[0], GT_W[1])), GT_W) * 100) / 100;
      if (!(rtErr < 0.01)) bad.push("正算→反算 往返自洽误差 " + rtErr + " m，定点迭代没收敛");`]);

A.push(["detail", 1,
`        "4 条加密底图 / 8 条非加密标注无误；偏移量级 408·439·459·327 m 对上；境外 0 m；" +`,
`        "4 条加密底图 / 8 条非加密标注无误；偏移量级 482·556·622·364 m 对上；境外 0 m；用户实测坐标对校准误差 " + e1 + "·" + e2 + " m；" +`]);

A.push(["control", 1,
`      if (Math.abs(gcjMetersAt(31.23, 121.47) - 408) > 25) bad.push("负对照没还原 wgs2gcj");`,
`      if (Math.abs(gcjMetersAt(31.23, 121.47) - 482) > 25) bad.push("负对照没还原 wgs2gcj");`]);

/* 3) 转换用例：精度要求改成"相对平移量的比例"，hist 计数配得上两次调用 */
A.push(["tol", 1,
`        if (!(worst < 0.05)) bad.push("转换+套合后画面移动了 " + worst.toFixed(3) + " px（应当不动）");`,
`        /* 一档平移是按图中心的近似：残余就是 δ 场在图幅内的变化（另一条断言量得 7 km 内 13.8 m）。
           所以按"相对被修正量的比例"判，而不是要求 0 —— 要求 0.05px 是把近似当精确，测不出真 bug。 */
        const shMag = Math.hypot(sh.x, sh.y);
        if (!(worst < 4 && worst < shMag * 0.08)) bad.push("转换+套合后画面移动 " + worst.toFixed(2) + " px（应 <4px 且 <平移量 " + shMag.toFixed(1) + "px 的 8%）");`]);

A.push(["twice", 1,
`        const lat0 = ok2.stations[Object.keys(ok2.stations)[0]].lat;
        convertProjectGcjToWgs();`,
`        const key0 = Object.keys(ok2.stations)[0];
        const lat0 = ok2.stations[key0].lat;
        convertProjectGcjToWgs();
        const lat1 = P.stations[key0].lat;
        convertProjectGcjToWgs();
        const lat2 = P.stations[key0].lat;`]);

A.push(["twice2", 1,
`        if (Math.abs(Object.values(P.stations)[0].lat - lat0) < 1e-6) bad.push("第二次转换没再搬（与「按声明执行」的口径不符）");`,
`        if (Math.abs(lat1 - lat0) < 1e-6 || Math.abs(lat2 - lat1) < 1e-6) bad.push("转换没有真的搬动坐标（lat0/1/2 = " + lat0 + "/" + lat1 + "/" + lat2 + "）");`]);

A.push(["detail2", 1,
`        "四城往返误差 <1e-9 度；伦敦原样返回；老档「转换+开套合」后每站相对视图中心的屏幕位置不动（<0.05px），" +`,
`        "四城往返误差 <1e-9 度；伦敦原样返回；老档「转换+开套合」后每站相对视图中心不动（残差 <4px 且 <平移量 8%）；" +`]);

A.push(["comment", 1,
`            转换 + 开套合之后，每站的屏幕像素必须与之前一致（≤0.05px）。`,
`            转换 + 开套合之后，每站相对视图中心的位置必须与之前一致（一档平移是近似，残差按平移量的比例判）。`]);

for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const Q = String.fromCharCode(34), BSL = String.fromCharCode(92);
const cnt = (h, s) => h.split(s).length - 1;
const checks = [
  ["残留的 ) / 3;", cnt(out, ") / 3;"), 0],
  ["* 2 / 3; 出现数", cnt(out, ") * 2 / 3;"), 6],
  ["旧量级表已消失", cnt(out, "408], [39.90, 116.40, 439"), 0],
  ["实测校准已接上", cnt(out, "GT_W"), 7]
  /* 注：不查"文本里是否出现裸双引号"——注释里出现是完全无害的，
     真正的权威是 node vm 的编译闸（上一轮就是它逮到字符串被截断的）。 */
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8"), sineTermsFixed: fixed }));
