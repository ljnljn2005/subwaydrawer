"use strict";

/* Test the functions shipped in the single-file application, with an explicit
   source override available while the UI block is being integrated. Speech is
   simulated: these checks never invoke a computer's native speech engine. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const extract = (text) => {
  const start = text.indexOf("// BEGIN NAV ANNOUNCEMENTS"), end = text.indexOf("// END NAV ANNOUNCEMENTS", start);
  return start >= 0 && end > start ? text.slice(start, end) : null;
};
const override = process.argv.indexOf("--source");
const appPath = path.join(__dirname, "..", "index.html");
const appSource = extract(fs.readFileSync(appPath, "utf8"));
const source = override >= 0 ? extract(fs.readFileSync(path.resolve(process.argv[override + 1]), "utf8")) :
  appSource || extract(fs.readFileSync(path.join(__dirname, "navigation-ui.js"), "utf8"));
assert.ok(source, "Navigation announcement marker range is missing");
const load = (text) => vm.runInNewContext(text + "\n({navEnglishName, navInterchangeLines, navAnnouncement, navSelectVoice, createNavSpeaker});");
const api = load(source), clean = (value) => JSON.parse(JSON.stringify(value));
let checks = 0, negativeControls = 0;
const test = (name, callback) => {
  try { callback(); checks++; }
  catch (error) { error.message = name + ": " + error.message; throw error; }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const leg = (from, to, fromIndex, toIndex, direction = 1, lineId = "L") =>
  ({lineId, from, to, fromIndex, toIndex, direction, segmentIndex: Math.min(fromIndex, toIndex)});
const project = {
  stations: {
    A: {id: "A", name: "起点", nameEn: "Origin"}, B: {id: "B", name: "中央", nameEn: "Central"},
    C: {id: "C", name: "北站", nameEn: "North"}, D: {id: "D", name: "终站", nameEn: "Terminal"},
    E: {id: "E", name: "机场", nameEn: "Airport"}, F: {id: "F", name: "西站", nameEn: "West"}
  },
  lines: [
    {id: "L", name: "地铁 02 号线", stations: ["A", "B", "C", "D"]},
    {id: "M", name: "3号线", stations: ["B", "E"]},
    {id: "N", name: "机场线", nameEn: "Airport Express", stations: ["F", "B"]},
    {id: "H", name: "隐藏线", visible: false, stations: ["B", "C"]},
    {id: "J", name: "在建线", style: "dash", stations: ["B", "C"]},
    {id: "S", name: "单站线", stations: ["B"]},
    {id: "Z", name: "无效线", stations: ["B", "missing"]},
    {id: "R", name: "重复站线", stations: ["B", "B"]},
    {id: "M", name: "重复线路记录", stations: ["B", "F"]}
  ]
};
const plan = {from: "A", to: "D", legs: [leg("A", "B", 0, 1), leg("B", "C", 1, 2), leg("C", "D", 2, 3)]};
const arrival = (station = "B", index = 0, final = false) => ({type: "arrival", station, index, lineId: "L", final});
const next = (station = "B", index = 0) => ({type: "next", station, index, lineId: "L"});
const romanize = (name) => ({"起点": "Qi Dian", "中央": "Zhong Yang", "北站": "Bei Zhan", "机场线": "Ji Chang Xian"}[name] || name);

test("next station uses natural Chinese and English wording", () => {
  const message = api.navAnnouncement(project, next(), plan, romanize);
  assert.match(message.zh, /^下一站，中央。/);
  assert.match(message.en, /^The next station is Central\./);
  assert.equal(message.terminus, false);
});
test("all usable interchange lines are spoken in both languages", () => {
  const message = api.navAnnouncement(project, next(), plan, romanize);
  assert.match(message.zh, /可换乘3号线、机场线。/);
  assert.match(message.en, /You can transfer to Line 3 and Airport Express\./);
  for (const unusable of ["地铁 02 号线", "隐藏线", "在建线", "单站线", "无效线", "重复站线", "重复线路记录"]) {
    assert.ok(!message.zh.includes(unusable), "Included unusable/current line: " + unusable);
  }
});
test("interchange eligibility excludes current, hidden, construction, singleton, dangling and duplicate IDs", () => {
  assert.deepEqual(clean(api.navInterchangeLines(project, "B", "L")).map((line) => line.id), ["M", "N"]);
});
test("interchange ignores stale station line references", () => {
  const p = clone(project); p.stations.B.lines = ["H", "J", "missing"];
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")).map((line) => line.id), ["M", "N"]);
});
test("line service may join the station at either endpoint", () => {
  const p = {stations: project.stations, lines: [project.lines[1], project.lines[2]]};
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")).map((line) => line.id), ["M", "N"]);
});
test("repeated self segments do not count as service", () => {
  const p = {stations: project.stations, lines: [{id: "R", stations: ["B", "B", "B"], loop: true}]};
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")), []);
});
test("a valid neighbor after repeated station occurrences still provides service", () => {
  const p = {stations: project.stations, lines: [{id: "R", stations: ["B", "B", "E"]}]};
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")).map((line) => line.id), ["R"]);
});
test("a circular seam provides service when linear neighbors are dangling", () => {
  const p = {stations: project.stations, lines: [{id: "R", stations: ["B", "missing", "E"], loop: true}]};
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")).map((line) => line.id), ["R"]);
  p.lines[0].loop = false;
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")), []);
});
test("an unusable duplicate does not mask a later usable line with the same ID", () => {
  const p = {stations: project.stations, lines: [{id: "M", stations: ["B"]}, project.lines[1]]};
  assert.deepEqual(clean(api.navInterchangeLines(p, "B", "L")).map((line) => line.id), ["M"]);
});
test("out-of-station interchange is explicit in each language", () => {
  const p = clone(project); p.stations.B.outTransfer = true;
  const message = api.navAnnouncement(p, next(), plan, romanize);
  assert.match(message.zh, /可出站换乘3号线、机场线。/);
  assert.match(message.en, /Please exit the station to transfer\./);
});
test("a station without an interchange has no transfer sentence", () => {
  const message = api.navAnnouncement(project, next("C", 1), plan, romanize);
  assert.ok(!message.zh.includes("换乘")); assert.ok(!message.en.includes("transfer"));
});
test("English three-line lists retain every line with a final conjunction", () => {
  const p = clone(project); p.lines.push({id: "T", name: "4号线", stations: ["B", "C"]});
  assert.match(api.navAnnouncement(p, next(), plan, romanize).en, /Line 3, Airport Express and Line 4\./);
});
test("ordinary arrival identifies the station and reminds passengers about belongings", () => {
  const message = api.navAnnouncement(project, arrival(), plan, romanize);
  assert.match(message.zh, /^中央到了。/); assert.match(message.zh, /请带齐随身物品/);
  assert.match(message.en, /^We are now at Central\./); assert.match(message.en, /take all your belongings/);
});
test("the passenger's destination is not automatically the train's terminus", () => {
  const message = api.navAnnouncement(project, arrival("B", 0, true), {...plan, to: "B", legs: [plan.legs[0]]}, romanize);
  assert.equal(message.terminus, false); assert.ok(!message.zh.includes("终点站"));
  assert.ok(!message.en.includes("terminus")); assert.ok(!message.en.includes("All passengers"));
});
test("forward line endpoint has a next-station terminus announcement", () => {
  const message = api.navAnnouncement(project, next("D", 2), plan, romanize);
  assert.equal(message.terminus, true); assert.match(message.zh, /下一站，终站，本次列车的终点站。/);
  assert.match(message.en, /The next station is Terminal, the terminus of this train\./);
});
test("actual train terminus asks all passengers to leave in both languages", () => {
  const message = api.navAnnouncement(project, arrival("D", 2, true), plan, romanize);
  assert.equal(message.terminus, true); assert.match(message.zh, /^终点站，终站到了。/);
  assert.match(message.zh, /请所有乘客下车/); assert.match(message.en, /This is the terminus\. All passengers, please leave the train\./);
});
test("train terminus depends on its line endpoint even if route continues by transfer", () => {
  const message = api.navAnnouncement(project, arrival("D", 2, false), plan, romanize);
  assert.equal(message.terminus, true);
});
test("reverse travel ends at the first station of the line", () => {
  const p = {from: "B", to: "A", legs: [leg("B", "A", 1, 0, -1)]};
  assert.equal(api.navAnnouncement(project, arrival("A", 0, true), p, romanize).terminus, true);
});
test("reverse travel through an interior station is not a terminus", () => {
  const p = {from: "D", to: "C", legs: [leg("D", "C", 3, 2, -1)]};
  assert.equal(api.navAnnouncement(project, arrival("C", 0, true), p, romanize).terminus, false);
});
test("a ring never announces an index endpoint as a terminus", () => {
  const p = clone(project); p.lines[0].loop = true;
  assert.equal(api.navAnnouncement(p, arrival("D", 2, true), plan, romanize).terminus, false);
  const ringPlan = {legs: [leg("B", "A", 1, 0, -1)]};
  assert.equal(api.navAnnouncement(p, arrival("A", 0, true), ringPlan, romanize).terminus, false);
});
test("a repeated station ID is a terminus only at its actual endpoint occurrence", () => {
  const p = clone(project); p.lines[0].stations = ["A", "B", "C", "B"];
  const repeatedPlan = {legs: [leg("A", "B", 0, 1), leg("C", "B", 2, 3)]};
  assert.equal(api.navAnnouncement(p, arrival("B", 0, true), repeatedPlan, romanize).terminus, false);
  assert.equal(api.navAnnouncement(p, arrival("B", 1, true), repeatedPlan, romanize).terminus, true);
});
test("missing and unrelated events are silent", () => {
  assert.equal(api.navAnnouncement(project, arrival("missing"), plan, romanize), null);
  assert.equal(api.navAnnouncement(project, {type: "transfer", station: "B", lineId: "M"}, plan, romanize), null);
});
test("every message contains Chinese first and English second with matching language tags", () => {
  for (const event of [next(), arrival(), next("D", 2), arrival("D", 2, true)]) {
    const message = api.navAnnouncement(project, event, plan, romanize);
    assert.deepEqual(clean(message.parts), [{text: message.zh, lang: "zh-CN"}, {text: message.en, lang: "en-US"}]);
  }
});
test("announcements and interchange discovery do not mutate project, plan or event", () => {
  const event = next(), before = JSON.stringify([project, plan, event]);
  api.navAnnouncement(project, event, plan, romanize); api.navInterchangeLines(project, "B", "L");
  assert.equal(JSON.stringify([project, plan, event]), before);
});

test("user-provided English names are trimmed and take precedence", () => {
  assert.equal(api.navEnglishName({name: "中央", nameEn: "  People's Square  "}, () => {throw new Error("Unexpected pinyin");}), "People's Square");
  assert.equal(api.navEnglishName({name: "2号线", nameEn: "  Blue Line  "}, romanize, true), "Blue Line");
});
test("blank English names fall back to offline romanization", () => {
  assert.equal(api.navEnglishName({name: "中央", nameEn: "  "}, romanize), "Zhong Yang");
});
test("numbered Chinese lines become English Line names", () => {
  for (const name of ["2号线", "02 号线", "地铁 2 号线"]) assert.equal(api.navEnglishName({name}, romanize, true), "Line 2");
});
test("numeric station names are not mistaken for line names", () => {
  assert.equal(api.navEnglishName({name: "2号线"}, (name) => "Station " + name), "Station 2号线");
});
test("Latin station names and missing pinyin support remain readable", () => {
  assert.equal(api.navEnglishName({name: "Airport T2"}, () => {throw new Error("Unexpected pinyin");}), "Airport T2");
  assert.equal(api.navEnglishName({name: "中央"}, null), "中央");
});
const pinyinPath = path.join(__dirname, "..", "vendor", "pinyin-pro.js");
if (fs.existsSync(pinyinPath)) test("the shipped offline bundle romanizes Chinese without network access", () => {
  const sandbox = {}; vm.runInNewContext(fs.readFileSync(pinyinPath, "utf8"), sandbox);
  const pinyin = (name) => sandbox.pinyinPro.pinyin(name, {toneType: "none"});
  assert.equal(api.navEnglishName({name: "人民医院"}, pinyin), "ren min yi yuan");
  const p = clone(project); delete p.stations.B.nameEn;
  assert.match(api.navAnnouncement(p, next(), plan, pinyin).en, /The next station is zhong yang\./);
});
test("voice selection prefers an exact language before a local regional fallback", () => {
  const voices = [{name: "British", lang: "en-GB", localService: true}, {name: "US", lang: "en-US", localService: false},
    {name: "Chinese", lang: "zh-CN", localService: true}];
  assert.equal(api.navSelectVoice(voices, "en-US").name, "US");
  assert.equal(api.navSelectVoice(voices, "zh-CN").name, "Chinese");
});
test("equal-language voices prefer a local installed voice", () => {
  assert.equal(api.navSelectVoice([{name: "Remote", lang: "en-US"}, {name: "Local", lang: "en-US", localService: true}], "en-US").name, "Local");
});
test("voice language comparison tolerates case and underscore regional separators", () => {
  assert.equal(api.navSelectVoice([{name: "Fallback", lang: "EN_gb"}], "en-US").name, "Fallback");
  assert.equal(api.navSelectVoice([{name: "Exact", lang: "ZH-cn"}], "zh-CN").name, "Exact");
});
test("missing matching voices return null for browser language-based selection", () => {
  assert.equal(api.navSelectVoice([], "en-US"), null);
  assert.equal(api.navSelectVoice([{lang: "fr-FR"}], "en-US"), null);
});
test("voice selection leaves the system voice list unchanged", () => {
  const voices = [{lang: "en-GB"}, {lang: "zh-CN"}, {lang: "en-US", localService: true}], before = JSON.stringify(voices);
  api.navSelectVoice(voices, "en-US"); assert.equal(JSON.stringify(voices), before);
});

const bilingual = [{text: "下一站，中央。", lang: "zh-CN"}, {text: "The next station is Central.", lang: "en-US"}];
const harness = (implementation = api, onSpeak) => {
  let completed = 0, cancels = 0, timerId = 0;
  const spoken = [], timers = new Map(), timerHistory = [];
  const adapter = {
    speak(part, finish) { const call = {part, finish}; spoken.push(call); if (onSpeak) onSpeak(call, spoken.length); },
    cancel() { cancels++; },
    later(fn, ms) { const entry = {id: ++timerId, fn, ms}; timers.set(entry.id, entry); timerHistory.push(entry); return entry.id; },
    unlater(id) { timers.delete(id); }
  };
  const speaker = implementation.createNavSpeaker(adapter, () => completed++);
  return {speaker, spoken, timers, timerHistory, get completed() {return completed;}, get cancels() {return cancels;},
    expire() { const entry = timers.values().next().value; assert.ok(entry, "No watchdog to expire"); timers.delete(entry.id); entry.fn(); }};
};
const assertSequence = (implementation = api) => {
  const h = harness(implementation); h.speaker.speak(bilingual);
  assert.equal(h.spoken.length, 1); assert.equal(h.spoken[0].part.lang, "zh-CN"); assert.equal(h.speaker.busy, true);
  h.spoken[0].finish();
  assert.equal(h.spoken.length, 2); assert.equal(h.spoken[1].part.lang, "en-US");
  assert.equal(h.cancels, 0); assert.equal(h.completed, 0); assert.equal(h.speaker.busy, true);
  h.spoken[1].finish(); assert.equal(h.completed, 1); assert.equal(h.speaker.busy, false); assert.equal(h.timers.size, 0);
};
test("Chinese and English play sequentially without cancellation or premature clock release", () => assertSequence());
test("utterance callback duplication cannot skip English or finish twice", () => {
  const h = harness(); h.speaker.speak(bilingual); h.spoken[0].finish(); h.spoken[0].finish();
  assert.equal(h.spoken.length, 2); assert.equal(h.completed, 0);
  h.spoken[1].finish(); h.spoken[1].finish(); assert.equal(h.completed, 1);
});
test("speech input is copied so caller edits cannot corrupt queued English", () => {
  const parts = clone(bilingual), h = harness(); h.speaker.speak(parts); parts[1].text = "changed"; parts.pop();
  h.spoken[0].finish(); assert.equal(h.spoken[1].part.text, bilingual[1].text);
});
test("pausing cancels active speech, retains its language and removes the watchdog", () => {
  const h = harness(); h.speaker.speak(bilingual); h.speaker.pause();
  assert.equal(h.speaker.paused, true); assert.equal(h.speaker.busy, true); assert.equal(h.cancels, 1); assert.equal(h.timers.size, 0);
  h.spoken[0].finish(); assert.equal(h.spoken.length, 1); assert.equal(h.completed, 0);
  h.speaker.resume(); assert.equal(h.speaker.paused, false); assert.equal(h.spoken[1].part.lang, "zh-CN");
  h.spoken[1].finish(); h.spoken[2].finish(); assert.equal(h.completed, 1);
});
test("pausing English resumes English instead of restarting Chinese", () => {
  const h = harness(); h.speaker.speak(bilingual); h.spoken[0].finish(); h.speaker.pause(); h.speaker.resume();
  assert.deepEqual(h.spoken.map((call) => call.part.lang), ["zh-CN", "en-US", "en-US"]);
  h.spoken[1].finish(); assert.equal(h.completed, 0); h.spoken[2].finish(); assert.equal(h.completed, 1);
});
test("a stale pre-pause completion is ignored even after resuming", () => {
  const h = harness(); h.speaker.speak(bilingual); h.speaker.pause(); h.speaker.resume(); h.spoken[0].finish();
  assert.equal(h.spoken.length, 2); assert.equal(h.completed, 0); assert.equal(h.spoken[1].part.lang, "zh-CN");
});
const assertClearedCallbacks = (implementation = api) => {
  const h = harness(implementation); h.speaker.speak(bilingual); const old = h.spoken[0].finish;
  h.speaker.clear(); old(); h.timerHistory[0].fn(); h.speaker.resume();
  assert.equal(h.spoken.length, 1); assert.equal(h.completed, 0); assert.equal(h.speaker.busy, false);
  assert.equal(h.speaker.paused, false); assert.equal(h.timers.size, 0);
};
test("clearing speech removes work and ignores stale native and watchdog callbacks", () => assertClearedCallbacks());
test("restarting replaces the old bilingual message and rejects old completions", () => {
  const h = harness(); h.speaker.speak(bilingual); const old = h.spoken[0].finish;
  h.speaker.speak([{text: "到站。", lang: "zh-CN"}, {text: "We are now at North.", lang: "en-US"}]); old();
  assert.equal(h.spoken.length, 2); assert.equal(h.cancels, 1); assert.equal(h.completed, 0);
  h.spoken[1].finish(); assert.equal(h.spoken[2].part.text, "We are now at North.");
  h.spoken[2].finish(); assert.equal(h.completed, 1);
});
test("rapid replacement retains only the latest station message", () => {
  const h = harness();
  for (let i = 0; i < 100; i++) h.speaker.speak([{text: "站 " + i, lang: "zh-CN"}, {text: "Station " + i, lang: "en-US"}]);
  assert.equal(h.spoken.length, 100); assert.equal(h.timers.size, 1); assert.equal(h.cancels, 99);
  for (const call of h.spoken.slice(0, 99)) call.finish();
  assert.equal(h.spoken.length, 100); assert.equal(h.completed, 0);
  h.spoken[99].finish(); assert.equal(h.spoken[100].part.text, "Station 99");
  h.spoken[100].finish(); assert.equal(h.completed, 1); assert.equal(h.timers.size, 0);
});
test("speaker exceptions release Chinese and still attempt English", () => {
  const h = harness(api, (_, count) => {if (count === 1) throw new Error("Speech unavailable");});
  h.speaker.speak(bilingual); assert.equal(h.spoken.length, 2); assert.equal(h.spoken[1].part.lang, "en-US");
  h.spoken[1].finish(); assert.equal(h.completed, 1); assert.equal(h.speaker.busy, false);
});
test("failure of both language engines releases the navigation clock", () => {
  const h = harness(api, () => {throw new Error("Speech unavailable");}); h.speaker.speak(bilingual);
  assert.equal(h.spoken.length, 2); assert.equal(h.completed, 1); assert.equal(h.speaker.busy, false); assert.equal(h.timers.size, 0);
});
test("native error completion progresses without leaving a stale watchdog", () => {
  const h = harness(); h.speaker.speak(bilingual); h.spoken[0].finish(new Error("Native speech error"));
  assert.equal(h.spoken.length, 2); assert.equal(h.timers.size, 1); h.spoken[1].finish(new Error("Native speech error"));
  assert.equal(h.completed, 1); assert.equal(h.timers.size, 0);
});
test("watchdogs cancel silent engines, advance languages and eventually release speech", () => {
  const h = harness(); h.speaker.speak(bilingual); h.expire();
  assert.equal(h.cancels, 1); assert.equal(h.spoken[1].part.lang, "en-US");
  h.spoken[0].finish(); assert.equal(h.completed, 0); h.expire();
  assert.equal(h.cancels, 2); assert.equal(h.completed, 1); assert.equal(h.speaker.busy, false); assert.equal(h.timers.size, 0);
});
test("long messages have a finite watchdog rather than blocking indefinitely", () => {
  const h = harness(); h.speaker.speak([{text: "字".repeat(1000), lang: "zh-CN"}]);
  const ms = h.timerHistory[0].ms; assert.ok(ms >= 15000 && ms <= 90000); h.expire();
  assert.equal(h.completed, 1); assert.equal(h.speaker.busy, false);
});
test("pause, resume and clear are harmless while idle", () => {
  const h = harness(); h.speaker.pause(); h.speaker.resume(); h.speaker.clear(); h.speaker.clear();
  assert.equal(h.speaker.busy, false); assert.equal(h.speaker.paused, false); assert.equal(h.spoken.length, 0);
  assert.equal(h.cancels, 0); assert.equal(h.completed, 0); assert.equal(h.timers.size, 0);
});

/* Each control removes a safety rule and must be caught by the corresponding
   real behavior assertion; these are not tests that mirror implementation. */
const mutant = (before, after) => {
  assert.ok(source.includes(before), "Negative control target missing: " + before);
  return load(source.replace(before, after));
};
const negative = (name, callback) => test("negative control: " + name, () => {callback(); negativeControls++;});
negative("current train line cannot be included as an interchange", () => {
  const m = mutant("l.id === currentLineId || ", "");
  assert.throws(() => assert.deepEqual(clean(m.navInterchangeLines(project, "B", "L")).map((line) => line.id), ["M", "N"]));
});
negative("a dashed construction line must not be offered", () => {
  const m = mutant(' || l.style === "dash"', "");
  assert.throws(() => assert.deepEqual(clean(m.navInterchangeLines(project, "B", "L")).map((line) => line.id), ["M", "N"]));
});
negative("route destination alone cannot imply train terminus", () => {
  const m = mutant("const terminus = !!(l && leg && !l.loop && leg.to === event.station &&", "const terminus = event.final || !!(l && leg && !l.loop && leg.to === event.station &&");
  assert.throws(() => assert.equal(m.navAnnouncement(project, arrival("B", 0, true), plan, romanize).terminus, false));
});
negative("ring endpoints are not train termini", () => {
  const m = mutant("&& !l.loop &&", "&&"); const p = clone(project); p.lines[0].loop = true;
  assert.throws(() => assert.equal(m.navAnnouncement(p, arrival("D", 2, true), plan, romanize).terminus, false));
});
negative("English must follow Chinese instead of being skipped", () => {
  const m = mutant("active = false; index++;", "active = false; index += 2;");
  assert.throws(() => assertSequence(m));
});
negative("switching to English must not cancel the finished Chinese message", () => {
  const m = mutant("active = true;", "adapter.cancel(); active = true;");
  assert.throws(() => assertSequence(m));
});
negative("old callbacks cannot resurrect cleared messages", () => {
  const m = mutant("if (ownToken !== token || paused) return;", "if (paused) return;");
  assert.throws(() => assertClearedCallbacks(m));
});
negative("English cannot use an unrelated installed language", () => {
  const m = mutant('voices.filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === base)', 'voices.filter(() => true)');
  assert.throws(() => assert.equal(m.navSelectVoice([{lang: "fr-FR"}], "en-US"), null));
});

console.log("PASS " + checks + " bilingual announcement/speech semantic cases (including " + negativeControls +
  " negative controls; " + (override >= 0 ? "explicit UI source" : appSource ? "delivered application" : "UI source before integration") + ")");
