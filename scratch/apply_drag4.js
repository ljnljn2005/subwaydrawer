/* scratch/apply_drag4.js —— 修那条算错的期望（只用单行锚点）。
   背景：原期望"挪 idx1 到末尾会把两段弯道一起拆掉"，但 [0,1,2,3,4] 挪 1 到末尾得到
   [0,2,3,4,1]，其中 2>3 仍然相邻 ⇒ 活跃 1、休眠 1 才是对的。改成挪"两段共用的那一颗"
   （idx2）到末尾：[0,1,3,4,2] 里 1>2 与 2>3 都不再相邻，才真的能验"同时休眠"。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let s = fs.readFileSync(F, "utf8");
const R = [
  ["if (!reorderStation(L().id, 1, ids.length)) bad.push(", "if (!reorderStation(L().id, 2, ids.length)) bad.push("],
  ["if (L().stations[ids.length - 1] !== ids[1])", "if (L().stations[ids.length - 1] !== ids[2])"],
  ["const solo = synthProject(1, 1); P = solo;",
   "const solo = synthProject(3, 1); solo.lines[0].stations = [solo.lines[0].stations[0]]; P = solo;"]
];
for (const [a, b] of R) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log("ABORT hits=" + n + " :: " + a.slice(0, 52)); process.exit(1); }
  s = s.split(a).join(b);
}
/* 改完必须自洽：两处期望都指向 idx2，且不再有 idx1 版残留 */
if (s.split("reorderStation(L().id, 2, ids.length)").length - 1 !== 1) { console.log("ABORT: 重排调用没改成 idx2"); process.exit(1); }
if (s.split("!== ids[2]) bad.push(\"没落到末尾").length - 1 !== 1) { console.log("ABORT: 末尾断言没改成 ids[2]"); process.exit(1); }
fs.writeFileSync(F, s, "utf8");
console.log("ok bytes=" + Buffer.byteLength(s, "utf8"));
