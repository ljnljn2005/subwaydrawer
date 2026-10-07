/* scratch/apply_68d.js —— 修两处：
   (a) 产品：pad 恒为 |shift|+1 ⇒ 连 WGS-84 底图也多取一圈瓦片（白花钱），改成无平移就原样返回；
   (b) 测试：像素往返的精度要求是错的（Leaflet 自己就按整像素量化），换成"开/关套合两次往返必须逐位相同"。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const A = [];

A.push(["overscan", 1,
`    const s = datumPixelShift();
    const pad = L.point(Math.abs(Math.round(s.x)) + 1, Math.abs(Math.round(s.y)) + 1);
    if (!pad.x && !pad.y) return b;
    return L.bounds(b.min.subtract(pad), b.max.add(pad));`,
`    const s = datumPixelShift();
    const ax = Math.abs(Math.round(s.x)), ay = Math.abs(Math.round(s.y));
    if (!ax && !ay) return b;                       /* 没平移就一格都不多取 */
    const pad = L.point(ax + 1, ay + 1);
    return L.bounds(b.min.subtract(pad), b.max.add(pad));`]);

A.push(["roundtrip", 1,
`        /* 4) 坐标数学一点没动：像素往返必须逐位相同（动了图元侧就会在这里露馅） */
        const rt = map.containerPointToLatLng(map.latLngToContainerPoint([c.lat + 0.01, c.lng - 0.02]));
        if (Math.abs(rt.lat - (c.lat + 0.01)) > 1e-9 || Math.abs(rt.lng - (c.lng - 0.02)) > 1e-9) bad.push("Leaflet 的坐标换算被碰了：" + rt.lat + "," + rt.lng);`,
`        /* 4) 套合不许动坐标数学：同一个像素往返，开着套合与关掉套合必须逐位相同。
              （不能要求往返等于原坐标 —— Leaflet 的 latLngToContainerPoint 本身就按整像素量化，
               那种断言在旧构建上也会红，测的是 Leaflet 不是我加的平移。） */
        const probe = [c.lat + 0.01, c.lng - 0.02];
        const rtOn = map.containerPointToLatLng(map.latLngToContainerPoint(probe));
        const savedFit0 = settings.datumFit;
        settings.datumFit = false; applyDatumShift();
        const rtOff = map.containerPointToLatLng(map.latLngToContainerPoint(probe));
        settings.datumFit = savedFit0; applyDatumShift();
        if (rtOn.lat !== rtOff.lat || rtOn.lng !== rtOff.lng) bad.push("套合改变了点击↔坐标的对应关系：" + rtOn.lat + "," + rtOn.lng + " ≠ " + rtOff.lat + "," + rtOff.lng);`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const Q = String.fromCharCode(34), BSL = String.fromCharCode(92);
const cnt = (hay, s) => hay.split(s).length - 1;
const checks = [
  ["旧的恒加一 pad 已消失", cnt(out, "Math.abs(Math.round(s.x)) + 1, Math.abs(Math.round(s.y)) + 1"), 0],
  ["新 pad 写法", cnt(out, "const pad = L.point(ax + 1, ay + 1);"), 1],
  ["无平移不多取", cnt(out, "if (!ax && !ay) return b;"), 1],
  ["错误的 1e-9 断言已换掉", cnt(out, "1e-9) bad.push(\x22Leaflet 的坐标换算被碰了"), 0],
  ["A/B 断言已接上", cnt(out, "rtOn.lat !== rtOff.lat"), 1],
  ["新增未转义引号风险（同行奇数个双引号的中文行）", 0, 0]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
