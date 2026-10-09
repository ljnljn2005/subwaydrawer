"use strict";

// Run the delivered camera and lifecycle functions against synthetic Leaflet
// events. The animation clock advances in 16 ms steps; no browser, tile server,
// personal project, archive, or local storage is accessed.
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
const core = ["navFollowPoint", "navFollowPan", "navFollowEnd", "navCancelFollow", "navReleaseFollow", "navPauseFollowForZoom", "navCancelFrame", "navBindMap"];
let checks = 0;
function test(name, fn) {
  try { fn(); checks++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
}
const clean = (v) => JSON.parse(JSON.stringify(v));
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + " != " + expected);
function harness(extra = [], overrides = {}) {
  const microtasks = [], events = new Map(), dom = new Map(), docEvents = new Map(), windowEvents = new Map(), timers = new Map();
  let time = 0, anim = null, stops = 0, maximumAnimations = 0, nextTimer = 1;
  const moves = [], calls = [], eventGuards = [], cancelledFrames = [], effects = [];
  const node = (selector) => {
    if (!dom.has(selector)) dom.set(selector, {
      offsetHeight: 200, hidden: false, innerHTML: "", textContent: "", checked: true,
      value: "", dataset: {}, firstChild: null, parentElement: {},
      classList: { add() {}, remove() {} }, appendChild() {}, focus() {},
      addEventListener(type, callback) { this[type] = callback; }
    });
    return dom.get(selector);
  };
  const context = {
    console, nav: { follow: true, followPoint: null, followPanActive: false,
      playback: { status: "running", phase: "ride" }, lastTime: 0, raf: 7 },
    navProgrammaticView: false, navFollowZooming: false, navFollowSerial: 0, navFollowZoomSerial: 0,
    userViewAt: 123, inSelfTest: false, viewLockUntil: 0,
    queueMicrotask: (callback) => microtasks.push(callback),
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    performance: { now: () => time }, $: node,
    viewByUser: () => { context.userViewAt = time; }, toast() {}, linePoints: () => [[0, 0], [1, 1]],
    L: { latLngBounds: () => ({ pad() { return this; }, isValid: () => true }) },
    P: { id: "synthetic", stations: {} },
    document: {
      hidden: false,
      addEventListener(type, callback) { docEvents.set(type, callback); },
      createDocumentFragment: () => ({ appendChild() {} })
    },
    navRefreshGeometry: () => effects.push("geometry"), navDrawCursor: () => effects.push("cursor"), renderMap: () => effects.push("render"),
    navSilence: () => effects.push("silence"), navResumeSpeech: () => effects.push("speech"),
    navScheduleFrame: () => effects.push("frame"), navClearLayers: () => effects.push("layers"),
    navHideSearch() {}, navAdvanceClock() {}, navRenderState() {},
    navStationOptions: () => [{ id: "a", name: "甲站" }, { id: "b", name: "乙站" }],
    activeLine: () => null, sel: { station: null }, setTool() {}, stationLines: () => [],
    navChooseStation() {}, navBindSearch() {}, navReplan() {}, navClose() {}, navStart() {}, navTogglePause() {},
    window: { addEventListener(type, callback) { windowEvents.set(type, callback); } },
    commitViewNow() {}, station: () => ({ lat: 0, lng: 0, name: "测试站" }),
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    createNavPlayback: () => ({ status: "running", phase: "stop" }),
    planRide: () => null, line: () => null, esc: (v) => String(v),
    cancelAnimationFrame: (id) => cancelledFrames.push(id)
  };
  const emit = (name) => {
    for (const callback of [...(events.get(name) || [])]) callback();
  };
  const map = context.map = {
    center: { x: 0, y: 0 }, size: { x: 1000, y: 800 }, _panAnim: { _inProgress: false },
    getSize() { return this.size; }, getZoom: () => 15, getContainer: () => node("#map"),
    latLngToContainerPoint(ll) { return { x: ll.x - this.center.x + this.size.x / 2,
      y: ll.y - this.center.y + this.size.y / 2 }; },
    on(names, callback) { for (const name of names.split(/\s+/)) {
      if (!events.has(name)) events.set(name, []); events.get(name).push(callback);
    } return this; },
    panBy(offset, options) {
      const [x, y] = offset;
      calls.push({ offset: Array.from(offset), options: clean(options), guard: context.navProgrammaticView });
      if (anim && this.nativeStopOnRun) this.stop();
      else assert.equal(anim, null, "Camera animation must not be restarted while still moving");
      emit("movestart");
      if (!options.animate || this.synchronous) {
        this.center.x += x; this.center.y += y; emit("move"); emit("moveend"); return this;
      }
      anim = { from: { ...this.center }, x, y, started: time, duration: options.duration * 1000,
        power: 1 / Math.max(options.easeLinearity || .5, .2) };
      this._panAnim._inProgress = true;
      maximumAnimations = Math.max(maximumAnimations, 1);
      return this;
    },
    stop() {
      stops++;
      if (anim) { anim = null; this._panAnim._inProgress = false; emit("moveend"); }
      return this;
    }, distance: () => 2100,
    fitBounds() { effects.push("fit"); this.panBy([100, 50], { animate: true, duration: .25, easeLinearity: .5 }); },
    panTo() { effects.push("goto"); this.panBy([100, 50], { animate: true, duration: .25, easeLinearity: .5 }); },
    zoomIn: () => effects.push("zoomIn"), zoomOut: () => effects.push("zoomOut")
  };
  vm.createContext(context);
  vm.runInContext(core.concat(extra).map((name) => overrides[name] || named(name)).join("\n") + "\nglobalThis.api={" + core.concat(extra).join(",") + "};", context);
  context.api.navBindMap();
  map.on("moveend", () => eventGuards.push(context.navProgrammaticView));
  const flush = () => { let n = 0; while (microtasks.length) {
    assert.ok(n++ < 100, "Microtask loop did not settle"); microtasks.shift()();
  } };
  const advance = (ms = 16, flushTasks = true) => {
    time += ms;
    if (anim) {
      const active = anim, f = Math.min(1, (time - active.started) / active.duration), k = 1 - Math.pow(1 - f, active.power);
      map.center.x = active.from.x + active.x * k; map.center.y = active.from.y + active.y * k;
      emit("move");
      if (f === 1 && anim === active) { anim = null; map._panAnim._inProgress = false; emit("moveend"); }
    }
    moves.push({ t: time, x: map.center.x, y: map.center.y });
    let due;
    while ((due = [...timers.entries()].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0])) {
      timers.delete(due[0]); due[1].callback();
    }
    if (flushTasks) flush();
  };
  const settle = () => { let n = 0; while (anim || microtasks.length) {
    assert.ok(n++ < 1000, "Camera did not settle"); advance();
  } };
  // The expected screen focus sits above the navigation card.
  const targetY = () => Math.max(35, Math.max(60, map.size.y - node("#navCard").offsetHeight - 32) * .5);
  const target = (dx = 0, dy = 0) => ({ x: map.center.x + dx,
    y: map.center.y + targetY() - map.size.y / 2 + dy });
  return { context, api: context.api, map, node, calls, effects, cancelledFrames, eventGuards,
    emit, advance, settle, flush, target, targetY, moves,
    input(name, event = {}) { node("#map")[name](event); }, release(name) { docEvents.get(name)(); },
    windowEvent(name) { assert.ok(windowEvents.has(name), "Missing delivered window event " + name); windowEvents.get(name)(); },
    bindZoomView() {
      const line = source.split(/\r?\n/).find((v) => v.includes('map.on("zoomend", () => { $("#sZoom")'));
      assert.ok(line, "Missing delivered zoom-end render handler"); vm.runInContext(line, context);
    },
    visibility(hidden) { context.document.hidden = hidden; docEvents.get("visibilitychange")(); },
    get anim() { return anim; }, get stops() { return stops; }, get maximumAnimations() { return maximumAnimations; },
    get timers() { return [...timers.values()]; }
  };
}

test("a train inside the old 20–80 percent dead zone is followed immediately", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40));
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.animate, true);
  close(h.calls[0].offset[0], 40);
});
test("nearby motion uses a short linear camera animation", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40, 20));
  close(h.calls[0].options.duration, .16); close(h.calls[0].options.easeLinearity, 1);
  h.advance(80); close(h.map.center.x, 20); close(h.map.center.y, 10);
});
test("the camera focus leaves room above the navigation card", () => {
  const h = harness(), ll = { x: 100, y: 120 }; h.api.navFollowPoint(ll); h.settle();
  const p = h.map.latLngToContainerPoint(ll); close(p.x, 500); close(p.y, h.targetY());
});
test("a distant starting point is eased into view", () => {
  const h = harness(); h.api.navFollowPoint(h.target(1200, 900));
  assert.equal(h.calls[0].options.animate, true); close(h.calls[0].options.duration, .4);
  close(h.calls[0].options.easeLinearity, .5);
  h.advance(16); assert.ok(h.map.center.x > 0 && h.map.center.x < 1200);
});
test("a train already at the focus does not start an animation", () => {
  const h = harness(); h.api.navFollowPoint(h.target()); assert.equal(h.calls.length, 0);
});
test("an identical target settles once without a camera loop", () => {
  const h = harness(), ll = h.target(50); h.api.navFollowPoint(ll);
  for (let i = 0; i < 5; i++) h.api.navFollowPoint(ll);
  assert.equal(h.calls.length, 1); h.settle(); assert.equal(h.calls.length, 1);
});
test("only the latest train position is used at the next animation boundary", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40)); h.advance(80);
  const latest = h.target(130, 20); h.api.navFollowPoint(h.target(80, 10)); h.api.navFollowPoint(latest);
  assert.equal(h.calls.length, 1); h.advance(80);
  assert.equal(h.calls.length, 2); close(h.calls[1].offset[0], 110); close(h.calls[1].offset[1], 20);
  h.settle(); const p = h.map.latLngToContainerPoint(latest); close(p.x, 500); close(p.y, h.targetY());
  assert.equal(h.maximumAnimations, 1);
});
test("programmatic view guard covers asynchronous movement and all moveend listeners", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40));
  assert.equal(h.context.navProgrammaticView, true); assert.equal(h.context.userViewAt, -Infinity);
  h.advance(80); assert.equal(h.context.navProgrammaticView, true);
  h.advance(80, false); assert.deepEqual(h.eventGuards, [true]);
  assert.equal(h.context.navProgrammaticView, true); h.flush(); assert.equal(h.context.navProgrammaticView, false);
  assert.equal(h.context.userViewAt, -Infinity);
});
test("a queued continuation retains the programmatic guard", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40)); h.advance(80);
  h.api.navFollowPoint(h.target(90)); h.advance(80);
  assert.equal(h.calls.length, 2); assert.equal(h.context.navProgrammaticView, true);
  h.settle(); assert.ok(h.eventGuards.every(Boolean)); assert.equal(h.context.navProgrammaticView, false);
});
test("a stale completion microtask cannot release a newer camera guard", () => {
  const h = harness(); h.api.navFollowPoint(h.target(40)); h.advance(160, false);
  h.api.navCancelFollow(); h.api.navFollowPoint(h.target(80)); h.flush();
  assert.equal(h.context.navProgrammaticView, true); assert.ok(h.anim);
  h.settle(); assert.equal(h.context.navProgrammaticView, false);
});
test("a native Leaflet stop does not recursively restart the camera inside its end callback", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.api.navFollowPoint(h.target(150)); h.map.stop();
  assert.equal(h.calls.length, 1, "The PosAnimation.stop call stack must finish before camera continuation");
  assert.equal(h.anim, null); assert.equal(h.context.navProgrammaticView, true);
  h.api.navCancelFollow(); h.flush(); assert.equal(h.calls.length, 1);
});
test("a manual view takeover may start its native animation without a competing camera", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.api.navFollowPoint(h.target(150)); h.api.navReleaseFollow();
  h.map.panBy([75, 20], { animate: true, duration: .25, easeLinearity: .5 }); h.flush();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].guard, false);
  assert.equal(h.context.nav.follow, false); h.settle(); assert.equal(h.calls.length, 2);
});
test("synchronous Leaflet moveend listeners also execute under the camera guard", () => {
  const h = harness(); h.map.synchronous = true; h.api.navFollowPoint(h.target(40));
  assert.deepEqual(h.eventGuards, [true]); assert.equal(h.context.nav.followPanActive, false);
  assert.equal(h.context.navProgrammaticView, false); h.flush(); assert.equal(h.calls.length, 1);
});
test("an animation error clears camera ownership and its target", () => {
  const h = harness(); h.map.panBy = () => { throw new Error("Synthetic animation failure"); };
  assert.throws(() => h.api.navFollowPoint(h.target(40)), /Synthetic animation failure/);
  assert.equal(h.context.nav.followPanActive, false); assert.equal(h.context.nav.followPoint, null);
  assert.equal(h.context.navProgrammaticView, false);
});
test("view saving is blocked during camera animation until its completion microtask", () => {
  const h = harness(["viewCommitAllowed"]); assert.equal(h.api.viewCommitAllowed(), true);
  h.api.navFollowPoint(h.target(40)); assert.equal(h.api.viewCommitAllowed(), false);
  h.advance(160, false); assert.equal(h.api.viewCommitAllowed(), false);
  h.flush(); assert.equal(h.api.viewCommitAllowed(), true);
});
test("cancelling follows stops at the current camera position and clears its target", () => {
  const h = harness(); h.api.navFollowPoint(h.target(80)); h.advance(48);
  const before = { ...h.map.center }; h.api.navCancelFollow(); h.flush();
  assert.equal(h.stops, 1); assert.equal(h.anim, null); assert.equal(h.context.nav.followPanActive, false);
  assert.equal(h.context.nav.followPoint, null); assert.deepEqual(h.map.center, before);
  h.advance(400); assert.equal(h.calls.length, 1); assert.deepEqual(h.map.center, before);
});
test("cancellation moveend cannot restart an older target", () => {
  const h = harness(); h.api.navFollowPoint(h.target(80)); h.advance(48);
  h.api.navFollowPoint(h.target(500)); h.api.navCancelFollow(); h.settle();
  assert.equal(h.calls.length, 1); assert.ok(h.eventGuards.every(Boolean));
  assert.equal(h.context.navProgrammaticView, false);
});
test("cancelling an idle follower does not stop a user map animation", () => {
  const h = harness(); h.map.panBy([50, 0], { animate: true, duration: .4, easeLinearity: 1 });
  h.api.navCancelFollow(); assert.equal(h.stops, 0); assert.ok(h.anim); h.settle(); close(h.map.center.x, 50);
});
test("switching follow off suppresses queued and new camera movement", () => {
  const h = harness(); h.context.nav.follow = false; h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0);
});
test("the actual follow checkbox cancels immediately and can resume following", () => {
  const h = harness(["openNavigation"]); h.context.nav = null; h.api.openNavigation();
  h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.node("#navFollow").checked = false; h.node("#navFollow").change(); h.flush();
  assert.equal(h.context.nav.follow, false); assert.equal(h.anim, null);
  assert.equal(h.context.nav.followPoint, null);
  h.node("#navFollow").checked = true; h.node("#navFollow").change();
  assert.equal(h.context.nav.follow, true); assert.ok(h.effects.includes("cursor"));
});
test("a hidden document does not begin following", () => {
  const h = harness(); h.context.document.hidden = true; h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0);
});
test("zooming suspends a follow animation", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.emit("zoomstart");
  assert.equal(h.anim, null); const count = h.calls.length;
  h.api.navFollowPoint(h.target(500)); assert.equal(h.calls.length, count);
});
test("zoom end permits fresh following targets again", () => {
  const h = harness(); h.emit("zoomstart"); h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0); h.emit("zoomend"); h.flush(); h.api.navFollowPoint(h.target(120));
  assert.equal(h.calls.length, 1); assert.equal(h.context.navFollowZooming, false);
});
test("user input activity blocks new camera movement", () => {
  const h = harness(); h.context.nav.followInputActive = true; h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0);
});
for (const [begin, end] of [["mousedown", "mouseup"], ["touchstart", "touchend"], ["touchstart", "touchcancel"]]) {
  test(begin + " yields the camera to the user until " + end, () => {
    const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.input(begin); h.flush();
    assert.equal(h.anim, null); assert.equal(h.context.nav.followInputActive, true);
    const count = h.calls.length; h.api.navFollowPoint(h.target(100)); assert.equal(h.calls.length, count);
    h.release(end); assert.equal(h.context.nav.followInputActive, false); assert.ok(h.effects.includes("cursor"));
    h.api.navFollowPoint(h.target(100)); assert.equal(h.calls.length, count + 1);
  });
}
test("a wheel input cancels the camera without disabling follow", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.input("wheel"); h.flush();
  assert.equal(h.anim, null); assert.equal(h.context.nav.follow, true);
});
test("wheel input protects the delay before native zoomstart from train RAF takeover", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.input("wheel"); h.flush();
  close(h.context.nav.followInputUntil, 212);
  const count = h.calls.length; h.advance(40); h.api.navFollowPoint(h.target(150));
  assert.equal(h.calls.length, count, "Train RAF must not steal the camera during the wheel debounce");
  h.emit("zoomstart"); h.advance(181); h.api.navFollowPoint(h.target(180));
  assert.equal(h.calls.length, count, "Native zoom must retain the camera after the input deadline expires");
  h.emit("zoomend"); h.flush(); h.api.navFollowPoint(h.target(180)); assert.equal(h.calls.length, count + 1);
});
test("an expired zoom input deadline permits following if the browser never zooms", () => {
  const h = harness(); h.input("wheel"); h.advance(40); h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0); h.advance(141); h.api.navFollowPoint(h.target(120));
  assert.equal(h.calls.length, 1);
});
test("repeated wheel input extends the protected native zoom window", () => {
  const h = harness(); h.input("wheel"); h.advance(120); h.input("wheel");
  close(h.context.nav.followInputUntil, 300); h.advance(100); h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 0); h.advance(81); h.api.navFollowPoint(h.target(100));
  assert.equal(h.calls.length, 1);
});
for (const status of ["paused", "finished"]) {
  test("the zoom fallback resumes a stationary " + status + " train without a playback RAF", () => {
    const h = harness(), ll = h.target(100); h.context.nav.playback.status = status; h.context.nav.raf = 0;
    h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
    h.input("wheel"); assert.equal(h.timers.length, 1); h.advance(179); assert.equal(h.calls.length, 0);
    h.advance(1); assert.equal(h.calls.length, 1); assert.equal(h.context.nav.followInputUntil, 0);
    assert.equal(h.context.nav.followZoomTimer, 0); assert.equal(h.timers.length, 0);
  });
}
test("zoom at the map limit recovers a paused camera when no zoom event occurs", () => {
  const h = harness(), ll = h.target(100);
  h.context.nav.playback.status = "paused"; h.context.nav.raf = 0;
  h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
  const delivered = source.split(/\r?\n/).find((v) => v.includes('$("#zIn").addEventListener("click"'));
  assert.ok(delivered); vm.runInContext(delivered, h.context); h.node("#zIn").click();
  assert.ok(h.effects.includes("zoomIn")); h.advance(180);
  assert.equal(h.calls.length, 1); assert.equal(h.context.nav.followZoomTimer, 0);
});
test("early zoomend restores a paused camera before the 180 ms fallback deadline", () => {
  const h = harness(), ll = h.target(100); h.bindZoomView(); h.context.nav.playback.status = "paused";
  h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
  h.input("wheel"); h.emit("zoomstart"); assert.equal(h.timers.length, 0);
  h.advance(40); h.emit("zoomend"); h.emit("moveend"); h.flush(); assert.equal(h.context.nav.followInputUntil, 0);
  assert.equal(h.calls.length, 1); assert.ok(h.anim);
});
test("zoomstart cancels the fallback and delegates recovery to zoomend", () => {
  const h = harness(), ll = h.target(100); h.bindZoomView(); h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
  h.input("wheel"); h.emit("zoomstart"); assert.equal(h.timers.length, 0);
  assert.equal(h.context.nav.followZoomTimer, 0); h.advance(200); assert.equal(h.calls.length, 0);
  h.emit("zoomend"); h.emit("moveend"); h.flush(); assert.equal(h.calls.length, 1);
});
test("cancellation clears the zoom timer and invalidates an already queued callback", () => {
  const h = harness(); h.input("wheel"); const callback = h.timers[0].callback;
  h.api.navCancelFollow(); assert.equal(h.timers.length, 0); assert.equal(h.context.nav.followZoomTimer, 0);
  callback(); h.advance(200); assert.ok(!h.effects.includes("cursor")); assert.equal(h.calls.length, 0);
});
test("closing navigation prevents an old zoom timer from reviving its camera", () => {
  const h = harness(["navClose"]); h.input("wheel"); const callback = h.timers[0].callback;
  h.api.navClose(); assert.equal(h.timers.length, 0); callback(); h.advance(200);
  assert.equal(h.context.nav, null); assert.ok(!h.effects.includes("cursor")); assert.equal(h.calls.length, 0);
});
test("an old owner zoom timer does not draw or follow a new navigation owner", () => {
  const h = harness(); h.input("wheel"); const callback = h.timers[0].callback;
  h.context.nav = { follow: true, followPoint: null, followPanActive: false };
  callback(); h.advance(200); assert.ok(!h.effects.includes("cursor")); assert.equal(h.calls.length, 0);
});
test("a superseded zoom timer cannot clear the newer protected input deadline", () => {
  const h = harness(); h.input("wheel"); const callback = h.timers[0].callback;
  h.advance(120); h.input("wheel"); callback(); close(h.context.nav.followInputUntil, 300);
  assert.ok(!h.effects.includes("cursor")); assert.equal(h.timers.length, 1);
});
test("window blur clears map input state left by releasing the pointer outside the page", () => {
  const h = harness(); h.input("mousedown"); assert.equal(h.context.nav.followInputActive, true);
  h.windowEvent("blur"); assert.equal(h.context.nav.followInputActive, false);
  h.api.navFollowPoint(h.target(100)); assert.equal(h.calls.length, 1);
});
for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
  test(key + " takes over the map without a competing camera", () => {
    const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.input("keydown", { key });
    assert.equal(h.anim, null); assert.equal(h.context.nav.follow, false);
    h.map.panBy([75, 20], { animate: true, duration: .25, easeLinearity: .5 }); h.flush();
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].guard, false);
  });
}
for (const key of ["+", "=", "-"]) {
  test(key + " lets the native zoom handler stop the camera first", () => {
    const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.input("keydown", { key }); h.flush();
    assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
    assert.equal(h.context.nav.follow, true);
  });
  test(key + " prevents a train RAF from resuming before its native zoom handler", () => {
    const h = harness(); h.input("keydown", { key }); h.advance(40); h.api.navFollowPoint(h.target(100));
    assert.equal(h.calls.length, 0); h.advance(141); h.emit("zoomend"); h.flush(); h.api.navFollowPoint(h.target(120));
    assert.equal(h.calls.length, 1);
  });
}
for (const [id, direction] of [["zIn", "zoomIn"], ["zOut", "zoomOut"]]) {
  test("the delivered " + id + " button protects the camera before requesting zoom", () => {
    const h = harness(), line = source.split(/\r?\n/).find((v) => v.includes('$("#' + id + '").addEventListener("click"'));
    assert.ok(line, "Missing delivered zoom button handler"); vm.runInContext(line, h.context);
    h.api.navFollowPoint(h.target(100)); h.advance(32); h.node("#" + id).click(); h.flush();
    assert.equal(h.anim, null); assert.ok(h.effects.includes(direction)); close(h.context.nav.followInputUntil, 212);
    const count = h.calls.length; h.advance(40); h.api.navFollowPoint(h.target(150)); assert.equal(h.calls.length, count);
  });
}
for (const key of ["+", "=", "-"]) {
  test("the delivered document " + key + " shortcut protects zoom from train RAF takeover", () => {
    const h = harness(), line = source.split(/\r?\n/).find((v) => v.includes(key === "-" ? 'case "-": navPauseFollowForZoom' : 'case "+": case "=": navPauseFollowForZoom'));
    assert.ok(line, "Missing delivered document zoom shortcut");
    h.api.navFollowPoint(h.target(100)); h.advance(32);
    vm.runInContext("switch (" + JSON.stringify(key) + ") { " + line + " }", h.context); h.flush();
    assert.equal(h.anim, null); close(h.context.nav.followInputUntil, 212);
    const count = h.calls.length; h.advance(40); h.api.navFollowPoint(h.target(150)); assert.equal(h.calls.length, count);
  });
}
for (const fn of ["fitAll", "fitLine"]) {
  test(fn + " releases follow before starting its native map animation", () => {
    const h = harness([fn]); h.context.P.stations = { a: { lat: 0, lng: 0 }, b: { lat: 1, lng: 1 } };
    h.context.line = () => ({ stations: ["a", "b"] });
    h.api.navFollowPoint(h.target(100)); h.advance(32); h.api[fn](); h.flush();
    assert.equal(h.context.nav.follow, false); assert.equal(h.context.nav.followPoint, null);
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].guard, false); assert.equal(h.context.userViewAt, 32);
    h.settle(); assert.equal(h.calls.length, 2);
  });
}
test("the actual station context-menu command releases follow before positioning the map", () => {
  const h = harness(["runCmd"]); h.context.sel.station = "a";
  h.api.navFollowPoint(h.target(100)); h.advance(32); h.api.runCmd("gotoStn"); h.flush();
  assert.equal(h.context.nav.follow, false); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].guard, false); assert.equal(h.context.userViewAt, 32);
  h.settle(); assert.equal(h.calls.length, 2);
});
test("the delivered station-list positioning handler also releases follow", () => {
  const h = harness(), delivered = source.match(/if \(act === "goto"\) \{[^\r\n]+\}/);
  assert.ok(delivered, "Missing delivered station-list goto handler");
  h.api.navFollowPoint(h.target(100)); h.advance(32);
  vm.runInContext("(function(act, st) { " + delivered[0] + " })(\"goto\", {lat: 0, lng: 0});", h.context); h.flush();
  assert.equal(h.context.nav.follow, false); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].guard, false); assert.equal(h.context.userViewAt, 32);
  h.settle(); assert.equal(h.calls.length, 2);
});
function endWithoutNativeAnimationGuard() {
  const delivered = named("navFollowEnd"), mutated = delivered.replace(/\s*\|\|\s*\(map\._panAnim\s*&&\s*map\._panAnim\._inProgress\)/, "");
  assert.notEqual(mutated, delivered, "Missing native animation guard for the negative control");
  return mutated;
}
function bindWithImmediateZoomEnd() {
  const delivered = named("navBindMap"), start = delivered.indexOf('  map.on("zoomend"'), end = delivered.indexOf('  map.on("resize"', start);
  assert.ok(start > 0 && end > start, "Missing zoom-end binding for the negative control");
  return delivered.slice(0, start) + '  map.on("zoomend", () => { navFollowZooming = false; if (nav) nav.followInputUntil = 0; });\n' + delivered.slice(end);
}
function zoomTail(overrides = {}) {
  const h = harness([], overrides), ll = h.target(100); h.map.nativeStopOnRun = true; h.bindZoomView();
  h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
  h.emit("zoomstart"); h.emit("zoomend"); h.emit("moveend");
  return h;
}
test("native zoomend then moveend starts one camera animation after the entire event stack", () => {
  const h = zoomTail(); assert.equal(h.calls.length, 0); assert.equal(h.context.navFollowZooming, true);
  h.flush(); assert.equal(h.calls.length, 1); assert.equal(h.context.navFollowZooming, false);
  assert.equal(h.context.navProgrammaticView, true); assert.ok(h.map._panAnim._inProgress);
  h.settle(); assert.equal(h.calls.length, 1); assert.equal(h.context.navProgrammaticView, false);
});
test("the previous immediate zoomend and unguarded moveend cause native stop-start microtask starvation", () => {
  const h = zoomTail({ navBindMap: bindWithImmediateZoomEnd(), navFollowEnd: endWithoutNativeAnimationGuard() });
  assert.throws(() => h.flush(), /Microtask loop did not settle/);
  assert.ok(h.calls.length > 20 && h.stops > 20, "The negative control must demonstrate native stop-start recursion");
});
test("an unrelated moveend cannot end a native camera animation still in progress", () => {
  const h = harness(); h.map.nativeStopOnRun = true; h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.api.navFollowPoint(h.target(120)); h.emit("moveend"); h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.context.nav.followPanActive, true);
  assert.equal(h.context.navProgrammaticView, true); assert.ok(h.map._panAnim._inProgress);
  h.settle(); assert.equal(h.calls.length, 2); assert.equal(h.context.navProgrammaticView, false);
});
function delayedResize(overrides = {}) {
  const h = harness([], overrides), ll = h.target(1200); h.map.nativeStopOnRun = true;
  h.context.navDrawCursor = () => h.api.navFollowPoint(ll); h.emit("resize");
  h.context.setTimeout(() => h.emit("moveend"), 200);
  return h;
}
test("a 200 ms debounced resize moveend leaves the ongoing camera animation alone", () => {
  const h = delayedResize(); close(h.calls[0].options.duration, .4); h.advance(200);
  assert.equal(h.calls.length, 1); assert.equal(h.stops, 0); assert.ok(h.map._panAnim._inProgress);
  assert.equal(h.context.navProgrammaticView, true); h.settle(); assert.equal(h.calls.length, 1);
});
test("the previous unguarded resize tail causes native stop-start microtask starvation", () => {
  const h = delayedResize({ navFollowEnd: endWithoutNativeAnimationGuard() });
  assert.throws(() => h.advance(200), /Microtask loop did not settle/);
  assert.ok(h.calls.length > 20 && h.stops > 20);
});
test("an older zoom-end microtask cannot unlock a newer zoom session", () => {
  const h = harness(); h.emit("zoomstart"); h.emit("zoomend"); h.emit("zoomstart"); h.flush();
  assert.equal(h.context.navFollowZooming, true); h.api.navFollowPoint(h.target(100)); assert.equal(h.calls.length, 0);
  h.emit("zoomend"); h.flush(); h.api.navFollowPoint(h.target(100)); assert.equal(h.calls.length, 1);
});
test("a zoom-end microtask cannot restart a camera after follow was cancelled", () => {
  const h = harness(), ll = h.target(100); h.bindZoomView(); h.context.navDrawCursor = () => h.api.navFollowPoint(ll);
  h.emit("zoomstart"); h.emit("zoomend"); h.api.navCancelFollow(); h.flush();
  assert.equal(h.calls.length, 0); assert.equal(h.context.nav.followPoint, null);
});
test("a zoom-end microtask cannot draw into a replacement navigation owner", () => {
  const h = harness(); h.emit("zoomstart"); h.emit("zoomend");
  h.context.nav = { follow: true, followPoint: null, followPanActive: false }; h.flush();
  assert.equal(h.calls.length, 0); assert.ok(!h.effects.includes("cursor"));
});
test("a user map drag disables follow and cancels the camera", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.emit("dragstart"); h.flush();
  assert.equal(h.context.nav.follow, false); assert.equal(h.node("#navFollow").checked, false);
  assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
});
test("backgrounding cancels the camera and pauses playback scheduling", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.visibility(true); h.flush();
  assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
  assert.ok(h.cancelledFrames.length); assert.ok(h.effects.includes("silence"));
});
test("foregrounding resumes playback scheduling", () => {
  const h = harness(); h.visibility(true); h.visibility(false);
  assert.ok(h.effects.includes("speech")); assert.ok(h.effects.includes("frame"));
});
test("resizing clears an obsolete camera target before recalculating geometry", () => {
  const h = harness(); h.api.navFollowPoint(h.target(100)); h.advance(32); h.emit("resize"); h.flush();
  assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
  assert.deepEqual(h.effects.slice(-2), ["geometry", "cursor"]);
});
test("pausing playback cancels the camera", () => {
  const h = harness(["navTogglePause"]); h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.api.navTogglePause(); h.flush(); assert.equal(h.context.nav.playback.status, "paused");
  assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
});
test("closing navigation cancels the camera before discarding navigation", () => {
  const h = harness(["navClose"]); h.api.navFollowPoint(h.target(100)); h.advance(32);
  h.api.navClose(); h.flush(); assert.equal(h.context.nav, null); assert.equal(h.anim, null);
  assert.equal(h.context.navProgrammaticView, false); assert.equal(h.node("#navCard").hidden, true);
});
test("suspending navigation cancels the camera before switching projects", () => {
  const h = harness(["navSuspend"]); h.api.navFollowPoint(h.target(100)); h.advance(32);
  const saved = h.api.navSuspend(); h.flush(); assert.equal(h.context.nav, null); assert.equal(h.anim, null);
  assert.equal(saved.followPoint, null); assert.equal(saved.followPanActive, false);
});
test("restoring navigation clears stale pointer input and zoom deadlines", () => {
  const h = harness(["navRestore", "navClose"]), saved = {
    follow: true, followPoint: null, followPanActive: false, followInputActive: true,
    followInputUntil: 10000, content: {}, playback: { status: "running", phase: "ride" }
  };
  h.api.navFollowPoint(h.target(100)); h.advance(32); h.api.navRestore(saved); h.flush();
  assert.equal(h.context.nav, saved); assert.equal(saved.followInputActive, false); assert.equal(saved.followInputUntil, 0);
  assert.equal(h.anim, null); h.api.navFollowPoint(h.target(100)); assert.ok(h.anim);
});
test("replanning cancels the old camera target", () => {
  const h = harness(["navReplan"]); h.context.nav.choices = [];
  h.api.navFollowPoint(h.target(100)); h.advance(32); h.api.navReplan(); h.flush();
  assert.equal(h.context.nav.playback, null); assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
});
test("restarting clears an older camera animation before creating playback", () => {
  const h = harness(["navStart"]); h.context.nav.plan = { ok: true, legs: [{ from: "a", to: "b" }] };
  h.api.navFollowPoint(h.target(100)); h.advance(32); h.api.navStart(); h.flush();
  assert.equal(h.anim, null); assert.equal(h.context.nav.followPoint, null);
  assert.equal(h.context.nav.playback.status, "running");
});

function trajectory(old) {
  const h = harness(), errors = [], steps = [];
  const start = { x: 0, y: h.target().y };
  h.api.navFollowPoint(start); h.settle();
  const previous = { ...h.map.center };
  h.moves.length = 0;
  let lastX = previous.x;
  for (let i = 1; i <= 250; i++) {
    const ll = { x: start.x + i * 4, y: start.y };
    if (old) {
      const p = h.map.latLngToContainerPoint(ll), size = h.map.getSize();
      if (!(p.x > size.x * .2 && p.x < size.x * .8)) h.map.panBy([p.x - size.x * .5, 0], { animate: false });
    } else h.api.navFollowPoint(ll);
    h.advance(16); steps.push(h.map.center.x - lastX); lastX = h.map.center.x;
    errors.push(Math.abs(h.map.latLngToContainerPoint(ll).x - 500));
  }
  return { h, steps, errors };
}
test("16 ms train motion yields continuous camera motion with bounded lag", () => {
  const { h, steps, errors } = trajectory(false);
  assert.ok(steps.filter((v) => v > 0).length > steps.length * .9,
    "Camera should move on almost every frame, rather than jump at viewport boundaries");
  assert.ok(Math.max(...steps) < 12, "No large jump is allowed during constant-speed travel");
  assert.ok(Math.max(...errors) < 90, "The train must stay near its screen focus");
  assert.ok(h.calls.every((c) => c.options.animate)); assert.equal(h.maximumAnimations, 1);
});
test("the previous boundary-and-instant-pan behavior fails the continuous-motion criteria", () => {
  const { steps, errors } = trajectory(true);
  assert.ok(steps.filter((v) => v > 0).length < steps.length * .1);
  assert.ok(Math.max(...steps) >= 300); assert.ok(Math.max(...errors) >= 250);
});

console.log("Navigation camera follow: " + checks + "/" + checks + " checks passed");
