/* scratch/apply_drag3.js —— 只改那条算错的测试期望（单行锚点，避开多行匹配的不确定性）。
   目标：把"挪中间那站让两段同时散掉"这一步写对。 */
const fs = require("fs");
const F = "D:/Coding/subwaydrawer/index.html";
let s = fs.readFileSync(F, "utf8");
const R = [
  ["(L().id, 1, ids.length)", "(L().id, 2, ids.length)"],
  ["if (L().stations[ids.length - 1] !== ids[1])", "if (L().stations[ids.length - 1] !== ids[2])"],
  ["/* 1) 把第 2 站挪到最末：两段都散了", "/* 1) 把两段共用的那一站（中间那站）挪到最末：只有它能同时拆掉两段（[0,1,2,3,4] 挪 idx2 ⇒ [0,1,3,4,2]，1>2 与 2>3 都不再相邻）：两段都散了"],
  ["reorderStation(L().id, 0, 2);", "reorderStation(L().id, 0, 2);   /* 只挪一颗：必然留下一段仍相邻 */"]
];
for (const [a, b] of R) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.log("ABORT hits=" + n + " :: " + a.slice(0, 48)); process.exit(1); }
  s = s.split(a).join(b);
}
if (s.split("ids[2]) bad.push").length - 1 !== 1) { console.log("ABORT: 末尾断言没接上 ids[2]"); process.exit(1); }
fs.writeFileSync(F, s, "utf8");
console.log("expectations corrected, bytes=" + Buffer.byteLength(s, "utf8"));
