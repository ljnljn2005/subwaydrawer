/* GitHub Pages 仅发布应用与列明的依赖；本地存档、种子图纸和维护文件都不进入产物。 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, ".pages-site");
const META = '<meta name="subwaystudio-hosting" content="static">';
const ANCHOR = '<meta charset="utf-8">';
const ASSETS = [
  "vendor/leaflet.css",
  "vendor/leaflet.js",
  "vendor/pinyin-pro.js",
  "vendor/pinyin-pro.LICENSE.txt",
  "vendor/pinyin-pro.README.txt"
];

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (html.split(ANCHOR).length !== 2) throw new Error("Pages 构建要求唯一 charset 标记");
if (html.includes(META)) throw new Error("静态发布标记只应由 Pages 构建添加");
const reads = ASSETS.map((name) => {
  const file = path.join(ROOT, name);
  if (!fs.lstatSync(file).isFile()) throw new Error("发布依赖必须是普通文件：" + name);
  return { name, data: fs.readFileSync(file) };
});

/* 清理前核对绝对目标，拒绝对工作区之外或其它目录执行递归删除。 */
if (path.dirname(OUT) !== ROOT || path.basename(OUT) !== ".pages-site") throw new Error("发布目录不在预期位置");
if (fs.existsSync(OUT) && (!fs.lstatSync(OUT).isDirectory() || fs.lstatSync(OUT).isSymbolicLink())) {
  throw new Error("发布目录必须是工作区内的普通目录");
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "vendor"), { recursive: true });
fs.writeFileSync(path.join(OUT, "index.html"), html.replace(ANCHOR, ANCHOR + "\n" + META));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
reads.forEach(({ name, data }) => fs.writeFileSync(path.join(OUT, name), data));

const published = ["index.html", ".nojekyll", ...ASSETS];
const found = [];
function list(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) list(file);
    else found.push(path.relative(OUT, file).split(path.sep).join("/"));
  });
}
list(OUT);
if (JSON.stringify(found.sort()) !== JSON.stringify(published.slice().sort())) {
  throw new Error("静态发布内容与允许名单不一致");
}
reads.forEach(({ name, data }) => {
  if (!fs.readFileSync(path.join(OUT, name)).equals(data)) throw new Error("依赖复制校验失败：" + name);
});
console.log(JSON.stringify({ ok: true, output: path.relative(ROOT, OUT), files: published, seedsIncluded: false }));
