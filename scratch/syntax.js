/* scratch/syntax.js — 语法/体积闸：把 index.html 里所有内联 <script> 用 vm 编译一遍，
   再报字节数、断言条数、LAST_INLINE 指纹。改完文件先跑它，别直接上浏览器。 */
const fs = require("fs"), vm = require("vm");
const p = process.argv[2] || "D:/Coding/subwaydrawer/index.html";
const src = fs.readFileSync(p, "utf8");
const bytes = Buffer.byteLength(src, "utf8");
const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let ok = true, acc = 0;
blocks.forEach((b, i) => {
  try { new vm.Script(b, { filename: p + "#" + i }); }
  catch (e) { ok = false; console.log("BLOCK " + i + " SYNTAX ERROR: " + e.message); }
  acc += b.length;
});
const cases = (src.match(/\bt\(\s*["'`]/g) || []).length + (src.match(/R\.push\(\{\s*name:/g) || []).length;
console.log(JSON.stringify({ file: p, bytes, blocks: blocks.length, srcLen: acc, cases, syntax: ok ? "OK" : "FAIL" }));
console.log("LAST_INLINE " + JSON.stringify(src.slice(src.lastIndexOf("<script")).slice(0, 120)));
process.exit(ok ? 0 : 1);
