/* Exercise the actual app's optional announcement-name fields and local pinyin bundle. */
const fs = require("fs"), vm = require("vm"), assert = require("assert/strict");
const html = fs.readFileSync("index.html", "utf8");
function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, "unique app source range missing: " + start);
  assert.equal(html.indexOf(start, a + start.length), -1, "ambiguous source range");
  return html.slice(a, b);
}
const clipAndValidation = between("const TEXT_LIMITS =", "/* 写入 + 滚动备份：");
const normalization = between("function normalize(p) {", "function createProject(");
const setters = between("function setLineField(", "function toggleAttach(");
const fixture = () => ({
  name: "报站测试", lines: [{ id: "L", name: "2 号线", badge: "2", color: "#FF0000", width: 6, stations: ["S"] }],
  stations: { S: { id: "S", name: "博物馆", lat: 30, lng: 120 } }, center: [30, 120], zoom: 12
});
function context(source = clipAndValidation + normalization + setters) {
  const c = {
    CURRENT_VERSION: 4, PALETTE: [{ c: "#FF0000" }], P: fixture(),
    uid: () => { throw new Error("fixture has stable ids"); },
    isNum: v => typeof v === "number" && Number.isFinite(v),
    numVal: v => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    autoBadge: () => "2", pushHistory() {}, toast() {}, markDirty() {},
    renderMap() {}, renderLineList() {}, renderLegend() {}, renderStatus() {}, renderLinkBar() {}, renderStnList() {}
  };
  vm.createContext(c); vm.runInContext(source, c); return c;
}
let cases = 0;
function check(name, test) { test(); cases++; }
const c = context();
check("normalizing old data does not create optional fields", () => {
  const p = c.normalize(fixture()), first = JSON.stringify(p);
  assert(!Object.hasOwn(p.lines[0], "nameEn")); assert(!Object.hasOwn(p.stations.S, "nameEn"));
  assert.equal(JSON.stringify(c.normalize(p)), first);
});
check("normalization keeps explicit English names and trims surrounding spaces", () => {
  const p = fixture(); p.lines[0].nameEn = " Airport Express "; p.stations.S.nameEn = " Museum ";
  c.normalize(p); assert.equal(p.lines[0].nameEn, "Airport Express"); assert.equal(p.stations.S.nameEn, "Museum");
  assert.equal(c.validateProject(p).length, 0);
});
check("normalization drops optional blanks instead of storing empty fields", () => {
  const p = fixture(); p.lines[0].nameEn = null; p.stations.S.nameEn = "   "; c.normalize(p);
  assert(!Object.hasOwn(p.lines[0], "nameEn")); assert(!Object.hasOwn(p.stations.S, "nameEn"));
});
check("normalization sanitizes and clips supplied announcement names", () => {
  const p = fixture(); p.lines[0].nameEn = "\u0001" + "A".repeat(121); p.stations.S.nameEn = "B".repeat(121);
  c.normalize(p); assert.equal(p.lines[0].nameEn, "A".repeat(120)); assert.equal(p.stations.S.nameEn.length, 120);
  assert.equal(c.validateProject(p).length, 0);
});
check("validation rejects malformed optional names", () => {
  for (const bad of [false, null, "\u0001Museum", "A".repeat(121)]) {
    for (const isLine of [true, false]) {
      const p = c.normalize(fixture()); (isLine ? p.lines[0] : p.stations.S).nameEn = bad;
      assert(c.validateProject(p).length > 0);
    }
  }
});
check("actual property setters clip names and support clearing", () => {
  c.P = c.normalize(fixture());
  for (const [entity, setter] of [[c.P.lines[0], c.setLineField], [c.P.stations.S, c.setStnField]]) {
    const el = { value: "" }; setter(entity, "nameEn", "\u0001" + "X".repeat(121), el, true);
    assert.equal(entity.nameEn, "X".repeat(120)); assert.equal(el.value, entity.nameEn);
    setter(entity, "nameEn", "", el, true); assert(!Object.hasOwn(entity, "nameEn"));
  }
});
check("negative control catches removed optional-name validation", () => {
  const old = context(clipAndValidation.replace(/^    if \([ls]\.nameEn !== undefined\).*\r?\n/gm, "") + normalization + setters);
  const p = old.normalize(fixture()); p.stations.S.nameEn = "\u0001Museum";
  assert.equal(old.validateProject(p).length, 0);
});
check("negative control catches dropped setter sanitization", () => {
  const old = context(clipAndValidation + normalization + setters.replaceAll(' || k === "nameEn"', ""));
  old.P = old.normalize(fixture()); old.setStnField(old.P.stations.S, "nameEn", "\u0001Museum", { value: "" }, true);
  assert(old.validateProject(old.P).length > 0);
});
check("local pinyin UMD exposes an offline API with phrase-aware readings", () => {
  const browser = {}; vm.runInNewContext(fs.readFileSync("vendor/pinyin-pro.js", "utf8"), browser);
  assert.equal(typeof browser.pinyinPro.pinyin, "function");
  assert.equal(browser.pinyinPro.pinyin("博物馆", { toneType: "none" }), "bo wu guan");
  assert.equal(browser.pinyinPro.pinyin("重庆北站", { toneType: "none" }), "chong qing bei zhan");
  assert.equal(browser.pinyinPro.pinyin("廊永线", { toneType: "none" }), "lang yong xian");
});
console.log(`Speech names: ${cases} cases passed (2 negative controls).`);
