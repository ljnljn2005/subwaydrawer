/* scratch/sync.js —— 生成 dist/：把应用源复制成服务器要出的那份。
   为什么要有这个脚本：`index.html` 改了但忘了同步，服务器就一直在出旧版（踩过多次）。
   dist/data/ 是种子图纸的唯一原件，本脚本绝不碰它；只复制 index.html 与 vendor/。
   复制后逐字节校验，不一致就报错退出 —— 宁可红，不要静默出旧版。 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const files = [];
const walk = (dir, base) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base);
    else files.push({ from: p, to: path.join(base, path.relative(dir === ROOT ? ROOT : dir, p)) });
  });
};

const plan = [];
plan.push({ from: path.join(ROOT, "index.html"), to: path.join(DIST, "index.html") });
fs.readdirSync(path.join(ROOT, "vendor")).forEach((n) => {
  plan.push({ from: path.join(ROOT, "vendor", n), to: path.join(DIST, "vendor", n) });
});

let changed = 0;
plan.forEach((j) => {
  const a = fs.readFileSync(j.from);
  fs.mkdirSync(path.dirname(j.to), { recursive: true });
  let b = null;
  try { b = fs.readFileSync(j.to); } catch (e) {}
  if (b && b.equals(a)) return;
  fs.writeFileSync(j.to, a);
  changed++;
  console.log("同步 " + path.relative(ROOT, j.to) + " (" + a.length + " 字节" + (b ? "，原 " + b.length : "，新建") + ")");
});

const bad = [];
plan.forEach((j) => {
  const a = fs.readFileSync(j.from), b = fs.readFileSync(j.to);
  if (!a.equals(b)) bad.push(path.relative(ROOT, j.to));
});
if (bad.length) { console.log("FAIL: 复制后仍不一致 " + bad.join(", ")); process.exit(1); }
console.log(JSON.stringify({ ok: true, copied: changed, checked: plan.length, dist: path.relative(ROOT, DIST) + "/" }));
