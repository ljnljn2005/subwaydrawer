// BEGIN NAVIGATION TESTS
    t("模拟导航插值：按真实折线弧长前进，重复顶点不影响进度", () => {
      const bad = [];
      const check = (ok, message) => { if (!ok) bad.push(message); };
      const sample = (points, fraction) => {
        const result = navPointAt(points, fraction);
        return result && result.point ? result.point : result;
      };
      const same = (point, expected) => !!point && Math.abs(point.x - expected.x) < 1e-9 && Math.abs(point.y - expected.y) < 1e-9;
      const path = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
      const duplicatePath = [path[0], path[0], path[1], path[1], path[2]];
      const cases = [[0, { x: 0, y: 0 }], [3 / 7, { x: 3, y: 0 }], [.5, { x: 3, y: .5 }], [1, { x: 3, y: 4 }]];
      try {
        cases.forEach(([fraction, expected]) => {
          check(same(sample(path, fraction), expected), "进度 " + fraction + " 未按 3+4 长度分配折线插值");
          check(same(sample(duplicatePath, fraction), expected), "重复顶点改变了进度 " + fraction + " 的落点");
        });
        // Interpolating by vertex count puts the midpoint at (3,0), which must fail
        // the same expected-position predicate that checks the actual sampler.
        check(!same(path[1], cases[2][1]), "按顶点数量插值的负对照没有被识别");
      } catch (e) { bad.push("异常：" + e.message); }
      return { ok: !bad.length, detail: bad.length ? bad.join("；") :
        "3+4 长度折线的起点/拐点/中途/终点均准确，重复顶点不变；按顶点数量插值的负对照被识别" };
    });

    t("模拟导航几何：曲线/共走廊/反向/换乘/闭环/重复站均沿实际色带，平移缩放后重新对齐", () => {
      const saved = { p: P, sel, stack: settings.stack, view: [map.getCenter(), map.getZoom()],
        dirty, owner: dirtyOwner, hist: hist.slice(), future: future.slice(), intent: userViewAt };
      const bad = [];
      const check = (ok, message) => { if (!ok) bad.push(message); };
      let samples = 0, maxDistance = 0, chordRejected = false, offsetRejected = false;
      const equalPoint = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
      const distanceToBand = (point, band) => {
        if (!point || !isNum(point.x) || !isNum(point.y) || !band || band.length < 2) return Infinity;
        let distance = Infinity;
        for (let i = 1; i < band.length; i++) distance = Math.min(distance, distToSeg(point, band[i - 1], band[i]));
        return distance;
      };
      // The same predicate checks real playback samples and deliberate wrong paths.
      const onBand = (point, band) => distanceToBand(point, band) < 1e-7;
      const samplePoint = (points, fraction) => {
        const sample = navPointAt(points, fraction);
        return sample && sample.point ? sample.point : sample;
      };
      try {
        settings.stack = true;
        map.setView(saved.view[0], 13, { animate: false });
        const size = map.getSize(), x = size.x / 2, y = size.y / 2;
        const positions = { nav_A: [-180, -60], nav_B: [-50, 35], nav_C: [80, -60],
          nav_D: [165, 80], nav_E: [-130, 120] };
        const fixture = { id: "synth-navigation-geometry", name: "导航几何自检", version: CURRENT_VERSION,
          center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom(), lines: [], stations: {} };
        Object.keys(positions).forEach((id) => {
          const xy = positions[id], ll = map.containerPointToLatLng({ x: x + xy[0], y: y + xy[1] });
          fixture.stations[id] = { id, name: id, lat: ll.lat, lng: ll.lng, lines: [], note: "", labelOff: null };
        });
        const addFixtureLine = (id, ids, width, loop, bends) => {
          fixture.lines.push({ id, name: id, badge: id.slice(-1), color: "#E4002B", color2: "#FFFFFF",
            colorMode: "mono", width, style: "solid", visible: true, stack: true,
            stations: ids, loop: !!loop, bends: bends || {} });
        };
        addFixtureLine("nav_main", ["nav_A", "nav_B", "nav_C"], 6, false, {
          "nav_A>nav_B": [{ along: .45, normal: .42 }], "nav_B>nav_C": [{ along: .55, normal: -.28 }] });
        addFixtureLine("nav_shared", ["nav_A", "nav_B", "nav_C"], 10, false);
        addFixtureLine("nav_branch", ["nav_C", "nav_D", "nav_E"], 7, false, {
          "nav_D>nav_E": [{ along: .55, normal: .21 }] });
        addFixtureLine("nav_ring", ["nav_E", "nav_A", "nav_C"], 5, true, {
          "nav_C>nav_E": [{ along: .5, normal: -.24 }] });
        addFixtureLine("nav_repeat", ["nav_A", "nav_B", "nav_C", "nav_B", "nav_D"], 5, false);
        P = normalize(fixture); sel = { line: "nav_main", station: null };
        const leg = (lineId, segmentIndex, direction) => {
          const l = line(lineId), ids = shapeIds(l), reverse = direction === -1;
          const a = segmentIndex, b = segmentIndex + 1;
          return { lineId, segmentIndex, direction,
            from: ids[reverse ? b : a], to: ids[reverse ? a : b],
            fromIndex: (reverse ? b : a) % l.stations.length, toIndex: (reverse ? a : b) % l.stations.length };
        };
        const plan = (legs) => ({ ok: true, from: legs[0].from, to: legs[legs.length - 1].to, legs,
          stations: [legs[0].from].concat(legs.map((edge) => edge.to)) });
        const cases = [
          plan([leg("nav_main", 0, 1), leg("nav_main", 1, 1)]),
          plan([leg("nav_main", 1, -1), leg("nav_main", 0, -1)]),
          plan([leg("nav_main", 0, 1), leg("nav_main", 1, 1), leg("nav_branch", 0, 1), leg("nav_branch", 1, 1)]),
          plan([leg("nav_ring", 2, 1), leg("nav_ring", 0, 1)]),
          plan([leg("nav_ring", 0, -1), leg("nav_ring", 2, -1)]),
          plan([leg("nav_repeat", 3, 1)])
        ];
        const inspectView = (label) => {
          renderLines(buildCorridorGroups());
          const baseline = JSON.stringify(lineGeoPx);
          cases.forEach((route, caseIndex) => {
            const geometry = navGeometry(route);
            check(Array.isArray(geometry) && geometry.length === route.legs.length,
              label + " / 路径 " + caseIndex + " 的几何段数不符");
            route.legs.forEach((edge, index) => {
              const os = lineGeoPx[edge.lineId], actualBand = joinSegs(os || []);
              const direct = navLegPoints(route.legs, index, lineGeoPx), points = geometry && geometry[index];
              check(Array.isArray(direct) && direct.length >= 2 && Array.isArray(points) && points.length >= 2,
                label + " / " + edge.lineId + " / " + edge.segmentIndex + " 没有有效折线");
              if (!Array.isArray(points) || points.length < 2 || !Array.isArray(direct) || direct.length < 2 || !os || !os[edge.segmentIndex]) return;
              check(JSON.stringify(points) === JSON.stringify(direct), label + " 的实时几何与已绘制几何不同");
              const own = os[edge.segmentIndex].pts.slice();
              if (edge.direction === -1) own.reverse();
              // Every sampled curve point must occur in travel order; a whole-line
              // flattening or an indexOf lookup cannot silently select another edge.
              let cursor = 0;
              own.forEach((point) => {
                while (cursor < points.length && !equalPoint(point, points[cursor])) cursor++;
                if (cursor < points.length) cursor++; else check(false, label + " 的段索引/反向顺序不准确");
              });
              check(equalPoint(points[points.length - 1], own[own.length - 1]), label + " 的终点偏离实际段尾");
              [0, .125, .25, .375, .5, .625, .75, .875, 1].forEach((fraction) => {
                const point = samplePoint(points, fraction), distance = distanceToBand(point, actualBand);
                maxDistance = Math.max(maxDistance, distance); samples++;
                check(onBand(point, actualBand), label + " / " + edge.lineId + " / " + edge.segmentIndex +
                  " / " + fraction + " 车头离色带 " + distance.toFixed(6) + "px");
              });
            });
          });
          check(JSON.stringify(lineGeoPx) === baseline, label + " 的导航采样改写了共享线路几何");
        };
        inspectView("初始视图");
        const main = line("nav_main"), raw = lineShapePx(main).segs[0].raw;
        check(raw.length > 2 && Math.abs(lineGeoPx.nav_main[0].off) > 0,
          "fixture 未覆盖真实曲线和共走廊偏移，几何检查没有区分力");
        const a = map.latLngToContainerPoint([station("nav_A").lat, station("nav_A").lng]);
        const b = map.latLngToContainerPoint([station("nav_B").lat, station("nav_B").lng]);
        const band = joinSegs(lineGeoPx.nav_main);
        chordRejected = !onBand({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, band);
        offsetRejected = !onBand(samplePoint(raw, .375), band);
        check(chordRejected, "负对照失效：站坐标直连中点仍通过贴线判据");
        check(offsetRejected, "负对照失效：去掉共走廊偏移仍通过贴线判据");
        map.panBy([47, -31], { animate: false }); inspectView("平移后");
        map.setZoom(15, { animate: false }); inspectView("缩放后");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        P = saved.p; sel = saved.sel; settings.stack = saved.stack;
        dirty = saved.dirty; dirtyOwner = saved.owner; hist = saved.hist; future = saved.future;
        clearMarkerPools(); map.stop(); map.setView(saved.view[0], saved.view[1], { animate: false }); renderAll();
        userViewAt = -Infinity; viewLockUntil = performance.now() + 2400;
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        samples + " 个实际色带采样，最大偏差 " + maxDistance.toFixed(9) +
        "px；正反向/换乘/闭环接缝/重复站及平移缩放均对齐，站坐标直连和去偏移负对照均被识别" };
    });

    t("模拟导航到站：大时间步依次经过全部停站，终点恰好一次，完成后不重复播报", () => {
      const bad = [];
      const check = (ok, message) => { if (!ok) bad.push(message); };
      let runs = 0, terminalControl = false, duplicateControl = false;
      const arrivalOK = (state, expected) => state.status === "finished" &&
        state.arrivals.length === expected.length && state.arrivals.every((event, index) =>
          event.station === expected[index] && event.final === (index === expected.length - 1));
      const route = (ids) => ({ ok: true, from: ids[0], to: ids[ids.length - 1], stations: ids,
        legs: ids.slice(1).map((id, index) => ({ lineId: index < 2 ? "nav_first" : "nav_second",
          segmentIndex: index < 2 ? index : index - 2, from: ids[index], to: id,
          fromIndex: index, toIndex: index + 1, direction: 1 })) });
      const cases = [["A", "B", "C"], ["A", "B", "C", "D", "E"], ["A", "B", "A", "C"]];
      try {
        cases.forEach((ids) => {
          const plan = route(ids), durations = plan.legs.map((edge, index) => .25 + index * .125);
          [true, false].forEach((oneStep) => {
            const state = createNavPlayback(plan, durations);
            check(state.status === "running" && state.phase === "stop" && state.index === 0 && state.elapsed === 0,
              "播放初始状态不正确");
            check(state.arrivals.length === 1 && state.arrivals[0].station === ids[0] && state.arrivals[0].final === false,
              "播放起点没有准确记为一次非终点到站");
            advanceNavPlayback(state, 0);
            check(state.arrivals.length === 1, "零时间步重复报起点或推进到站");
            if (oneStep) advanceNavPlayback(state, 3600);
            else {
              for (let step = 0; step < 2000 && state.status !== "finished"; step++) advanceNavPlayback(state, .075);
            }
            check(arrivalOK(state, ids), (oneStep ? "大时间步" : "细时间步") +
              "未按站序精确报站并完成：" + JSON.stringify(state.arrivals));
            const before = JSON.stringify(state.arrivals);
            advanceNavPlayback(state, 3600); advanceNavPlayback(state, .5);
            check(JSON.stringify(state.arrivals) === before && state.status === "finished", "完成后再次推进重复报终点");
            if (runs === 0) {
              // Use the exact arrival predicate against the historical lost-terminal
              // failure and against an accidental second terminal announcement.
              terminalControl = !arrivalOK(Object.assign({}, state, { arrivals: state.arrivals.slice(0, -1) }), ids);
              duplicateControl = !arrivalOK(Object.assign({}, state, { arrivals: state.arrivals.concat(state.arrivals.slice(-1)) }), ids);
              check(terminalControl, "漏终点负对照没有被到站判据识别");
              check(duplicateControl, "重复终点负对照没有被到站判据识别");
            }
            runs++;
          });
        });
      } catch (e) { bad.push("异常：" + e.message); }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        runs + " 次单步/逐帧播放覆盖普通、换乘和重复到同站路径，全部站按顺序报到，终点只报一次；漏终点/重复终点负对照均被识别" };
    });
    t("模拟导航交互：跟随不改存档，暂停继续正常，自检保留控件，编辑清除车头和动画", () => {
      const saved = { p: P, sel, tool, pending: pendingInsert, view: [map.getCenter(), map.getZoom()],
        dirty, owner: dirtyOwner, hist: hist.slice(), future: future.slice(), flag: inSelfTest,
        lock: viewLockUntil, intent: userViewAt, armed: viewCommitArmed, programmatic: navProgrammaticView,
        nudgeId, nudgeAt,
        timeout: window.setTimeout, clearTimeout: window.clearTimeout, panBy: map.panBy,
        pillState: $("#savePill").dataset.state, pillText: $("#savePill span").textContent, pillTitle: $("#savePill").title,
        navigation: navSuspend() };
      const bad = [], timers = new Map();
      const check = (ok, message) => { if (!ok) bad.push(message); };
      const storageBytes = () => {
        const entries = {}; Object.keys(localStorage).sort().forEach((key) => { entries[key] = localStorage.getItem(key); });
        return JSON.stringify(entries);
      };
      const diskBefore = storageBytes();
      let fakeTimer = -1000000, trackedGuard = false, followMoved = false, userControl = false, cleanupControl = false, mergedNudge = false;
      let restoredNodes = 0, suspended = null;
      // Keep the actual markDirty/view debounce code, but prevent its synthetic
      // callbacks from surviving the synchronous test and writing a user's save.
      window.setTimeout = (callback, delay, ...args) => {
        const id = fakeTimer--; timers.set(id, { callback, delay, args }); return id;
      };
      window.clearTimeout = (id) => {
        if (timers.has(id)) { timers.delete(id); return; }
        if (typeof id === "number" && id <= -1000000) return;
        saved.clearTimeout.call(window, id);
      };
      try {
        inSelfTest = true; navProgrammaticView = false; userViewAt = -Infinity; viewLockUntil = Infinity;
        P = synthProject(3, 1); P.id = "synth-navigation-ui";
        sel = { line: P.lines[0].id, station: "x0" }; hist = []; future = []; dirty = false; dirtyOwner = null;
        clearMarkerPools(); map.setView(P.center, P.zoom, { animate: false }); renderAll();
        // Use Leaflet's rounded center as the baseline; opening the card must not
        // inherit an unrelated, genuine pre-test viewport change.
        const center = map.getCenter(); P.center = [center.lat, center.lng]; P.zoom = map.getZoom();
        const baseline = projectFingerprint(P), baselineZoom = P.zoom, initialHist = JSON.stringify(hist), initialFuture = JSON.stringify(future);
        const unchanged = () => projectFingerprint(P) === baseline && !dirty && dirtyOwner === null &&
          JSON.stringify(hist) === initialHist && JSON.stringify(future) === initialFuture && storageBytes() === diskBefore;
        inSelfTest = false; viewLockUntil = 0; viewByUser();
        openNavigation();
        check(!!nav && !$("#navCard").hidden && $("#tNavigate").classList.contains("is-on"), "导航入口没有显示卡片");
        check(unchanged(), "打开导航改动了图纸/历史/未保存状态/本地存储");
        navChooseStation("navFrom", "x0", false); navChooseStation("navTo", "x2", false);
        $("#navPreference").value = "stops"; $("#navPreference").dispatchEvent(new Event("change", { bubbles: true }));
        $("#navSpeed").value = "2"; $("#navSpeed").dispatchEvent(new Event("change", { bubbles: true }));
        check(nav && nav.plan && nav.plan.ok && nav.plan.from === "x0" && nav.plan.to === "x2" && nav.plan.legs.length === 2,
          "导航控件没有按 x0→x2 规划两段路径");
        $("#navStart").click();
        check(nav && nav.playback && nav.playback.status === "running" && !!nav.marker && !!nav.layer &&
          map.hasLayer(nav.layer) && (document.hidden || !!nav.raf), "开始模拟没有运行状态/车头/图层/动画");
        check(unchanged(), "开始模拟或首次跟随改动了图纸/历史/未保存状态/本地存储");
        $("#navPause").click();
        check(nav && nav.playback.status === "paused" && !nav.raf && $("#navPause").textContent === "继续", "暂停未停止动画或未提供继续按钮");
        const pausedBytes = JSON.stringify(nav.playback);
        advanceNavPlayback(nav.playback, 3600);
        check(JSON.stringify(nav.playback) === pausedBytes, "暂停状态仍推进了停站或行车");
        userViewAt = -Infinity;
        map.setZoom(map.getZoom() + 1, { animate: false });
        const pausedPoint = map.latLngToContainerPoint(nav.marker.getLatLng()), pausedSize = map.getSize();
        check(nav.playback.status === "paused" && !nav.raf && pausedPoint.x >= 0 && pausedPoint.x <= pausedSize.x &&
          pausedPoint.y >= 0 && pausedPoint.y <= pausedSize.y, "暂停列车缩放后没有重新跟随到可见范围或意外恢复播放");
        check(unchanged(), "暂停列车的程序缩放/跟随改写了图纸视图或存档");
        $("#navPause").click();
        check(nav && nav.playback.status === "running" && $("#navPause").textContent === "暂停" &&
          (document.hidden || !!nav.raf), "继续没有恢复模拟状态或动画");
        $("#navFollow").checked = false; $("#navFollow").dispatchEvent(new Event("change", { bubbles: true }));
        const nodes = Array.from($("#navCard").querySelectorAll("select,button,input"));
        const values = nodes.map((node) => ({ node, value: node.value, checked: node.checked }));
        const runtime = nav;
        suspended = navSuspend();
        check(suspended === runtime && !nav && $("#navCard").hidden && !runtime.raf && !runtime.marker && !runtime.layer &&
          nodes.every((node) => !node.isConnected), "自检挂起没有移走控件并清理车头/动画");
        navRestore(suspended); suspended = null;
        values.forEach((entry) => {
          const actual = $("#" + entry.node.id);
          if (actual === entry.node && actual.value === entry.value && actual.checked === entry.checked) restoredNodes++;
          else check(false, "自检恢复重建了控件或丢失选择值：" + entry.node.id);
        });
        check(nav === runtime && nav.speed === 2 && nav.preference === "stops" && !nav.follow &&
          nav.playback.status === "running" && !$("#navCard").hidden, "自检恢复丢失模拟配置/运行状态");
        $("#navPause").click();
        check(nav && nav.playback.status === "paused", "恢复控件失去了原暂停事件监听");
        $("#navPause").click();
        check(nav && nav.playback.status === "running", "恢复控件失去了原继续事件监听");
        check(unchanged(), "暂停/继续/自检挂起恢复改动了图纸或存档");
        const beforeFollow = map.getCenter(), armedBefore = viewCommitArmed;
        map.panBy = function () {
          trackedGuard = navProgrammaticView;
          const result = saved.panBy.apply(this, arguments);
          commitViewNow(); // Exercise the guard while the synchronous moveend fires.
          return result;
        };
        const size = map.getSize(), far = map.containerPointToLatLng({ x: size.x + 420, y: size.y + 320 });
        viewByUser(); navFollowPoint(far); map.panBy = saved.panBy;
        const afterFollow = map.getCenter();
        followMoved = map.latLngToContainerPoint(beforeFollow).distanceTo(map.latLngToContainerPoint(afterFollow)) > 100;
        check(followMoved && trackedGuard && !navProgrammaticView && userViewAt === -Infinity,
          "强制跟随没有真实移动或没有清除程序视图归属/旧用户意图");
        check(viewCommitArmed === armedBefore, "程序跟随 moveend 被当成用户移动排入记账");
        commitViewNow();
        check(unchanged(), "跟随结束后的立即记账仍把程序视图写进图纸");
        // Explicitly prove the programmatic guard works even with recent input.
        viewByUser(); navProgrammaticView = true; commitViewNow(); navProgrammaticView = false; userViewAt = -Infinity;
        check(unchanged(), "程序视图保护没有拦住刚发生用户输入的立即记账");
        const oldLayer = nav.layer, oldMarker = nav.marker, cleanupRuntime = nav;
        cleanupControl = !!oldLayer && !!oldMarker && map.hasLayer(oldLayer) && map.hasLayer(oldMarker);
        check(cleanupControl, "编辑清理负对照失效：编辑前没有实际导航图层或车头");
        pushHistory();
        check(!nav && !cleanupRuntime.raf && !cleanupRuntime.layer && !cleanupRuntime.marker &&
          !map.hasLayer(oldLayer) && !map.hasLayer(oldMarker) && $("#navCard").hidden &&
          !document.querySelector(".nav-train") && !$("#tNavigate").classList.contains("is-on"),
          "开始编辑没有完整关闭导航、移走车头或取消动画");
        check(hist.length === 1 && !future.length && projectFingerprint(P) === baseline,
          "编辑前记历史没有只新增一笔原图快照");
        hist = []; future = []; updateHistoryButtons(); commitViewNow();
        check(unchanged(), "取消导航后旧程序移动又被记入图纸");
        // A second arrow-key nudge inside the 600 ms undo merge window skips
        // pushHistory. It remains an edit and must close navigation itself.
        openNavigation();
        check(!!nav && !$("#navCard").hidden, "历史合并窗微调用例没有真实打开导航");
        const nudgedStation = station("x0"), oldCoordinates = [nudgedStation.lat, nudgedStation.lng];
        const oldNudgeHistory = JSON.stringify(hist), nudgeRuntime = nav;
        sel.station = "x0"; nudgeId = "x0"; nudgeAt = Date.now();
        const nudgeAccepted = nudgeStation(1, 0);
        mergedNudge = nudgeAccepted && JSON.stringify(hist) === oldNudgeHistory &&
          (nudgedStation.lat !== oldCoordinates[0] || nudgedStation.lng !== oldCoordinates[1]);
        check(mergedNudge, "历史合并窗内微调没有实际改坐标，或意外增加了一笔撤销");
        check(!nav && $("#navCard").hidden && !nudgeRuntime.layer && !nudgeRuntime.marker && !nudgeRuntime.raf,
          "历史合并窗跳过 pushHistory 后，微调仍留下导航卡片/图层/车头/动画");
        // Restore only the intentional nudge, retaining the no-change predicate
        // used by all earlier navigation operations.
        nudgedStation.lat = oldCoordinates[0]; nudgedStation.lng = oldCoordinates[1];
        dirty = false; dirtyOwner = null; userViewAt = -Infinity;
        check(unchanged(), "合并窗微调回还后仍有额外图纸/历史/存档副作用");
        // A genuine user pan must still commit. Timers are intercepted, and the
        // synthetic edit is restored immediately before leaving this same stack.
        viewByUser(); map.panBy([61, 37], { animate: false }); commitViewNow();
        userControl = projectFingerprint(P) !== baseline && dirty && dirtyOwner === P.id;
        check(userControl, "真实用户平移负对照没有正常改动视图和未保存状态");
        check(Array.from(timers.values()).some((timer) => timer.delay === 550), "负对照未走到实际自动保存排程");
        P.center = [center.lat, center.lng]; P.zoom = baselineZoom;
        dirty = false; dirtyOwner = null; userViewAt = -Infinity;
        check(storageBytes() === diskBefore, "导航交互或用户平移负对照实际写入了本地存储");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        inSelfTest = true; viewLockUntil = Infinity; userViewAt = -Infinity; navProgrammaticView = false;
        window.setTimeout = saved.timeout; window.clearTimeout = saved.clearTimeout;
        map.panBy = saved.panBy; navClose();
        if (suspended && suspended.content) suspended.content.replaceChildren();
        P = saved.p; sel = saved.sel; tool = saved.tool; pendingInsert = saved.pending;
        hist = saved.hist; future = saved.future; dirty = saved.dirty; dirtyOwner = saved.owner;
        nudgeId = saved.nudgeId; nudgeAt = saved.nudgeAt;
        clearMarkerPools(); map.stop(); map.setView(saved.view[0], saved.view[1], { animate: false }); renderAll();
        $$("#tSelect,#tAdd,#tLink").forEach((button) => button.classList.toggle("is-on", button.dataset.tool === tool));
        navRestore(saved.navigation);
        $("#savePill").dataset.state = saved.pillState; $("#savePill span").textContent = saved.pillText; $("#savePill").title = saved.pillTitle;
        viewCommitArmed = saved.armed; userViewAt = saved.intent; navProgrammaticView = saved.programmatic;
        inSelfTest = saved.flag; viewLockUntil = Math.max(saved.lock, performance.now() + 2400);
      }
      check(storageBytes() === diskBefore, "恢复原现场后本地存储字节不一致");
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        "开始/暂停/继续正常；" + restoredNodes + " 个控件保持原节点、值和事件监听；刚输入后强制跟随不记账，关闭/编辑清车头与动画，合并撤销窗内微调也关闭导航；真实用户平移负对照记账，保存排程同步截获，本地存储逐字节相同" };
    });
    t("模拟导航搜索：中文筛选、同名站、失效输入、键盘与交换不改图纸或存储", () => {
      const saved = { p: P, fingerprint: projectFingerprint(P), sel, tool, pending: pendingInsert,
        view: [map.getCenter(), map.getZoom()], dirty, owner: dirtyOwner, hist: hist.slice(), future: future.slice(),
        flag: inSelfTest, lock: viewLockUntil, intent: userViewAt, armed: viewCommitArmed, programmatic: navProgrammaticView,
        timeout: window.setTimeout, clearTimeout: window.clearTimeout,
        pillState: $("#savePill").dataset.state, pillText: $("#savePill span").textContent, pillTitle: $("#savePill").title,
        navigation: navSuspend() };
      const bad = [], timers = new Map();
      const check = (ok, message) => { if (!ok) bad.push(message); };
      const storageBytes = () => {
        const entries = {}; Object.keys(localStorage).sort().forEach((key) => { entries[key] = localStorage.getItem(key); });
        return JSON.stringify(entries);
      };
      const diskBefore = storageBytes();
      let fakeTimer = -2000000, suspended = null, duplicateControl = false, staleControl = false, keyboardChecks = 0;
      window.setTimeout = (callback, delay, ...args) => {
        const id = fakeTimer--; timers.set(id, { callback, delay, args }); return id;
      };
      window.clearTimeout = (id) => {
        if (timers.has(id)) { timers.delete(id); return; }
        if (typeof id === "number" && id <= -2000000) return;
        saved.clearTimeout.call(window, id);
      };
      try {
        inSelfTest = true; navProgrammaticView = false; userViewAt = -Infinity; viewLockUntil = Infinity;
        const fixture = synthProject(8, 2);
        fixture.id = "synth-navigation-search";
        const names = ["科技园", "中央公园", "市民中心", "科技园", "南湖", "蓝线终点", "隐藏站", "在建站"];
        names.forEach((name, i) => { fixture.stations["x" + i].name = name; });
        fixture.lines[0].name = "红线"; fixture.lines[0].badge = "红"; fixture.lines[0].stations = ["x0", "x1", "x2"];
        fixture.lines[1].name = "蓝线"; fixture.lines[1].badge = "蓝"; fixture.lines[1].stations = ["x2", "x3", "x4", "x5"];
        fixture.lines.push(Object.assign({}, fixture.lines[0], { id: "search-hidden", name: "隐藏线", visible: false, stations: ["x6", "x0"] }));
        fixture.lines.push(Object.assign({}, fixture.lines[1], { id: "search-building", name: "在建线", style: "dash", stations: ["x7", "x5"] }));
        P = normalize(fixture); sel = { line: "y0", station: "x0" }; hist = []; future = []; dirty = false; dirtyOwner = null;
        clearMarkerPools(); map.setView(P.center, P.zoom, { animate: false }); renderAll();
        const center = map.getCenter(); P.center = [center.lat, center.lng]; P.zoom = map.getZoom();
        const baseline = projectFingerprint(P), initialHist = JSON.stringify(hist), initialFuture = JSON.stringify(future);
        const unchanged = () => projectFingerprint(P) === baseline && !dirty && dirtyOwner === null &&
          JSON.stringify(hist) === initialHist && JSON.stringify(future) === initialFuture && storageBytes() === diskBefore;
        const inputText = (fieldId, value) => {
          const input = $("#" + fieldId); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); return input;
        };
        const results = (fieldId) => $("#" + fieldId + "Results");
        const options = (fieldId) => Array.from(results(fieldId).querySelectorAll('button[role="option"][data-station]'));
        const key = (input, name, extra) => input.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: name, bubbles: true, cancelable: true }, extra || {})));
        const activeOption = (input) => document.getElementById(input.getAttribute("aria-activedescendant") || "");
        openNavigation();
        check(!!nav && $("#navFrom").tagName === "INPUT" && $("#navTo").tagName === "INPUT", "起终点没有使用搜索输入框");
        const eligible = nav.choices.map((choice) => choice.id).sort();
        check(eligible.join(",") === "x0,x1,x2,x3,x4,x5", "候选纳入了隐藏/在建车站或遗漏运营车站");
        const choicesBefore = JSON.stringify(nav.choices), matches = navSearchMatches("科技", nav.choices);
        const ids = matches.map((choice) => choice.id).sort();
        const duplicatesOK = (candidates) => candidates.length === 2 && new Set(candidates.map((choice) => choice.id)).size === 2;
        check(ids.join(",") === "x0,x3" && duplicatesOK(matches), "中文部分站名搜索没有保留两个不同 ID 的同名站");
        duplicateControl = !duplicatesOK(matches.slice(0, 1));
        check(duplicateControl, "按站名去重的负对照没有被识别");
        check(JSON.stringify(nav.choices) === choicesBefore, "纯搜索修改了候选列表");
        check(matches.every((choice) => (choice.label + " " + choice.detail).includes(choice.id === "x0" ? "红" : "蓝")),
          "同名车站的候选缺少所属线路提示");
        const byLine = navSearchMatches("红", nav.choices).map((choice) => choice.id).sort();
        check(byLine.join(",") === "x0,x1,x2", "线路提示未参与搜索或混入其他线路的同名站");
        const from = inputText("navFrom", "科技");
        check(!from.dataset.stationId && !results("navFrom").hidden && from.getAttribute("aria-expanded") === "true" &&
          options("navFrom").map((node) => node.dataset.station).sort().join(",") === "x0,x3", "输入中文没有展开正确候选或保留了旧起点 ID");
        const blueTwin = options("navFrom").find((node) => node.dataset.station === "x3");
        check(!!blueTwin && blueTwin.textContent.includes("蓝"), "蓝线同名候选没有线路提示");
        if (blueTwin) blueTwin.click();
        check(from.dataset.stationId === "x3" && nav.from === "x3" && from.value.includes("科技园") && results("navFrom").hidden,
          "点击同名候选没有选中准确的蓝线车站 ID");
        navChooseStation("navFrom", "x0", false); navChooseStation("navTo", "x5");
        $("#navFollow").checked = false; $("#navFollow").dispatchEvent(new Event("change", { bubbles: true }));
        $("#navStart").click();
        const oldRuntime = nav, oldPlayback = nav.playback, oldLayer = nav.layer, oldMarker = nav.marker;
        const invalidInputCleared = (runtime, input) => !input.dataset.stationId && !runtime.to && !runtime.plan &&
          !runtime.playback && !runtime.raf && !runtime.layer && !runtime.marker && $("#navStart").disabled;
        staleControl = !!oldPlayback && !!oldLayer && !!oldMarker && map.hasLayer(oldLayer) && map.hasLayer(oldMarker) &&
          !invalidInputCleared(nav, $("#navTo"));
        check(staleControl, "沿用旧目的地/播放的负对照未被失效输入判据识别");
        const to = inputText("navTo", "不存在的站名");
        check(nav === oldRuntime && invalidInputCleared(nav, to) && !map.hasLayer(oldLayer) && !map.hasLayer(oldMarker),
          "修改目的地仍沿用旧 ID、路线、车头或动画");
        check(!results("navTo").hidden && !options("navTo").length && !!results("navTo").textContent.trim(),
          "无匹配输入没有明确提示或仍提供可选旧候选");
        check(unchanged(), "搜索/点击/修改目的地改动了图纸、历史或存储");
        inputText("navTo", "科技");
        key(to, "ArrowDown");
        check(!!activeOption(to), "向下键没有设置可访问的活动候选"); keyboardChecks++;
        key(to, "ArrowUp");
        const active = activeOption(to), expectedId = active && active.dataset.station;
        check(!!expectedId && ["x0", "x3"].includes(expectedId), "向上键没有定位有效候选"); keyboardChecks++;
        key(to, "Enter");
        check(!!expectedId && to.dataset.stationId === expectedId && nav.to === expectedId && results("navTo").hidden,
          "Enter 没有确认当前键盘候选的准确 ID"); keyboardChecks++;
        inputText("navTo", "科技");
        to.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "科" }));
        key(to, "Enter", { isComposing: true });
        check(!!nav && !to.dataset.stationId && !nav.to && results("navTo").hidden,
          "中文输入法确认误选候选或仍显示组合前的旧候选"); keyboardChecks++;
        key(to, "Escape", { isComposing: true });
        check(!!nav && !$("#navCard").hidden && !to.dataset.stationId && results("navTo").hidden,
          "中文输入法取消组合时意外关闭导航或重新显示旧候选"); keyboardChecks++;
        to.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "科技" }));
        check(!results("navTo").hidden && options("navTo").length === 2,
          "中文组合结束没有按最终文字重新显示候选"); keyboardChecks++;
        key(to, "Escape");
        check(!!nav && !$("#navCard").hidden && results("navTo").hidden && to.getAttribute("aria-expanded") === "false",
          "Escape 没有先收候选或意外关闭了导航"); keyboardChecks++;
        key(to, "Escape");
        check(!nav && $("#navCard").hidden, "候选关闭后第二次 Escape 未关闭导航"); keyboardChecks++;
        openNavigation();
        navChooseStation("navFrom", "x0", false); navChooseStation("navTo", "x5");
        const fromBefore = $("#navFrom").value, toBefore = $("#navTo").value;
        navSearchRender($("#navFrom")); $("#navSwap").click();
        check($("#navFrom").dataset.stationId === "x5" && $("#navTo").dataset.stationId === "x0" &&
          $("#navFrom").value === toBefore && $("#navTo").value === fromBefore && nav.from === "x5" && nav.to === "x0" &&
          nav.plan && nav.plan.ok && nav.plan.from === "x5" && nav.plan.to === "x0" &&
          results("navFrom").hidden && results("navTo").hidden, "交换起终点未同步 ID、文字、候选和反向路线");
        // Retain a partially typed query across the same suspend/restore path used
        // by the overall suite; original DOM nodes must still own their listeners.
        const queryInput = inputText("navTo", "科技"), oldFromInput = $("#navFrom"), oldResults = results("navTo"), runtime = nav;
        const confirmedFrom = oldFromInput.dataset.stationId, confirmedLabel = oldFromInput.value;
        suspended = navSuspend(); navRestore(suspended); suspended = null;
        check(nav === runtime && $("#navTo") === queryInput && results("navTo") === oldResults && $("#navFrom") === oldFromInput &&
          queryInput.value === "科技" && !queryInput.dataset.stationId && oldFromInput.dataset.stationId === confirmedFrom &&
          oldFromInput.value === confirmedLabel && !nav.to && !nav.plan, "挂起恢复丢失原输入节点、查询或确认 ID");
        navSearchRender(queryInput);
        const afterRestore = options("navTo").find((node) => node.dataset.station === "x0");
        if (afterRestore) afterRestore.click();
        check(!!afterRestore && queryInput.dataset.stationId === "x0" && nav.to === "x0" && nav.plan && nav.plan.ok,
          "恢复后搜索候选或点击监听失效");
        navHideSearch(queryInput);
        check(results("navTo").hidden && queryInput.getAttribute("aria-expanded") === "false" && !queryInput.getAttribute("aria-activedescendant"),
          "收起候选未清除展开/活动候选状态");
        check(unchanged(), "键盘、交换或挂起恢复改动了图纸、历史或本地存储");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        inSelfTest = true; viewLockUntil = Infinity; userViewAt = -Infinity; navProgrammaticView = false;
        window.setTimeout = saved.timeout; window.clearTimeout = saved.clearTimeout; navClose();
        if (suspended && suspended.content) suspended.content.replaceChildren();
        P = saved.p; sel = saved.sel; tool = saved.tool; pendingInsert = saved.pending;
        hist = saved.hist; future = saved.future; dirty = saved.dirty; dirtyOwner = saved.owner;
        clearMarkerPools(); map.stop(); map.setView(saved.view[0], saved.view[1], { animate: false }); renderAll();
        $$("#tSelect,#tAdd,#tLink").forEach((button) => button.classList.toggle("is-on", button.dataset.tool === tool));
        navRestore(saved.navigation);
        $("#savePill").dataset.state = saved.pillState; $("#savePill span").textContent = saved.pillText; $("#savePill").title = saved.pillTitle;
        viewCommitArmed = saved.armed; userViewAt = saved.intent; navProgrammaticView = saved.programmatic;
        inSelfTest = saved.flag; viewLockUntil = Math.max(saved.lock, performance.now() + 2400);
      }
      check(P === saved.p && projectFingerprint(P) === saved.fingerprint, "恢复后原图纸内容变化");
      check(storageBytes() === diskBefore, "恢复后本地存储字节变化");
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        "中文部分站名和线路筛选、同名站按 ID 点击、" + keyboardChecks + " 项键盘/输入法/Esc、交换和原节点恢复通过；修改输入立即清旧路线/车头/动画，无匹配禁开始；去重与沿用旧播放负对照有效，图纸/历史/存储逐字节不变" };
    });
    t("中英报站交互：下一站边走边播，到站打断旧报站并等双语，暂停和清理正常", () => {
      const saved = { p: P, fingerprint: projectFingerprint(P), sel, tool, pending: pendingInsert,
        view: [map.getCenter(), map.getZoom()], dirty, owner: dirtyOwner, hist: hist.slice(), future: future.slice(),
        flag: inSelfTest, lock: viewLockUntil, intent: userViewAt, armed: viewCommitArmed, programmatic: navProgrammaticView,
        advanceClock: navAdvanceClock,
        pillState: $("#savePill").dataset.state, pillText: $("#savePill span").textContent, pillTitle: $("#savePill").title,
        navigation: navSuspend() };
      const bad = [], spoken = [], timers = new Map(), availability = [];
      const check = (ok, message) => { if (!ok) bad.push(message); };
      const storageBytes = () => {
        const entries = {}; Object.keys(localStorage).sort().forEach((key) => { entries[key] = localStorage.getItem(key); });
        return JSON.stringify(entries);
      };
      const diskBefore = storageBytes();
      let timerId = 0, cancels = 0, completions = 0, freezeControl = false, arrivalControl = false, easingControl = false;
      let suspendedSpeech = null;
      const injectSpeaker = () => {
        const owner = nav;
        owner.speaker = createNavSpeaker({
          speak(part, finish) { spoken.push({ text: part.text, lang: part.lang, finish }); },
          cancel() { cancels++; },
          later(callback) { const id = ++timerId; timers.set(id, callback); return id; },
          unlater(id) { timers.delete(id); }
        }, () => { completions++; navSpeechComplete(owner); });
      };
      // The deterministic adapter never calls the device's speech engine. Missing
      // capability flags receive placeholders solely to exercise the real UI.
      const ensureAvailability = (key, value) => {
        if (window[key]) return;
        availability.push({ key, descriptor: Object.getOwnPropertyDescriptor(window, key) });
        Object.defineProperty(window, key, { configurable: true, value });
      };
      const toggleVoice = (enabled) => {
        $("#navVoice").checked = enabled; $("#navVoice").dispatchEvent(new Event("change", { bubbles: true }));
      };
      const resumeHiddenAdapter = () => {
        if (document.hidden) {
          check(nav.speaker.paused && !nav.speaking, "隐藏页面继续时意外开始语音");
          nav.speaking = true; nav.speaker.resume();
        }
      };
      const clock = (now) => { navAdvanceClock(now); navCancelFrame(); };
      const departFirst = () => { navStart(); navCancelFrame(); nav.lastTime = 0; clock(3600000); };
      const atFirstDeparture = (state) => state.status === "running" && state.phase === "ride" && state.index === 0 &&
        state.elapsed === 0 && state.arrivals.length === 1 && state.arrivals[0].station === "x0";
      const atFirstArrival = (state) => state.status === "running" && state.phase === "stop" && state.index === 1 &&
        state.elapsed === 0 && state.arrivals.length === 2 && state.arrivals[1].station === "x1";
      const arrivalPreempted = (count, cancelled) => atFirstArrival(nav.playback) && cancels === cancelled + 1 &&
        spoken.length === count + 1 && spoken.at(-1).lang === "zh-CN" && spoken.at(-1).text.startsWith("中央公园到了。");
      try {
        inSelfTest = true; navProgrammaticView = false; userViewAt = -Infinity; viewLockUntil = Infinity;
        ensureAvailability("speechSynthesis", {}); ensureAvailability("SpeechSynthesisUtterance", function () {});
        P = synthProject(3, 1); P.id = "synth-navigation-speech";
        ["起点", "中央公园", "终点"].forEach((name, i) => { P.stations["x" + i].name = name; });
        P.stations.x1.nameEn = "Central Park"; P.stations.x2.nameEn = "Terminal";
        sel = { line: P.lines[0].id, station: "x0" }; hist = []; future = []; dirty = false; dirtyOwner = null;
        clearMarkerPools(); map.setView(P.center, P.zoom, { animate: false }); renderAll();
        const center = map.getCenter(); P.center = [center.lat, center.lng]; P.zoom = map.getZoom();
        const baseline = projectFingerprint(P), initialHist = JSON.stringify(hist), initialFuture = JSON.stringify(future);
        const unchanged = () => projectFingerprint(P) === baseline && !dirty && dirtyOwner === null &&
          JSON.stringify(hist) === initialHist && JSON.stringify(future) === initialFuture && storageBytes() === diskBefore;
        openNavigation();
        navChooseStation("navFrom", "x0", false); navChooseStation("navTo", "x2");
        $("#navFollow").checked = false; $("#navFollow").dispatchEvent(new Event("change", { bubbles: true }));
        navStart(); navCancelFrame(); injectSpeaker(); inSelfTest = false; toggleVoice(true);
        nav.lastTime = 0; clock(3600000);
        check(atFirstDeparture(nav.playback) && nav.announcement.type === "next" && nav.announcement.station === "x1" &&
          nav.speaker.busy && nav.speaking && spoken.length === 1 && spoken[0].lang === "zh-CN",
          "大时间步未进入第一段行车，或下一站没有先播中文");
        const departurePoint = nav.marker.getLatLng(), beforeRideTime = nav.lastTime;
        const rideSample = nav.playback.durations[0] * .1, sampleTime = 3600000 + rideSample * 1000;
        // Restore the old freeze-while-speaking behavior temporarily. The same
        // movement predicate must reject it, then pass against the real clock.
        try {
          navAdvanceClock = (now) => {
            if (nav.speaker && nav.speaker.busy) { nav.lastTime = null; return; }
            saved.advanceClock(now);
          };
          clock(sampleTime);
          freezeControl = !(nav.playback.elapsed > 0 && nav.lastTime === sampleTime);
          check(freezeControl, "下一站旧冻结逻辑的负对照未被行车判据识别");
        } finally { navAdvanceClock = saved.advanceClock; nav.lastTime = beforeRideTime; }
        clock(sampleTime);
        check(nav.playback.phase === "ride" && Math.abs(nav.playback.elapsed - rideSample) < 1e-8 && nav.speaker.busy &&
          nav.lastTime === sampleTime && map.distance(departurePoint, nav.marker.getLatLng()) > .01,
          "下一站中文期间列车仍冻结，或没有移动真实车头");
        const eased = navRideFraction(.1), expectedPoint = navPointAt(nav.points[0], eased);
        const expectedPosition = map.unproject(expectedPoint, nav.geoZoom);
        const constantPosition = map.unproject(navPointAt(nav.points[0], .1), nav.geoZoom);
        easingControl = map.distance(constantPosition, expectedPosition) > .01;
        check(easingControl, "未接入加减速的匀速车头负对照没有被位置判据识别");
        check(map.distance(nav.marker.getLatLng(), expectedPosition) < .01 &&
          Math.abs($("#navProgress").value - eased / nav.plan.legs.length) < 1e-8,
          "真实车头或进度条没有使用行车加减速后的距离比例");
        navScheduleFrame();
        check(document.hidden || !!nav.raf, "下一站中文期间没有持续安排动画帧"); navCancelFrame();
        spoken[0].finish();
        check(spoken.length === 2 && spoken[1].lang === "en-US" && spoken[1].text.includes("Central Park") &&
          nav.speaker.busy && completions === 0, "下一站中文没有顺序接英文");
        clock(sampleTime + 200);
        check(nav.playback.phase === "ride" && Math.abs(nav.playback.elapsed - rideSample - .2) < 1e-8 && nav.speaker.busy,
          "下一站英文期间列车仍冻结");
        spoken[1].finish(); navCancelFrame();
        check(completions === 1 && !nav.speaker.busy && !nav.speaking && nav.lastTime === sampleTime + 200,
          "下一站双语结束重置了仍在行车的时钟");
        clock(sampleTime + 400);
        check(Math.abs(nav.playback.elapsed - rideSample - .4) < 1e-8, "下一站播报完成后的行车漏算了一帧");
        navScheduleFrame();
        check(document.hidden || !!nav.raf, "下一站结束后没有安排继续行车"); navCancelFrame();

        // Reach the first arrival before next-station Chinese finishes. The
        // no-replacement mutant must fail the immediate arrival/cancel predicate.
        departFirst();
        const oldNextChinese = spoken.at(-1), oldWatchdog = timers.values().next().value;
        const beforeArrival = spoken.length, beforeArrivalCancel = cancels, realSpeak = nav.speaker.speak;
        try {
          nav.speaker.speak = function (parts) { if (!this.busy) realSpeak.call(this, parts); };
          clock(7200000);
          arrivalControl = !arrivalPreempted(beforeArrival, beforeArrivalCancel);
          check(arrivalControl, "到站不取消下一站的负对照未被替换判据识别");
        } finally { nav.speaker.speak = realSpeak; }
        navAnnounce(nav.announcement); navCancelFrame();
        check(arrivalPreempted(beforeArrival, beforeArrivalCancel) && nav.announcement.type === "arrival" &&
          nav.announcement.station === "x1" && nav.speaker.busy && nav.speaking,
          "到站没有立即取消未完的下一站中文并播到站中文");
        const arrivalCount = spoken.length, waitingArrival = JSON.stringify(nav.playback);
        oldNextChinese.finish(); oldWatchdog();
        check(spoken.length === arrivalCount && completions === 1, "旧下一站中文/定时器回调泄漏英文或完成事件");
        clock(10800000);
        check(JSON.stringify(nav.playback) === waitingArrival && nav.lastTime === null,
          "到站中文期间列车没有保持停站");
        const originalChinese = spoken.at(-1), beforePause = spoken.length, beforeCancel = cancels;
        navTogglePause(); navCancelFrame();
        const pausedBytes = JSON.stringify(nav.playback);
        check(nav.playback.status === "paused" && nav.speaker.busy && nav.speaker.paused && !nav.speaking &&
          cancels === beforeCancel + 1 && !nav.raf, "到站中文暂停没有取消当前语音并保留语言");
        originalChinese.finish(); clock(14400000);
        check(spoken.length === beforePause && JSON.stringify(nav.playback) === pausedBytes && completions === 1,
          "到站暂停后的旧中文回调仍播英文或推进模拟");
        navTogglePause(); navCancelFrame(); resumeHiddenAdapter();
        check(nav.playback.status === "running" && spoken.length === beforePause + 1 &&
          spoken.at(-1).lang === "zh-CN" && spoken.at(-1).text === originalChinese.text,
          "到站中文继续没有从中断语言重新播放");
        spoken.at(-1).finish();
        const originalEnglish = spoken.at(-1), beforeEnglishPause = spoken.length;
        check(originalEnglish.lang === "en-US" && nav.speaker.busy && completions === 1,
          "到站中文完成没有接英文，或提前解除停站等待");
        const waitingEnglish = JSON.stringify(nav.playback); clock(18000000);
        check(JSON.stringify(nav.playback) === waitingEnglish && nav.lastTime === null,
          "到站英文期间列车提前离站");
        navTogglePause(); navCancelFrame(); originalEnglish.finish();
        check(nav.speaker.paused && spoken.length === beforeEnglishPause && completions === 1,
          "到站英文暂停后的旧回调仍完成播报");
        navTogglePause(); navCancelFrame(); resumeHiddenAdapter();
        check(spoken.length === beforeEnglishPause + 1 && spoken.at(-1).lang === "en-US" &&
          spoken.at(-1).text === originalEnglish.text, "到站英文继续时丢失当前语言");
        spoken.at(-1).finish(); navCancelFrame();
        check(completions === 2 && !nav.speaker.busy && !nav.speaking && nav.lastTime === null,
          "到站双语完成后仍在等待或没有清理时钟");
        clock(21600000);
        check(JSON.stringify(nav.playback) === waitingArrival, "到站播报结束后的首帧补算了等待期间时间");
        clock(25200000);
        check(nav.playback.phase === "ride" && nav.playback.index === 1 && nav.playback.elapsed === 0 &&
          nav.announcement.type === "next" && nav.announcement.station === "x2" && nav.speaker.busy,
          "到站双语结束后未正常离站并播下一站");
        spoken.at(-1).finish();
        const rideEnglish = spoken.at(-1), rideCount = spoken.length;
        clock(25200200);
        check(nav.playback.elapsed > 0 && nav.speaker.busy && rideEnglish.lang === "en-US",
          "第二段下一站英文期间未行车");
        navTogglePause(); navCancelFrame();
        const pausedRide = JSON.stringify(nav.playback); rideEnglish.finish(); clock(28800000);
        check(nav.playback.status === "paused" && nav.speaker.paused && !nav.speaking && !nav.raf &&
          JSON.stringify(nav.playback) === pausedRide && spoken.length === rideCount && completions === 2,
          "行车中暂停没有同时停下车和下一站英文");
        navTogglePause(); navCancelFrame(); resumeHiddenAdapter();
        const resumedRideEnglish = spoken.at(-1);
        check(nav.playback.status === "running" && resumedRideEnglish.lang === "en-US" &&
          resumedRideEnglish.text === rideEnglish.text && spoken.length === rideCount + 1,
          "行车继续未恢复列车状态与当前下一站英文");
        clock(32400000); const rideElapsed = nav.playback.elapsed; clock(32400200);
        check(nav.playback.phase === "ride" && nav.playback.elapsed > rideElapsed && nav.speaker.busy,
          "行车继续后等待下一站语音而冻结");
        const finalCancel = cancels, finalCountBefore = spoken.length;
        clock(36000000);
        const finalChinese = spoken.at(-1), finalBytes = JSON.stringify(nav.playback);
        check(nav.playback.status === "finished" && nav.announcement.type === "arrival" && nav.announcement.final &&
          nav.speaker.busy && cancels === finalCancel + 1 && spoken.length === finalCountBefore + 1 &&
          finalChinese.lang === "zh-CN" && finalChinese.text.startsWith("终点站，终点到了。"),
          "终点到站未立即取消未完的下一站英文并改播到站中文");
        rideEnglish.finish(); resumedRideEnglish.finish();
        check(spoken.length === finalCountBefore + 1 && completions === 2,
          "终点到站后的旧下一站英文回调仍完成或改变报站");
        const beforeFinalPause = spoken.length;
        check(!$("#navPause").disabled && $("#navPause").textContent === "暂停", "终点中文期间暂停按钮提前禁用");
        $("#navPause").click(); navCancelFrame(); finalChinese.finish();
        check(nav.speaker.paused && nav.speaker.busy && !nav.speaking && !$("#navPause").disabled &&
          $("#navPause").textContent === "继续" && JSON.stringify(nav.playback) === finalBytes &&
          spoken.length === beforeFinalPause && completions === 2, "终点中文暂停没有保留语言或旧回调仍生效");
        const pausedFinalOwner = nav, pausedFinalButton = $("#navPause");
        suspendedSpeech = navSuspend();
        check(!nav && suspendedSpeech === pausedFinalOwner && suspendedSpeech.userSpeechPaused &&
          suspendedSpeech.speaker.paused && !suspendedSpeech.raf && !suspendedSpeech.marker,
          "终点手动暂停后的挂起没有保留暂停意图或清理车头");
        navRestore(suspendedSpeech); suspendedSpeech = null; navCancelFrame(); navResumeSpeech();
        check(nav === pausedFinalOwner && $("#navPause") === pausedFinalButton && nav.userSpeechPaused &&
          nav.speaker.paused && !nav.speaking && !nav.raf && spoken.length === beforeFinalPause &&
          $("#navPause").textContent === "继续" && JSON.stringify(nav.playback) === finalBytes,
          "终点手动暂停在挂起恢复后自动开始播报或丢失原按钮");
        $("#navPause").click(); navCancelFrame(); resumeHiddenAdapter();
        check(!nav.speaker.paused && !nav.userSpeechPaused && spoken.length === beforeFinalPause + 1 && spoken.at(-1).lang === "zh-CN" &&
          spoken.at(-1).text === finalChinese.text && JSON.stringify(nav.playback) === finalBytes,
          "终点中文继续改变路线或丢失语言");
        spoken.at(-1).finish();
        const finalEnglish = spoken.at(-1), beforeFinalEnglishPause = spoken.length;
        check(finalEnglish.lang === "en-US" && nav.speaker.busy && !$("#navPause").disabled,
          "终点中文完成后未接英文或英文期间无法暂停");
        $("#navPause").click(); navCancelFrame(); finalEnglish.finish();
        check(nav.speaker.paused && $("#navPause").textContent === "继续" && spoken.length === beforeFinalEnglishPause &&
          completions === 2, "终点英文暂停后旧回调仍完成播报");
        $("#navPause").click(); navCancelFrame(); resumeHiddenAdapter();
        check(!nav.speaker.paused && spoken.length === beforeFinalEnglishPause + 1 && spoken.at(-1).lang === "en-US" &&
          spoken.at(-1).text === finalEnglish.text, "终点英文继续丢失当前语言");
        spoken.at(-1).finish(); navCancelFrame();
        const completedCount = spoken.length;
        check(completions === 3 && !nav.speaker.busy && !nav.speaking && $("#navPause").disabled &&
          $("#navPause").textContent === "暂停" && JSON.stringify(nav.playback) === finalBytes,
          "终点双语完成后没有禁用暂停或重复记到站");
        $("#navPause").click(); clock(39600000); navScheduleFrame();
        check(spoken.length === completedCount && completions === 3 && !nav.raf && JSON.stringify(nav.playback) === finalBytes,
          "终点双语完成后操作又触发行车或重复报站");
        check(unchanged(), "报站/途中和终点暂停继续改动图纸、历史或存储");

        // Muting during a real arrival releases the station dwell and invalidates
        // callbacks; no speech may be produced as the remaining journey finishes.
        departFirst(); clock(7200000);
        const disabledCallback = spoken.at(-1).finish, beforeDisable = spoken.length;
        check(atFirstArrival(nav.playback) && nav.speaker.busy, "关闭语音用例没有真实到站等待");
        toggleVoice(false);
        check(!nav.voice && !nav.speaker.busy && !nav.speaking && nav.lastTime === null &&
          (document.hidden || !!nav.raf), "关闭语音未清等待或未恢复动画排程");
        navCancelFrame(); disabledCallback();
        check(spoken.length === beforeDisable && completions === 3, "关闭语音后旧回调仍续播或完成");
        clock(10800000); clock(14400000);
        check(nav.playback.status === "finished" && nav.playback.arrivals.map((event) => event.station).join(",") === "x0,x1,x2" &&
          !nav.speaker.busy && spoken.length === beforeDisable, "关闭语音后卡在等待、漏终点或发出新语音");
        toggleVoice(true);
        const replanCallback = spoken.at(-1).finish, replanCount = spoken.length, oldLayer = nav.layer;
        check(nav.speaker.busy, "重规划用例没有真实待播语音");
        navReplan(); navCancelFrame(); replanCallback();
        check(!nav.playback && !nav.speaker.busy && !nav.speaking && !nav.announcement && !nav.marker && !nav.raf &&
          !map.hasLayer(oldLayer) && $("#navAnnouncement").hidden && spoken.length === replanCount && completions === 3,
          "重规划未清语音/图层，或旧回调仍生效");
        departFirst();
        const restartCallback = spoken.at(-1).finish, restartCount = spoken.length, oldPlayback = nav.playback;
        $("#navRestart").click(); navCancelFrame(); restartCallback();
        check(nav.playback !== oldPlayback && nav.playback.phase === "stop" && nav.playback.index === 0 &&
          nav.playback.arrivals.length === 1 && !nav.speaker.busy && !nav.speaking && !nav.announcement &&
          spoken.length === restartCount && completions === 3, "重来沿用旧播放/语音或旧回调仍生效");
        nav.lastTime = 0; clock(3600000);
        const closeCallback = spoken.at(-1).finish, closed = nav, closeLayer = nav.layer, closeMarker = nav.marker, closeCount = spoken.length;
        navClose(); closeCallback();
        check(!nav && !closed.speaker.busy && !closed.speaking && !closed.raf && !closed.layer && !closed.marker &&
          !map.hasLayer(closeLayer) && !map.hasLayer(closeMarker) && $("#navCard").hidden &&
          spoken.length === closeCount && completions === 3 && !timers.size, "关闭导航仍留语音/定时器/车头或旧回调仍生效");
        check(unchanged(), "关闭语音/重规划/重来/关闭导航改动图纸、历史或存储");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        navAdvanceClock = saved.advanceClock;
        if (suspendedSpeech && suspendedSpeech.speaker) suspendedSpeech.speaker.clear();
        inSelfTest = true; viewLockUntil = Infinity; userViewAt = -Infinity; navProgrammaticView = false; navClose();
        availability.forEach(({ key, descriptor }) => {
          if (descriptor) Object.defineProperty(window, key, descriptor); else delete window[key];
        });
        P = saved.p; sel = saved.sel; tool = saved.tool; pendingInsert = saved.pending;
        hist = saved.hist; future = saved.future; dirty = saved.dirty; dirtyOwner = saved.owner;
        clearMarkerPools(); map.stop(); map.setView(saved.view[0], saved.view[1], { animate: false }); renderAll();
        $$("#tSelect,#tAdd,#tLink").forEach((button) => button.classList.toggle("is-on", button.dataset.tool === tool));
        navRestore(saved.navigation);
        $("#savePill").dataset.state = saved.pillState; $("#savePill span").textContent = saved.pillText; $("#savePill").title = saved.pillTitle;
        viewCommitArmed = saved.armed; userViewAt = saved.intent; navProgrammaticView = saved.programmatic;
        inSelfTest = saved.flag; viewLockUntil = Math.max(saved.lock, performance.now() + 2400);
      }
      check(P === saved.p && projectFingerprint(P) === saved.fingerprint && storageBytes() === diskBefore,
        "恢复原现场后图纸或本地存储字节变化");
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        "下一站中英期间车头按加减速距离持续行进且结束不丢时钟；到站打断下一站中文/英文并完整等待双语；途中、停站与终点可暂停续播，终点手动暂停挂起恢复保留；关闭语音/重规划/重来/关闭取消旧回调，旧冻结/不取消/匀速负对照有效；未调用设备语音，图纸/历史/存储逐字节不变" };
    });
// END NAVIGATION TESTS
