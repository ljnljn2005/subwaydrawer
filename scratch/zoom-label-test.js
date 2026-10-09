"use strict";

// Exercise the delivered label selection and render pipeline on synthetic data.
// No browser, archive, personal map, or local storage is accessed.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function named(name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, "Missing delivered function " + name);
  const open = source.indexOf("{", start);
  let depth = 0, mode = "", escape = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (mode === "//") { if (c === "\n") mode = ""; continue; }
    if (mode === "/*") { if (c === "*" && next === "/") { mode = ""; i++; } continue; }
    if (mode) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === mode) mode = "";
      continue;
    }
    if (c === "/" && (next === "/" || next === "*")) { mode = c + next; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { mode = c; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed delivered function " + name);
}
const clean = (v) => JSON.parse(JSON.stringify(v));
const ids = (v) => Array.from(v, (item) => item.st.id);
let checks = 0;
function test(name, callback) {
  try { callback(); checks++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
}
const layerLabel = { markers: new Set() };
let creates = 0, drops = 0, sizes = 0;
function marker(latlng, options) {
  creates++;
  const span = { className: options.icon.html, style: { setProperty() {} }, textContent: "" };
  return { options, latlng,
    addTo(layer) { layer.markers.add(this); return this; },
    setLatLng(ll) { this.latlng = ll; return this; },
    getElement() { return { querySelector: () => span }; }
  };
}
const solves = [], labelCell = { textContent: "", style: {} };
const context = {
  console, sel: { station: null }, tool: "select", settings: { showLabels: true, cullLabels: true },
  labelPool: {}, labelSig: {}, labelMarkers: {}, lastSides: {}, lastHit: {},
  lblSig: null, lblOut: null, lblKey: null, lblKeyGen: 0, lblSolveHits: 0, lblSolveMisses: 0,
  lblSkipHits: 0, lblSkipMisses: 0, labelDomGen: 0, labelSettling: false,
  labelCacheDirty: false, labelsHeld: false, lblHeldSkips: 0, labelObstacles: [],
  layerLabel, L: { marker, divIcon: (v) => v },
  map: { zoom: 10, getZoom() { return this.zoom; }, getSize() { return { x: 960, y: 720 }; },
    containerPointToLatLng(p) { return { lat: p.y, lng: p.x }; } },
  $: () => labelCell, bmById: () => ({ dark: false }),
  labelSize(text, fs) { sizes++; return { w: text.length * fs, h: fs }; },
  manualOffsetPx: (st) => st.labelOff,
  labelBox: (p, off, sz) => ({ x: p.x + off.dx, y: p.y + off.dy, ...sz }),
  labelRect: (x, y, side, sz) => ({ x, y, ...sz }),
  clearDirty() {}, labelInDirty: () => true,
  latlngPair: (ll) => Array.isArray(ll) ? ll : [ll.lat, ll.lng],
  markAt(mk, ll) { const p = context.latlngPair(ll); mk._at0 = p[0]; mk._at1 = p[1]; },
  bindLabelDrag() {}, cacheLabelSize() {}, esc: (v) => v,
  dropLabel(mk) { layerLabel.markers.delete(mk); context.labelDomGen++; drops++; },
  collision: false,
  solveSides(...args) {
    solves.push(clean(args));
    return Object.fromEntries(args[0].map((it) => [it.id, { side: "r", hitLine: context.collision }]));
  }
};
vm.createContext(context);
const delivered = ["mapLabelPriority", "selectMapLabels", "buildLabelInputs", "labelKeysOf",
  "labelSolveSignature", "labelShouldHide", "renderLabels"];
vm.runInContext(delivered.map(named).join("\n") + "\nglobalThis.api={" + delivered.join(",") + "};", context);
const api = context.api;
function fixture(count = 900) {
  return Array.from({ length: count }, (_, i) => ({
    st: { id: "S" + String(i).padStart(4, "0"), name: "测试" + i, lat: Math.floor(i / 30) * 5, lng: (i % 30) * 5 },
    px: { x: (i % 30) * 5, y: Math.floor(i / 30) * 5 },
    c: "#d22", xfer: false, term: false, size: 6
  }));
}
function importantFixture() {
  const vis = fixture();
  vis[31].xfer = true; vis[32].term = true;
  vis[33].st.labelOff = { dx: 17, dy: -13, z: 15 };
  return vis;
}
function reset(zoom = 10) {
  Object.assign(context, { sel: { station: null }, tool: "select", settings: { showLabels: true, cullLabels: true },
    labelPool: {}, labelSig: {}, labelMarkers: {}, lastSides: {}, lastHit: {}, lblSig: null,
    lblOut: null, lblKey: null, lblKeyGen: 0, lblSolveHits: 0, lblSolveMisses: 0,
    lblSkipHits: 0, lblSkipMisses: 0, labelDomGen: 0, labelCacheDirty: false,
    labelSettling: false, labelObstacles: [], collision: false });
  context.map.zoom = zoom; layerLabel.markers.clear(); solves.length = 0;
  creates = drops = sizes = 0; labelCell.textContent = "";
}

test("overview discards layout candidates before the expensive solver", () => {
  const vis = fixture(), selected = api.selectMapLabels(vis, 10, null, true);
  assert.ok(selected.length > 0 && selected.length < vis.length / 5);
  // The former behavior admitted every station and cannot satisfy this guard.
  assert.ok(vis.length >= selected.length * 5);
});
test("closer zoom progressively restores station names", () => {
  const vis = fixture(), far = api.selectMapLabels(vis, 10, null, true), closer = api.selectMapLabels(vis, 12, null, true);
  assert.ok(closer.length > far.length);
  assert.deepEqual(ids(api.selectMapLabels(vis, 13, null, true)), ids(vis));
});
test("interchanges terminals manual and selected names survive a dense cluster", () => {
  const vis = importantFixture(), chosen = ids(api.selectMapLabels(vis, 7, vis[34].st.id, true));
  [31, 32, 33, 34].forEach((i) => assert.ok(chosen.includes(vis[i].st.id)));
});
test("priority follows station role and selection rather than ordinary station count", () => {
  const vis = importantFixture();
  [31, 32, 33].forEach((i) => assert.equal(api.mapLabelPriority(vis[i], null), true));
  assert.equal(api.mapLabelPriority(vis[34], vis[34].st.id), true);
  assert.equal(api.mapLabelPriority(vis[35], null), false);
});
test("panning across grid boundaries preserves the chosen stations", () => {
  const vis = importantFixture(), moved = clean(vis);
  moved.forEach((v) => { v.px.x += 123.375; v.px.y -= 57.25; });
  assert.deepEqual(ids(api.selectMapLabels(moved, 10, null, true)), ids(api.selectMapLabels(vis, 10, null, true)));
});
test("selection does not mutate the map or manual offsets", () => {
  const vis = importantFixture(), before = JSON.stringify(vis);
  const chosen = api.selectMapLabels(vis, 10, vis[34].st.id, true);
  assert.equal(JSON.stringify(vis), before);
  assert.ok(chosen.every((v) => vis.includes(v)));
  assert.deepEqual(ids(chosen), ids(vis).filter((id) => ids(chosen).includes(id)));
});
test("turning off culling restores every station even at distant zoom", () => {
  const vis = fixture();
  assert.deepEqual(ids(api.selectMapLabels(vis, 4, null, false)), ids(vis));
});
test("sparse distant stations remain useful without an arbitrary global quota", () => {
  const vis = fixture(40); vis.forEach((v, i) => { v.px.x = i * 200; });
  assert.equal(api.selectMapLabels(vis, 7, null, true).length, vis.length);
});
test("render sends fewer solver items but every station pin remains an obstacle", () => {
  reset(); const vis = importantFixture(); api.renderLabels(vis);
  assert.equal(solves.length, 1);
  assert.ok(solves[0][0].length < vis.length / 5);
  assert.equal(solves[0][6].length, vis.length);
  assert.deepEqual(solves[0][6].map((p) => p.id), ids(vis));
  assert.ok(Object.keys(context.labelMarkers).length < vis.length / 5);
  assert.ok(sizes < vis.length, "rejected names must avoid text measurement too");
  assert.equal(layerLabel.markers.size, Object.keys(context.labelMarkers).length);
});
test("station thinning is reflected in the visible label count", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  assert.ok(labelCell.textContent.includes(Object.keys(context.labelMarkers).length + "/" + vis.length));
});
test("zooming out removes obsolete markers and zooming in restores names", () => {
  reset(13); const vis = fixture(); api.renderLabels(vis);
  assert.equal(Object.keys(context.labelPool).length, vis.length);
  context.map.zoom = 10; api.renderLabels(vis);
  const smallCount = Object.keys(context.labelPool).length;
  assert.ok(smallCount < vis.length / 5); assert.equal(drops, vis.length - smallCount);
  context.map.zoom = 13; api.renderLabels(vis);
  assert.equal(Object.keys(context.labelPool).length, vis.length);
  assert.equal(layerLabel.markers.size, vis.length);
});
test("unchanged overview reuses the whole label layer and solution", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  const built = creates, solved = solves.length; api.renderLabels(vis);
  assert.equal(creates, built); assert.equal(solves.length, solved); assert.equal(context.lblSkipHits, 1);
});
test("equal-width station rename updates the marker while reusing the layout solution", () => {
  reset(13); const vis = fixture(40); api.renderLabels(vis);
  const v = vis[10], mk = context.labelMarkers[v.st.id], solved = solves.length, misses = context.lblSkipMisses;
  assert.equal(v.st.name, "测试10"); v.st.name = "更名10";
  api.renderLabels(vis);
  assert.equal(context.labelMarkers[v.st.id], mk);
  assert.equal(mk.getElement().querySelector().textContent, "更名10");
  assert.equal(context.lblSkipMisses, misses + 1);
  assert.equal(solves.length, solved); assert.equal(context.lblSolveHits, 1);
});
test("moving a hidden station invalidates the cached station-pin solution", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  const chosen = ids(api.selectMapLabels(vis, 10, null, true)), hidden = vis.find((v) => !chosen.includes(v.st.id));
  const before = solves.length; hidden.px.x += 0.01; api.renderLabels(vis);
  assert.deepEqual(ids(api.selectMapLabels(vis, 10, null, true)), chosen);
  assert.equal(solves.length, before + 1);
  const pin = solves.at(-1)[6].find((p) => p.id === hidden.st.id); assert.equal(pin.x, hidden.px.x);
});
test("hidden pin coordinates have unambiguous cache signature boundaries", () => {
  reset();
  const pins = [{ id: "hidden", x: 12, y: 3 }];
  const initial = api.labelSolveSignature([], [], [], pins);
  assert.equal(api.labelSolveSignature([], [], [], clean(pins)), initial);
  // Concatenating bare numbers made these different positions both read "123".
  assert.notEqual(api.labelSolveSignature([], [], [], [{ id: "hidden", x: 1, y: 23 }]), initial);
});
test("selecting an omitted ordinary station shows its name even over a line", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  const hidden = vis.find((v) => !context.labelMarkers[v.st.id]);
  context.sel.station = hidden.st.id; context.collision = true; api.renderLabels(vis);
  assert.ok(context.labelMarkers[hidden.st.id]); assert.equal(solves.length, 2);
  assert.ok(solves.at(-1)[0].some((it) => it.id === hidden.st.id));
});
test("selected visible station invalidates collision-culling decisions", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  const visibleId = Object.keys(context.labelMarkers)[0];
  context.sel.station = visibleId; context.collision = true; api.renderLabels(vis);
  assert.ok(context.labelMarkers[visibleId]); assert.equal(context.lblSkipHits, 0);
});
test("partial layout uses the reduced candidate set and full station-pin obstacles", () => {
  reset(); const vis = importantFixture(); api.renderLabels(vis);
  api.renderLabels(vis, [[{ x: 0, y: 0 }, { x: 200, y: 200 }]]);
  assert.equal(solves.length, 2); assert.ok(solves[1][0].length < vis.length / 5);
  assert.equal(solves[1][6].length, vis.length); assert.equal(context.lblSig, null);
  api.renderLabels(vis); assert.equal(solves.length, 3);
});
test("important names survive collision culling and manual markers stay manual", () => {
  reset(); const vis = importantFixture(); context.collision = true; api.renderLabels(vis);
  [31, 32, 33].forEach((i) => assert.ok(context.labelMarkers[vis[i].st.id]));
  assert.equal(context.labelMarkers[vis[33].st.id].getElement().querySelector().className.includes("s-man"), true);
  const ordinary = api.selectMapLabels(vis, 10, null, true).filter((v) => !api.mapLabelPriority(v, null));
  ordinary.forEach((v) => assert.equal(context.labelMarkers[v.st.id], undefined));
});
test("culling disabled removes thinning and collision hiding in the actual renderer", () => {
  reset(); const vis = fixture(); context.collision = true; api.renderLabels(vis);
  assert.equal(Object.keys(context.labelMarkers).length, 0);
  context.settings.cullLabels = false; api.renderLabels(vis);
  assert.equal(solves.at(-1)[0].length, vis.length); assert.equal(Object.keys(context.labelMarkers).length, vis.length);
});
test("detail mode preserves the existing complete-input solver path", () => {
  reset(13); const vis = fixture(); api.renderLabels(vis);
  assert.equal(solves[0][0].length, vis.length);
  assert.ok(solves[0][6] == null, "complete detail path should preserve the former solver station inputs");
});
test("hiding all labels cleans up pooled markers after an overview render", () => {
  reset(); const vis = fixture(); api.renderLabels(vis);
  assert.ok(layerLabel.markers.size); context.settings.showLabels = false; api.renderLabels(vis);
  assert.equal(layerLabel.markers.size, 0); assert.equal(Object.keys(context.labelPool).length, 0);
});

// Verify the real solver too: observing the seventh argument alone would miss a
// regression that accepts the full station-pin list but silently ignores it.
const geometry = {
  SIDE_ORDER: ["r", "tr", "br", "l", "tl", "bl", "b", "t"],
  labelSize: () => ({ w: 20, h: 10 }),
  pinGridMode: "off", pinGridMin: 64, pinGridBuilds: 0, pinGridCell: 0,
  solveGridMode: "off", solveGridMinPts: 180, solveGridMinWork: 40000, solveGridBuilds: 0,
  solveGridCell: 0, segBoxReject: true, segGroupSkip: true
};
vm.createContext(geometry);
vm.runInContext(["labelRect", "segSeg", "segHitsRect", "solveGridWanted", "pinGridWanted", "solveSides"]
  .map(named).join("\n"), geometry);
function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function brute(items, obstacles, hint, fixed, pins) {
  const out = {}, placed = fixed.map((v) => v.r);
  const order = items.slice().sort((a, b) => (b.rank || 0) - (a.rank || 0));
  for (const it of order) {
    let best = null;
    geometry.SIDE_ORDER.forEach((side, pref) => {
      const r = geometry.labelRect(it.x, it.y, side, it.size, 10);
      let score = pref * 0.6 - (hint[it.id] === side ? 1.5 : 0);
      for (const box of placed) if (overlap(r, box)) score += 120;
      for (const p of pins) {
        if (p.id !== it.id && overlap(r, { x: p.x - 8, y: p.y - 8, w: 16, h: 16 })) score += 40;
      }
      let hitLine = false;
      for (const line of obstacles) {
        if (line.slice(1).some((p, i) => geometry.segHitsRect(line[i], p, r))) { score += 60; hitLine = true; }
      }
      if (!best || score < best.score) best = { side, score, hitLine, r };
    });
    out[it.id] = { side: best.side, hitLine: best.hitLine };
    placed.push(best.r);
  }
  return out;
}
test("real solver avoids an unnamed station that would occupy its preferred side", () => {
  const items = [{ id: "A", x: 0, y: 0, size: { w: 20, h: 10 } }];
  const pins = [{ id: "hidden", x: 20, y: 0 }, { id: "A", x: 0, y: 0 }];
  const withoutPins = geometry.solveSides(items, [], 10, 8, {}, []);
  assert.equal(withoutPins.A.side, "r"); // Negative control for the former reduced-input solver.
  for (const mode of ["off", "on"]) {
    geometry.pinGridMode = mode;
    const withPins = geometry.solveSides(items, [], 10, 8, {}, [], pins);
    assert.equal(withPins.A.side, "tr");
    assert.deepEqual(clean(withPins), brute(items, [], {}, [], pins));
  }
});
test("separate pin and label ordering matches a brute geometry oracle in both branches", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: "name" + i,
    x: ((i * 17) % 23) * 11, y: ((i * 7) % 19) * 9, rank: i % 3, size: { w: 20 + i % 5, h: 10 } }));
  const pins = Array.from({ length: 200 }, (_, i) => ({ id: "unnamed" + i,
    x: ((i * 41) % 31) * 8 - 20, y: ((i * 29) % 37) * 6 - 30 }));
  pins.push(...items.slice().reverse().map(({ id, x, y }) => ({ id, x, y })));
  const fixed = [{ id: "manual", r: { x: 65, y: 25, w: 30, h: 18 } }];
  const obs = [[{ x: -15, y: 5 }, { x: 90, y: 90 }, { x: 250, y: 5 }]], hint = { name0: "l", name3: "t" };
  const expected = brute(items, obs, hint, fixed, pins);
  for (const mode of ["off", "on"]) {
    geometry.pinGridMode = mode; geometry.pinGridBuilds = 0;
    assert.deepEqual(clean(geometry.solveSides(items, obs, 10, 8, hint, fixed, pins)), expected);
    assert.equal(geometry.pinGridBuilds, mode === "on" ? 1 : 0);
  }
});
console.log("Zoomed-out label regressions: " + checks + "/" + checks + " passed");
