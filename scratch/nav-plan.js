"use strict";

// BEGIN NAV PLAN
/* Route over station occurrences, not station names. A repeated station on one
   line keeps its actual segment index; transfers use the physical station ID.
   Distances describe station-to-station geography, not the drawn bend length. */
function planRide(project, fromId, toId, preference = "transfers") {
  const result = (ok, reason, code) => ({ ok, reason, code, from: fromId, to: toId,
    legs: [], stations: [], transfers: 0, stops: 0, distanceKm: 0 });
  const stationMap = project && project.stations;
  if (!stationMap || !Array.isArray(project.lines)) return result(false, "地图数据无效", "invalid-project");
  const owns = (id) => Object.prototype.hasOwnProperty.call(stationMap, id) && !!stationMap[id];
  if (!owns(fromId)) return result(false, "出发站不存在，请重新选择", "missing-from");
  if (!owns(toId)) return result(false, "到达站不存在，请重新选择", "missing-to");
  if (fromId === toId) {
    const same = result(true, "起点和终点相同，你已经到达", "same-station");
    same.stations = [fromId];
    return same;
  }
  const nodes = [], atStation = new Map();
  const lines = project.lines.filter((l) => l && l.visible !== false && l.style !== "dash" && Array.isArray(l.stations));
  lines.forEach((line) => {
    const ids = line.stations, lineNodes = [];
    ids.forEach((sid, index) => {
      if (!owns(sid)) { lineNodes.push(-1); return; }
      const number = nodes.length;
      nodes.push({ sid, lineId: line.id, index, ride: [] });
      lineNodes.push(number);
      if (!atStation.has(sid)) atStation.set(sid, []);
      atStation.get(sid).push(number);
    });
    const join = (a, b, segmentIndex) => {
      if (a < 0 || b < 0) return;
      nodes[a].ride.push({ next: b, segmentIndex, direction: 1 });
      nodes[b].ride.push({ next: a, segmentIndex, direction: -1 });
    };
    for (let i = 0; i + 1 < lineNodes.length; i++) join(lineNodes[i], lineNodes[i + 1], i);
    if (line.loop && ids.length >= 3) join(lineNodes[ids.length - 1], lineNodes[0], ids.length - 1);
  });
  const boardable = (sid) => (atStation.get(sid) || []).filter((n) => nodes[n].ride.length);
  const origins = boardable(fromId), destinations = boardable(toId);
  if (!origins.length) return result(false, "出发站尚未接入运营线路，请先连接车站", "unserved-from");
  if (!destinations.length) return result(false, "到达站尚未接入运营线路，请先连接车站", "unserved-to");

  /* Two states per occurrence: ready to board (even), arrived by train (odd).
     A transfer must be followed by a ride, so changing lines twice at one
     station cannot teleport between repeated occurrences of the same line. */
  const count = nodes.length * 2, transfers = new Float64Array(count), stops = new Float64Array(count);
  transfers.fill(Infinity); stops.fill(Infinity);
  const previous = new Int32Array(count); previous.fill(-1);
  const previousLeg = new Array(count), heap = [];
  const fewestStops = preference === "stops";
  const compare = (a, b) => fewestStops ? a.s - b.s || a.t - b.t || a.state - b.state : a.t - b.t || a.s - b.s || a.state - b.state;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compare(heap[parent], item) <= 0) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = item;
  };
  const pop = () => {
    const top = heap[0], tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
        if (compare(tail, heap[child]) <= 0) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = tail;
    }
    return top;
  };
  const relax = (state, t, s, parent, leg) => {
    const better = fewestStops ? s < stops[state] || (s === stops[state] && t < transfers[state]) :
      t < transfers[state] || (t === transfers[state] && s < stops[state]);
    if (!better) return;
    transfers[state] = t; stops[state] = s; previous[state] = parent; previousLeg[state] = leg;
    push({ state, t, s });
  };
  origins.forEach((n) => relax(n * 2, 0, 0, -1, null));
  const expandedTransfers = new Map();
  let finalState = -1;
  while (heap.length) {
    const entry = pop(), state = entry.state;
    if (entry.t !== transfers[state] || entry.s !== stops[state]) continue;
    const nodeNumber = state >> 1, node = nodes[nodeNumber];
    if (node.sid === toId) { finalState = state; break; }
    node.ride.forEach((edge) => {
      const next = nodes[edge.next];
      relax(edge.next * 2 + 1, entry.t, entry.s + 1, state, {
        lineId: node.lineId, from: node.sid, to: next.sid, fromIndex: node.index,
        toIndex: next.index, segmentIndex: edge.segmentIndex, direction: edge.direction
      });
    });
    if (!(state & 1)) continue;
    /* Transfer destinations depend on station and line, not the occurrence.
       Only the first settled arrival of each line needs to expand this list. */
    let done = expandedTransfers.get(node.sid);
    if (!done) { done = new Set(); expandedTransfers.set(node.sid, done); }
    if (done.has(node.lineId)) continue;
    done.add(node.lineId);
    (atStation.get(node.sid) || []).forEach((nextNumber) => {
      if (nodes[nextNumber].lineId !== node.lineId && nodes[nextNumber].ride.length) {
        relax(nextNumber * 2, entry.t + 1, entry.s, state, null);
      }
    });
  }
  if (finalState < 0) return result(false, "这两个站目前无法通过运营线路到达，请检查连线或选择其他车站", "unreachable");
  const route = result(true, "", "ready");
  for (let state = finalState; previous[state] >= 0; state = previous[state]) {
    if (previousLeg[state]) route.legs.push(previousLeg[state]);
  }
  route.legs.reverse();
  route.stations.push(fromId);
  const distance = (a, b) => {
    const coords = [a.lat, a.lng, b.lat, b.lng].map(Number);
    if (!coords.every(Number.isFinite)) return 0;
    const rad = Math.PI / 180, deltaLat = (coords[2] - coords[0]) * rad, deltaLng = (coords[3] - coords[1]) * rad;
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(coords[0] * rad) * Math.cos(coords[2] * rad) * Math.sin(deltaLng / 2) ** 2;
    return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
  };
  route.legs.forEach((leg, i) => {
    route.stations.push(leg.to);
    if (i > 0 && route.legs[i - 1].lineId !== leg.lineId) route.transfers++;
    route.distanceKm += distance(stationMap[leg.from], stationMap[leg.to]);
  });
  route.stops = route.legs.length;
  return route;
}
// END NAV PLAN

module.exports = { planRide };

if (require.main === module) {
  const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const ownSource = fs.readFileSync(__filename, "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const extract = (source) => {
    const start = source.indexOf("// BEGIN NAV PLAN"), end = source.indexOf("// END NAV PLAN", start);
    return start >= 0 && end > start ? source.slice(start, end) : null;
  };
  const appSource = extract(app), source = appSource || extract(ownSource);
  const run = vm.runInNewContext(source + "\nplanRide;");
  const clean = (value) => JSON.parse(JSON.stringify(value));
  let checks = 0;
  const line = (id, stations, extra = {}) => ({ id, stations, visible: true, style: "solid", ...extra });
  const project = (lines, extraStations = []) => {
    const stations = {};
    [...lines.flatMap((l) => l.stations), ...extraStations].forEach((id, i) => {
      stations[id] = { id, name: id, lat: 30 + i * .001, lng: 120 + i * .001 };
    });
    return { lines, stations };
  };
  const good = (name, p, from, to, expected, preference) => {
    const before = JSON.stringify(p), route = clean(run(p, from, to, preference));
    assert.equal(route.ok, true, name + ": " + route.reason);
    Object.entries(expected).forEach(([key, value]) => assert.deepEqual(route[key], value, name + ": " + key));
    assert.equal(JSON.stringify(p), before, name + " mutated project");
    assert.equal(route.stations.length, route.stops + 1, name + " station count");
    assert.equal(route.stations.at(-1), to, name + " includes final station");
    assert.equal(route.legs.length, route.stops, name + " stop count");
    assert.ok(Number.isFinite(route.distanceKm) && route.distanceKm >= 0, name + " distance");
    route.legs.forEach((leg, i) => {
      const l = p.lines.find((candidate) => candidate.id === leg.lineId);
      assert.equal(l.stations[leg.fromIndex], leg.from, name + " exact departure occurrence");
      assert.equal(l.stations[leg.toIndex], leg.to, name + " exact arrival occurrence");
      assert.equal(leg.from, route.stations[i], name + " continuous departure");
      assert.equal(leg.to, route.stations[i + 1], name + " continuous arrival");
      assert.equal(leg.direction, l.loop && leg.fromIndex === l.stations.length - 1 && leg.toIndex === 0 ? 1 :
        l.loop && leg.fromIndex === 0 && leg.toIndex === l.stations.length - 1 ? -1 : Math.sign(leg.toIndex - leg.fromIndex), name + " direction");
      assert.equal(leg.segmentIndex, l.loop && Math.abs(leg.toIndex - leg.fromIndex) === l.stations.length - 1 ?
        l.stations.length - 1 : Math.min(leg.fromIndex, leg.toIndex), name + " geometry segment index");
    });
    checks++;
    return route;
  };
  const bad = (name, p, from, to, code) => {
    const before = JSON.stringify(p), route = run(p, from, to);
    assert.equal(route.ok, false, name); assert.equal(route.code, code, name + " code");
    assert.ok(route.reason.length, name + " explanation");
    assert.equal(JSON.stringify(p), before, name + " mutated project");
    checks++;
  };
  const abc = project([line("L", ["A", "B", "C"])]);
  good("forward including terminus", abc, "A", "C", { stations: ["A", "B", "C"], stops: 2, transfers: 0 });
  good("reverse including terminus", abc, "C", "A", { stations: ["C", "B", "A"], stops: 2, transfers: 0 });
  good("interior start", abc, "B", "C", { stations: ["B", "C"], stops: 1 });
  good("same station", abc, "B", "B", { stations: ["B"], stops: 0, transfers: 0, code: "same-station" });
  bad("missing start", abc, "Z", "C", "missing-from");
  bad("missing end", abc, "A", "Z", "missing-to");
  bad("invalid project", null, "A", "B", "invalid-project");
  const ring = project([line("R", ["A", "B", "C", "D"], { loop: true })]);
  good("ring closing forward", ring, "D", "A", { stations: ["D", "A"], stops: 1 });
  good("ring closing reverse", ring, "A", "D", { stations: ["A", "D"], stops: 1 });
  good("ring shorter reverse", ring, "A", "C", { stops: 2, transfers: 0 });
  const change = project([line("L", ["A", "X", "B"]), line("M", ["C", "X", "D"])]);
  good("shared ID transfer", change, "A", "D", { stations: ["A", "X", "D"], stops: 2, transfers: 1 });
  good("shared ID reverse transfer", change, "D", "A", { stations: ["D", "X", "A"], stops: 2, transfers: 1 });
  good("boarding any origin line", change, "X", "D", { stops: 1, transfers: 0 });
  good("arrival on any destination line", change, "A", "X", { stops: 1, transfers: 0 });
  const repeated = project([line("L", ["A", "B", "C", "B", "D"])]);
  const repeatRoute = good("repeated station cannot teleport", repeated, "A", "D", {
    stations: ["A", "B", "C", "B", "D"], stops: 4, transfers: 0 });
  assert.deepEqual(repeatRoute.legs.map((leg) => leg.segmentIndex), [0, 1, 2, 3]); checks++;
  good("repeated origin chooses correct index", repeated, "B", "D", { stops: 1 });
  good("repeated terminus chooses correct index", repeated, "D", "B", { stops: 1 });
  good("adjacent repeated occurrence stays connected", project([line("L", ["A", "B", "B", "C"])]), "A", "C", {
    stations: ["A", "B", "B", "C"], stops: 3, transfers: 0 });
  const repeatWithLine = project([line("L", ["A", "B", "C", "B", "D"]), line("M", ["B", "E"])]);
  good("transfer relay cannot teleport", repeatWithLine, "A", "D", { stops: 4, transfers: 0 }, "stops");
  const disconnected = project([line("L", ["A", "B"]), line("M", ["C", "D"])], ["Z"]);
  bad("disconnected network", disconnected, "A", "D", "unreachable");
  bad("free start station", disconnected, "Z", "D", "unserved-from");
  bad("free end station", disconnected, "A", "Z", "unserved-to");
  good("same free station", disconnected, "Z", "Z", { stops: 0, stations: ["Z"] });
  const single = project([line("L", ["A"]), line("M", ["B", "C"])]);
  bad("one station line cannot board", single, "A", "C", "unserved-from");
  const hidden = project([line("L", ["A", "X"]), line("M", ["X", "D"], { visible: false })]);
  bad("hidden destination line excluded", hidden, "A", "D", "unserved-to");
  const construction = project([line("L", ["A", "X"]), line("M", ["X", "D"], { style: "dash" })]);
  bad("construction line excluded", construction, "A", "D", "unserved-to");
  const bridge = project([line("L", ["A", "X"]), line("M", ["X", "Y"], { style: "dash" }), line("N", ["Y", "D"])]);
  bad("construction bridge excluded", bridge, "A", "D", "unreachable");
  bridge.lines[1].style = "solid"; bridge.lines[1].visible = false;
  bad("hidden bridge excluded", bridge, "A", "D", "unreachable");
  const defaultVisible = project([line("L", ["A", "B"])]); delete defaultVisible.lines[0].visible;
  good("visibility omitted remains operational", defaultVisible, "A", "B", { stops: 1 });
  const twins = project([line("L", ["A", "X"]), line("M", ["Y", "D"])]);
  twins.stations.X.name = twins.stations.Y.name = "同名站";
  bad("same name different ID not a transfer", twins, "A", "D", "unreachable");
  const alternatives = project([line("long", ["A", "B", "C", "D", "E", "F"]), line("short1", ["A", "X"]), line("short2", ["X", "F"])]);
  good("fewest transfers selects direct train", alternatives, "A", "F", { stops: 5, transfers: 0 }, "transfers");
  good("fewest stops selects shortcut transfer", alternatives, "A", "F", { stops: 2, transfers: 1 }, "stops");
  const transfersTie = project([line("long", ["A", "B", "C", "D"]), line("short", ["A", "X", "D"])]);
  good("transfer tie chooses fewer stops", transfersTie, "A", "D", { stops: 2, transfers: 0 }, "transfers");
  const stopsTie = project([line("direct", ["A", "B", "D"]), line("change1", ["A", "X"]), line("change2", ["X", "D"])]);
  good("stop tie chooses fewer transfers", stopsTie, "A", "D", { stops: 2, transfers: 0 }, "stops");
  good("invalid preference uses transfer default", alternatives, "A", "F", { stops: 5, transfers: 0 }, "other");
  const coordinates = project([line("L", ["A", "B"])]);
  coordinates.stations.A = { id: "A", lat: 0, lng: 0 }; coordinates.stations.B = { id: "B", lat: 0, lng: 1 };
  const geo = good("haversine distance", coordinates, "A", "B", { stops: 1 });
  assert.ok(Math.abs(geo.distanceKm - 111.195) < .001); checks++;
  const invalidRefs = project([line("L", ["A", "missing", "B"])]); delete invalidRefs.stations.missing;
  bad("invalid intermediate reference is not bridged", invalidRefs, "A", "B", "unserved-from");
  const large = project([line("big", Array.from({ length: 1200 }, (_, i) => "S" + i))]);
  good("1200 station line", large, "S0", "S1199", { stops: 1199, transfers: 0 });

  /* Negative controls prove that these assertions reject plausible regressions,
     instead of only checking that our implementation agrees with itself. */
  const mutant = (before, after) => {
    assert.ok(source.includes(before), "mutation target missing");
    return vm.runInNewContext(source.replace(before, after) + "\nplanRide;");
  };
  const omitTerminus = mutant("route.stations.push(leg.to);", "if (i < route.legs.length - 1) route.stations.push(leg.to);");
  assert.notDeepEqual(clean(omitTerminus(abc, "A", "C").stations), ["A", "B", "C"]); checks++;
  const omitClosure = mutant("if (line.loop && ids.length >= 3)", "if (false && line.loop && ids.length >= 3)");
  assert.notEqual(omitClosure(ring, "D", "A").stops, 1); checks++;
  const ignoreTransfers = mutant('const fewestStops = preference === "stops";', "const fewestStops = true;");
  assert.notEqual(ignoreTransfers(alternatives, "A", "F", "transfers").transfers, 0); checks++;
  console.log("PASS " + checks + " navigation semantic cases (including 3 negative controls; " + (appSource ? "application planner" : "planner source before integration") + ")");
}
