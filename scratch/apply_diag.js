/* scratch/apply_diag.js —— 标准线路图两处观感缺陷：
   (1) 包围盒只算站点/折线，铭牌与编号牌是事后贴的 ⇒ 边上站名顶到离画布 10px、别处 110px，整幅歪；
   (2) 示意图里 5 张铭牌压线（屏幕侧可以隐藏，成果图少一个字就是缺陷）⇒ 给压线的再解一次、退远一档。
   两条都配常驻断言。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const A = [];

A.push(["frame", 1,
`  const pad = SCHEME.PAD;
  const visL = P.lines.filter((l) => l.visible);
  const LG = legendGeom(visL, SCHEME.W, true);      // 示意图的图例带"环线/在建"注记，量宽要按带注记算
  const padT = pad, padB = Math.max(pad, LG.blockH + 46);   // 下边距容得下图例，画心自己缩
  const vw = x1 - x0 || 1, vh = y1 - y0 || 1;
  const k = (SCHEME.W - pad * 2) / vw;
  const W = Math.round(vw * k + pad * 2);
  const H = Math.round(vh * k + padT + padB);
  const X = (x) => (x - x0) * k + pad;
  const Y = (y) => (y - y0) * k + padT;`,
`  const pad = SCHEME.PAD;
  const visL = P.lines.filter((l) => l.visible);
  const LG = legendGeom(visL, SCHEME.W, true);      // 示意图的图例带"环线/在建"注记，量宽要按带注记算
  /* 画幅以前只按站点与折线的盒子算，铭牌和编号牌是事后贴上去的：实测最右一张站名
     离画布边只剩 10 px，而别处留 110 px —— 整幅图看着就是歪的、还贴边。
     这里按"实际最长站名 + 最宽编号牌"把四周余量补齐：画心缩放 k 一点不动
     （形状、字节口径与原来同构），只是把画布放大到能让墨迹离四边一样远。 */
  let labW = 0, badgeW = 0;
  Object.keys(pos).forEach((id) => { const s = station(id); if (s) labW = Math.max(labW, textWidth(s.name, 14, 600)); });
  if (settings.showBadges !== false) P.lines.forEach((l) => { badgeW = Math.max(badgeW, textWidth(String(l.badge || ""), 13, 700) + 8); });
  const allowX = Math.ceil(labW) + 20 + badgeW + 22, allowY = 26;
  const padL = pad + allowX, padR = pad + allowX;
  const padT = pad + allowY, padB = Math.max(pad, LG.blockH + 46) + allowY;   // 下边距容得下图例，画心自己缩
  const vw = x1 - x0 || 1, vh = y1 - y0 || 1;
  const k = (SCHEME.W - pad * 2) / vw;
  const W = Math.round(vw * k + padL + padR);
  const H = Math.round(vh * k + padT + padB);
  const X = (x) => (x - x0) * k + padL;
  const Y = (y) => (y - y0) * k + padT;`]);

A.push(["relief", 1,
`  const sSides = solveSides(sItems, sObs, 13, 11);`,
`  /* 屏幕侧放不下可以隐藏，成果图不行 —— 少一个字就是缺陷。所以第一轮压了线的，
     把它连同"别人已经占下的位置"一起再解一次，退远一档，只接受不压线的结果；
     解不动的保持原位（至少不会更糟）。 */
  const sSides = solveSides(sItems, sObs, 13, 11);
  const stuckS = sItems.filter((it) => sSides[it.id] && sSides[it.id].hitLine);
  if (stuckS.length) {
    const taken = [];
    sItems.forEach((it) => {
      const r = sSides[it.id];
      if (!r || r.hitLine) return;
      taken.push({ id: it.id, r: labelRect(it.x, it.y, r.side, labelSize(it.text, it.fs), 13) });
    });
    const relief = solveSides(stuckS, sObs, 26, 20, null, taken);
    stuckS.forEach((it) => { const r = relief[it.id]; if (r && !r.hitLine) sSides[it.id] = r; });
  }`]);

/* 常驻断言：墨迹离四边必须一样远（两种导出都验），且示意图压线铭牌不得多于 2 张 */
A.push(["case", 1,
`    t("导出：图例不吃画心、不出画幅，且 SVG 是合法 XML", () => {`,
`    t("导出：墨迹离画布四边一样远（不许贴边），示意图压线的站名不超过 2 张", () => {
      const bad = [];
      const savedP = P, savedSel = sel, savedView = [map.getCenter(), map.getZoom()];
      const M = 108;                       // SCHEME.PAD - 2：四周至少留这么远
      const inkBox = (svg) => {
        const W = +svg.match(/<svg[^>]*width="([\\d.]+)"/)[1], H = +svg.match(/<svg[^>]*height="([\\d.]+)"/)[1];
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        /* 站点与折线 */
        [...svg.matchAll(/<circle[^>]*cx="([-\d.]+)" cy="([-\d.]+)"[^>]*r="([-\d.]+)"/g)].forEach((m) => {
          const cx = +m[1], cy = +m[2], r = +m[3] + 2;
          x0 = Math.min(x0, cx - r); x1 = Math.max(x1, cx + r); y0 = Math.min(y0, cy - r); y1 = Math.max(y1, cy + r);
        });
        [...svg.matchAll(/<polyline points="([^"]+)"/g)].forEach((m) => {
          m[1].trim().split(/\\s+/).forEach((p) => { const q = p.split(","); x0 = Math.min(x0, +q[0]); x1 = Math.max(x1, +q[0]); y0 = Math.min(y0, +q[1]); y1 = Math.max(y1, +q[1]); });
        });
        /* 铭牌：按锚点与实量宽推出矩形 */
        [...svg.matchAll(/<text class="lbl" x="([-\\d.]+)" y="([-\\d.]+)" text-anchor="(start|end|middle)"[^>]*font-size="(\\d+)"[^>]*>([^<]*)<\\/text>/g)].forEach((m) => {
          const w = labelSize(m[6], +m[5]).w, h = +m[5] + 9, x = +m[1], y = +m[2];
          const l = m[3] === "middle" ? x - w / 2 : m[3] === "end" ? x - w : x;
          x0 = Math.min(x0, l); x1 = Math.max(x1, l + w); y0 = Math.min(y0, y - h + 3); y1 = Math.max(y1, y + 4);
        });
        return { W: W, H: H, l: Math.round(x0), t: Math.round(y0), r: Math.round(W - x1), b: Math.round(H - y1) };
      };
      const onLine = (svg) => {
        const segs = [];
        [...svg.matchAll(/<polyline points="([^"]+)"/g)].forEach((m) => {
          const pts = m[1].trim().split(/\\s+/).map((p) => p.split(",").map(Number));
          for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
        });
        let n = 0;
        [...svg.matchAll(/<text class="lbl" x="([-\\d.]+)" y="([-\\d.]+)" text-anchor="(start|end|middle)"[^>]*font-size="(\\d+)"[^>]*>([^<]*)<\\/text>/g)].forEach((m) => {
          const w = labelSize(m[6], +m[5]).w, h = +m[5] + 9, x = +m[1], y = +m[2];
          const l = (m[3] === "middle" ? x - w / 2 : m[3] === "end" ? x - w : x) + 2, tp = y - h + 5;
          for (const s of segs) {
            const ax = Math.min(s[0][0], s[1][0]), bx = Math.max(s[0][0], s[1][0]);
            const ay = Math.min(s[0][1], s[1][1]), by = Math.max(s[0][1], s[1][1]);
            if (bx < l || ax > l + w - 4 || by < tp || ay > tp + h - 4) continue;
            for (let t = 0; t <= 1.0001; t += 0.05) {
              const px = s[0][0] + (s[1][0] - s[0][0]) * t, py = s[0][1] + (s[1][1] - s[0][1]) * t;
              if (px > l && px < l + w - 4 && py > tp && py < tp + h - 4) { n++; return; }
            }
          }
        });
        return n;
      };
      try {
        inSelfTest = true;
        [[24, 3], [60, 5]].forEach(([N, L]) => {
          P = synthProject(N, L); sel = { line: P.lines[0].id, station: null };
          map.setView(P.center, 13, { animate: false }); renderMap();
          const g = inkBox(buildSVG().svg), d = inkBox(buildSchematicSVG().svg);
          [[g, "地理图"], [d, "标准图"]].forEach(([b, nm]) => {
            if (Math.min(b.l, b.t, b.r, b.b) < M) bad.push(nm + " 墨迹离边只有 " + Math.min(b.l, b.t, b.r, b.b) + "px（应 ≥" + M + "）：" + JSON.stringify(b));
          });
          const o = onLine(buildSchematicSVG().svg);
          if (o > 2) bad.push("L" + L + " 标准图有 " + o + " 张站名压在线路上（应 ≤2）");
        });
        /* 负对照：故意把左右余量抽掉一档，贴边判据必须变红 —— 否则这条断言根本没在看东西 */
        const P0 = P;
        try {
          P = synthProject(24, 3); sel = { line: P.lines[0].id, station: null }; map.setView(P.center, 13, { animate: false }); renderMap();
          const keep = SCHEME.PAD;
          try { SCHEME.PAD = 8; const b = inkBox(buildSchematicSVG().svg);
            if (Math.min(b.l, b.t, b.r, b.b) >= M) bad.push("负对照失效：把 PAD 抽到 8 也没测出贴边");
          } finally { SCHEME.PAD = keep; clearLayoutCache(); }
          P = P0;
        } catch (e) { bad.push("负对照抛错：" + e.message); }
      } catch (e) { bad.push("抛错：" + e.message); }
      finally {
        inSelfTest = true; P = savedP; sel = savedSel;
        map.setView(savedView[0], savedView[1], { animate: false }); clearMarkerPools(); renderAll();
        viewLockUntil = performance.now() + 2400; userViewAt = -Infinity;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") :
        "两种导出的墨迹离四边都 ≥108px（原来右边只剩 10px）；标准图压线站名 ≤2 张；负对照（PAD 抽到 8）能被抓住" };
    });
    t("导出：图例不吃画心、不出画幅，且 SVG 是合法 XML", () => {`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const cnt = (h, s) => h.split(s).length - 1;
const checks = [
  ["旧画幅算法已消失", cnt(out, "const W = Math.round(vw * k + pad * 2);"), 0],
  ["新画幅算法", cnt(out, "const W = Math.round(vw * k + padL + padR);"), 1],
  ["退远重解接上", cnt(out, "const relief = solveSides(stuckS, sObs, 26, 20, null, taken);"), 1],
  ["新断言接上", cnt(out, "墨迹离画布四边一样远"), 1]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
