// BEGIN NAV PLAYBACK
/* Simulation time is deliberately separate from geography and map zoom. */
function createNavPlayback(plan, durations) {
  const finished = !plan.legs.length;
  return { plan, durations: plan.legs.map((_, i) => Math.max(.05, Number(durations[i]) || 3)),
    status: finished ? "finished" : "running", phase: "stop", index: 0, elapsed: 0,
    arrivals: [{ station: plan.from, final: finished }], transfers: [] };
}
function navStopDuration(state) {
  const i = state.index, legs = state.plan.legs;
  return i > 0 && legs[i - 1].lineId !== legs[i].lineId ? 2.6 : .9;
}
function advanceNavPlayback(state, dt, stopAtEvent = false) {
  const events = [];
  if (state.status !== "running" || !Number.isFinite(dt) || dt <= 0) return events;
  while (dt > 0 && state.status === "running") {
    const duration = state.phase === "stop" ? navStopDuration(state) : state.durations[state.index];
    const remaining = Math.max(0, duration - state.elapsed), take = Math.min(dt, remaining);
    state.elapsed += take; dt -= take;
    if (state.elapsed + 1e-9 < duration) break;
    state.elapsed = 0;
    if (state.phase === "stop") {
      const i = state.index, legs = state.plan.legs;
      if (i > 0 && legs[i - 1].lineId !== legs[i].lineId) {
        const event = { type: "transfer", station: legs[i].from, lineId: legs[i].lineId };
        state.transfers.push(event); events.push(event);
      }
      state.phase = "ride";
      events.push({ type: "next", station: legs[i].to, lineId: legs[i].lineId, index: i });
    } else {
      const leg = state.plan.legs[state.index], final = state.index === state.plan.legs.length - 1;
      const event = { type: "arrival", station: leg.to, lineId: leg.lineId, final, index: state.index };
      state.arrivals.push(event); events.push(event);
      if (final) { state.status = "finished"; state.phase = "stop"; }
      else { state.index++; state.phase = "stop"; }
    }
    // Expose each departure/arrival boundary so the UI can replace announcements.
    if (stopAtEvent && events.length) break;
  }
  return events;
}
function navRideFraction(fraction) {
  const t = Math.max(0, Math.min(1, Number(fraction) || 0)), a = .24;
  // Integrate a trapezoidal velocity profile: accelerate, cruise, then brake.
  if (t < a) return t * t / (2 * a * (1 - a));
  if (t > 1 - a) return 1 - (1 - t) * (1 - t) / (2 * a * (1 - a));
  return (t - a / 2) / (1 - a);
}
function navPointAt(pts, fraction) {
  if (!pts || !pts.length) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  const lengths = [], f = Math.max(0, Math.min(1, fraction));
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); lengths.push(d); total += d; }
  let target = f * total;
  for (let i = 1; i < pts.length; i++) {
    const d = lengths[i - 1];
    if (target <= d || i === pts.length - 1) {
      const a = pts[i - 1], b = pts[i], u = d ? Math.min(1, target / d) : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
    }
    target -= d;
  }
  return null;
}
function navLegPoints(legs, index, geometries) {
  const leg = legs[index], segments = geometries[leg.lineId] || [], segment = segments[leg.segmentIndex];
  if (!segment || !segment.pts.length) return [];
  const pts = segment.pts.map((p) => ({ x: p.x, y: p.y }));
  if (leg.direction === -1) pts.reverse();
  const prev = legs[index - 1];
  /* joinSegs draws a connector between consecutive offset segments, but no
     connector between different lines or across the unjoined ring seam. */
  if (prev && prev.lineId === leg.lineId && prev.direction === leg.direction &&
      prev.toIndex === leg.fromIndex && Math.abs(prev.segmentIndex - leg.segmentIndex) === 1) {
    const ps = segments[prev.segmentIndex];
    if (ps && ps.pts.length) {
      const end = ps.pts[prev.direction === -1 ? 0 : ps.pts.length - 1];
      if (end.x !== pts[0].x || end.y !== pts[0].y) pts.unshift({ x: end.x, y: end.y });
    }
  }
  return pts;
}
// END NAV PLAYBACK

// BEGIN NAV UI
// BEGIN NAV ANNOUNCEMENTS
function navEnglishName(item, pinyin, isLine = false) {
  if (item.nameEn && item.nameEn.trim()) return item.nameEn.trim();
  const name = String(item.name || "");
  if (isLine) {
    const number = name.match(/^(?:地铁\s*)?(\d+)\s*号线$/);
    if (number) return "Line " + Number(number[1]);
  }
  return /[\u3400-\u9fff]/.test(name) && pinyin ? pinyin(name) : name;
}
function navInterchangeLines(project, stationId, currentLineId) {
  const seen = new Set();
  return project.lines.filter((l) => {
    if (l.id === currentLineId || seen.has(l.id) || l.visible === false || l.style === "dash") return false;
    const ids = l.stations || [];
    const served = ids.some((id, i) => id === stationId &&
      [ids[i - 1], ids[i + 1], l.loop && i === 0 && ids[ids.length - 1], l.loop && i === ids.length - 1 && ids[0]]
        .some((next) => next && next !== id && project.stations[next]));
    if (served) seen.add(l.id);
    return served;
  });
}
function navAnnouncement(project, event, plan, pinyin) {
  if (event.type !== "next" && event.type !== "arrival") return null;
  const s = project.stations[event.station];
  if (!s) return null;
  const l = project.lines.find((entry) => entry.id === event.lineId), leg = plan.legs[event.index];
  const terminus = !!(l && leg && !l.loop && leg.to === event.station &&
    ((leg.direction === 1 && leg.toIndex === l.stations.length - 1) || (leg.direction === -1 && leg.toIndex === 0)));
  const transfers = navInterchangeLines(project, s.id, event.lineId);
  const englishList = (names) => names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  const zhTransfer = transfers.length ? (s.outTransfer ? "可出站换乘" : "可换乘") + transfers.map((entry) => entry.name).join("、") + "。" : "";
  const enTransfer = transfers.length ? " You can transfer to " + englishList(transfers.map((entry) => navEnglishName(entry, pinyin, true))) +
    (s.outTransfer ? ". Please exit the station to transfer." : ".") : "";
  const enName = navEnglishName(s, pinyin);
  const zh = event.type === "next" ? "下一站，" + s.name + (terminus ? "，本次列车的终点站。" : "。") + zhTransfer :
    (terminus ? "终点站，" : "") + s.name + "到了。" + zhTransfer +
      (terminus ? "请所有乘客下车，感谢您乘坐本次列车。" : "下车的乘客，请带齐随身物品。");
  const en = event.type === "next" ? "The next station is " + enName + (terminus ? ", the terminus of this train." : ".") + enTransfer :
    "We are now at " + enName + "." + (terminus ? " This is the terminus. All passengers, please leave the train. Thank you for travelling with us." :
      " Please remember to take all your belongings when leaving the train.") + enTransfer;
  return { zh, en, terminus, parts: [{ text: zh, lang: "zh-CN" }, { text: en, lang: "en-US" }] };
}
function navSelectVoice(voices, lang) {
  const base = lang.split("-")[0].toLowerCase();
  return voices.filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === base)
    .sort((a, b) => Number(b.lang.toLowerCase() === lang.toLowerCase()) - Number(a.lang.toLowerCase() === lang.toLowerCase()) ||
      Number(!!b.localService) - Number(!!a.localService))[0] || null;
}
/* Keep exactly one station's bilingual message. The adapter allows the actual
   cancellation and delayed native callbacks to be tested without making sound. */
function createNavSpeaker(adapter, onComplete) {
  let parts = [], index = 0, token = 0, active = false, paused = false, timer = null;
  const untimer = () => { if (timer !== null) adapter.unlater(timer); timer = null; };
  const cancel = () => { token++; untimer(); if (active) { try { adapter.cancel(); } catch (_) {} } active = false; };
  const play = () => {
    if (paused || index >= parts.length) return;
    const part = parts[index], ownToken = ++token;
    active = true;
    const finish = (timeout) => {
      if (ownToken !== token || paused) return;
      token++; untimer();
      if (timeout) { try { adapter.cancel(); } catch (_) {} }
      active = false; index++;
      if (index < parts.length) play();
      else { parts = []; index = 0; onComplete(); }
    };
    timer = adapter.later(() => finish(true), Math.min(90000, 15000 + part.text.length * 180));
    try { adapter.speak(part, () => finish(false)); } catch (_) { finish(false); }
  };
  return {
    get busy() { return parts.length > 0; },
    get paused() { return paused; },
    speak(message) { cancel(); parts = message.map((part) => ({ ...part })); index = 0; paused = false; play(); },
    pause() { paused = true; cancel(); },
    resume() { if (!paused) return; paused = false; play(); },
    clear() { cancel(); parts = []; index = 0; paused = false; }
  };
}
// END NAV ANNOUNCEMENTS
let nav = null;
let navProgrammaticView = false;
function navGeometry(plan) {
  const groups = buildCorridorGroups(), geometries = {};
  plan.legs.forEach((leg) => {
    if (geometries[leg.lineId]) return;
    const l = line(leg.lineId);
    if (l) geometries[l.id] = offsetSegs(lineShapePx(l).segs, groups, l.id);
  });
  return plan.legs.map((_, i) => navLegPoints(plan.legs, i, geometries));
}
function navClearLayers() {
  if (!nav) return;
  if (nav.layer) nav.layer.remove();
  nav.layer = null; nav.marker = null;
}
function navCancelFrame() { if (nav && nav.raf) { cancelAnimationFrame(nav.raf); nav.raf = 0; } }
function navSilence(keep = false) {
  if (!nav) return;
  if (nav.speaker) { if (keep) nav.speaker.pause(); else nav.speaker.clear(); }
  if (!keep) nav.userSpeechPaused = false;
  nav.speaking = false; nav.lastTime = null;
}
function navResumeSpeech() {
  if (!nav || !nav.speaker || !nav.speaker.busy || nav.userSpeechPaused || document.hidden || nav.playback.status === "paused") return;
  nav.speaking = true; nav.speaker.resume();
}
function navWaitsForAnnouncement() {
  return !!(nav && nav.speaker && nav.speaker.busy && nav.announcement && nav.announcement.type === "arrival");
}
function navSpeechComplete(owner) {
  if (nav !== owner) return;
  nav.speaking = false;
  if (nav.announcement && nav.announcement.type === "arrival") nav.lastTime = null;
  navRenderState(); navScheduleFrame();
}
function navClose() {
  if (!nav) return;
  navCancelFrame(); navSilence(); navClearLayers(); nav = null;
  const card = $("#navCard"); if (card) { card.hidden = true; card.innerHTML = ""; }
  $("#tNavigate").classList.remove("is-on");
}
function navSuspend() {
  if (!nav) return null;
  ["navFrom", "navTo"].forEach((id) => navHideSearch($("#" + id)));
  navCancelFrame(); navSilence(true); navClearLayers();
  const saved = nav;
  saved.content = document.createDocumentFragment();
  const card = $("#navCard"); while (card.firstChild) saved.content.appendChild(card.firstChild);
  nav = null; $("#navCard").hidden = true; $("#tNavigate").classList.remove("is-on");
  return saved;
}
function navRestore(saved) {
  navClose(); if (!saved) return;
  nav = saved; nav.lastTime = null; nav.raf = 0; nav.speaking = false;
  $("#navCard").appendChild(saved.content); delete saved.content;
  $("#navCard").hidden = false; $("#tNavigate").classList.add("is-on");
  navRefreshGeometry(); navRenderState(); navDrawCursor(true); navResumeSpeech(); navScheduleFrame();
}
function navStationOptions() {
  const ids = new Set();
  P.lines.forEach((l) => {
    if (!l.visible || l.style === "dash" || l.stations.length < 2) return;
    l.stations.forEach((id) => { if (station(id)) ids.add(id); });
  });
  return Array.from(ids).map(station).sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
}
function navSearchMatches(query, choices) {
  const parts = String(query || "").trim().toLocaleLowerCase().split(/\s+/).filter((s) => s && s !== "·");
  return choices.filter((choice) => parts.every((part) => choice.search.toLocaleLowerCase().includes(part)));
}
function navHideSearch(input) {
  if (!input) return;
  const results = $("#" + input.id + "Results");
  if (results) results.hidden = true;
  input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
}
function navSearchActivate(input, index) {
  const buttons = Array.from($("#" + input.id + "Results").querySelectorAll('[role="option"]'));
  if (!buttons.length) { input.removeAttribute("aria-activedescendant"); return; }
  const at = (index + buttons.length) % buttons.length;
  buttons.forEach((button, i) => button.setAttribute("aria-selected", String(i === at)));
  input.setAttribute("aria-activedescendant", buttons[at].id);
  buttons[at].scrollIntoView({ block: "nearest" });
}
function navSearchRender(input) {
  if (!nav || !input) return;
  const matches = navSearchMatches(input.value, nav.choices), results = $("#" + input.id + "Results");
  results.innerHTML = matches.length ? matches.slice(0, 60).map((choice, i) =>
    '<button type="button" class="nav-result" role="option" tabindex="-1" aria-selected="false" id="' + input.id + 'Option' + i +
    '" data-station="' + esc(choice.id) + '"><b>' + esc(choice.name) + '</b><small>' + esc(choice.detail) + '</small></button>').join("") +
    (matches.length > 60 ? '<div class="nav-search-note">还有 ' + (matches.length - 60) + ' 个匹配，请继续输入站名。</div>' : "") :
    '<div class="nav-search-note" role="status">没有匹配的运营站点</div>';
  results.hidden = false; input.setAttribute("aria-expanded", "true"); navSearchActivate(input, 0);
}
function navChooseStation(fieldId, stationId, replan = true) {
  if (!nav) return;
  const input = $("#" + fieldId), choice = nav.choices.find((c) => c.id === stationId);
  input.value = choice ? choice.label : ""; input.dataset.stationId = choice ? choice.id : "";
  navHideSearch(input);
  if (replan) navReplan();
}
function navBindSearch(fieldId) {
  const input = $("#" + fieldId), results = $("#" + fieldId + "Results");
  let composing = false;
  input.addEventListener("focus", () => { input.select(); navSearchRender(input); });
  input.addEventListener("input", () => {
    input.dataset.stationId = ""; navReplan();
    if (!composing) navSearchRender(input);
  });
  input.addEventListener("compositionstart", () => { composing = true; navHideSearch(input); });
  input.addEventListener("compositionend", () => { composing = false; navSearchRender(input); });
  input.addEventListener("blur", () => navHideSearch(input));
  input.addEventListener("keydown", (e) => {
    if (composing || e.isComposing || e.keyCode === 229) { if (e.key === "Escape") e.stopPropagation(); return; }
    if (e.key === "Escape" && !results.hidden) { e.preventDefault(); e.stopPropagation(); navHideSearch(input); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    if (results.hidden && e.key === "Enter") return;
    e.preventDefault(); e.stopPropagation();
    if (results.hidden) { navSearchRender(input); if (e.key === "ArrowUp") navSearchActivate(input, -1); return; }
    const buttons = Array.from(results.querySelectorAll('[role="option"]'));
    const at = buttons.findIndex((b) => b.id === input.getAttribute("aria-activedescendant"));
    if (e.key === "Enter") { if (buttons[at]) navChooseStation(fieldId, buttons[at].dataset.station); }
    else navSearchActivate(input, at + (e.key === "ArrowDown" ? 1 : -1));
  });
  results.addEventListener("pointerdown", (e) => e.preventDefault());
  results.addEventListener("click", (e) => {
    const button = e.target.closest('[data-station]');
    if (button) navChooseStation(fieldId, button.dataset.station);
  });
}
function openNavigation() {
  if (nav) { $("#navFrom").focus(); return; }
  commitViewNow(); setTool("select");
  const stations = navStationOptions(), active = activeLine();
  const first = stations.find((s) => s.id === sel.station) || stations.find((s) => active && s.id === active.stations[0]) || stations[0];
  const lastId = active && active.stations[active.stations.length - 1];
  const last = stations.find((s) => s.id === lastId && s.id !== (first && first.id)) || stations.find((s) => s.id !== (first && first.id));
  nav = { projectId: P.id, from: first ? first.id : "", to: last ? last.id : "",
    preference: "transfers", speed: 1, speechRate: 1, follow: true, voice: false, plan: null, playback: null, raf: 0, lastTime: null, layer: null, marker: null, speaking: false };
  const nameCounts = new Map(); stations.forEach((s) => nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1));
  nav.choices = stations.map((s) => {
    const lines = stationLines(s).filter((l) => l.style !== "dash");
    const badges = lines.map((l) => l.badge || l.name).join(" / "), detail = lines.map((l) => l.name).join(" / ");
    const sameName = nameCounts.get(s.name) > 1;
    return { id: s.id, name: s.name, label: s.name + (sameName ? " · " + badges : ""), detail,
      search: s.name + " " + badges + " " + detail };
  });
  const field = (id) => '<div class="nav-picker"><input id="' + id + '" type="search" role="combobox" placeholder="输入站名搜索" autocomplete="off"' +
    ' aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + 'Results"><div id="' + id + 'Results" class="nav-results" role="listbox" aria-label="匹配车站" hidden></div></div>';
  const card = $("#navCard");
  card.innerHTML = '<div class="nav-head"><b>模拟导航</b><button id="navClose" class="x" title="关闭导航（Esc）" aria-label="关闭导航">✕</button></div>' +
    '<div class="nav-fields"><label for="navFrom">出发站</label>' + field("navFrom") +
    '<button class="tool" id="navSwap" title="交换起点和终点" aria-label="交换起点和终点">⇄</button>' +
    '<label for="navTo">到达站</label>' + field("navTo") + '</div>' +
    '<div class="nav-options"><label>路线 <select id="navPreference"><option value="transfers">少换乘</option><option value="stops">少坐站</option></select></label>' +
    '<label>车速 <select id="navSpeed"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>' +
    '<label>报站语速 <select id="navSpeechRate" aria-label="报站语速" title="中英文共用语速，调整从下一段播报生效"><option value=".75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div>' +
    '<div id="navSummary" class="nav-summary"></div><div id="navItinerary" class="nav-itinerary"></div>' +
    '<div id="navLive" class="nav-live" role="status" aria-live="polite"></div><progress id="navProgress" max="1" value="0" aria-label="乘车进度"></progress>' +
    '<div id="navAnnouncement" class="nav-announcement" hidden><div id="navAnnouncementZh"></div><div id="navAnnouncementEn" lang="en"></div></div>' +
    '<div class="nav-controls"><button class="btn btn--go" id="navStart">开始模拟</button><button class="btn" id="navPause" disabled>暂停</button><button class="btn" id="navRestart" disabled>重来</button></div>' +
    '<div class="nav-toggles"><label><input type="checkbox" id="navFollow" checked>跟随列车</label><label><input type="checkbox" id="navVoice">中英报站</label></div>' +
    '<small class="nav-note">行驶时播下一站，到站切换报站；到站中英播完后发车。</small>';
  card.hidden = false; $("#tNavigate").classList.add("is-on");
  navChooseStation("navFrom", nav.from, false); navChooseStation("navTo", nav.to, false);
  $("#navClose").addEventListener("click", navClose);
  navBindSearch("navFrom"); navBindSearch("navTo");
  $("#navPreference").addEventListener("change", navReplan);
  $("#navSwap").addEventListener("click", () => {
    const a = $("#navFrom"), b = $("#navTo");
    const text = a.value, id = a.dataset.stationId;
    a.value = b.value; a.dataset.stationId = b.dataset.stationId; b.value = text; b.dataset.stationId = id;
    navHideSearch(a); navHideSearch(b); navReplan();
  });
  $("#navSpeed").addEventListener("change", () => { navAdvanceClock(performance.now()); if (nav) nav.speed = Number($("#navSpeed").value); });
  $("#navSpeechRate").addEventListener("change", () => { nav.speechRate = Number($("#navSpeechRate").value) || 1; });
  $("#navFollow").addEventListener("change", () => { nav.follow = $("#navFollow").checked; if (nav.follow) navDrawCursor(true); });
  $("#navVoice").addEventListener("change", () => {
    nav.voice = $("#navVoice").checked;
    if (!nav.voice) { navSilence(); navScheduleFrame(); }
    else if (nav.announcement) { navAnnounce(nav.announcement); if (nav.playback.status === "paused") navSilence(true); }
    navRenderState();
  });
  $("#navStart").addEventListener("click", navStart);
  $("#navRestart").addEventListener("click", navStart);
  $("#navPause").addEventListener("click", navTogglePause);
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { $("#navVoice").disabled = true; $("#navSpeechRate").disabled = true; $("#navVoice").parentElement.title = "此浏览器不支持语音报站，文字提示仍可使用"; }
  navReplan();
}
function navReplan() {
  if (!nav) return;
  navCancelFrame(); navSilence(); navClearLayers(); nav.playback = null; nav.lastTime = null; nav.announcement = null;
  $("#navAnnouncement").hidden = true;
  const selected = (id) => { const input = $("#" + id), choice = nav.choices.find((c) => c.id === input.dataset.stationId); return choice && choice.label === input.value ? choice.id : ""; };
  nav.from = selected("navFrom"); nav.to = selected("navTo"); nav.preference = $("#navPreference").value;
  nav.plan = nav.from && nav.to ? planRide(P, nav.from, nav.to, nav.preference) : null;
  const plan = nav.plan;
  $("#navSummary").textContent = plan ? (plan.ok ? (plan.stops ? plan.stops + " 站 · " + plan.transfers + " 次换乘" : plan.reason) : plan.reason) :
    (nav.choices.length < 2 ? "先连接至少两个站，并设为可见的运营线路。" : "搜索站名并从候选中选择出发站和到达站。");
  const trips = [];
  if (plan && plan.ok) plan.legs.forEach((leg) => {
    const last = trips[trips.length - 1];
    if (last && last.lineId === leg.lineId) { last.to = leg.to; last.count++; }
    else trips.push({ lineId: leg.lineId, from: leg.from, to: leg.to, count: 1 });
  });
  $("#navItinerary").innerHTML = trips.map((trip, i) => {
    const l = line(trip.lineId);
    return '<div class="nav-trip"><i style="background:' + esc(l.color) + '"></i><span><b>' + esc(l.name) + '</b> · ' + trip.count + ' 站<br>' +
      esc((i ? "换乘 · " : "上车 · ") + station(trip.from).name + " → " + station(trip.to).name) + '</span></div>';
  }).join("");
  navRefreshGeometry(); navRenderState();
}
function navRefreshGeometry() {
  if (!nav || !nav.plan || !nav.plan.ok || !nav.plan.legs.length || nav.projectId !== P.id) return;
  const paths = navGeometry(nav.plan);
  if (paths.some((pts) => pts.length < 2)) { navClose(); return; }
  nav.geoZoom = map.getZoom();
  nav.points = paths.map((pts) => pts.map((p) => map.project(map.containerPointToLatLng(p), nav.geoZoom)));
  const ll = nav.points.map((pts) => pts.map((p) => map.unproject(p, nav.geoZoom)));
  navClearLayers(); nav.layer = L.layerGroup().addTo(map);
  ll.forEach((pts) => L.polyline(pts, { color: "#FFCB70", weight: 13, opacity: .3, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(nav.layer));
  if (nav.playback) navDrawCursor(false);
}
function navStart() {
  if (!nav || !nav.plan || !nav.plan.ok) return;
  commitViewNow(); navCancelFrame(); navSilence();
  const durations = nav.plan.legs.map((leg) => {
    const a = station(leg.from), b = station(leg.to);
    return clamp(map.distance([a.lat, a.lng], [b.lat, b.lng]) / 700, 2, 7);
  });
  nav.playback = createNavPlayback(nav.plan, durations); nav.lastTime = null; nav.announcement = null;
  $("#navAnnouncement").hidden = true;
  navRefreshGeometry();
  if (!nav) return;
  navRenderState(); navDrawCursor(true); navScheduleFrame();
}
function navTogglePause() {
  if (!nav || !nav.playback) return;
  navAdvanceClock(performance.now());
  if (nav.playback.status === "finished") {
    if (nav.speaker && nav.speaker.busy) {
      if (nav.speaker.paused) { nav.userSpeechPaused = false; navResumeSpeech(); }
      else { nav.userSpeechPaused = true; navSilence(true); }
    }
    navRenderState(); return;
  }
  if (nav.playback.status === "running") { nav.playback.status = "paused"; navCancelFrame(); navSilence(true); }
  else if (nav.playback.status === "paused") { nav.playback.status = "running"; nav.lastTime = null; navResumeSpeech(); navScheduleFrame(); }
  navRenderState();
}
function navAdvanceClock(now) {
  if (!nav || !nav.playback || nav.playback.status !== "running") return;
  if (navWaitsForAnnouncement()) { nav.lastTime = null; return; }
  const dt = nav.lastTime === null ? 0 : Math.max(0, (now - nav.lastTime) / 1000) * nav.speed;
  nav.lastTime = now;
  const voiceEnabled = nav.voice && !inSelfTest && !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;
  const events = advanceNavPlayback(nav.playback, dt, voiceEnabled);
  events.forEach(navAnnounce);
  navDrawCursor(true);
  if (events.length || nav.lastPhase !== nav.playback.phase) { nav.lastPhase = nav.playback.phase; navRenderState(); }
  else navUpdateProgress();
}
function navScheduleFrame() {
  if (!nav || !nav.playback || nav.playback.status !== "running" || nav.raf || document.hidden || navWaitsForAnnouncement()) return;
  nav.raf = requestAnimationFrame((now) => { if (!nav) return; nav.raf = 0; navAdvanceClock(now); navScheduleFrame(); });
}
function navDrawCursor(follow) {
  if (!nav || !nav.playback || !nav.points || !nav.points.length) return;
  const state = nav.playback, index = state.index;
  const f = state.status === "finished" ? 1 : state.phase === "ride" ? navRideFraction(state.elapsed / state.durations[index]) : 0;
  const p = navPointAt(nav.points[index], f), ll = map.unproject(p, nav.geoZoom);
  if (!nav.marker) nav.marker = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000,
    icon: L.divIcon({ className: "nav-train-wrap", html: '<div class="nav-train" role="img" aria-label="模拟列车">➤</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(nav.layer);
  else nav.marker.setLatLng(ll);
  const el = nav.marker.getElement();
  if (el) el.firstElementChild.style.transform = "rotate(" + p.angle + "deg)";
  if (follow && nav.follow && !inSelfTest) navFollowPoint(ll);
}
function navFollowPoint(ll) {
  const size = map.getSize(), point = map.latLngToContainerPoint(ll);
  const card = $("#navCard"), clearHeight = Math.max(60, size.y - card.offsetHeight - 32);
  const targetY = Math.max(35, clearHeight * .5);
  if (point.x > size.x * .2 && point.x < size.x * .8 && point.y > 30 && point.y < clearHeight - 10) return;
  navProgrammaticView = true; userViewAt = -Infinity;
  try { map.panBy([point.x - size.x * .5, point.y - targetY], { animate: false }); } finally { navProgrammaticView = false; }
}
function navUpdateProgress() {
  if (!nav || !nav.playback) { $("#navProgress").value = 0; return; }
  const s = nav.playback;
  $("#navProgress").value = s.status === "finished" ? 1 : (s.index + (s.phase === "ride" ? navRideFraction(s.elapsed / s.durations[s.index]) : 0)) / s.plan.legs.length;
}
function navRenderState() {
  if (!nav) return;
  const state = nav.playback, plan = nav.plan, ready = plan && plan.ok;
  $("#navStart").disabled = !ready || !!state;
  $("#navRestart").disabled = !state;
  const speechBusy = nav.speaker && nav.speaker.busy;
  const paused = state && (state.status === "paused" || (speechBusy && nav.speaker.paused));
  $("#navPause").disabled = !state || (state.status === "finished" && !speechBusy);
  $("#navPause").textContent = paused ? "继续" : "暂停";
  let text = "路线已就绪，点击开始模拟。";
  if (!ready) text = "";
  else if (state) {
    const leg = plan.legs[state.index];
    if (state.status === "finished") text = "已到达目的地 · " + station(plan.to).name;
    else if (state.phase === "stop") {
      const transfer = state.index > 0 && plan.legs[state.index - 1].lineId !== leg.lineId;
      text = (transfer ? "到站换乘 · " : state.index ? "到站 · " : "上车 · ") + station(leg.from).name + (transfer ? " · " + line(leg.lineId).name : "");
    } else text = line(leg.lineId).name + " · 下一站 " + station(leg.to).name;
    if (paused) text = "已暂停 · " + text;
  }
  $("#navLive").textContent = text;
  $("#navLive").dataset.state = state ? state.status : "ready";
  navUpdateProgress();
}
function navAnnounce(event) {
  if (!nav) return;
  const pinyin = window.pinyinPro && ((text) => window.pinyinPro.pinyin(text, { toneType: "none" })
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()));
  const message = navAnnouncement(P, event, nav.plan, pinyin);
  if (!message) return;
  nav.announcement = event;
  $("#navAnnouncement").hidden = false;
  $("#navAnnouncementZh").textContent = message.zh;
  $("#navAnnouncementEn").textContent = message.en;
  if (nav.voice && !inSelfTest && window.speechSynthesis && window.SpeechSynthesisUtterance) {
    const owner = nav;
    if (!nav.speaker) nav.speaker = createNavSpeaker({
      speak(part, finish) {
        const speech = new window.SpeechSynthesisUtterance(part.text); speech.lang = part.lang; speech.rate = .95 * owner.speechRate;
        const voice = navSelectVoice(window.speechSynthesis.getVoices(), part.lang);
        if (voice) speech.voice = voice;
        owner.utterance = speech;
        speech.onend = speech.onerror = () => { if (owner.utterance === speech) owner.utterance = null; finish(); };
        window.speechSynthesis.speak(speech);
      },
      cancel() { try { window.speechSynthesis.cancel(); } finally { owner.utterance = null; } },
      later(callback, delay) { return window.setTimeout(callback, Math.ceil(delay / Math.min(1, owner.speechRate))); },
      unlater(timer) { window.clearTimeout(timer); }
    }, () => navSpeechComplete(owner));
    nav.speaking = true; nav.speaker.speak(message.parts);
  }
}
function navBindMap() {
  map.on("resize", () => { navRefreshGeometry(); navDrawCursor(true); });
  map.on("dragstart", () => { if (nav && nav.follow && !navProgrammaticView) { nav.follow = false; $("#navFollow").checked = false; } });
  document.addEventListener("visibilitychange", () => {
    if (!nav) return;
    navCancelFrame(); nav.lastTime = null;
    if (document.hidden) navSilence(true); else { navResumeSpeech(); navScheduleFrame(); }
  });
}
// END NAV UI
