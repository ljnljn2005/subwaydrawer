// BEGIN LINK DRAG TESTS
    t("连线两阶段：布置站可见并保存，拖线不改坐标，空白松手/取消/切工具恢复地图拖动", () => {
      const bad = [];
      const saved = { p: P, sel, tool, mode: linkMode, chain: linkChain.slice(), closed: linkClosed,
        drag: linkDrag, steps: linkSteps.slice(), suppress: linkSuppressClickUntil, hist: hist.slice(), future: future.slice(),
        dirty, owner: dirtyOwner, pan: map.dragging.enabled(), merge: settings.mergeNear, px: settings.mergePx };
      const check = (ok, msg) => { if (!ok) bad.push(msg); };
      try {
        linkReset(); P = synthProject(0, 0); sel = { line: null, station: null }; hist = []; future = [];
        settings.mergeNear = true; settings.mergePx = 24;
        setTool("link"); linkSetMode("place"); linkSuppressClickUntil = 0;
        const size = map.getSize(), cx = size.x / 2, cy = size.y / 2;
        const points = [[cx - 100, cy - 60], [cx, cy + 65], [cx + 100, cy - 60], [cx - 160, cy + 75]]
          .map(([x, y]) => map.containerPointToLatLng({ x, y }));
        const ids = points.map((ll) => { linkSuppressClickUntil = 0; return linkAddPoint(ll); });
        check(ids.every((id) => !!station(id)), "布置车站没有创建有效 ID");
        check(Object.keys(P.stations).length === 4 && P.lines.length === 0 && hist.length === 4,
          "布置四站应只建四站、记录四笔历史，不能自动成线");
        check(ids.every((id) => station(id) && station(id).placed && !station(id).lines.length),
          "布置站未保留 placed 标记或已意外归入线路");
        renderAll();
        const visible = collectVisible().map((v) => v.st.id);
        check(ids.every((id) => visible.includes(id) && stnPool[id] && layerStn.hasLayer(stnPool[id])),
          "布置站存在于数据中却没有可见圆点");
        check(ids.every((id) => stnPool[id] && stnPool[id].options.draggable), "布置阶段的圆点不能拖动调整位置");
        const h = synthProject(1, 1), hidden = h.lines[0], hiddenId = "link_hidden_station";
        hidden.visible = false; hidden.stations = [hiddenId]; P.lines.push(hidden);
        P.stations[hiddenId] = { id: hiddenId, name: "隐藏线路站", lat: points[0].lat + .05,
          lng: points[0].lng + .05, lines: [hidden.id], note: "" };
        check(!collectVisible().some((v) => v.st.id === hiddenId), "显示无线站时把隐藏线路的站也显示了");
        pruneOrphans();
        check(ids.every((id) => !!station(id)), "整理线路引用时删除了正式布置的无线站");
        linkSuppressClickUntil = 0;
        const beforeNear = snapshot(), nearHist = hist.length;
        linkAddPoint(points[0]);
        check(snapshot() === beforeNear && hist.length === nearHist, "布置阶段点击已有站又新建了一站或多记历史");
        linkSetMode("connect"); settings.mergeNear = false;
        const testPan = map.dragging.enabled();
        const before = snapshot(), beforeHist = hist.length, beforeFuture = JSON.stringify(future);
        const coords = ids.map((id) => { const s = station(id); return s && [s.lat, s.lng]; });
        const blank = map.containerPointToLatLng({ x: cx, y: cy - 170 });
        linkSuppressClickUntil = 0; linkAddPoint(blank);
        check(snapshot() === before && hist.length === beforeHist, "拖线阶段点击空白仍会创建车站");
        check(linkBeginDrag(ids[0], points[0]), "从已布置车站不能开始拖线");
        check(!map.dragging.enabled(), "拖线时地图平移没有暂停");
        linkMoveDrag(points[1]);
        check(linkDrag && linkDrag.target === ids[1], "自动合并关闭时不能命中明确拖向的目标站");
        check(linkEndDrag(points[1]) && linkChain.join(",") === ids.slice(0, 2).join(","), "第一段拖线没有按 A→B 加入草稿");
        check(map.dragging.enabled() === testPan, "有效拖线松手后地图平移状态未恢复");
        check(linkBeginDrag(ids[1], points[1]) && !linkEndDrag(points[0]) && !linkClosed,
          "只有两站的连接却能闭合成环");
        check(linkBeginDrag(ids[1], points[1]) && linkEndDrag(points[2]), "从链尾继续拖线失败");
        check(linkChain.join(",") === ids.slice(0, 3).join(","), "连续拖线 A→B→C 的站序错误");
        const chainBefore = linkChain.join(",");
        check(linkBeginDrag(ids[0], points[0]) && linkEndDrag(points[3]) &&
          linkChain.join(",") === [ids[3]].concat(ids.slice(0, 3)).join(","), "从链首续接 D 没有形成 D→A→B→C");
        linkUndoStep();
        check(linkChain.join(",") === chainBefore && !linkClosed, "首端续接撤一步误删链尾 C，未恢复 A→B→C");
        check(!linkBeginDrag(ids[1], points[1]) && linkChain.join(",") === chainBefore,
          "从链中间分叉被误收进一条连续线路");
        check(linkBeginDrag(ids[2], points[2]) && !linkEndDrag(blank), "空白松手应拒绝这次拖线");
        check(linkChain.join(",") === chainBefore && !linkDrag && map.dragging.enabled() === testPan,
          "空白松手改了草稿或没有恢复地图平移");
        check(linkBeginDrag(ids[2], points[2]) && !linkEndDrag(null), "画布外松手应取消这次拖线");
        check(linkChain.join(",") === chainBefore && !linkDrag && map.dragging.enabled() === testPan,
          "画布外松手丢了已有连接或留下拖动锁");
        check(linkBeginDrag(ids[2], points[2]), "取消手势用例没有启动");
        linkCancelDrag();
        check(!linkDrag && linkChain.join(",") === chainBefore && map.dragging.enabled() === testPan,
          "取消手势误删已有草稿或未恢复地图平移");
        check(linkBeginDrag(ids[2], points[2]), "Ctrl+Z 取消手势用例没有启动");
        undo();
        check(!linkDrag && linkChain.join(",") === chainBefore && hist.length === beforeHist && snapshot() === before &&
          map.dragging.enabled() === testPan, "拖线未松手时 Ctrl+Z 应只取消手势，不能撤掉已有连接或正式布置站");
        check(linkBeginDrag(ids[2], points[2]) && linkEndDrag(points[0]) && linkClosed && linkChain.join(",") === chainBefore,
          "尾站拖回首站没有闭环，或重复加入了首站");
        linkUndoStep();
        check(!linkClosed && linkChain.join(",") === chainBefore, "闭环撤一步没有仅取消闭合边");
        map.dragging.disable();
        check(linkBeginDrag(ids[2], points[2]) && !linkEndDrag(null) && !map.dragging.enabled(),
          "地图本来禁用时，结束拖线却擅自启用了平移");
        if (testPan) map.dragging.enable();
        check(snapshot() === before && hist.length === beforeHist && JSON.stringify(future) === beforeFuture,
          "拖线草稿、拒绝或取消触碰了正式图纸/历史");
        check(ids.every((id, i) => station(id).lat === coords[i][0] && station(id).lng === coords[i][1]),
          "拖线改变了起点或目标站的坐标");
        check(linkBeginDrag(ids[2], points[2]), "切工具用例没有启动手势");
        setTool("select");
        check(!linkDrag && !linkChain.length && !linkClosed && map.dragging.enabled() === testPan,
          "切工具未清连接草稿/手势，或地图平移仍锁住");
        check(snapshot() === before && hist.length === beforeHist && ids.every((id) => !!station(id)),
          "切工具删除了已布置的正式车站或写入历史");
        // 负对照：旧版过滤掉所有无线站，必须被同一可见性断言识别。
        const oldVisible = Object.values(P.stations).filter((s) => stationLines(s).length).map((s) => s.id);
        check(ids.some((id) => !oldVisible.includes(id)), "无线站可见性负对照没有区分力");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        linkReset(); P = saved.p; sel = saved.sel; hist = saved.hist; future = saved.future;
        dirty = saved.dirty; dirtyOwner = saved.owner; settings.mergeNear = saved.merge; settings.mergePx = saved.px;
        setTool(saved.tool); linkMode = saved.mode; linkChain = saved.chain; linkClosed = saved.closed;
        linkDrag = saved.drag; linkSteps = saved.steps; linkSuppressClickUntil = saved.suppress;
        if (saved.pan) map.dragging.enable(); else map.dragging.disable();
        if (saved.drag && saved.drag.pointerId != null) {
          document.addEventListener("pointermove", linkPointerMove, { passive: false });
          document.addEventListener("pointerup", linkPointerUp); document.addEventListener("pointercancel", linkPointerCancel);
          window.addEventListener("blur", linkPointerCancel);
        }
        renderAll(); renderLinkPreview();
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        "布置四站各一笔历史，无线站可见且可调整；隐藏站仍隐藏；双端续接/撤步、闭环/撤闭合均保持准确站序；拖线与取消不改坐标/图纸/历史，松手及切工具恢复地图平移并保留布置站；旧无线站过滤负对照成立" };
    });

    t("连线提交：新建与并入各只记一次撤销，undo/redo 完整往返，失败不写图纸", () => {
      const bad = [];
      const saved = { p: P, sel, tool, mode: linkMode, chain: linkChain.slice(), closed: linkClosed,
        drag: linkDrag, steps: linkSteps.slice(), suppress: linkSuppressClickUntil, hist: hist.slice(), future: future.slice(),
        dirty, owner: dirtyOwner, pan: map.dragging.enabled() };
      const check = (ok, msg) => { if (!ok) bad.push(msg); };
      const fixture = () => {
        linkReset(); P = synthProject(6, 3); sel = { line: P.lines[0].id, station: null }; hist = []; future = [];
        setTool("link"); linkSetMode("connect"); renderAll();
      };
      try {
        fixture();
        const beforeNew = snapshot(), n = P.lines.length;
        ["x0", "x1", "x2"].forEach(linkPush);
        check(linkCommitNewLine(), "三站连接不能新建线路");
        const afterNew = snapshot(), newLine = activeLine();
        check(hist.length === 1 && !future.length && P.lines.length === n + 1,
          "新建线路提交没有恰好一笔历史");
        check(newLine && newLine.stations.join(",") === "x0,x1,x2" && !newLine.loop,
          "新建线路没有保持连接站序");
        check(["x0", "x1", "x2"].every((id) => station(id).lines.includes(newLine.id)),
          "新建线路没有建立车站归属引用");
        undo(); check(snapshot() === beforeNew && !hist.length && future.length === 1,
          "新建线路撤销一次没回到提交前，可能残留空线");
        redo(); check(snapshot() === afterNew && hist.length === 1 && !future.length,
          "新建线路重做一次没有恢复整笔提交");
        fixture();
        const beforeAppend = snapshot(), lid = activeLine().id;
        ["x0", "x3", "x1"].forEach(linkPush);
        check(linkCommitAppend(), "沿已有 x0→x3 再延长到 x1 不能并入");
        const afterAppend = snapshot();
        check(hist.length === 1 && activeLine().stations.join(",") === "x0,x3,x1",
          "并入把点击的连续路径筛乱了，或历史不止一步");
        check(station("x1").lines.includes(lid) && station("x1").lines.includes("y1"),
          "并入没有保留复用车站原有的换乘归属");
        undo(); check(snapshot() === beforeAppend && !hist.length && future.length === 1,
          "并入撤销一次没有恢复完整站序和车站归属");
        redo(); check(snapshot() === afterAppend && hist.length === 1 && !future.length,
          "并入重做一次没有恢复完整提交");
        linkReset(); ["x2", "x5"].forEach(linkPush);
        const beforeReject = snapshot(), rejectHist = JSON.stringify(hist), rejectFuture = JSON.stringify(future);
        check(!linkCommitAppend(), "没有当前线路锚点却并入成功");
        check(snapshot() === beforeReject && JSON.stringify(hist) === rejectHist && JSON.stringify(future) === rejectFuture,
          "被拒绝的并入动了数据或历史");
        linkReset(); linkChain = ["missing_station", "x0"];
        check(!linkCommitNewLine() && !linkCommitAppend(), "不存在的站 ID 能被提交进线路");
        check(snapshot() === beforeReject && JSON.stringify(hist) === rejectHist && JSON.stringify(future) === rejectFuture,
          "不存在的站被拒绝后仍修改了图纸或历史");
        fixture();
        const ring = activeLine(), closeKey = bendKey("x1", "x0"), leftKey = bendKey("x1", "x2"), rightKey = bendKey("x2", "x0");
        ring.stations = ["x0", "x3", "x1"]; ring.loop = true;
        if (!station("x1").lines.includes(ring.id)) station("x1").lines.push(ring.id);
        ring.bends = { [closeKey]: [{ along: .25, normal: .3 }, { along: .75, normal: -.2 }] };
        const beforeRing = snapshot(), oldRing = JSON.parse(JSON.stringify(ring));
        ["x1", "x2", "x0"].forEach(linkPush);
        check(linkCommitAppend(), "不能在环线末站→首站的闭合边插站");
        const afterRing = snapshot(), insertedRing = activeLine();
        check(insertedRing.loop && insertedRing.stations.join(",") === "x0,x3,x1,x2" && hist.length === 1,
          "环线闭合边插站的站序、环线位或历史错误");
        check(!(closeKey in insertedRing.bends) &&
          JSON.stringify(insertedRing.bends[leftKey]) === JSON.stringify([{ along: .5, normal: .3 }]) &&
          JSON.stringify(insertedRing.bends[rightKey]) === JSON.stringify([{ along: .5, normal: -.2 }]),
          "闭合边原弯道没有 remap 到末站→新站/新站→首站");
        const shape = lineShape(insertedRing, (st) => map.latLngToContainerPoint([st.lat, st.lng]));
        check(shape.segs.filter((s) => bendKey(s.a, s.b) === leftKey || bendKey(s.a, s.b) === rightKey)
          .filter((s) => Array.isArray(s.bend) && s.bend.length === 1).length === 2, "渲染形状未读到拆开闭合边后的两份弯道");
        undo(); check(snapshot() === beforeRing, "闭合边插站撤销一次没有还原原闭合弯道");
        redo(); check(snapshot() === afterRing, "闭合边插站重做一次没有还原两段弯道");
        // 负对照：旧 at===length 只读 stations[at]，b 为 undefined，因此留下孤儿闭合边 key。
        oldRing.stations.splice(oldRing.stations.length, 0, "x2");
        check(closeKey in oldRing.bends && !(leftKey in oldRing.bends) && !(rightKey in oldRing.bends),
          "闭合边 b=undefined 的弯道遗失负对照失效");
        fixture();
        const existingLoop = activeLine(); existingLoop.stations = ["x0", "x1", "x2"];
        P = normalize(P); renderAll();
        const beforeExistingLoop = snapshot();
        ["x0", "x1", "x2", "x0"].forEach(linkPush);
        check(linkClosed && linkCommitAppend() && activeLine().loop && hist.length === 1 &&
          activeLine().stations.join(",") === "x0,x1,x2", "沿已有线路全部站闭合草稿后不能一笔并入成环");
        const afterExistingLoop = snapshot();
        undo(); check(snapshot() === beforeExistingLoop, "并入已有线闭环撤销一次没有恢复普通线");
        redo(); check(snapshot() === afterExistingLoop, "并入已有线闭环重做一次没有恢复环线");
        fixture();
        ["x0", "x1", "x2", "x0"].forEach(linkPush);
        check(linkClosed && linkChain.join(",") === "x0,x1,x2", "拖回首站闭环时站序重复列了首站");
        linkUndoStep(); check(!linkClosed && linkChain.join(",") === "x0,x1,x2", "闭环撤一步误删末站");
        linkPush("x0");
        const beforeLoop = snapshot();
        check(linkCommitNewLine() && activeLine().loop && activeLine().stations.join(",") === "x0,x1,x2" && hist.length === 1,
          "闭环线路提交没有保持三个独立站及一笔历史");
        undo(); check(snapshot() === beforeLoop, "闭环提交撤销一次不能回到提交前");
        // 负对照：旧双历史行为的一次撤销会留下空线路，本组断言必须能看见差异。
        const oldUndo = JSON.parse(beforeNew); oldUndo.lines.push({ id: "negative_empty_line", stations: [] });
        check(JSON.stringify(oldUndo) !== beforeNew && oldUndo.lines.some((l) => l.id === "negative_empty_line" && !l.stations.length),
          "双历史残留空线的负对照失效");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        linkReset(); P = saved.p; sel = saved.sel; hist = saved.hist; future = saved.future;
        dirty = saved.dirty; dirtyOwner = saved.owner;
        setTool(saved.tool); linkMode = saved.mode; linkChain = saved.chain; linkClosed = saved.closed;
        linkDrag = saved.drag; linkSteps = saved.steps; linkSuppressClickUntil = saved.suppress;
        if (saved.pan) map.dragging.enable(); else map.dragging.disable();
        if (saved.drag && saved.drag.pointerId != null) {
          document.addEventListener("pointermove", linkPointerMove, { passive: false });
          document.addEventListener("pointerup", linkPointerUp); document.addEventListener("pointercancel", linkPointerCancel);
          window.addEventListener("blur", linkPointerCancel);
        }
        renderAll(); renderLinkPreview();
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        "新建/并入只存提交前一份快照，撤销重做完整恢复线路及换乘归属；闭合边插站保留两份 remap 弯道及渲染；闭环不重复首站；失败不写；双历史空线和旧闭合边弯道遗失负对照成立" };
    });

    t("连线并入规划：双向端点延长、相邻插段、首尾闭环；拒绝跨站/分叉/多处插入，有旧算法负对照", () => {
      const bad = [];
      const saved = { p: P, sel, tool, mode: linkMode, chain: linkChain.slice(), closed: linkClosed,
        drag: linkDrag, steps: linkSteps.slice(), suppress: linkSuppressClickUntil, hist: hist.slice(), future: future.slice(),
        dirty, owner: dirtyOwner, pan: map.dragging.enabled() };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const continuous = (seq, path, loop) => path.slice(1).every((id, i) => seq.some((a, j) =>
        (a === path[i] && seq[j + 1] === id) || (a === id && seq[j + 1] === path[i]) ||
        (loop && j === seq.length - 1 && ((a === path[i] && seq[0] === id) || (a === id && seq[0] === path[i])))));
      const cases = [
        ["末端延长", ["a", "b", "c"], ["c", "x", "y"], ["a", "b", "c", "x", "y"], false],
        ["反向接末端", ["a", "b", "c"], ["y", "x", "c"], ["a", "b", "c", "x", "y"], false],
        ["首端向外", ["a", "b", "c"], ["a", "x", "y"], ["y", "x", "a", "b", "c"], false],
        ["新站接首端", ["a", "b", "c"], ["x", "y", "a"], ["x", "y", "a", "b", "c"], false],
        ["沿旧路径延长", ["a", "b", "c"], ["b", "c", "x"], ["a", "b", "c", "x"], false],
        ["相邻插段", ["a", "b", "c"], ["a", "x", "y", "b"], ["a", "x", "y", "b", "c"], false],
        ["反向相邻插段", ["a", "b", "c"], ["b", "y", "x", "a"], ["a", "x", "y", "b", "c"], false],
        ["末首插段闭环", ["a", "b", "c"], ["c", "x", "y", "a"], ["a", "b", "c", "x", "y"], true],
        ["反向首尾闭环", ["a", "b", "c"], ["a", "y", "x", "c"], ["a", "b", "c", "x", "y"], true],
        ["已有站直接闭环", ["a", "b", "c"], ["c", "a"], ["a", "b", "c"], true],
        ["环线闭合边插站", ["a", "b", "c"], ["c", "x", "a"], ["a", "b", "c", "x"], true, true],
        ["两站线只插段", ["a", "b"], ["a", "x", "b"], ["a", "x", "b"], false],
        ["连续前缀消除重复锚点", ["a", "b", "c", "b", "d"], ["a", "b", "x", "c"], ["a", "b", "x", "c", "b", "d"], false]
      ];
      const rejects = [
        ["中间站分叉", ["a", "b", "c"], ["b", "x"]],
        ["单锚点两侧分叉", ["a", "b", "c"], ["x", "b", "y"]],
        ["跨过已有站", ["a", "b", "c", "d"], ["a", "x", "c"]],
        ["一次多处插段", ["a", "b", "c"], ["a", "x", "b", "y", "c"]],
        ["不连续旧路径", ["a", "b", "c", "d"], ["a", "c", "d", "x"]],
        ["重复站锚点歧义", ["a", "b", "c", "b", "d"], ["b", "x", "c"]],
        ["没有目标线站", ["a", "b", "c"], ["x", "y"]],
        ["已连接原段", ["a", "b", "c"], ["a", "b"]],
        ["两站闭环不足", ["a", "b"], ["b", "a"]],
        ["环线没有端点", ["a", "b", "c"], ["c", "x"], true]
      ];
      try {
        cases.forEach(([name, old, path, expected, loop, oldLoop]) => {
          const l = { stations: old.slice(), loop: !!oldLoop }, before = JSON.stringify(l), originalPath = JSON.stringify(path);
          const plan = planLinkAppend(l, path);
          if (JSON.stringify(l) !== before || JSON.stringify(path) !== originalPath) bad.push(name + "：纯规划修改了输入");
          if (!plan.ok) { bad.push(name + "：应收却拒绝，" + plan.reason); return; }
          const result = old.slice(); result.splice(plan.at, 0, ...plan.ids);
          if (!same(result, expected) || plan.loop !== loop) bad.push(name + "：结果 " + result.join(",") + "/loop=" + plan.loop);
          if (!continuous(result, path, plan.loop)) bad.push(name + "：并入后丢失点击路径中的相邻边");
        });
        rejects.forEach(([name, old, path, loop]) => {
          const l = { stations: old.slice(), loop: !!loop }, before = JSON.stringify(l), plan = planLinkAppend(l, path);
          if (plan.ok || !plan.reason || JSON.stringify(l) !== before) bad.push(name + "：应拒绝且保留输入");
        });
        // 负对照使用修复前的 indexOf + filter + splice，必须被连续路径断言打红。
        const oldAppend = (old, path) => {
          let at = old.indexOf(path[0]);
          if (at < 0) at = old.indexOf(path[1]) - 1;
          const added = path.slice(path[0] === old[at] ? 1 : 0).filter((id) => !old.includes(id));
          const result = old.slice(); result.splice(at + 1, 0, ...added); return result;
        };
        let caught = 0;
        [["b", "c", "x"], ["x", "b", "y"], ["a", "x", "c"]].forEach((path) => {
          if (!continuous(oldAppend(["a", "b", "c", "d"], path), path, false)) caught++;
        });
        if (caught !== 3) bad.push("旧 filter 算法的三个负对照仅识别了 " + caught + " 个");
      } catch (e) { bad.push("异常：" + e.message); }
      finally {
        linkReset(); P = saved.p; sel = saved.sel; hist = saved.hist; future = saved.future;
        dirty = saved.dirty; dirtyOwner = saved.owner;
        setTool(saved.tool); linkMode = saved.mode; linkChain = saved.chain; linkClosed = saved.closed;
        linkDrag = saved.drag; linkSteps = saved.steps; linkSuppressClickUntil = saved.suppress;
        if (saved.pan) map.dragging.enable(); else map.dragging.disable();
        if (saved.drag && saved.drag.pointerId != null) {
          document.addEventListener("pointermove", linkPointerMove, { passive: false });
          document.addEventListener("pointerup", linkPointerUp); document.addEventListener("pointercancel", linkPointerCancel);
          window.addEventListener("blur", linkPointerCancel);
        }
        renderAll(); renderLinkPreview();
      }
      return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join("；") :
        cases.length + " 组正确站序与路径连续性、" + rejects.length + " 组歧义/无变化拒绝，规划不改输入；旧 indexOf+filter 三个错误路径均被负对照识别" };
    });
// END LINK DRAG TESTS
