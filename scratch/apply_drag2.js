/* scratch/apply_drag2.js —— 站序拖拽 + 弯道休眠口径（与 apply_drag.js 同内容，重写一遍）
   锚点/接线计数任何一条不对就一个字节都不写。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let src = fs.readFileSync(F, "utf8");
const Q = String.fromCharCode(34);
const A = [];

A.push(["css", 1,
`.stn.is-sel{background:#1B2532;box-shadow:inset 2px 0 0 var(--signal)}`,
`.stn.is-sel{background:#1B2532;box-shadow:inset 2px 0 0 var(--signal)}
.stn[draggable="true"]{cursor:grab;user-select:none}
.stn.dragging{opacity:.4}
.stn.drop-before{box-shadow:inset 0 2px 0 var(--signal)}
.stn.drop-after{box-shadow:inset 0 -2px 0 var(--signal)}`]);

A.push(["row", 1,
`    return '<div class="stn' + (xfer ? " is-x" : "") + (sel2 ? " is-sel" : "") + '" data-id="' + id + '" style="--lc:' + c + '">' +`,
`    return '<div class="stn' + (xfer ? " is-x" : "") + (sel2 ? " is-sel" : "") +
      '" data-id="' + id + '" data-idx="' + i + '" draggable="true"' +
      ' title="拖动可改站序（当前第 ' + (i + 1) + ' 站）" style="--lc:' + c + '">' +`]);

A.push(["logic", 1,
`function bendCount(l) { return Object.keys(l.bends || {}).filter((k) => curved(l.bends[k])).length; }`,
`/* 曲线数只算「现在真的相邻的那一段」。站序可以拖拽改（见 reorderStation），被拆开的
   那一段上的弯道不删：键留在 bends 里，但 lineShape 按相邻站对取键，所以它不再被读到，
   等于休眠，顺序挪回去手调的曲线原样回来。存盘校验只查形状、不要求键必须相邻，
   留着是安全的。但面板上的计数与「全部改直」的可用性必须跟着画面走 ——
   否则面板说 3 处、图上只画 1 处，就是当着用户的面说谎。 */
function adjacentBendKeys(l) {
  const ids = shapeIds(l), s = {};
  for (let i = 0; i + 1 < ids.length; i++) s[bendKey(ids[i], ids[i + 1])] = 1;
  return s;
}
function bendCount(l) {
  const ids = shapeIds(l), b = l.bends || {};
  let n = 0;
  for (let i = 0; i + 1 < ids.length; i++) if (curved(b[bendKey(ids[i], ids[i + 1])])) n++;
  return n;
}
/* 休眠中的弯道数：键还在、形状也有效，只是那两头不再相邻 */
function dormantBendCount(l) {
  const adj = adjacentBendKeys(l), b = l.bends || {};
  return Object.keys(b).filter((k) => !adj[k] && curved(b[k])).length;
}`]);

A.push(["reorder", 1,
`function moveStation(lid, idx, dir) {`,
`/* 拖拽改站序。三个坑：
   1) 行必须带自己的下标：一条线可以重复访问同一个站（visibleLineIndexAll 里那个
      seen Set 就是为准），拿 stations.indexOf(id) 会动到第一次出现的那一个；
   2) to 是「插到第 to 个之前」：先把被拖的那颗摘掉，它后面的下标整体左移一格；
   3) pendingInsert 按 index 记锚点，顺序一变它就指错地方，必须作废。
   弯道一律保留（被拆开的转休眠），绝不静默删用户手调的形状。 */
function reorderStation(lid, from, to) {
  const l = line(lid); if (!l) return false;
  const n = l.stations.length;
  if (!(n > 1) || from < 0 || from >= n) return false;
  if (to < 0 || to > n || from === to || from === to - 1) return false;
  const moved = l.stations[from];
  pushHistory();
  const a = l.stations, wasCurved = bendCount(l);
  a.splice(from, 1);
  a.splice(from < to ? to - 1 : to, 0, moved);
  pendingInsert = null;
  renderAll(); markDirty();
  const dorm = dormantBendCount(l);
  toast("「" + station(moved).name + "」已挪到第 " + (a.indexOf(moved) + 1) + " 位" +
    (dorm ? " · " + dorm + " 处弯道暂时休眠（挪回去就还在）；曲线 " + wasCurved + "→" + bendCount(l) + " 处" : ""), "good");
  return true;
}

function moveStation(lid, idx, dir) {`]);

A.push(["wire", 1,
`  const sl = $("#stnList");
  sl.addEventListener("click", (e) => {`,
`  const sl = $("#stnList");
  /* 拖拽改站序：行上半区=插到它之前，下半区=插到它之后，落点线画在哪就插到哪。 */
  let stnDrag = null;
  const clearStnDrop = () => { $$(".stn").forEach((x) => x.classList.remove("drop-before", "drop-after", "dragging")); };
  const stnDropIdx = (row, y) => {
    const r = row.getBoundingClientRect(), t = +row.dataset.idx;
    return (y - r.top) < r.height / 2 ? t : t + 1;
  };
  sl.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".stn");
    if (!row || e.target.tagName === "INPUT") { stnDrag = null; e.preventDefault(); return; }
    stnDrag = +row.dataset.idx; row.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", row.dataset.id); } catch (err) {}
    }
  });
  sl.addEventListener("dragover", (e) => {
    const row = e.target.closest(".stn"); if (!row || stnDrag === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const at = stnDropIdx(row, e.clientY);
    $$(".stn").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    row.classList.add(at === +row.dataset.idx ? "drop-before" : "drop-after");
  });
  sl.addEventListener("drop", (e) => {
    const row = e.target.closest(".stn"); if (!row || stnDrag === null) return;
    e.preventDefault();
    reorderStation(sel.line, stnDrag, stnDropIdx(row, e.clientY));
    stnDrag = null; clearStnDrop();
  });
  sl.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".stn"); if (row) row.classList.remove("drop-before", "drop-after");
  });
  sl.addEventListener("dragend", () => { stnDrag = null; clearStnDrop(); });
  sl.addEventListener("click", (e) => {`]);

A.push(["hint", 1,
`: "点击选线 / 选站，拖动圆点改位置，滚轮缩放地图",`,
`: "点击选线 / 选站，拖动圆点改位置，右侧列表拖行改站序，滚轮缩放地图",`]);

A.push(["case", 1,
`    t("铭牌裁除按优先级：换乘站无处可放也保留，普通站仍按不压线隐藏", () => {`,
`    t("拖拽改站序：弯道只休眠不删除，曲线计数跟着画面，重复访问的站不会动错那一个", () => {
      const savedP = P, savedSel = { line: sel.line, station: sel.station }, savedLock = viewLockUntil, savedPI = pendingInsert;
      const savedHist = hist, savedFut = future;
      const bad = [];
      try {
        const p = synthProject(5, 1);
        p.lines[0].loop = false;
        P = p; sel.line = p.lines[0].id; sel.station = null; pendingInsert = null;
        hist = []; future = [];
        const L = () => P.lines[0], ord = () => L().stations.join(",");
        const ids = L().stations.slice();
        L().bends = {};
        L().bends[bendKey(ids[1], ids[2])] = [{ along: 0.5, normal: 0.4 }];
        L().bends[bendKey(ids[2], ids[3])] = [{ along: 0.5, normal: -0.3 }];
        renderAll();
        if (bendCount(L()) !== 2) bad.push("开局曲线数应为 2，实际 " + bendCount(L()));
        if (!reorderStation(L().id, 1, ids.length)) bad.push("拖到末尾没受理");
        if (L().stations[ids.length - 1] !== ids[1]) bad.push("没落到末尾：" + ord());
        if (Object.keys(L().bends).length !== 2) bad.push("被拆开的弯道被删了，只剩 " + Object.keys(L().bends).length + " 键");
        if (bendCount(L()) !== 0) bad.push("画面上已没有相邻曲线，计数还报 " + bendCount(L()) + " 处");
        if (dormantBendCount(L()) !== 2) bad.push("休眠数应为 2，实际 " + dormantBendCount(L()));
        if (hist.length !== 1) bad.push("一次重排应当只压一层撤销栈，实际 " + hist.length);
        L().stations = ids.slice(); renderAll();
        if (bendCount(L()) !== 2) bad.push("挪回原位后曲线数没回到 2，实际 " + bendCount(L()));
        if (dormantBendCount(L()) !== 0) bad.push("挪回原位后还报 " + dormantBendCount(L()) + " 处休眠");
        reorderStation(L().id, 0, 2);
        const c1 = bendCount(L()), d1 = dormantBendCount(L());
        if (c1 + d1 !== 2) bad.push("两处弯道的总数不该随重排变化，现在 " + c1 + "+" + d1);
        if (!(c1 >= 1)) bad.push("仍相邻的那一段没被算进活跃数（活跃=" + c1 + "）");
        const dup = synthProject(3, 1);
        dup.lines[0].loop = false;
        const dA = dup.lines[0].stations[0], dB = dup.lines[0].stations[1], dC = dup.lines[0].stations[2];
        dup.lines[0].stations = [dA, dB, dA, dC];
        P = dup; sel.line = dup.lines[0].id; hist = []; future = []; renderAll();
        const rows = $$(".stn");
        if (rows.length !== 4) bad.push("列表把重复访问的站吞成一行了（" + rows.length + " 行）");
        if (!rows[2] || rows[2].dataset.id !== dA) bad.push("第 3 行的 data-id 不是那个重复站");
        if (!rows[0] || rows[0].dataset.idx !== "0") bad.push("行没带自己的下标（重排会动错那一个）");
        if (rows[0] && rows[0].getAttribute("draggable") !== "true") bad.push("行不可拖，功能没接上");
        if (!reorderStation(dup.lines[0].id, 2, 0)) bad.push("移动第二次出现的那个站没受理");
        if (dup.lines[0].stations.join(",") !== [dA, dA, dB, dC].join(",")) bad.push("动成了第一次出现的那个：" + dup.lines[0].stations.join(","));
        if (reorderStation(dup.lines[0].id, 0, 99) || reorderStation(dup.lines[0].id, -1, 2)) bad.push("越界下标没拦住");
        const h2 = hist.length, o2 = dup.lines[0].stations.join(",");
        if (reorderStation(dup.lines[0].id, 0, 0) || reorderStation(dup.lines[0].id, 0, 1)) bad.push("原地落点被当成改动受理了");
        if (hist.length !== h2 || dup.lines[0].stations.join(",") !== o2) bad.push("原地落点还是改了数据");
        const solo = synthProject(1, 1); P = solo; sel.line = solo.lines[0].id; renderAll();
        if (reorderStation(solo.lines[0].id, 0, 1)) bad.push("单站线居然能重排");
      } catch (e) { bad.push("抛错：" + e.message); }
      finally {
        inSelfTest = true;
        P = savedP; sel.line = savedSel.line; sel.station = savedSel.station; pendingInsert = savedPI;
        hist = savedHist; future = savedFut; updateHistoryButtons();
        clearMarkerPools(); renderAll();
        viewLockUntil = performance.now() + 2400; userViewAt = -Infinity;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join("；") :
        "挪到末尾：bends 两键不丢、活跃曲线 2→0、休眠 0→2、只压一层撤销栈；挪回原位活跃数回到 2；只拆一段时活跃+休眠恒为 2；重复访问的站按行下标移动（行带 data-idx 且 draggable）；越界、原地落点、单站线全部拒收" };
    });
    t("铭牌裁除按优先级：换乘站无处可放也保留，普通站仍按不压线隐藏", () => {`]);

let out = src;
for (const [label, expect, oldS, newS] of A) {
  const n = out.split(oldS).length - 1;
  if (n !== expect) { console.log("ABORT " + label + " 命中 " + n + "（应为 " + expect + "），未写文件"); process.exit(1); }
  out = out.split(oldS).join(newS);
}
const cnt = (hay, s) => hay.split(s).length - 1;
const checks = [
  ["reorderStation 定义", cnt(out, "function reorderStation("), 1],
  ["拖拽接到重排", cnt(out, "reorderStation(sel.line, stnDrag"), 1],
  /* 这两条按"这一补丁新增了几处"判，不写死绝对数：线路行本来就带 data-idx /
     draggable，绝对数会随无关改动漂移，写死只会让闸门有一天变成假红或假绿。 */
  ["data-idx 新增数", cnt(out, "data-idx=" + Q) - cnt(src, "data-idx=" + Q), 1],
  ["draggable=true 新增数", cnt(out, "draggable=" + Q + "true" + Q) - cnt(src, "draggable=" + Q + "true" + Q), 2],
  ["bendCount 定义", cnt(out, "function bendCount(l)"), 1],
  ["dormantBendCount 定义", cnt(out, "function dormantBendCount(l)"), 1],
  ["旧 bendCount 已消失", cnt(out, "return Object.keys(l.bends || {}).filter((k) => curved(l.bends[k])).length"), 0],
  ["新增反转义引号", cnt(out, String.fromCharCode(92) + Q) - cnt(src, String.fromCharCode(92) + Q), 0]
];
for (const [name, got, want] of checks) {
  if (got !== want) { console.log("ABORT: " + name + " = " + got + "（应为 " + want + "），未写文件"); process.exit(1); }
}
fs.writeFileSync(F, out, "utf8");
console.log(JSON.stringify({ bytesBefore: Buffer.byteLength(src, "utf8"), bytesAfter: Buffer.byteLength(out, "utf8") }));
