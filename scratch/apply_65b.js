/* scratch/apply_65b.js —— #65 真正对症的那一刀：裁除决定按 rank 分档。
   锚点必须各命中指定次数，否则一个字节都不写。 */
const fs = require("fs");
const P = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(P, "utf8");
const A = [];

/* 1) 把"要不要藏"抽成纯判据（常驻断言要能量真值表，不靠换图纸） */
A.push(["predicate", 1,
`function cacheLabelSize(id, marker) {`,
`/* 铭牌藏不藏的唯一判据，抽出来是为了能逐格量真值表（常驻断言不必换图纸）。
   实测（示例图 z10/z11）：换乘站"没有任何一个方位不压线"是它的中位情形（0 个空位），
   普通站是 1~2 个 —— 因为两条线必然在换乘站交汇，附近本来就挤；而两者盒子宽度实测
   同为 58px（⇄ 字形画在站徽里，不在铭牌盒内），所以这不是"换乘的名字太宽塞不下"，
   是几何上无处可放。名字整张消失比铭牌盖过一线更伤：盒子本来就是不透明胶囊（自带
   边框与投影），盖在线上等同于把线压住；SVG/PNG 导出也一直全显不裁。
   ⇒ 缩放挤到放不下时：普通站按原规则隐藏，换乘站铭牌始终保留。 */
function labelShouldHide(hitLine, isXfer, cullOn) {
  return !!hitLine && !isXfer && cullOn !== false;
}

function cacheLabelSize(id, marker) {`]);

/* 2) 地图那条路上用判据（判据只改这一处；两条导出路径本来就不裁，不动） */
A.push(["callsite", 1,
`    /* 缩放太小时铭牌多到无处可放：按"不要压在线路上"的要求，放不下就不显示 */
    if (r.hitLine && settings.cullLabels !== false) { hiddenCount++; return; }`,
`    /* 缩放太小时按"不要压线"隐藏，但换乘站铭牌例外，理由见 labelShouldHide */
    if (labelShouldHide(r.hitLine, !!v.xfer, settings.cullLabels)) { hiddenCount++; return; }`]);

/* 3) 设置里的文案要跟着说实话 */
A.push(["settings-copy", 1,
`缩放太小放不下时隐藏站名（而不是压在线路上）`,
`缩放太小放不下时隐藏普通站名（换乘站铭牌始终保留，宁可盖住线）`]);

/* 4) 常驻断言：真值表 + 真实图纸行为 + 几何前提一起量 */
A.push(["case", 1,
`    t("视图记账只认用户发起的移动：程序换图不落账，容器上的真实输入才算", () => {`,
`    t("铭牌裁除按优先级：换乘站无处可放也保留，普通站仍按不压线隐藏", () => {
      const bad = [];
      /* 1) 判据真值表（四格全量，少一格都可能把"全显"或"全裁"当成修好了） */
      if (labelShouldHide(true, true, true) !== false) bad.push("换乘+压线仍被藏（例外没生效）");
      if (labelShouldHide(true, false, true) !== true) bad.push("普通+压线没被藏（原规则被顺手改了）");
      if (labelShouldHide(false, false, true) !== false) bad.push("普通+不压线被误藏");
      if (labelShouldHide(true, false, false) !== false) bad.push("关了'缩放太小隐藏'还在裁（开关失效）");
      /* 2) 几何前提必须在当前这张图上成立，否则下面那条"换乘全显"什么都没证明 */
      const savedView = [map.getCenter(), map.getZoom()], savedLock = viewLockUntil;
      let xfTot = 0, xfShown = 0, nrCull = 0, zeroClean = 0, detailTxt = "没走到实测那一步";
      try {
        viewLockUntil = Infinity;
        let picked = null;
        for (const z of [10, 11, 12, 9]) {
          map.setView(P.center, z, { animate: false }); renderAll();
          const vis = collectVisible();
          let zc = 0, xt = 0;
          vis.forEach((v) => {
            if (!v.xfer) return;
            xt++;
            let clean = 0;
            const sz = labelSize(v.st.name, 13.5);
            for (const side of SIDE_ORDER) {
              const r = labelRect(v.px.x, v.px.y, side, sz, 10);
              let hit = false;
              for (const line of labelObstacles) {
                for (let i = 0; i < line.length - 1; i++) { if (segHitsRect(line[i], line[i + 1], r)) { hit = true; break; } }
                if (hit) break;
              }
              if (!hit) clean++;
            }
            if (clean === 0) zc++;
          });
          if (xt > 0 && zc / xt >= 0.5) { picked = { z: z, xfTot: xt, zeroClean: zc }; break; }
        }
        if (!picked) return { ok: false, detail: "四档缩放里都没找到\"过半换乘站无处可放\"的场景，这条用例测不出优先级" };
        xfTot = picked.xfTot; zeroClean = picked.zeroClean;
        const vis = collectVisible();
        vis.forEach((v) => {
          const shown = !!labelMarkers[v.st.id];
          if (v.xfer) { if (shown) xfShown++; }
          else if (!shown) nrCull++;
        });
        if (xfShown < Math.min(xfTot, zeroClean)) bad.push("无处可放的换乘站还是有 " + (Math.min(xfTot, zeroClean) - xfShown) + " 张没显出来");
        if (nrCull <= 0) bad.push("普通站一张都没被裁（隐藏规则被整条关掉了，判据第 2 格只在真值表里验过）");
        detailTxt = "真值表 4/4；Z" + picked.z + " 有 " + zeroClean + "/" + xfTot + " 张换乘铭牌八方全压线，实测保留 " + xfShown + " 张，同场景普通站裁 " + nrCull + " 张（原规则还活着）";
      } finally {
        viewLockUntil = savedLock;
        map.setView(savedView[0], savedView[1], { animate: false }); renderAll();
        viewLockUntil = performance.now() + 2400; userViewAt = -Infinity;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") : detailTxt };
    });
    t("视图记账只认用户发起的移动：程序换图不落账，容器上的真实输入才算", () => {`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
/* 残留与接线检查 */
if (out.split("if (r.hitLine && settings.cullLabels !== false)").length - 1 !== 0) { console.log("ABORT: 旧判据仍在"); process.exit(1); }
if (out.split("labelShouldHide(").length - 1 < 6) { console.log("ABORT: 判据调用点太少"); process.exit(1); }
if (out.split("pickedDesc(").length - 1 !== 0) { console.log("ABORT: 用例里还有越界引用 picked 的写法"); process.exit(1); }
if (out.split("zc / xt >= 0.5").length - 1 !== 1) { console.log("ABORT: 用例的除法被写坏了"); process.exit(1); }
if (out.split("labelMarkers[v.st.id]").length - 1 !== 1) { console.log("ABORT: 可见性判据没接上 labelMarkers"); process.exit(1); }
fs.writeFileSync(P, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
