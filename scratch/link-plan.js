"use strict";

// BEGIN LINK PLAN
/* Plan one continuous connection without mutating the line or filtering away the
   user's existing stations. Existing portions must follow the line's actual
   order; multiple possible insertion results are deliberately rejected. */
function planLinkAppend(l, chainIds) {
  const fail = (reason) => ({ ok: false, reason, at: null, ids: [], loop: !!(l && l.loop) });
  if (!l || !Array.isArray(l.stations) || !Array.isArray(chainIds)) return fail("线路或连接路径无效");
  const isId = (id) => typeof id === "string" && id.trim().length > 0;
  if (!l.stations.every(isId) || !chainIds.every(isId)) return fail("连接路径中有无效的车站");
  if (chainIds.length < 2) return fail("至少连接两个车站");
  const old = l.stations, n = old.length, ring = !!l.loop;
  if (!n) return fail("当前线路还没有车站，请新建线路");
  if (ring && n < 3) return fail("当前环线的站序无效，请先断开环线");
  if (chainIds.some((id, i) => i > 0 && id === chainIds[i - 1])) return fail("相邻的连接点不能是同一个车站");
  const present = new Set(old);
  const runs = [];
  for (let i = 0; i < chainIds.length; i++) {
    if (present.has(chainIds[i])) continue;
    const start = i;
    while (i + 1 < chainIds.length && !present.has(chainIds[i + 1])) i++;
    runs.push({ start, end: i });
  }
  if (runs.length > 1) return fail("一次只能延长一个端点或插入一段，请分段连接");
  if (runs.length === 1 && runs[0].start === 0 && runs[0].end === chainIds.length - 1) {
    return fail("连接路径没有当前线路上的车站，请新建线路");
  }
  /* Every matching occurrence matters: indexOf silently chooses the wrong B in
     A-B-C-B-D. A longer continuous path can disambiguate it safely. */
  const matches = (path) => {
    const out = [];
    for (let start = 0; start < n; start++) {
      if (old[start] !== path[0]) continue;
      const dirs = path.length === 1 ? [0] : [1, -1];
      dirs.forEach((dir) => {
        let end = start, good = true;
        for (let i = 1; i < path.length; i++) {
          end += dir;
          if (ring) end = (end + n) % n;
          if (end < 0 || end >= n || old[end] !== path[i]) { good = false; break; }
        }
        if (good) out.push({ start, end, dir });
      });
    }
    return out;
  };
  const candidates = new Map();
  const offer = (at, ids, loop) => {
    const plan = { ok: true, reason: "", at, ids: ids.slice(), loop: !!loop };
    candidates.set(JSON.stringify([at, plan.ids, plan.loop]), plan);
  };
  const agrees = (match, dir) => match.dir === 0 || match.dir === dir;
  const existingIds = chainIds.filter((id) => present.has(id));
  const hasRepeatedAnchor = existingIds.some((id) => old.indexOf(id) !== old.lastIndexOf(id));
  if (!runs.length) {
    if (ring) return fail("这些车站已经由当前环线连接");
    /* With no new station, only a valid traversal of the missing terminal edge
       changes anything. Walking an existing segment is a harmless no-op. */
    if (n >= 3) {
      for (let start = 0; start < n; start++) {
        if (old[start] !== chainIds[0]) continue;
        [1, -1].forEach((dir) => {
          let at = start, bridges = 0, good = true;
          for (let i = 1; i < chainIds.length; i++) {
            const next = at + dir;
            if (next < 0 || next >= n) bridges++;
            at = (next + n) % n;
            if (old[at] !== chainIds[i] || bridges > 1) { good = false; break; }
          }
          if (good && bridges === 1) offer(n, [], true);
        });
      }
    }
    if (!candidates.size) {
      if (matches(chainIds).length) return fail("这些车站已经由当前线路连接");
      return fail("已有站必须沿当前线路连续连接；闭环请连接线路首尾");
    }
  } else {
    const run = runs[0], fresh = chainIds.slice(run.start, run.end + 1);
    const before = chainIds.slice(0, run.start), after = chainIds.slice(run.end + 1);
    if (!before.length || !after.length) {
      if (ring) return fail("环线没有端点；插站时请连接两个相邻站，支线请新建线路");
      const path = before.length ? before : after;
      const found = matches(path);
      found.forEach((m) => {
        const anchor = before.length ? m.end : m.start;
        if (n === 1) offer(before.length ? n : 0, fresh, false);
        else if (anchor === 0) offer(0, before.length ? fresh.slice().reverse() : fresh, false);
        else if (anchor === n - 1) offer(n, before.length ? fresh : fresh.slice().reverse(), false);
      });
      if (!candidates.size) {
        if (!found.length) return fail("点击的已有站没有沿当前线路连续连接");
        return fail(hasRepeatedAnchor ? "这个车站在站序中出现多次，连接位置不明确；请连接相邻站来确定位置" :
          "中间站不能直接延长；插站请连接相邻的另一个站，支线请新建线路");
      }
    } else {
      const left = matches(before), right = matches(after);
      left.forEach((a) => right.forEach((b) => {
        const from = a.end, to = b.start;
        let dir = 0, at = null, loop = ring;
        if (to === from + 1) { dir = 1; at = to; }
        else if (to === from - 1) { dir = -1; at = from; }
        else if ((ring || n >= 3) && from === n - 1 && to === 0) { dir = 1; at = n; loop = true; }
        else if ((ring || n >= 3) && from === 0 && to === n - 1) { dir = -1; at = n; loop = true; }
        if (dir && agrees(a, dir) && agrees(b, dir)) offer(at, dir === 1 ? fresh : fresh.slice().reverse(), loop);
      }));
      if (!candidates.size) {
        if (!left.length || !right.length) return fail("点击的已有站没有沿当前线路连续连接");
        return fail(hasRepeatedAnchor ? "重复车站的连接位置不明确；请沿站序连接相邻站" :
          "插站只能连接当前线路的相邻站；闭环请连接线路首尾，跨站连接请新建线路");
      }
    }
  }
  if (candidates.size !== 1) return fail("这个车站在站序中出现多次，连接位置不明确；请沿站序补连相邻站");
  return candidates.values().next().value;
}
// END LINK PLAN

module.exports = { planLinkAppend };

if (require.main === module) {
  const assert = require("node:assert/strict");
  /* 执行应用里的规划器，防止补丁源和实际交付文件发生漂移。 */
  const app = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
  const start = app.indexOf("function planLinkAppend(");
  const end = app.indexOf("/* 放站是正式操作", start);
  assert.ok(start >= 0 && end > start, "Missing application planner");
  const planLinkAppend = require("node:vm").runInNewContext("(" + app.slice(start, end).trim() + ")");
  let checks = 0;
  const line = (stations, loop = false) => ({ id: "L", stations, loop, bends: { "A>B": [{ along: 0.3, normal: 0.2 }] } });
  const apply = (l, p) => {
    assert.equal(p.ok, true, p.reason);
    const result = l.stations.slice(); result.splice(p.at, 0, ...p.ids);
    return { stations: result, loop: p.loop };
  };
  const good = (name, l, chain, expected, loop = l.loop) => {
    const beforeLine = JSON.stringify(l), beforeChain = JSON.stringify(chain);
    const p = planLinkAppend(l, chain);
    assert.deepEqual(apply(l, p), { stations: expected, loop }, name);
    assert.equal(JSON.stringify(l), beforeLine, name + " mutated line");
    assert.equal(JSON.stringify(chain), beforeChain, name + " mutated chain");
    checks++;
  };
  const bad = (name, l, chain) => {
    const beforeLine = JSON.stringify(l), beforeChain = JSON.stringify(chain);
    const p = planLinkAppend(l, chain);
    assert.equal(p.ok, false, name); assert.ok(p.reason.length, name + " missing explanation");
    assert.equal(JSON.stringify(l), beforeLine, name + " mutated line");
    assert.equal(JSON.stringify(chain), beforeChain, name + " mutated chain");
    checks++;
  };
  const ABC = () => line(["A", "B", "C"]);
  good("tail extension", ABC(), ["C", "X", "Y"], ["A", "B", "C", "X", "Y"]);
  good("tail extension drawn inward", ABC(), ["Y", "X", "C"], ["A", "B", "C", "X", "Y"]);
  good("head extension", ABC(), ["A", "X", "Y"], ["Y", "X", "A", "B", "C"]);
  good("head extension drawn inward", ABC(), ["Y", "X", "A"], ["Y", "X", "A", "B", "C"]);
  good("old prefix to tail", ABC(), ["A", "B", "C", "X"], ["A", "B", "C", "X"]);
  good("partial old prefix to tail", ABC(), ["B", "C", "X"], ["A", "B", "C", "X"]);
  good("reverse prefix to head", ABC(), ["C", "B", "A", "X", "Y"], ["Y", "X", "A", "B", "C"]);
  good("old suffix from head", ABC(), ["X", "Y", "A", "B", "C"], ["X", "Y", "A", "B", "C"]);
  good("old suffix from tail", ABC(), ["X", "Y", "C", "B", "A"], ["A", "B", "C", "Y", "X"]);
  good("adjacent insertion", ABC(), ["A", "X", "Y", "B"], ["A", "X", "Y", "B", "C"]);
  good("adjacent insertion reverse", ABC(), ["B", "Y", "X", "A"], ["A", "X", "Y", "B", "C"]);
  good("insertion with continuous prefix", ABC(), ["A", "B", "X", "C"], ["A", "B", "X", "C"]);
  good("insertion with continuous suffix", ABC(), ["A", "X", "B", "C"], ["A", "X", "B", "C"]);
  good("bridge creates ring", ABC(), ["C", "X", "Y", "A"], ["A", "B", "C", "X", "Y"], true);
  good("reverse bridge creates ring", ABC(), ["A", "Y", "X", "C"], ["A", "B", "C", "X", "Y"], true);
  good("bridge existing terminals only", ABC(), ["C", "A"], ["A", "B", "C"], true);
  good("reverse bridge existing terminals only", ABC(), ["A", "C"], ["A", "B", "C"], true);
  good("continuous traversal through new closure", ABC(), ["B", "C", "A"], ["A", "B", "C"], true);
  good("bridge with old prefix and suffix", ABC(), ["B", "C", "X", "A", "B"], ["A", "B", "C", "X"], true);
  good("ring interior insertion", line(["A", "B", "C"], true), ["B", "X", "C"], ["A", "B", "X", "C"], true);
  good("ring closing segment insertion", line(["A", "B", "C"], true), ["C", "X", "Y", "A"], ["A", "B", "C", "X", "Y"], true);
  good("ring closing segment reverse", line(["A", "B", "C"], true), ["A", "Y", "X", "C"], ["A", "B", "C", "X", "Y"], true);
  good("ring prefix wraps closure", line(["A", "B", "C", "D"], true), ["D", "A", "X", "B", "C"], ["A", "X", "B", "C", "D"], true);
  good("one station outward", line(["A"]), ["A", "X", "Y"], ["A", "X", "Y"]);
  good("one station inward", line(["A"]), ["X", "Y", "A"], ["X", "Y", "A"]);
  good("two stations prefer insertion", line(["A", "B"]), ["B", "Y", "X", "A"], ["A", "X", "Y", "B"]);
  good("repeated original unrelated to tail", line(["A", "B", "C", "B", "D"]), ["D", "X"], ["A", "B", "C", "B", "D", "X"]);
  good("repeated anchor resolved by old prefix", line(["A", "B", "C", "B", "D"]), ["A", "B", "X", "C"], ["A", "B", "X", "C", "B", "D"]);
  good("repeated anchor resolved by old suffix", line(["A", "B", "C", "B", "D"]), ["C", "X", "B", "D"], ["A", "B", "C", "X", "B", "D"]);
  good("intentional repeated new station preserved", ABC(), ["C", "X", "Y", "X"], ["A", "B", "C", "X", "Y", "X"]);
  bad("middle anchor does not reroute tail", ABC(), ["B", "X"]);
  bad("middle inward anchor does not reroute head", ABC(), ["X", "B"]);
  bad("old path stops in middle", ABC(), ["A", "B", "X"]);
  bad("nonadjacent anchors do not skip old stations", line(["A", "B", "C", "D"]), ["A", "X", "C"]);
  bad("nonadjacent old path", line(["A", "B", "C", "D"]), ["A", "C", "D", "X"]);
  bad("wrong orientation through insertion", ABC(), ["A", "B", "X", "A"]);
  bad("separate new sections", ABC(), ["A", "X", "B", "Y", "C"]);
  bad("both endpoint additions need separate commits", ABC(), ["X", "A", "B", "C", "Y"]);
  bad("ring cannot extend endpoint", line(["A", "B", "C"], true), ["C", "X"]);
  bad("ambiguous repeated middle anchor", line(["A", "B", "C", "B", "D"]), ["B", "X", "C"]);
  bad("ambiguous repeated endpoint", line(["A", "B", "A"]), ["A", "X"]);
  bad("unrelated chain", ABC(), ["X", "Y"]);
  bad("empty line", line([]), ["X", "Y"]);
  bad("insufficient chain", ABC(), ["A"]);
  bad("adjacent repeated click", ABC(), ["C", "C", "X"]);
  bad("no change existing edge", ABC(), ["A", "B"]);
  bad("no change existing full path", ABC(), ["A", "B", "C"]);
  bad("already closed ring", line(["A", "B", "C"], true), ["C", "A"]);
  bad("two station closure rejected", line(["A", "B"]), ["B", "A"]);
  bad("invalid original ring", line(["A", "B"], true), ["A", "X", "B"]);
  bad("invalid station id", ABC(), ["C", null]);
  bad("invalid chain type", ABC(), null);
  bad("multiple laps do not create a repeated edge", ABC(), ["A", "B", "C", "A", "B", "C", "A"]);
  /* The old filter silently reverses a head extension and swallows a bridge's
     final anchor. Both must disagree with semantic expected results. */
  const oldFilter = (l, chain) => {
    let at = l.stations.indexOf(chain[0]);
    if (at < 0) at = chain.length > 1 ? l.stations.indexOf(chain[1]) - 1 : -1;
    if (at < 0) return null;
    const ids = chain.slice(chain[0] === l.stations[at] ? 1 : 0).filter((id) => !l.stations.includes(id));
    const stations = l.stations.slice(); stations.splice(at + 1, 0, ...ids);
    return { stations, loop: !!l.loop };
  };
  assert.notDeepEqual(oldFilter(ABC(), ["A", "X"]), { stations: ["X", "A", "B", "C"], loop: false }); checks++;
  assert.notDeepEqual(oldFilter(ABC(), ["C", "X", "A"]), { stations: ["A", "B", "C", "X"], loop: true }); checks++;
  assert.notEqual(oldFilter(ABC(), ["B", "X"]), null); checks++;
  console.log("PASS " + checks + " semantic cases (including 3 old-filter negative controls)");
}
