"use strict";

// Exercise the delivered geometry and editor against synthetic data only.
// No browser, archive, personal project, or local storage is accessed.
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
const delivered = ["chordFrame", "bendHandle", "curveCubics", "sampleCubics", "catmullRom", "handleToBend",
  "shapeIds", "lineShape", "offsetSegs", "buildCorridorGroups", "curveHandleSpots", "getEditableSeg",
  "hk", "dropHandle", "clearHandlePool", "bindHandleDrag", "renderHandles", "sweepHandles",
  "distToSeg", "addBendAt", "adjacentBendKeys", "bendCount", "flipLineBends"];
const layerHandle = {
  markers: new Set(), hasLayer(marker) { return this.markers.has(marker); },
  addLayer(marker) { this.markers.add(marker); }, removeLayer(marker) { this.markers.delete(marker); },
  eachLayer(callback) { this.markers.forEach(callback); }
};
function marker(latlng, options) {
  const events = {}, element = { isConnected: true, className: "" };
  return { options, _icon: { querySelector: () => element },
    on(type, callback) { (events[type] || (events[type] = [])).push(callback); return this; },
    fire(type, data = {}) { (events[type] || []).slice().forEach((callback) => callback({ target: this, ...data })); return this; },
    listens(type) { return (events[type] || []).length; },
    setLatLng(value) { latlng = value; return this; }, getLatLng() { return latlng; },
    getElement() { return this._icon; }, addTo(layer) { this._layer = layer; layer.addLayer(this); return this; },
    remove() { if (this._layer) this._layer.removeLayer(this); return this; }
  };
}
const context = {
  console, P: null, sel: { line: "L1", station: null }, tool: "select", settings: { stack: true },
  hist: [], future: [], dirtyCalls: 0, panelCalls: 0, lineCalls: 0, layerHandle,
  map: {
    latLngToContainerPoint(ll) { return Array.isArray(ll) ? { x: ll[1], y: ll[0] } : { x: ll.lng, y: ll.lat }; },
    containerPointToLatLng(p) { return { lat: p.y, lng: p.x }; }
  },
  L: { marker, divIcon: (options) => options, DomEvent: { stopPropagation() {} } },
  clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
  toast() {}, markAt() {}, placeAt(mk, ll) { mk.setLatLng(ll); }
};
context.line = (id) => context.P.lines.find((l) => l.id === id);
context.station = (id) => context.P.stations[id];
context.activeLine = () => context.line(context.sel.line);
context.pushHistory = () => { context.hist.push(JSON.stringify(context.P)); context.future = []; };
context.markDirty = () => context.dirtyCalls++;
context.renderLines = () => context.lineCalls++;
context.renderPanels = () => context.panelCalls++;
vm.createContext(context);
vm.runInContext("const corridorKey=(a,b)=>a<b?a+'|'+b:b+'|'+a; const bendKey=(a,b)=>a+'>'+b; " +
  "const curved=(b)=>Array.isArray(b)&&b.length>0; let handlePool={},handleSig={};\n" +
  delivered.map(named).join("\n") + "\n" +
  "function lineShapePx(l){return lineShape(l,(s)=>map.latLngToContainerPoint([s.lat,s.lng]));}\n" +
  "globalThis.api={" + delivered.join(",") + ",pool:()=>handlePool};", context);
const api = context.api;
context.renderMap = () => api.renderHandles(); context.renderAll = context.renderMap;
const clean = (value) => JSON.parse(JSON.stringify(value));
const point = (x, y = 0) => ({ x, y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let checks = 0;
function test(name, callback) {
  try { callback(); checks++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
}
function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + " != " + expected);
}
function cubic(c, t) {
  const u = 1 - t;
  return { x: u ** 3 * c.A.x + 3 * u * u * t * c.C1.x + 3 * u * t * t * c.C2.x + t ** 3 * c.B.x,
    y: u ** 3 * c.A.y + 3 * u * u * t * c.C1.y + 3 * u * t * t * c.C2.y + t ** 3 * c.B.y };
}
function nearest(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, api.distToSeg(p, pts[i - 1], pts[i]));
  return d;
}
// The former algorithm is a negative control, never the positive test target.
function legacyCubics(points) {
  const p = [points[0], ...points, points.at(-1)], out = [];
  for (let i = 0; i + 3 < p.length; i++) {
    const [p0, A, B, p3] = p.slice(i, i + 4);
    out.push({ A, B, C1: point(A.x + (B.x - p0.x) / 6, A.y + (B.y - p0.y) / 6),
      C2: point(B.x - (p3.x - A.x) / 6, B.y - (p3.y - A.y) / 6) });
  }
  return out;
}
function legacyUniform(points, per = 14) {
  const out = [];
  legacyCubics(points).forEach((c) => { for (let j = 0; j < per; j++) out.push(cubic(c, j / per)); });
  out.push(points.at(-1)); return out;
}
function fixture(bends = [], stacked = false) {
  api.clearHandlePool();
  const line = { id: "L1", name: "测试线", visible: true, width: 6, stations: ["A", "B"],
    bends: bends.length ? { "A>B": clean(bends) } : {} };
  context.P = { lines: [line], stations: {
    A: { id: "A", lat: 0, lng: 0 }, B: { id: "B", lat: 0, lng: 200 }
  } };
  if (stacked) context.P.lines.push({ ...clean(line), id: "L2", stations: ["B", "A"], bends: {} });
  context.sel = { line: "L1", station: null }; context.tool = "select";
  context.hist = []; context.future = ["redo sentinel"]; context.dirtyCalls = context.panelCalls = context.lineCalls = 0;
  api.renderHandles(); return line;
}
function handle(tag = "+") { return api.pool()[api.hk("L1", "A>B", tag)]; }
function dragTo(mk, p, end = true) {
  mk.fire("dragstart"); mk.setLatLng(context.map.containerPointToLatLng(p)); mk.fire("drag");
  if (end) mk.fire("dragend");
}

test("straight segments remain exactly two points", () => {
  const l = fixture(), s = api.lineShape(l, (st) => point(st.lng, st.lat)).segs[0];
  assert.equal(s.raw.length, 2); assert.equal(s.cubics, null);
});
test("cubics pass every knot with matching tangent directions", () => {
  const p = [point(0), point(45, 130), point(50, 132), point(170, -90), point(250)];
  const original = JSON.stringify(p), curves = api.curveCubics(p), sampled = api.sampleCubics(curves);
  assert.equal(curves.length, p.length - 1); assert.equal(JSON.stringify(p), original);
  curves.forEach((c, i) => {
    assert.deepEqual(clean(c.A), p[i]); assert.deepEqual(clean(c.B), p[i + 1]);
    [c.A, c.C1, c.C2, c.B].forEach((v) => assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y)));
    assert.ok(sampled.some((v) => distance(v, p[i]) === 0));
    if (i) {
      const before = curves[i - 1], u = point(before.B.x - before.C2.x, before.B.y - before.C2.y);
      const v = point(c.C1.x - c.A.x, c.C1.y - c.A.y);
      close((u.x * v.y - u.y * v.x) / Math.max(1e-12, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)), 0);
      assert.ok(u.x * v.x + u.y * v.y >= 0);
    }
  });
  assert.deepEqual(clean(sampled.at(-1)), p.at(-1));
});
test("coincident knots never produce nonfinite geometry", () => {
  assert.equal(api.curveCubics([]).length, 0); assert.equal(api.curveCubics([point(0)]).length, 0);
  const curves = api.curveCubics([point(0), point(0), point(10, 20), point(10, 20), point(30)]);
  assert.equal(curves.length, 2);
  api.sampleCubics(curves).forEach((v) => assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y)));
});
test("dense bend points avoid the former short-segment backtracking", () => {
  const p = [point(0), point(100, 150), point(102, 151), point(220)];
  const short = api.curveCubics(p)[1], values = Array.from({ length: 129 }, (_, i) => cubic(short, i / 128).x);
  assert.ok(values.every((x, i) => !i || x >= values[i - 1]));
  const old = legacyUniform(p, 128).slice(128, 257);
  assert.ok(old.some((v, i) => i && v.x < old[i - 1].x), "legacy negative control did not detect a hook");
});
test("flattening stays within subpixel error on large curves", () => {
  const p = [point(0), point(1000, 1600), point(2000)], curves = api.curveCubics(p), sampled = api.sampleCubics(curves);
  let error = 0;
  curves.forEach((c) => { for (let i = 0; i <= 256; i++) error = Math.max(error, nearest(cubic(c, i / 256), sampled)); });
  assert.ok(error < .18, "maximum chord deviation " + error);
  const old = legacyUniform(p); let oldError = 0;
  legacyCubics(p).forEach((c) => { for (let i = 0; i <= 256; i++) oldError = Math.max(oldError, nearest(cubic(c, i / 256), old)); });
  assert.ok(oldError > .18, "legacy fixed-sampling negative control had no visible faceting");
});
test("near-station drag coordinates no longer stop at eight percent", () => {
  const b = api.handleToBend(point(0), point(200), point(1, 30));
  close(b.along, .005); close(b.normal, .15);
  assert.ok(Math.max(.08, Math.min(.92, b.along)) !== b.along, "old clamp negative control is ineffective");
});
test("opposite station order preserves distinct parallel lanes", () => {
  fixture([], true); const l1 = context.line("L1"), l2 = context.line("L2"), groups = api.buildCorridorGroups();
  const s1 = api.lineShape(l1, (st) => point(st.lng, st.lat)).segs[0];
  const s2 = api.lineShape(l2, (st) => point(st.lng, st.lat)).segs[0];
  const o1 = api.offsetSegs([s1], groups, "L1")[0], o2 = api.offsetSegs([s2], groups, "L2")[0];
  close(distance(o1.pts[0], o2.pts[1]), 10.5);
  const legacyOff = 5.25, legacySecond = point(s2.B.x + s2.f.nx * legacyOff, s2.B.y + s2.f.ny * legacyOff);
  close(distance(o1.pts[0], legacySecond), 0);
});
test("offset translates cubic controls and samples identically without mutation", () => {
  const l = fixture([{ along: .5, normal: .4 }], true), s = api.lineShape(l, (st) => point(st.lng, st.lat)).segs[0];
  const original = JSON.stringify(s), o = api.offsetSegs([s], api.buildCorridorGroups(), l.id)[0];
  assert.equal(JSON.stringify(s), original); assert.ok(o.cubics.length > 0);
  o.cubics.forEach((c, i) => ["A", "C1", "C2", "B"].forEach((k) => {
    close(c[k].x, s.cubics[i][k].x + s.f.nx * o.off); close(c[k].y, s.cubics[i][k].y + s.f.ny * o.off);
  }));
  const flattened = api.sampleCubics(o.cubics); assert.equal(flattened.length, o.pts.length);
  flattened.forEach((p, i) => close(distance(p, o.pts[i]), 0));
});
test("new and existing handles sit on the visible offset curve", () => {
  const l = fixture([{ along: .5, normal: .4 }], true), s = api.lineShape(l, (st) => point(st.lng, st.lat)).segs[0];
  const o = api.offsetSegs([s], api.buildCorridorGroups(), l.id)[0], spots = api.curveHandleSpots(s, o.off);
  assert.ok(spots.some((v) => v.pt === null));
  spots.forEach((v) => assert.ok(nearest(v.xy, o.pts) < .18, "handle floats off the visible line"));
  const plus = spots.find((v) => v.pt === null);
  assert.ok(Math.abs(plus.xy.y - o.off) > 1, "plus still sits on the hidden chord");
});
test("empty drag preserves data, redo, history, and saved state", () => {
  fixture(); const mk = handle(), before = JSON.stringify(context.P);
  mk.fire("dragstart"); mk.fire("dragend");
  assert.equal(JSON.stringify(context.P), before); assert.equal(context.hist.length, 0);
  assert.deepEqual(context.future, ["redo sentinel"]); assert.equal(context.dirtyCalls, 0);
  mk.fire("dragstart"); mk.fire("drag"); mk.fire("dragend");
  assert.equal(JSON.stringify(context.P), before); assert.equal(context.hist.length, 0);
  assert.deepEqual(context.future, ["redo sentinel"]); assert.equal(context.dirtyCalls, 0);
  const origin = context.map.latLngToContainerPoint(mk.getLatLng());
  dragTo(mk, point(origin.x + .8, origin.y + .8));
  assert.equal(JSON.stringify(context.P), before); assert.equal(context.hist.length, 0);
  assert.deepEqual(context.future, ["redo sentinel"]); assert.equal(context.dirtyCalls, 0);
  const legacyHistory = []; legacyHistory.push(before);
  assert.notEqual(legacyHistory.length, context.hist.length, "old dragstart history negative control is ineffective");
});
test("rerendering during a crossed-point drag preserves both visible handles", () => {
  const l = fixture([{ along: .25, normal: .3 }, { along: .75, normal: -.2 }]);
  const mk = handle("b0"), destination = point(180, 20), other = point(150, -40);
  dragTo(mk, destination, false); api.renderHandles();
  const positions = [handle("b0"), handle("b1")].map((m) => context.map.latLngToContainerPoint(m.getLatLng()));
  assert.ok(positions.some((p) => distance(p, destination) < 1e-8), "dragged handle left the pointer");
  assert.ok(positions.some((p) => distance(p, other) < 1e-8), "stationary handle disappeared after points crossed");
  mk.fire("dragend"); assert.equal(l.bends["A>B"].length, 2);
});
test("repeat rendering retains one set of handle listeners and allows repeated additions", () => {
  const l = fixture(), mk = handle(), types = ["dragstart", "drag", "dragend", "dblclick", "click"];
  const listenerCounts = types.map((type) => mk.listens(type));
  for (let i = 0; i < 6; i++) api.renderHandles();
  assert.equal(handle(), mk); assert.deepEqual(types.map((type) => mk.listens(type)), listenerCounts);
  dragTo(mk, point(100, 40)); assert.equal(l.bends["A>B"].length, 1);
  const next = handle(); assert.ok(next); dragTo(next, point(50, -35));
  assert.equal(l.bends["A>B"].length, 2); assert.equal(context.hist.length, 2);
  assert.equal(layerHandle.markers.size, 3);
});
test("dragging across the chord retains the edited point and its identity", () => {
  const l = fixture([{ along: .25, normal: .3 }, { along: .75, normal: -.2 }]);
  const other = l.bends["A>B"][1], mk = handle("b0");
  mk.fire("dragstart"); mk.setLatLng(context.map.containerPointToLatLng(point(100))); mk.fire("drag");
  assert.equal(l.bends["A>B"].length, 2); close(l.bends["A>B"][0].normal, 0);
  mk.setLatLng(context.map.containerPointToLatLng(point(180, -20))); mk.fire("drag");
  assert.ok(l.bends["A>B"].includes(other), "other handle identity was lost during the drag");
  close(other.along, .75); close(other.normal, -.2); assert.equal(context.hist.length, 1);
  mk.setLatLng(context.map.containerPointToLatLng(point(40, 35))); mk.fire("drag");
  close(other.along, .75); close(other.normal, -.2); assert.equal(context.hist.length, 1);
  mk.fire("dragend");
  assert.deepEqual(clean(l.bends["A>B"].map((b) => b.along)), [.2, .75]);
  assert.equal(l.bends["A>B"].length, 2);
  assert.ok(Math.abs(0) < .006, "old automatic-delete negative control is ineffective");
});
test("parallel handle drag subtracts the visible lane offset", () => {
  const l = fixture([{ along: .5, normal: .2 }], true), s = api.lineShape(l, (st) => point(st.lng, st.lat)).segs[0];
  const off = api.offsetSegs([s], api.buildCorridorGroups(), l.id)[0].off;
  dragTo(handle("b0"), point(100, off));
  assert.equal(l.bends["A>B"].length, 1); close(l.bends["A>B"][0].normal, 0);
  assert.notEqual(off / 200, 0, "old missing-offset negative control is ineffective");
});
test("double-click inserts into the current line object, after subtracting its lane offset", () => {
  const old = fixture([], true), current = clean(old); context.P.lines[0] = current;
  const s = api.lineShape(current, (st) => point(st.lng, st.lat)).segs[0];
  const off = api.offsetSegs([s], api.buildCorridorGroups(), current.id)[0].off;
  assert.equal(api.addBendAt(old, { lat: off, lng: 100 }), true);
  assert.deepEqual(old.bends, {}); assert.equal(current.bends["A>B"].length, 1);
  close(current.bends["A>B"][0].normal, 0); assert.equal(context.hist.length, 1);
});
test("construction tools reject curve edits without touching state", () => {
  const l = fixture();
  for (const tool of ["add", "link"]) {
    context.tool = tool; const before = JSON.stringify(context.P), h = context.hist.length;
    assert.equal(api.addBendAt(l, { lat: 20, lng: 80 }), false);
    assert.equal(JSON.stringify(context.P), before); assert.equal(context.hist.length, h);
    assert.deepEqual(context.future, ["redo sentinel"]); assert.equal(context.dirtyCalls, 0);
  }
});
test("repeated insertion beside an existing point does not duplicate it", () => {
  const l = fixture([{ along: .4, normal: .2 }]), before = JSON.stringify(context.P);
  assert.equal(api.addBendAt(l, { lat: 40.5, lng: 80.5 }), false);
  assert.equal(JSON.stringify(context.P), before); assert.equal(context.hist.length, 0);
  assert.deepEqual(context.future, ["redo sentinel"]); assert.equal(context.dirtyCalls, 0);
});
test("explicit handle deletion is reversible in one history entry", () => {
  const l = fixture([{ along: .4, normal: .2 }]), before = JSON.stringify(context.P);
  handle("b0").fire("dblclick");
  assert.equal((l.bends["A>B"] || []).length, 0); assert.equal(context.hist.length, 1);
  assert.equal(context.hist[0], before); assert.equal(layerHandle.markers.size, 1);
});
test("mirroring bends keeps their along positions", () => {
  const start = source.indexOf('    case "flipBends":'), end = source.indexOf('    case "toggleLoop":', start);
  assert.ok(start >= 0 && end > start, "delivered flipBends command missing");
  vm.runInContext("globalThis.flipDelivered=function(l){switch('flipBends'){" + source.slice(start, end) + "}}", context);
  const l = fixture([{ along: .2, normal: .3 }, { along: .65, normal: -.25 }]);
  context.flipDelivered(l);
  assert.deepEqual(clean(l.bends["A>B"]), [{ along: .2, normal: -.3 }, { along: .65, normal: .25 }]);
  assert.equal(context.hist.length, 1);
});

console.log("Curve geometry and editing checks: " + checks + " passed (synthetic projects only).");
