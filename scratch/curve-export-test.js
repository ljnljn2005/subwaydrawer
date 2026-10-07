"use strict";

// Exercise the delivered renderer with synthetic stations only. Geometry is
// extracted from index.html; label and legend layout are outside this test.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function extract(name) {
  const begin = source.indexOf("function " + name + "(");
  const end = source.indexOf("\n}", begin);
  assert.ok(begin >= 0 && end > begin, "Missing function " + name);
  return source.slice(begin, end + 2);
}
const names = ["shapeIds", "chordFrame", "bendHandle", "curveCubics", "sampleCubics", "catmullRom", "lineShape", "offsetSegs", "joinSegs", "buildCorridorGroups", "distToSeg", "svgRailPath", "diagonalCurve", "diagPolyline", "schematicGeometries", "schematicShapes", "lineLayers", "terminalFromLines", "visibleLineIndex", "stationGlyph", "mercY", "svgLabelXY", "buildSVG", "buildSchematicSVG"];
const fixture = () => {
  const stations = {};
  [["A",0,0],["B",150,60],["C",240,170],["D",320,150]].forEach(([id,x,y]) => {
    stations[id] = { id, name: "Station " + id, x, y, lng: 116 + x * .0001, lat: 39 - y * .0001, lines: [] };
  });
  const line = (id, ids, options = {}) => Object.assign({ id, name: id, badge: id, color: "#E4002B", color2: "#008F65", visible: true, width: 6, style: "solid", colorMode: "mono", stations: ids, bends: {}, loop: false, stack: true }, options);
  const lines = [line("primary", ["A","B","C"], { bends: { "A>B": [{ along: .4, normal: .4 }, { along: .7, normal: -.2 }] } }), line("reverse", ["B","A"], { color: "#0057B7" }), line("construction", ["C","D"], { color: "#F2C300", style: "dash" }), line("hidden", ["A","D"], { color: "#D012A3", visible: false })];
  lines.forEach(l => l.stations.forEach(id => stations[id].lines.push(l.id)));
  return { name: "Synthetic curve export", stations, lines };
};
const context = vm.createContext({ P: fixture(), settings: { stack: true, showBadges: false, showLabels: false } });
const setup = `
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const corridorKey = (a,b) => a < b ? a + "|" + b : b + "|" + a;
const bendKey = (a,b) => a + ">" + b;
const curved = b => Array.isArray(b) && b.length > 0;
const station = id => P.stations[id];
const SCHEME = { U:78, R:18, PAD:110, W:1500 };
const textWidth = (text,fs) => String(text).length * fs * .55;
const labelSize = (text,fs) => ({w:textWidth(text,fs),h:fs+9});
const legendGeom = () => ({rows:0,cols:0,blockH:0,colW:0});
const legendSvg = () => "";
const badgeClearance = () => null;
const esc = text => String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const solveSides = items => Object.fromEntries(items.map(it=>[it.id,{side:"r"}]));
const layoutSchematic = () => Object.fromEntries(Object.values(P.stations).map(s=>[s.id,{x:s.x,y:s.y}]));
`;
vm.runInContext(setup + names.map(extract).join("\n"), context);
const api = Object.fromEntries(names.map(n => [n, vm.runInContext(n,context)]));
const clean = value => JSON.parse(JSON.stringify(value));
const point = (x,y) => ({x,y});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const close = (a,b,tolerance=1e-7) => assert.ok(distance(a,b)<=tolerance, JSON.stringify(a)+" != "+JSON.stringify(b));
let checks=0;
function test(name, callback) { try { callback(); checks++; } catch(error) { error.message=name+": "+error.message; throw error; } }
function commands(d) {
  const tokens = d.match(/[MLCA]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) || [];
  const ops=[],counts={M:2,L:2,C:6,A:7};
  for(let i=0;i<tokens.length;) {
    const type=tokens[i++],count=counts[type]; assert.ok(count,"Unsupported path command "+type);
    const values=tokens.slice(i,i+count).map(Number); assert.equal(values.length,count); assert.ok(values.every(Number.isFinite));
    i+=count;ops.push({type,values});
  }
  return ops;
}
function cubic(c,t) {
  const m=1-t;
  return point(m*m*m*c.A.x+3*m*m*t*c.C1.x+3*m*t*t*c.C2.x+t*t*t*c.B.x,
    m*m*m*c.A.y+3*m*m*t*c.C1.y+3*m*t*t*c.C2.y+t*t*t*c.B.y);
}
function pathSamples(d) {
  const ops=commands(d),out=[];let current=null;
  ops.forEach(op=>{
    const v=op.values;
    if(op.type==="M"||op.type==="L") { current=point(v[0],v[1]);out.push(current); }
    else if(op.type==="C") {
      const c={A:current,C1:point(v[0],v[1]),C2:point(v[2],v[3]),B:point(v[4],v[5])};
      for(let i=1;i<=200;i++)out.push(cubic(c,i/200));current=c.B;
    } else {
      assert.equal(v[0],v[1]);assert.equal(v[2],0);assert.equal(v[3],0);
      const end=point(v[5],v[6]),dx=end.x-current.x,dy=end.y-current.y,chord=Math.hypot(dx,dy);
      const r=v[0],h=Math.sqrt(Math.max(0,r*r-chord*chord/4)),sign=v[4]?1:-1;
      const center=point((current.x+end.x)/2-dy/chord*h*sign,(current.y+end.y)/2+dx/chord*h*sign);
      const start=Math.atan2(current.y-center.y,current.x-center.x),finish=Math.atan2(end.y-center.y,end.x-center.x);
      let angle=finish-start; if(sign>0&&angle<0)angle+=2*Math.PI;if(sign<0&&angle>0)angle-=2*Math.PI;
      for(let i=1;i<100;i++)out.push(point(center.x+Math.cos(start+angle*i/100)*r,center.y+Math.sin(start+angle*i/100)*r));
      out.push(end);current=end;
    }
  });return out;
}
function minPolylineDistance(p,pts) { let best=Infinity;for(let i=1;i<pts.length;i++)best=Math.min(best,api.distToSeg(p,pts[i-1],pts[i]));return best; }
const model=context.P,primary=model.lines[0];
const projection=s=>point(s.x,s.y);
test("geographic curved segments contain real Bezier commands",()=>{
  const shape=api.lineShape(primary,projection),os=api.offsetSegs(shape.segs,api.buildCorridorGroups(),primary.id),d=api.svgRailPath(shape.segs,os);
  assert.equal(commands(d).filter(o=>o.type==="C").length,3);assert.ok(commands(d).some(o=>o.type==="L"));
});
test("cubic output preserves shifted station endpoints and bend order",()=>{
  const shape=api.lineShape(primary,projection),os=api.offsetSegs(shape.segs,api.buildCorridorGroups(),primary.id),ops=commands(api.svgRailPath(shape.segs,os));
  close(point(...ops[0].values),os[0].pts[0],.001);close(point(...ops.at(-1).values),os.at(-1).pts.at(-1),.001);
  const ends=ops.filter(o=>o.type==="C").map(o=>point(o.values[4],o.values[5]));
  ends.forEach((p,i)=>close(p,os[0].cubics[i].B,.001));
});
test("geographic path samples follow the map geometry",()=>{
  const shape=api.lineShape(primary,projection),os=api.offsetSegs(shape.segs,api.buildCorridorGroups(),primary.id),samples=pathSamples(api.svgRailPath(shape.segs,os)),map=api.joinSegs(os);
  samples.forEach(p=>assert.ok(minPolylineDistance(p,map)<.18));
});
test("lane offset applies to every Bezier control point",()=>{
  const shape=api.lineShape(primary,projection),os=api.offsetSegs(shape.segs,api.buildCorridorGroups(),primary.id);
  os[0].cubics.forEach((c,i)=>["A","C1","C2","B"].forEach(key=>close(c[key],point(shape.segs[0].cubics[i][key].x+shape.segs[0].f.nx*os[0].off,shape.segs[0].cubics[i][key].y+shape.segs[0].f.ny*os[0].off))));
});
test("different segment offsets retain the exact station step",()=>{
  const shape=api.lineShape(primary,projection),os=api.offsetSegs(shape.segs,api.buildCorridorGroups(),primary.id),ops=commands(api.svgRailPath(shape.segs,os));
  assert.notEqual(os[0].off,os[1].off);
  const lastCurve=ops.findLastIndex(o=>o.type==="C");assert.equal(ops[lastCurve+1].type,"L");
  close(point(...ops[lastCurve+1].values),os[1].pts[0],.001);
});
test("straight segments are preserved as straight lines",()=>{
  const shape=api.lineShape(model.lines[2],projection),os=api.offsetSegs(shape.segs,{},model.lines[2].id),ops=commands(api.svgRailPath(shape.segs,os));
  assert.deepEqual(ops.map(o=>o.type),["M","L"]);close(point(...ops[0].values),shape.segs[0].A,.001);close(point(...ops[1].values),shape.segs[0].B,.001);
});
for(const [tag,A,B] of [["horizontal",point(0,0),point(100,0)],["vertical",point(10,100),point(10,-10)],["diagonal",point(50,50),point(-50,-50)],["upper",point(0,0),point(140,-60)],["lower",point(0,0),point(150,60)],["vertical dominant",point(10,-30),point(60,160)],["tiny",point(0,0),point(.01,.03)],["equal endpoints",point(15,20),point(15,20)]]) {
  test("standard route preserves "+tag+" endpoints and reverse geometry",()=>{
    const a=api.diagonalCurve(A,B,18),b=api.diagonalCurve(B,A,18);close(a.points[0],A);close(a.points.at(-1),B);
    assert.deepEqual(clean(a.points),clean(b.points).reverse());
    assert.ok(a.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  });
}
test("standard corners are exact circles tangent to both legs",()=>{
  const A=point(0,0),B=point(150,60),g=api.diagonalCurve(A,B,18),a=g.arc;assert.ok(a);
  g.points.slice(1,-1).forEach(p=>assert.ok(Math.abs(distance(p,a.center)-a.radius)<1e-7));
  const dot=(u,v)=>u.x*v.x+u.y*v.y;
  assert.ok(Math.abs(dot(point(a.entry.x-A.x,a.entry.y-A.y),point(a.entry.x-a.center.x,a.entry.y-a.center.y)))<1e-7);
  assert.ok(Math.abs(dot(point(B.x-a.exit.x,B.y-a.exit.y),point(a.exit.x-a.center.x,a.exit.y-a.center.y)))<1e-7);
});
test("standard SVG emits true arc and agrees with sampled geometry",()=>{
  const A=point(0,0),B=point(150,60),g=api.diagonalCurve(A,B,18),seg={i:0,a:"A",b:"B",A,B,f:api.chordFrame(A,B),raw:g.points,arc:g.arc};
  const os=api.offsetSegs([seg],{},"one"),d=api.svgRailPath([seg],os);assert.ok(commands(d).some(o=>o.type==="A"));
  pathSamples(d).forEach(p=>assert.ok(minPolylineDistance(p,os[0].pts)<.125));
});
test("standard shifted arcs preserve lane offset and scaling",()=>{
  const pos=Object.fromEntries(Object.values(model.stations).map(s=>[s.id,projection(s)])),g=api.schematicGeometries(pos).primary;
  const transform=p=>point(p.x*3+11,p.y*3+8),d=api.svgRailPath(g.segs,g.os,transform);
  close(point(...commands(d)[0].values),transform(g.os[0].pts[0]),.001);
  pathSamples(d).forEach(p=>assert.ok(minPolylineDistance(p,g.points.map(transform))<.365));
});
test("reverse ordered shared corridor uses two separate parallel lanes",()=>{
  const plain=Object.assign({},primary,{bends:{}}),one=api.lineShape(plain,projection),two=api.lineShape(model.lines[1],projection),groups=api.buildCorridorGroups();
  const a=api.offsetSegs(one.segs,groups,plain.id)[0].pts,b=api.offsetSegs(two.segs,groups,model.lines[1].id)[0].pts.slice().reverse();
  a.forEach((p,i)=>assert.ok(Math.abs(distance(p,b[i])-10.5)<1e-7));
});
test("loop path ends exactly at its starting station",()=>{
  const loop=Object.assign({},primary,{stations:["A","B","C"],loop:true}),shape=api.lineShape(loop,projection),os=api.offsetSegs(shape.segs,{},loop.id),ops=commands(api.svgRailPath(shape.segs,os));
  close(point(...ops[0].values),point(...ops.at(-1).values),.001);assert.equal(shape.segs.length,3);
});
test("empty geometry has no fictitious path",()=>assert.equal(api.svgRailPath([],[]),""));
for(const mode of ["geographic","standard"])test(mode+" export retains construction dashes and excludes hidden rails",()=>{
  const result=mode==="geographic"?api.buildSVG():api.buildSchematicSVG();
  assert.ok(!/NaN|Infinity|undefined/.test(result.svg));assert.ok(!result.svg.includes('stroke="#D012A3"'));
  const rails=[...result.svg.matchAll(/<path class="rail-path" d="([^"]+)"[^>]*>/g)];
  assert.equal(rails.length,9);rails.forEach(m=>assert.ok(commands(m[1]).length>=2));
  const construction=rails.find(m=>m[0].includes('stroke="#F2C300"'));assert.ok(construction);assert.ok(construction[0].includes("stroke-dasharray="));
  assert.ok(rails.some(m=>commands(m[1]).some(o=>o.type===(mode==="geographic"?"C":"A"))));
});
test("SVG geometry audit reads actual path and rejects a vacuous rail set",()=>{
  const audit=extract("svgRailSamples");assert.ok(audit.includes("getTotalLength"));assert.ok(audit.includes("getPointAtLength"));assert.ok(audit.includes("if (!paths.length) throw"));
  assert.ok(!source.includes('svg.matchAll(/<polyline points="'));
});
console.log("Curve export: "+checks+" checks passed.");
