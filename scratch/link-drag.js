/* 放站是正式操作；拖线只构造连接草稿，确认后统一提交。 */
let linkChain = [], linkClosed = false, linkMode = "place", linkSteps = [];
let linkLayer = null, linkColor = "#FFB020", linkDrag = null, linkSuppressClickUntil = 0;
function linkReset() {
  linkCancelDrag();
  linkChain = []; linkClosed = false; linkSteps = [];
  if (linkLayer) linkLayer.clearLayers();
  renderLinkBar();
}
function linkHas(id) { return linkChain.includes(id); }
function linkPush(id) {
  if (!station(id) || linkClosed) return false;
  if (linkChain[linkChain.length - 1] === id) return false;
  const before = { chain: linkChain.length < 2 ? [] : linkChain.slice(), closed: linkClosed };
  if (linkHas(id)) {
    if (id === linkChain[0] && linkChain.length >= 3) linkClosed = true;
    else { toast("该站已在连接中；从两端继续拖线，或撤一步", "bad"); return false; }
  } else linkChain.push(id);
  if (linkChain.length >= 2) linkSteps.push(before);
  renderLinkBar(); renderLinkPreview();
  return true;
}
function linkSetMode(mode) {
  if (mode !== "place" && mode !== "connect") return;
  linkCancelDrag(); linkMode = mode;
  renderAll();
}
function linkAddPoint(latlng) {
  if (performance.now() < linkSuppressClickUntil) return false;
  if (linkMode !== "place") {
    toast("从车站圆点按住拖到另一站；需要新站时切到「布置车站」");
    return false;
  }
  const near = findNearStation(latlng, null, true);
  if (near) { selectStation(near.id); return false; }
  pushHistory();
  const id = uid("s_");
  P.stations[id] = { id, name: "车站 " + (Object.keys(P.stations).length + 1),
    lat: latlng.lat, lng: latlng.lng, lines: [], note: "", placed: true };
  sel.station = id;
  renderAll(); markDirty();
  return id;
}
/* 明确拖向车站的吸附不受「加站时自动合并」设置影响，隐藏线路上的站不命中。 */
function linkFindTarget(latlng, excludeId) {
  if (!latlng) return null;
  const p = map.latLngToContainerPoint(latlng);
  let best = null, distance = Math.max(18, settings.mergePx || 24);
  Object.values(P.stations).forEach((st) => {
    if (st.id === excludeId || (st.lines.length && !st.lines.some((id) => { const l = line(id); return l && l.visible; }))) return;
    const q = map.latLngToContainerPoint([st.lat, st.lng]);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < distance) { distance = d; best = st; }
  });
  return best;
}
function linkBeginDrag(id, latlng) {
  if (tool !== "link" || linkMode !== "connect" || !station(id)) return false;
  if (linkClosed) { toast("连接已闭合，请确认或撤一步后继续"); return false; }
  if (linkChain.length && id !== linkChain[0] && id !== linkChain[linkChain.length - 1]) {
    toast("请从连接的首站或末站继续拖线；支线可另建线路", "bad"); return false;
  }
  linkCancelDrag();
  linkDrag = { from: id, latlng: latlng || L.latLng(station(id).lat, station(id).lng),
    target: null, pan: map.dragging.enabled() };
  map.dragging.disable();
  renderLinkPreview();
  return true;
}
function linkMoveDrag(latlng) {
  if (!linkDrag) return;
  linkDrag.latlng = latlng;
  const st = linkFindTarget(latlng, linkDrag.from);
  linkDrag.target = st ? st.id : null;
  renderLinkPreview();
}
function linkCancelDrag() {
  document.removeEventListener("pointermove", linkPointerMove);
  document.removeEventListener("pointerup", linkPointerUp);
  document.removeEventListener("pointercancel", linkPointerCancel);
  window.removeEventListener("blur", linkPointerCancel);
  const drag = linkDrag;
  linkDrag = null;
  if (drag && drag.pan) map.dragging.enable();
}
function linkEndDrag(latlng) {
  if (!linkDrag) return false;
  const from = linkDrag.from, target = linkFindTarget(latlng, from);
  const before = { chain: linkChain.slice(), closed: linkClosed };
  linkCancelDrag();
  let ok = false;
  if (target) {
    if (!linkChain.length) { linkChain = [from, target.id]; ok = true; }
    else {
      const atHead = from === linkChain[0], other = atHead ? linkChain[linkChain.length - 1] : linkChain[0];
      if (linkHas(target.id)) {
        if (target.id === other && linkChain.length >= 3) { linkClosed = true; ok = true; }
        else toast("这条连接已包含该站；闭合环线至少需要三个站", "bad");
      } else if (atHead) { linkChain.unshift(target.id); ok = true; }
      else { linkChain.push(target.id); ok = true; }
    }
  } else toast("松开时没有接到车站，本次拖线已取消");
  if (ok) linkSteps.push(before);
  linkSuppressClickUntil = performance.now() + 300;
  renderLinkBar(); renderLinkPreview();
  return ok;
}
function linkPointerMove(e) {
  if (!linkDrag || (linkDrag.pointerId != null && linkDrag.pointerId !== e.pointerId)) return;
  e.preventDefault();
  linkMoveDrag(map.mouseEventToLatLng(e));
}
function linkPointerUp(e) {
  if (!linkDrag || (linkDrag.pointerId != null && linkDrag.pointerId !== e.pointerId)) return;
  e.preventDefault(); e.stopPropagation();
  const r = map.getContainer().getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  linkEndDrag(inside ? map.mouseEventToLatLng(e) : null);
}
function linkPointerCancel() { linkCancelDrag(); renderLinkPreview(); }
function bindLinkPointer(mk, id) {
  if (!mk._icon) return;
  mk._icon.addEventListener("pointerdown", (e) => {
    if (tool !== "link" || linkMode !== "connect" || (e.button != null && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    if (!linkBeginDrag(id, map.mouseEventToLatLng(e))) return;
    linkDrag.pointerId = e.pointerId;
    document.addEventListener("pointermove", linkPointerMove, { passive: false });
    document.addEventListener("pointerup", linkPointerUp);
    document.addEventListener("pointercancel", linkPointerCancel);
    window.addEventListener("blur", linkPointerCancel);
  });
}
function linkUndoStep() {
  if (linkDrag) { linkCancelDrag(); renderLinkBar(); renderLinkPreview(); return; }
  const before = linkSteps.pop();
  if (before) { linkChain = before.chain; linkClosed = before.closed; }
  else { linkChain = []; linkClosed = false; }
  renderLinkBar(); renderLinkPreview();
}
function linkValidChain() {
  return linkChain.length >= 2 && linkChain.every((id) => !!station(id));
}
function linkAppendPlan() {
  if (!activeLine()) return { ok: false, reason: "先选择一条线路，或使用「新建线路」" };
  if (!linkValidChain()) return { ok: false, reason: "先拖线连接至少两个车站" };
  return planLinkAppend(activeLine(), linkClosed ? linkChain.concat(linkChain[0]) : linkChain);
}
function linkCommitAppend() {
  const l = activeLine(), plan = linkAppendPlan();
  if (!plan.ok) { toast(plan.reason, "bad"); return false; }
  pushHistory();
  if (plan.ids.length) spliceIntoLine(l, plan.at, plan.ids);
  l.loop = plan.loop;
  plan.ids.forEach((id) => { const st = station(id); if (!st.lines.includes(l.id)) st.lines.push(l.id); });
  sel.line = l.id; sel.station = null;
  linkReset(); renderAll(); markDirty();
  toast("已并入 " + l.name + "，共 " + l.stations.length + " 站", "good");
  return true;
}
function linkCommitNewLine() {
  if (!linkValidChain()) { toast("先拖线连接至少两个车站", "bad"); return false; }
  /* addLine 已记录提交前快照；这里不重复记历史。 */
  const l = addLine(false);
  l.stations = linkChain.slice(); l.loop = linkClosed;
  linkChain.forEach((id) => { const st = station(id); if (!st.lines.includes(l.id)) st.lines.push(l.id); });
  sel.line = l.id; sel.station = null;
  linkReset(); renderAll(); markDirty();
  toast("新建 " + l.name + "：" + l.stations.length + " 站" + (l.loop ? " · 环线" : ""), "good");
  return true;
}
function renderLinkPreview() {
  if (!map) return;
  if (!linkLayer) linkLayer = L.layerGroup().addTo(map);
  linkLayer.clearLayers();
  if (tool !== "link") return;
  const pts = linkChain.map((id) => station(id)).filter(Boolean).map((st) => [st.lat, st.lng]);
  if (linkClosed && pts.length >= 3) pts.push(pts[0]);
  if (pts.length >= 2) L.polyline(pts, { color: linkColor, weight: 4, opacity: .85, dashArray: "7 6", interactive: false }).addTo(linkLayer);
  const highlighted = new Set(linkChain);
  if (linkDrag) {
    const st = station(linkDrag.from), target = station(linkDrag.target);
    if (st) {
      const ll = target ? [target.lat, target.lng] : linkDrag.latlng;
      L.polyline([[st.lat, st.lng], ll], { color: target ? "#58D7A0" : linkColor, weight: 4, dashArray: "7 6", interactive: false }).addTo(linkLayer);
      highlighted.add(st.id);
    }
    if (target) highlighted.add(target.id);
  }
  highlighted.forEach((id) => {
    const st = station(id); if (!st) return;
    L.circleMarker([st.lat, st.lng], { radius: 12, color: linkDrag && linkDrag.target === id ? "#58D7A0" : linkColor,
      weight: 2, fillOpacity: 0, interactive: false }).addTo(linkLayer);
  });
}
function renderLinkBar() {
  let host = document.getElementById("linkCard");
  if (tool !== "link") { if (host) host.innerHTML = ""; return; }
  if (!host) { host = document.createElement("div"); host.id = "linkCard"; document.body.appendChild(host); }
  const names = linkChain.map((id, i) => (i + 1) + ". " + ((station(id) || {}).name || "?")).join(" → ") + (linkClosed ? " → 首站（闭环）" : "");
  const hint = linkMode === "place" ? "点击空白处放站；拖动圆点调整位置，再切到拖线连接" : "按住车站圆点，拖到另一站松开；从两端继续，拖回另一端闭环";
  const l = activeLine(), plan = linkAppendPlan(), ready = linkValidChain();
  host.innerHTML = '<div class="lk-in"><div class="lk-steps">' +
    '<button class="tool' + (linkMode === "place" ? ' is-on' : '') + '" id="lkPlace">① 布置车站</button>' +
    '<button class="tool' + (linkMode === "connect" ? ' is-on' : '') + '" id="lkConnect">② 拖线连接</button></div>' +
    '<span class="lk-chain" title="' + esc(names || hint) + '">' + esc(names || hint) + '</span>' +
    '<span class="lk-btns"><button class="tool" id="lkGo"' + (plan.ok ? '' : ' disabled') +
    ' title="' + esc(plan.ok ? '按当前连接并入所选线路' : plan.reason) + '">并入 ' + esc(l ? l.badge || l.name : '当前线路') + '</button>' +
    '<button class="tool" id="lkNew"' + (ready ? '' : ' disabled') + '>新建线路</button>' +
    '<button class="tool" id="lkUndo"' + (linkChain.length ? '' : ' disabled') + '>撤一步</button>' +
    '<button class="tool danger" id="lkCancel"' + (linkChain.length ? '' : ' disabled') + '>取消连接</button></span>' +
    (ready && !plan.ok ? '<small class="lk-reason">' + esc(plan.reason) + '</small>' : '') + '</div>';
  $("#lkPlace", host).onclick = () => linkSetMode("place");
  $("#lkConnect", host).onclick = () => linkSetMode("connect");
  $("#lkGo", host).onclick = linkCommitAppend;
  $("#lkNew", host).onclick = linkCommitNewLine;
  $("#lkUndo", host).onclick = linkUndoStep;
  $("#lkCancel", host).onclick = () => { linkReset(); renderStatus(); toast("已取消连接，布置好的车站已保留"); };
  if (P) { renderStatus(); updateHistoryButtons(); }
}
