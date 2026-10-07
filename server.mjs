/* 本机服务器 + 局域网存档（给"换个设备继续画"用）
   ─ 静态：服务 ./dist（没有就服务命令行给的目录），无缓存，防目录穿越
   ─ 存档：./saves 下的具名 JSON，读写都要口令
   ─ 口令：./saves/../.archive-key 首次启动随机生成并打印；也可以设环境变量 ARCHIVE_KEY
   ─ 只监听 0.0.0.0:PORT（默认 8848）；端口被占用直接报错退出，不悄悄换端口

   安全边界（如实说明）：口令走 HTTP 明文，只在可信局域网里够用；口令存在浏览器
   localStorage 里，换一台没登录过的设备要重新输一次。saves/ 与 .archive-key 都在
   webDirectory(dist) 之外，静态路径取不到它们。 */
import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, stat, readdir, unlink } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = resolve(process.argv[2] || "./dist");
const SAVE_DIR = resolve(process.argv[3] || "./saves");
const KEY_FILE = resolve("./.archive-key");
const MAX_BYTES = 8 * 1024 * 1024;          // 单份存档上限 8 MB
const MAX_LIST = 200;                        // 最多列这么多份，防目录爆炸

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};

async function loadKey() {
  if (process.env.ARCHIVE_KEY) return String(process.env.ARCHIVE_KEY);
  try {
    const k = (await readFile(KEY_FILE, "utf8")).trim();
    if (k) return k;
  } catch (e) { /* 还没有就生成一枚 */ }
  const k = randomBytes(12).toString("hex");
  await writeFile(KEY_FILE, k + "\n", "utf8");
  return k;
}
let ARCHIVE_KEY = "";

/* 存档名：允许中文（用户就叫"廊坊地铁"），但必须挡住路径穿越与花活。
   拒：空、超长、以 . 开头、含 / \ .. 或控制字符。这是纯函数，自检有真值表。 */
function nameOk(raw) {
  const n = String(raw == null ? "" : raw);
  if (!n || !n.trim() || n.length > 64) return false;   // 全空格也算空：那会生成一份"没有名字"的存档
  if (n[0] === "." || n.includes("..")) return false;
  if (/[\/\\\u0000-\u001f]/.test(n)) return false;
  return /^[A-Za-z0-9_\u4e00-\u9fa5.\- ]+$/.test(n);
}
function savePath(name) { return join(SAVE_DIR, name + ".json"); }

function keyGiven(req, url) {
  const h = req.headers["x-archive-key"];
  if (typeof h === "string" && h) {
    /* 浏览器那侧把口令 encodeURIComponent 过再塞进 header（HTTP 头只允许 latin-1，
       中文口令裸写会让 fetch 直接抛）。这里同款 decode，纯 ASCII 口令两边都无感。 */
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }
  const q = url.searchParams.get("key");
  return typeof q === "string" ? q : "";
}
function keyOk(req, url) {
  const got = Buffer.from(keyGiven(req, url), "utf8");
  const want = Buffer.from(ARCHIVE_KEY, "utf8");
  /* 长度不等直接 false：timingSafeEqual 对不等长缓冲会抛。比较本身是定时的，
     不泄漏口令长度以外的信息；但注意口令走明文 HTTP，局域网内够用。 */
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-archive-key",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "cache-control": "no-store"
  }, extra || {}));
  res.end(body);
}

async function readBody(req) {
  return await new Promise((resolveP, rejectP) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) { rejectP(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolveP(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectP);
  });
}

/* 存档内容必须"真的像一份图纸"：挡住把别的东西往这里堆。
   与前端 adoptProject 同一口径（lines 是数组），但这里只做粗判，细校验在前端。 */
function looksLikeProject(text) {
  if (text.length > MAX_BYTES) return false;
  let d = null;
  try { d = JSON.parse(text); } catch (e) { return false; }
  if (!d || typeof d !== "object") return false;
  const p = d.project && Array.isArray(d.project.lines) ? d.project : d;
  return Array.isArray(p.lines) && !!p.stations && typeof p.stations === "object";
}

async function api(req, res, url) {
  const path = url.pathname;
  if (path === "/api/ping") {
    send(res, 200, { ok: true, archive: true, needKey: true, hasKey: !!keyGiven(req, url), authorized: keyOk(req, url) });
    return true;
  }
  if (!path.startsWith("/api/")) return false;
  if (!keyOk(req, url)) { send(res, 401, { ok: false, error: "bad_key" }); return true; }

  if (path === "/api/saves" && req.method === "GET") {
    await mkdir(SAVE_DIR, { recursive: true });
    let names = [];
    try { names = (await readdir(SAVE_DIR)).filter((f) => f.endsWith(".json")); } catch (e) { names = []; }
    const items = [];
    for (const f of names.slice(0, MAX_LIST)) {
      const name = f.slice(0, -5);
      if (!nameOk(name)) continue;
      let st = null, title = "";
      try { st = await stat(join(SAVE_DIR, f)); } catch (e) { continue; }
      try {
        const d = JSON.parse(await readFile(join(SAVE_DIR, f), "utf8"));
        title = (d && d.project && d.project.name) || (d && d.name) || "";
      } catch (e) { /* 读不动就只报文件名，别让一份坏档毁掉整个列表 */ }
      items.push({ name, title, bytes: st.size, updatedAt: Math.floor(st.mtimeMs) });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    send(res, 200, { ok: true, items, total: items.length });
    return true;
  }

  const name = url.searchParams.get("name");
  if (!nameOk(name)) { send(res, 400, { ok: false, error: "bad_name" }); return true; }

  if (path === "/api/save" && req.method === "GET") {
    let text = null;
    try { text = await readFile(savePath(name), "utf8"); } catch (e) { send(res, 404, { ok: false, error: "not_found" }); return true; }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text),
      "access-control-allow-origin": "*", "cache-control": "no-store"
    });
    res.end(text);
    return true;
  }
  if (path === "/api/save" && req.method === "POST") {
    let text = "";
    try { text = await readBody(req); } catch (e) { send(res, 413, { ok: false, error: e.message === "too_large" ? "too_large" : "read_failed" }); return true; }
    if (!looksLikeProject(text)) { send(res, 400, { ok: false, error: "not_a_project" }); return true; }
    await mkdir(SAVE_DIR, { recursive: true });
    /* 先写临时文件再改名：中途断掉不会留下半份存档 */
    const tmp = savePath(name) + "." + randomBytes(4).toString("hex") + ".tmp";
    await writeFile(tmp, text, "utf8");
    await rename(tmp, savePath(name));
    send(res, 200, { ok: true, name, bytes: Buffer.byteLength(text), updatedAt: Date.now() });
    return true;
  }
  if (path === "/api/save" && req.method === "DELETE") {
    try { await unlink(savePath(name)); send(res, 200, { ok: true, name, deleted: true }); }
    catch (e) { send(res, 404, { ok: false, error: "not_found" }); }
    return true;
  }
  send(res, 404, { ok: false, error: "unknown_endpoint" });
  return true;
}

async function serveStatic(req, res, url) {
  const p = decodeURIComponent(url.pathname);
  let full = normalize(join(ROOT, p === "/" ? "index.html" : p));
  if (!full.startsWith(ROOT + sep) && full !== ROOT) { res.writeHead(403); res.end("403\n"); return; }
  try {
    let st = await stat(full);
    if (st.isDirectory()) { full = join(full, "index.html"); st = await stat(full); }
    const buf = await readFile(full);
    /* 弱 ETag 用 size + mtime 毫秒：不必每次请求都哈希 660 KB，内容一改 mtime 就变。
       no-cache（不是 no-store）= 浏览器可以留副本，但每次都必须回来问一次，
       所以"刷新还是旧版"不可能发生，省下来的只是命中时的几百字节头部。 */
    const etag = 'W/"' + buf.length.toString(16) + "-" + Math.round(st.mtimeMs).toString(16) + '"';
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag, "cache-control": "no-cache" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(full).toLowerCase()] || "application/octet-stream",
      "content-length": buf.length,
      "cache-control": "no-cache",
      etag
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 没有这个文件\n");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "127.0.0.1"));
  try {
    if (req.method === "OPTIONS") { send(res, 204, {}); return; }
    if (url.pathname.startsWith("/api/") && (await api(req, res, url))) return;
    if (url.pathname.startsWith("/api/")) { send(res, 404, { ok: false, error: "unknown_endpoint" }); return; }
    await serveStatic(req, res, url);
  } catch (e) {
    send(res, 500, { ok: false, error: "server_error" });
  }
});

server.on("error", (e) => {
  console.error("启动失败：" + (e.code === "EADDRINUSE" ? `端口 ${PORT} 已被占用` : e.message));
  process.exit(1);
});

ARCHIVE_KEY = await loadKey();
await mkdir(SAVE_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  const ips = [];
  for (const [n, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address + " (" + n + ")");
  }
  console.log("静态根目录 " + ROOT);
  console.log("存档目录   " + SAVE_DIR);
  console.log("存档口令   " + ARCHIVE_KEY + (process.env.ARCHIVE_KEY ? "（来自环境变量）" : "（存在 .archive-key，可自行改掉）"));
  console.log("本机       http://127.0.0.1:" + PORT + "/");
  ips.forEach((ip) => console.log("局域网     http://" + ip.split(" ")[0] + ":" + PORT + "/  ← " + ip));
});
