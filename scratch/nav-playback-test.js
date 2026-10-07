"use strict";

/* Execute the delivered functions, without Leaflet or DOM mocks. Before the UI
   is integrated, the same checks can run against its source file. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const indexPath = path.join(__dirname, "..", "index.html");
const extract = (content) => {
  const start = content.indexOf("// BEGIN NAV PLAYBACK"), end = content.indexOf("// END NAV PLAYBACK", start);
  return start >= 0 && end > start ? content.slice(start, end) : null;
};
const appSource = extract(fs.readFileSync(indexPath, "utf8"));
const source = appSource || extract(fs.readFileSync(path.join(__dirname, "navigation-ui.js"), "utf8"));
assert.ok(source, "Navigation playback marker range is missing");
const load = (text) => vm.runInNewContext(text + "\n({createNavPlayback, navStopDuration, advanceNavPlayback, navRideFraction, navPointAt, navLegPoints});");
const api = load(source), clean = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
const test = (name, callback) => {
  try { callback(); checks++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
};
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + " != " + expected);
const leg = (lineId, from, to, fromIndex, toIndex, segmentIndex, direction = 1) => ({ lineId, from, to, fromIndex, toIndex, segmentIndex, direction });
const plan = { ok: true, from: "A", to: "D", legs: [
  leg("L", "A", "B", 0, 1, 0), leg("L", "B", "C", 1, 2, 1), leg("M", "C", "D", 0, 1, 0)
] };
const durations = [1.2, 1.7, .8];
const playback = () => api.createNavPlayback(plan, durations);
const point = (x, y = 0) => ({ x, y });
const geometry = { L: [
  { off: 2, pts: [point(0), point(3)] },
  { off: 4, pts: [point(4), point(8)] },
  { off: -3, pts: [point(9), point(10)] }
], M: [{ off: 1, pts: [point(80, 1), point(90, 1)] }] };

test("initial station is recorded once", () => {
  const state = playback();
  assert.equal(state.status, "running"); assert.equal(state.phase, "stop"); assert.equal(state.index, 0);
  assert.deepEqual(clean(state.arrivals), [{ station: "A", final: false }]);
  assert.deepEqual(clean(state.transfers), []);
});
test("creating playback does not mutate input", () => {
  const before = JSON.stringify([plan, durations]); playback();
  assert.equal(JSON.stringify([plan, durations]), before);
});
test("duration storage is independent", () => {
  const original = [1, 2, 3], state = api.createNavPlayback(plan, original);
  original[0] = 10; assert.equal(state.durations[0], 1);
});
test("minimum and fallback ride durations", () => {
  const state = api.createNavPlayback(plan, [-1, 0, NaN]);
  assert.deepEqual(clean(state.durations), [.05, 3, 3]);
});
test("ordinary and transfer station dwells", () => {
  const state = playback(); assert.equal(api.navStopDuration(state), .9);
  state.index = 1; assert.equal(api.navStopDuration(state), .9);
  state.index = 2; assert.equal(api.navStopDuration(state), 2.6);
});
test("departure announces its next station once without an arrival", () => {
  const state = playback();
  assert.deepEqual(clean(api.advanceNavPlayback(state, .9)), [{ type: "next", station: "B", lineId: "L", index: 0 }]);
  assert.equal(state.phase, "ride"); assert.equal(state.index, 0); assert.equal(state.elapsed, 0);
  assert.equal(state.arrivals.length, 1);
  assert.deepEqual(clean(api.advanceNavPlayback(state, .1)), []);
});
test("partial ride retains station and elapsed fraction", () => {
  const state = playback(); api.advanceNavPlayback(state, 1.5);
  assert.equal(state.phase, "ride"); assert.equal(state.index, 0); close(state.elapsed, .6);
  assert.equal(state.arrivals.length, 1);
});
test("intermediate arrival advances to next station dwell", () => {
  const state = playback(), events = api.advanceNavPlayback(state, 2.1);
  assert.deepEqual(clean(events), [
    { type: "next", station: "B", lineId: "L", index: 0 },
    { type: "arrival", station: "B", lineId: "L", final: false, index: 0 }
  ]);
  assert.equal(state.phase, "stop"); assert.equal(state.index, 1); close(state.elapsed, 0);
});
test("transfer fires once after its longer station dwell", () => {
  const state = playback(); api.advanceNavPlayback(state, 4.7);
  assert.equal(state.index, 2); assert.equal(state.phase, "stop");
  assert.deepEqual(clean(api.advanceNavPlayback(state, 2.5)), []);
  const events = api.advanceNavPlayback(state, .1);
  assert.deepEqual(clean(events), [
    { type: "transfer", station: "C", lineId: "M" },
    { type: "next", station: "D", lineId: "M", index: 2 }
  ]);
  assert.equal(state.phase, "ride"); assert.equal(state.transfers.length, 1);
  assert.deepEqual(clean(api.advanceNavPlayback(state, .1)), []);
  assert.equal(state.transfers.length, 1);
});
test("large tick preserves every arrival including terminus", () => {
  const state = playback(), events = api.advanceNavPlayback(state, 1000);
  assert.equal(state.status, "finished"); assert.equal(state.index, 2);
  assert.deepEqual(clean(events), [
    { type: "next", station: "B", lineId: "L", index: 0 },
    { type: "arrival", station: "B", lineId: "L", final: false, index: 0 },
    { type: "next", station: "C", lineId: "L", index: 1 },
    { type: "arrival", station: "C", lineId: "L", final: false, index: 1 },
    { type: "transfer", station: "C", lineId: "M" },
    { type: "next", station: "D", lineId: "M", index: 2 },
    { type: "arrival", station: "D", lineId: "M", final: true, index: 2 }
  ]);
  assert.deepEqual(clean(state.arrivals).map((event) => event.station), ["A", "B", "C", "D"]);
  assert.equal(state.arrivals.filter((event) => event.final).length, 1);
});
test("one ride includes final station", () => {
  const one = api.createNavPlayback({ from: "X", to: "Y", legs: [leg("L", "X", "Y", 0, 1, 0)] }, [.2]);
  api.advanceNavPlayback(one, 1.1);
  assert.equal(one.status, "finished"); assert.equal(one.arrivals.at(-1).station, "Y");
  assert.equal(one.arrivals.at(-1).final, true);
});
test("finished playback never advances or reannounces", () => {
  const state = playback(); api.advanceNavPlayback(state, 1000);
  const before = JSON.stringify(state);
  assert.deepEqual(clean(api.advanceNavPlayback(state, 1000)), []);
  assert.equal(JSON.stringify(state), before);
});
test("paused playback never advances or announces", () => {
  const state = playback(); api.advanceNavPlayback(state, 1.5); state.status = "paused";
  const before = JSON.stringify(state);
  assert.deepEqual(clean(api.advanceNavPlayback(state, 1000)), []);
  assert.equal(JSON.stringify(state), before);
});
test("resuming continues the remaining ride", () => {
  const state = playback(); api.advanceNavPlayback(state, 1.5); state.status = "paused";
  api.advanceNavPlayback(state, 1000); state.status = "running";
  const events = api.advanceNavPlayback(state, .6);
  assert.equal(events[0].station, "B"); assert.equal(state.index, 1);
});
test("nonpositive and invalid clock input is ignored", () => {
  const state = playback(); api.advanceNavPlayback(state, .3);
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, "1", {}]) {
    const before = JSON.stringify(state);
    assert.deepEqual(clean(api.advanceNavPlayback(state, dt)), []);
    assert.equal(JSON.stringify(state), before);
  }
});
test("small clock ticks equal one large tick at completion", () => {
  const big = playback(), small = playback();
  const bigEvents = api.advanceNavPlayback(big, 10), smallEvents = [];
  for (let i = 0; i < 200; i++) smallEvents.push(...api.advanceNavPlayback(small, .05));
  assert.deepEqual(clean(smallEvents), clean(bigEvents));
  assert.deepEqual(clean(small), clean(big));
});
test("small clock ticks equal one large tick midride", () => {
  const big = playback(), small = playback();
  const bigEvents = api.advanceNavPlayback(big, 7.5), smallEvents = [];
  for (let i = 0; i < 150; i++) smallEvents.push(...api.advanceNavPlayback(small, .05));
  assert.deepEqual(clean(smallEvents), clean(bigEvents));
  assert.equal(small.status, big.status); assert.equal(small.phase, big.phase); assert.equal(small.index, big.index);
  close(small.elapsed, big.elapsed);
});
test("event gate stops a huge tick at the first departure", () => {
  const state = playback(), events = api.advanceNavPlayback(state, 1000, true);
  assert.deepEqual(clean(events), [{ type: "next", station: "B", lineId: "L", index: 0 }]);
  assert.equal(state.status, "running"); assert.equal(state.phase, "ride"); assert.equal(state.index, 0);
  assert.equal(state.elapsed, 0); assert.equal(state.arrivals.length, 1);
});
test("event gate stops a huge ride tick at its arrival", () => {
  const state = playback(); api.advanceNavPlayback(state, .9);
  const events = api.advanceNavPlayback(state, 1000, true);
  assert.deepEqual(clean(events), [{ type: "arrival", station: "B", lineId: "L", final: false, index: 0 }]);
  assert.equal(state.status, "running"); assert.equal(state.phase, "stop"); assert.equal(state.index, 1);
  assert.equal(state.elapsed, 0); assert.equal(state.arrivals.length, 2);
});
test("event gate preserves transfer and departure in one transition", () => {
  const state = playback(); api.advanceNavPlayback(state, 4.7);
  const events = api.advanceNavPlayback(state, 1000, true);
  assert.deepEqual(clean(events), [
    { type: "transfer", station: "C", lineId: "M" },
    { type: "next", station: "D", lineId: "M", index: 2 }
  ]);
  assert.equal(state.phase, "ride"); assert.equal(state.index, 2); assert.equal(state.elapsed, 0);
  assert.equal(state.transfers.length, 1);
});
test("event gate retains partial time without inventing a transition", () => {
  const state = playback();
  assert.deepEqual(clean(api.advanceNavPlayback(state, .3, true)), []); close(state.elapsed, .3);
  assert.deepEqual(clean(api.advanceNavPlayback(state, .2, true)), []); close(state.elapsed, .5);
  assert.deepEqual(clean(api.advanceNavPlayback(state, .4, true)), [{ type: "next", station: "B", lineId: "L", index: 0 }]);
  assert.equal(state.elapsed, 0);
  assert.deepEqual(clean(api.advanceNavPlayback(state, .4, true)), []); close(state.elapsed, .4);
});
test("successive gated ticks drop no departure or arrival", () => {
  const ungated = playback(), gated = playback(), all = api.advanceNavPlayback(ungated, 1000), gatedEvents = [];
  for (let i = 0; i < 10 && gated.status === "running"; i++) {
    const events = clean(api.advanceNavPlayback(gated, 1000, true));
    assert.ok(events.length === 1 || events.length === 2 && events[0].type === "transfer" && events[1].type === "next");
    gatedEvents.push(...events);
  }
  assert.equal(gated.status, "finished"); assert.deepEqual(gatedEvents, clean(all));
  assert.deepEqual(clean(gated), clean(ungated));
  assert.deepEqual(clean(api.advanceNavPlayback(gated, 1000, true)), []);
});
test("every directed segment announces its own next occurrence", () => {
  const repeated = { from: "A", to: "C", legs: [
    leg("L", "A", "B", 0, 1, 0), leg("L", "B", "A", 1, 0, 0, -1), leg("L", "A", "C", 0, 2, 2, -1)
  ] };
  const state = api.createNavPlayback(repeated, [.1, .1, .1]), events = clean(api.advanceNavPlayback(state, 1000));
  assert.deepEqual(events.filter((event) => event.type === "next"), [
    { type: "next", station: "B", lineId: "L", index: 0 },
    { type: "next", station: "A", lineId: "L", index: 1 },
    { type: "next", station: "C", lineId: "L", index: 2 }
  ]);
  assert.deepEqual(events.filter((event) => event.type === "arrival").map((event) => [event.station, event.index, event.final]),
    [["B", 0, false], ["A", 1, false], ["C", 2, true]]);
  assert.deepEqual(clean(state.arrivals).map((event) => event.station), ["A", "B", "A", "C"]);
});
test("explicitly disabled event gate preserves default clock behavior", () => {
  const implicit = playback(), explicit = playback();
  assert.deepEqual(clean(api.advanceNavPlayback(explicit, 7.5, false)), clean(api.advanceNavPlayback(implicit, 7.5)));
  assert.deepEqual(clean(explicit), clean(implicit));
});
test("zero leg route finishes at its only station", () => {
  const state = api.createNavPlayback({ from: "A", to: "A", legs: [] }, []);
  assert.equal(state.status, "finished");
  assert.deepEqual(clean(state.arrivals), [{ station: "A", final: true }]);
  const before = JSON.stringify(state);
  assert.deepEqual(clean(api.advanceNavPlayback(state, 1000)), []);
  assert.equal(JSON.stringify(state), before);
});

const arc = [point(0), point(9), point(9, 1)];
const rideSpeed = (sample, time, step = 1e-5) => (sample(time + step) - sample(time - step)) / (2 * step);
const accelerationAndBraking = (sample) => {
  const start = [.04, .1, .16, .22].map((time) => rideSpeed(sample, time));
  const cruise = [.3, .4, .5, .6, .7].map((time) => rideSpeed(sample, time));
  const end = [.78, .84, .9, .96].map((time) => rideSpeed(sample, time));
  return start.every((speed, i) => speed > 0 && (!i || speed > start[i - 1] + .1)) &&
    cruise.every((speed) => speed > 1 && Math.abs(speed - cruise[0]) < 1e-7) &&
    end.every((speed, i) => speed > 0 && (!i || speed < end[i - 1] - .1)) &&
    start.at(-1) < cruise[0] && end[0] < cruise[0];
};
test("ride motion clamps before departure and after arrival", () => {
  for (const time of [-100, -1, -.001, 0]) assert.equal(api.navRideFraction(time), 0);
  for (const time of [1, 1.001, 2, 100]) assert.equal(api.navRideFraction(time), 1);
  close(api.navRideFraction(.5), .5);
});
test("ride motion advances monotonically without overshoot", () => {
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const fraction = api.navRideFraction(i / 1000);
    assert.ok(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1);
    assert.ok(fraction >= previous && (!i || fraction > previous));
    previous = fraction;
  }
  assert.equal(previous, 1);
});
test("ride motion starts and arrives at rest", () => {
  const step = 1e-5;
  const departureSpeed = (api.navRideFraction(step) - api.navRideFraction(0)) / step;
  const arrivalSpeed = (api.navRideFraction(1) - api.navRideFraction(1 - step)) / step;
  assert.ok(departureSpeed >= 0 && departureSpeed < .001);
  assert.ok(arrivalSpeed >= 0 && arrivalSpeed < .001);
  assert.ok(api.navRideFraction(.05) < .05 && 1 - api.navRideFraction(.95) < .05,
    "Departure and braking must travel less than constant speed over the same short time");
});
test("ride motion accelerates cruises and brakes", () => {
  assert.ok(accelerationAndBraking(api.navRideFraction), "Expected increasing, constant, then decreasing speed");
  close(rideSpeed(api.navRideFraction, .5), 1 / .76, 1e-7);
});
test("ride acceleration and braking are symmetric", () => {
  for (let i = 0; i <= 100; i++) {
    const time = i / 100;
    close(api.navRideFraction(time) + api.navRideFraction(1 - time), 1);
    if (i && i < 100) close(rideSpeed(api.navRideFraction, time), rideSpeed(api.navRideFraction, 1 - time), 1e-7);
  }
});
test("ride phase boundaries keep position and speed continuous", () => {
  const step = 1e-6;
  for (const seam of [.24, .76]) {
    const left = api.navRideFraction(seam - step), at = api.navRideFraction(seam), right = api.navRideFraction(seam + step);
    assert.ok(left < at && at < right && right - left < 3 * step);
    const before = (at - left) / step, after = (right - at) / step;
    close(before, after, 1e-5);
    close(before, rideSpeed(api.navRideFraction, .5), 1e-5);
  }
});
test("eased ride fractions retain drawn arc and reverse endpoints", () => {
  const reversed = arc.slice().reverse();
  for (let i = 0; i <= 100; i++) {
    const fraction = api.navRideFraction(i / 100), forward = api.navPointAt(arc, fraction), reverse = api.navPointAt(reversed, fraction);
    for (const p of [forward, reverse]) {
      assert.ok(p.y === 0 && p.x >= 0 && p.x <= 9 || p.x === 9 && p.y >= 0 && p.y <= 1,
        "Easing must remain on the drawn polyline");
    }
    const complementary = api.navPointAt(arc, 1 - fraction);
    close(reverse.x, complementary.x); close(reverse.y, complementary.y);
  }
  assert.deepEqual(clean(api.navPointAt(arc, api.navRideFraction(0))), { x: 0, y: 0, angle: 0 });
  assert.deepEqual(clean(api.navPointAt(arc, api.navRideFraction(1))), { x: 9, y: 1, angle: 90 });
  assert.deepEqual(clean(api.navPointAt(reversed, api.navRideFraction(0))), { x: 9, y: 1, angle: -90 });
  assert.deepEqual(clean(api.navPointAt(reversed, api.navRideFraction(1))), { x: 0, y: 0, angle: 180 });
});
test("polyline interpolation uses arc distance", () => {
  assert.deepEqual(clean(api.navPointAt(arc, .5)), { x: 5, y: 0, angle: 0 });
  assert.deepEqual(clean(api.navPointAt(arc, .95)), { x: 9, y: .5, angle: 90 });
});
test("polyline endpoints and fractions are clamped", () => {
  assert.deepEqual(clean(api.navPointAt(arc, -1)), { x: 0, y: 0, angle: 0 });
  assert.deepEqual(clean(api.navPointAt(arc, 2)), { x: 9, y: 1, angle: 90 });
});
test("every interpolated position stays on drawn geometry", () => {
  for (let i = 0; i <= 100; i++) {
    const p = api.navPointAt(arc, i / 100);
    assert.ok(p.y === 0 && p.x >= 0 && p.x <= 9 || p.x === 9 && p.y >= 0 && p.y <= 1);
    assert.ok(p.angle === 0 || p.angle === 90);
  }
});
test("reverse polyline follows reverse arc distance and angle", () => {
  const p = api.navPointAt(arc.slice().reverse(), .05);
  close(p.x, 9); close(p.y, .5); close(p.angle, -90);
});
test("empty single point and coincident geometry stay finite", () => {
  assert.equal(api.navPointAt([], .5), null); assert.equal(api.navPointAt(null, .5), null);
  assert.deepEqual(clean(api.navPointAt([point(2, 4)], .5)), { x: 2, y: 4, angle: 0 });
  assert.deepEqual(clean(api.navPointAt([point(2, 4), point(2, 4)], .8)), { x: 2, y: 4, angle: 0 });
});
test("interpolation does not mutate point input", () => {
  const before = JSON.stringify(arc); api.navPointAt(arc, .95); assert.equal(JSON.stringify(arc), before);
});
test("leg selects exact geometry segment", () => {
  const legs = [leg("L", "B", "C", 1, 2, 1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 0, geometry)), [point(4), point(8)]);
});
test("reverse leg reverses its exact segment", () => {
  const legs = [leg("L", "C", "B", 2, 1, 1, -1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 0, geometry)), [point(8), point(4)]);
});
test("forward adjacent offset segments include drawn connector", () => {
  const legs = [leg("L", "A", "B", 0, 1, 0), leg("L", "B", "C", 1, 2, 1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(3), point(4), point(8)]);
});
test("reverse adjacent offset segments include reversed connector", () => {
  const legs = [leg("L", "C", "B", 2, 1, 1, -1), leg("L", "B", "A", 1, 0, 0, -1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(4), point(3), point(0)]);
});
test("coincident segment joint does not add duplicate point", () => {
  const joined = { L: [{ pts: [point(0), point(4)] }, { pts: [point(4), point(8)] }] };
  const legs = [leg("L", "A", "B", 0, 1, 0), leg("L", "B", "C", 1, 2, 1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, joined)), [point(4), point(8)]);
});
test("different lines have no drawn offset connector", () => {
  const legs = [leg("L", "A", "B", 0, 1, 0), leg("M", "B", "C", 0, 1, 0)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(80, 1), point(90, 1)]);
});
test("direction change does not invent a connector", () => {
  const legs = [leg("L", "A", "B", 0, 1, 0), leg("L", "B", "C", 1, 2, 1, -1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(8), point(4)]);
});
test("disconnected station occurrences do not invent a connector", () => {
  const legs = [leg("L", "A", "B", 0, 1, 0), leg("L", "D", "C", 3, 2, 1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(4), point(8)]);
});
test("ring seam has no connector in forward direction", () => {
  const legs = [leg("L", "C", "A", 2, 0, 2), leg("L", "A", "B", 0, 1, 0)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(0), point(3)]);
});
test("ring seam has no connector in reverse direction", () => {
  const legs = [leg("L", "B", "A", 1, 0, 0, -1), leg("L", "A", "C", 0, 2, 2, -1)];
  assert.deepEqual(clean(api.navLegPoints(legs, 1, geometry)), [point(10), point(9)]);
});
test("missing or empty geometry returns an empty path", () => {
  const legs = [leg("missing", "A", "B", 0, 1, 0)];
  assert.deepEqual(clean(api.navLegPoints(legs, 0, geometry)), []);
  assert.deepEqual(clean(api.navLegPoints([leg("L", "A", "B", 0, 1, 4)], 0, geometry)), []);
  assert.deepEqual(clean(api.navLegPoints([leg("L", "A", "B", 0, 1, 0)], 0, { L: [{ pts: [] }] })), []);
});
test("geometry points and legs remain unchanged", () => {
  const legs = [leg("L", "C", "B", 2, 1, 1, -1), leg("L", "B", "A", 1, 0, 0, -1)];
  const before = JSON.stringify([legs, geometry]);
  const pts = api.navLegPoints(legs, 1, geometry); pts[0].x = 999;
  assert.equal(JSON.stringify([legs, geometry]), before);
});

/* Test assertions must detect the historical terminus omission and plausible
   time/geometry regressions. Each mutant intentionally fails an expectation. */
const mutant = (before, after) => {
  assert.ok(source.includes(before), "Negative control target missing");
  return load(source.replace(before, after));
};
test("negative control detects omitted final arrival", () => {
  const m = mutant("state.arrivals.push(event); events.push(event);", "if (!final) { state.arrivals.push(event); events.push(event); }");
  const state = m.createNavPlayback(plan, durations); m.advanceNavPlayback(state, 1000);
  assert.notEqual(state.arrivals.at(-1).station, "D");
});
test("negative control detects advancing while paused", () => {
  assert.ok(source.includes('if (state.status !== "running" || !Number.isFinite(dt) || dt <= 0)'));
  assert.ok(source.includes('while (dt > 0 && state.status === "running")'));
  const combined = load(source.replace('if (state.status !== "running" || !Number.isFinite(dt) || dt <= 0)', "if (!Number.isFinite(dt) || dt <= 0)")
    .replace('while (dt > 0 && state.status === "running")', 'while (dt > 0 && state.status !== "finished")'));
  const state = combined.createNavPlayback(plan, durations); state.status = "paused";
  const before = JSON.stringify(state); combined.advanceNavPlayback(state, .5);
  assert.notEqual(JSON.stringify(state), before);
});
test("negative control detects interpolation by point count", () => {
  const m = mutant("let target = f * total;", "let target = f * lengths.length * lengths[0];");
  assert.notEqual(m.navPointAt(arc, .5).x, 5);
});
test("negative control detects reading wrong segment", () => {
  const m = mutant("segment = segments[leg.segmentIndex];", "segment = segments[0];");
  assert.notDeepEqual(clean(m.navLegPoints([leg("L", "B", "C", 1, 2, 1)], 0, geometry)), [point(4), point(8)]);
});
test("negative control detects invented ring seam connector", () => {
  const m = mutant("Math.abs(prev.segmentIndex - leg.segmentIndex) === 1", "true");
  const legs = [leg("L", "C", "A", 2, 0, 2), leg("L", "A", "B", 0, 1, 0)];
  assert.notDeepEqual(clean(m.navLegPoints(legs, 1, geometry)), [point(0), point(3)]);
});
test("negative control detects a train moving at constant speed", () => {
  const m = load(source + "\nfunction navRideFraction(t) { return Math.max(0, Math.min(1, t)); }");
  assert.equal(accelerationAndBraking(m.navRideFraction), false);
  assert.notEqual(m.navRideFraction(.05), api.navRideFraction(.05));
});

console.log("PASS " + checks + " navigation playback/geometry semantic cases (including 6 negative controls; " +
  (appSource ? "application playback" : "UI source before integration") + ")");
