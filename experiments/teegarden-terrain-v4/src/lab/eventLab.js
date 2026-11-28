// 돌발상황 견본 페이지 (event-lab.html). 게임(main.js)은 건드리지 않고 같은 지형·장치·흐름·사건 데이터로 연출만 시험한다.
// 주소: event-lab.html?planet=b&event=o2fail (행성은 주소로 정해져서 견본을 바꾸면 새로 불러온다)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLANET } from '../planets/index.js';
import { buildPlain } from '../plain.js';
import { buildRidge } from '../ridge.js';
import { buildBasin } from '../coldLands.js';
import { buildSurroundings, joinPoints } from '../surroundings.js';
import { buildStarfield } from '../effects.js';
import { buildModule, buildOverlay, tintLayer, TINT } from '../placement.js';
import { resolve, flowsFor, siteLetter, choiceData, ALL_STEPS, floorAt } from '../choices.js';
import { buildFlowPoints, pairSpots, outSpots, waterSources, arcPath } from '../flows.js';
import { EVENTS, outcome } from '../events.js';
import { smooth, clamp } from '../terrain.js';
import { blue, blueStep, orange } from '../palette.js';
import { FX, hash } from '../eventFx.js';
import { createCrew } from './eventCrew.js';
import config from './eventFx.json' with { type: 'json' };

const $ = s => document.querySelector(s);
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const params = new URLSearchParams(location.search);
const sample = config.samples.find(s => s.id === params.get('event') && s.planet === PLANET.id) ?? config.samples.find(s => s.planet === PLANET.id);
const event = EVENTS.find(e => e.id === sample.id);
const calm = matchMedia('(prefers-reduced-motion:reduce)').matches;
for (const s of config.samples) {
  const a = make('a', s === sample ? 'on' : '', s.name);
  a.href = '?planet=' + s.planet + '&event=' + s.id;
  if (s === sample) a.setAttribute('aria-current', 'page');
  $('#lab-tabs').append(a);
}

// 게임과 같은 점 머티리얼 하나 (main.js 에서 옮김. 지역 배율 1)
const host = $('#lab-stage'), renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, 0.1, 300), controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = 1.45;
const material = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
material.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, { uLineNear: { value: 16 }, uLineMin: { value: 0.5 }, uLineBase: { value: 0.5 } });
  shader.vertexShader = 'attribute float lineWeight;\nuniform float uLineNear;\nuniform float uLineMin;\nuniform float uLineBase;\n' + shader.vertexShader.replace('#include <fog_vertex>',
    '#include <fog_vertex>\nfloat lineSize = uLineBase * clamp(-mvPosition.z / uLineNear, uLineMin, 1.0);\n'
    + 'gl_PointSize *= mix(1.0, lineSize, lineWeight);\nvColor.rgb *= mix(1.0, uLineBase * uLineMin / lineSize, lineWeight);');
};
const color = new THREE.Color();
function linear(srgb) {
  const out = new Float32Array(srgb.length);
  for (let i = 0; i < out.length; i += 3) { color.setRGB(srgb[i], srgb[i + 1], srgb[i + 2], THREE.SRGBColorSpace); color.toArray(out, i); }
  return out;
}
function addPoints(data, weight = 0) {
  const g = new THREE.BufferGeometry(), base = linear(data.colors), n = data.positions.length / 3;
  g.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
  g.setAttribute('color', new THREE.BufferAttribute(base.slice(), 3));
  g.setAttribute('lineWeight', new THREE.BufferAttribute(data.weights ?? new Float32Array(n).fill(weight), 1));
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; scene.add(points);
  return { points, base, pos: g.attributes.position, col: g.attributes.color };
}

let answered = null, world, state = 'idle', t0 = 0, heal = 0, healTo = 0, left = 0, clockOn = false, lastTick = 0, lastFrame = 0, view = null, tween = null;
const from = { p: new THREE.Vector3(), q: new THREE.Vector3() }, to = { p: new THREE.Vector3(), q: new THREE.Vector3() };

const SPREAD_WIDE = 1.8, SPREAD_WIDE_SECONDS = 6; // 번짐: 장치 밖으로 퍼지는 거리(지역 단위)와 다 퍼지는 때(초)
const SPREAD_SECONDS = 5; // 번짐: 사건이 시작되고 장치 전체가 덮이기까지
async function build() {
  const { site, selection } = sample, def = PLANET.sites[site], letter = siteLetter(site), layers = resolve(selection);
  const ground = (x, z) => floorAt(site, x, z);
  let land = ({ plain: buildPlain, ridge: buildRidge, basin: buildBasin }[site])(30000, { ...def, view: 'section' });
  land = joinPoints(land, buildSurroundings(site, def));
  const terrain = addPoints(land);
  addPoints(buildStarfield());
  const module = await buildModule(site, layers.module, 'section'), items = [{ id: 'module', data: module }];
  for (const id of layers.overlays) items.push({ id, data: await buildOverlay(site, id, module, items.slice(1).map(i => i.data)) });
  const targetIds = sample.target === 'module' ? ['module'] : ALL_STEPS.find(s => s.id === sample.target).choices.find(c => c.id === selection[sample.target]).overlays;
  for (const item of items) {
    item.hit = targetIds.includes(item.id);
    const lv = item.data.levels;
    const tint = (fn, low, span) => { const o = new Float32Array(lv.length * 3); for (let i = 0; i < lv.length; i++) o.set(fn(low + span * lv[i]), i * 3); return linear(o); };
    Object.assign(item, addPoints({ positions: item.data.positions, colors: tintLayer(lv, 'old') }, item.hit ? TINT.new.weight : TINT.old.weight));
    item.cold = tint(blue, 0.12, 0.14); item.alarm = tint(orange, 0.42, 0.3); // 사건 중: 다른 건물은 어두운 파랑, 대상만 주황
  }
  // 흐름 (main.js syncFlows 와 같은 규칙)
  const homes = module.homes.map(h => h.at), anchors = new Map(), sources = [], flows = [], drawn = new Set();
  for (const item of items.slice(1)) {
    const w = waterSources(choiceData.layers.overlay[item.id], letter, item.data.spots ?? [], module.homes, item.data.shrink ?? 1);
    anchors.set(item.id, w.anchors); sources.push(...w.sources);
  }
  for (const flow of flowsFor(selection)) {
    const lists = flow.nodes.map(n => n.id === 'homes' ? homes : n.id === 'out' ? 'out' : anchors.get(n.overlay) ?? []);
    if (lists.some(l => !l.length)) continue;
    const all = lists.filter(l => l !== 'out').flat(), mid = [0, 1, 2].map(j => all.reduce((s, p) => s + p[j], 0) / all.length), segments = [];
    for (let i = 0; i + 1 < lists.length; i++) {
      const next = lists[i + 1] === 'out' ? outSpots(lists[i], mid) : lists[i + 1], below = flow.nodes[i + 1].id === flow.below;
      for (const [a, b] of pairSpots(lists[i], next)) {
        const key = flow.kind + a + b;
        if (!drawn.has(key)) { drawn.add(key); segments.push(below ? [a, b, { below }] : [a, b]); }
      }
    }
    if (segments.length) flows.push({ kind: flow.kind, amount: flow.amount, vary: 0, segments });
  }
  const cutFlows = flows.filter(f => sample.flows.includes(f.kind));
  const bundle = (list, src) => {
    if (!list.length && !src.length) return null;
    const d = buildFlowPoints(list, ground, src);
    return { ...addPoints(d), weights: d.weights, animate: d.animate, clock: 0 };
  };
  const cut = bundle(cutFlows, []), rest = bundle(flows.filter(f => !cutFlows.includes(f)), sources);
  if (cut) cut.frost = linear(Float32Array.from({ length: cut.base.length }, (_, i) => blueStep(1)[i % 3]));
  // 대상의 가운데·크기
  const hit = items.find(i => i.hit), box = new THREE.Box3().setFromBufferAttribute(hit.pos), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const focus = mid.clone(), segments = cutFlows.flatMap(f => f.segments);
  let radius = Math.max(size.x, size.z) / 2, spot = [mid.x, box.min.y, mid.z], burst = spot;
  let markAt = new THREE.Vector3(mid.x, box.max.y + 0.35, mid.z);
  if (sample.fx === 'pipeBurst') { // 가장 긴 물관의 가운데가 터진다
    const seg = segments.reduce((a, b) => (arcPath(...b.slice(0, 2), ground).length > arcPath(...a.slice(0, 2), ground).length ? b : a));
    burst = arcPath(seg[0], seg[1], ground).at(0.5);
    focus.set(...burst); spot = [burst[0], ground(burst[0], burst[2]), burst[2]]; radius = 1.3;
    markAt = new THREE.Vector3(burst[0], burst[1] + 1, burst[2]);
  }
  let spots = [], crew = null, seedAt = null, reach = null, wide = null;
  if (sample.fx === 'crew') { // 대상 장치 앞(카메라 쪽)에서 정비하던 대원들
    const at = hit.data.spots[0], cx = at[0] + 0.45, cz = at[2] + 1.3;
    spots = [[0, 0], [0.75, 0.25], [-0.7, 0.3], [0.2, 0.85], [-0.45, -0.5]].map(([x, z]) => [cx + x, cz + z]);
    spot = [cx, ground(cx, cz), cz]; radius = 1.2; focus.set(cx, spot[1] + 0.3, cz); markAt = new THREE.Vector3(cx, spot[1] + 1.05, cz);
    crew = await createCrew({ spots, ground, addPoints, linear });
    for (const item of items) item.hit = false; // 장치는 멀쩡하다
  }
  if (sample.fx === 'spread') { // 한쪽 끝에서 시작해 SPREAD_SECONDS 동안 장치 전체로 번진다
    seedAt = [box.min.x, box.min.y, box.max.z];
    const far = Math.hypot(size.x, size.y, size.z) + 0.5;
    reach = time => 0.3 + far * smooth(0.3, SPREAD_SECONDS, time);
    const p = hit.data.positions;
    hit.far = Float32Array.from({ length: p.length / 3 }, (_, i) => Math.hypot(p[i * 3] - seedAt[0], p[i * 3 + 1] - seedAt[1], p[i * 3 + 2] - seedAt[2]));
    hit.clean = linear(tintLayer(hit.data.levels, 'new'));
    // 장치 밖: 바닥을 타고 둘레로 퍼지고, 닿은 건물도 물든다
    wide = time => radius * 0.5 + (SPREAD_WIDE + radius * 0.5) * smooth(1, SPREAD_WIDE_SECONDS, time);
    for (const item of items) if (item !== hit) {
      const q = item.data.positions;
      item.far = Float32Array.from({ length: q.length / 3 }, (_, i) => Math.hypot(q[i * 3] - spot[0], q[i * 3 + 2] - spot[2]));
      item.clean = item.cold; item.outer = true;
    }
  }
  if (sample.fx === 'quake') hit.rest = hit.data.positions.slice();
  const fx = FX[sample.fx]({ center: spot, radius, top: box.max.y, segments, ground, burst, targetPoints: hit.data.positions, dir: [0.94, -0.34], spots, seedAt, reach, wide, wideFar: SPREAD_WIDE });
  const extra = addPoints(fx);
  const ring = addPoints({ positions: new Float32Array(360 * 3), colors: Float32Array.from({ length: 360 * 3 }, (_, i) => orange(1)[i % 3]) }, 0.3); // 바닥 경고 고리
  const whole = new THREE.Box3();
  for (const i of items) whole.union(new THREE.Box3().setFromBufferAttribute(i.pos));
  const wc = whole.getCenter(new THREE.Vector3()), ws = whole.getSize(new THREE.Vector3()), dir = new THREE.Vector3(0.35, 0.55, 1).normalize();
  const dist = sample.fx === 'crew' ? 4.6 : sample.fx === 'spread' ? 8.5 : sample.fx === 'quake' ? Math.max(9, radius * 3) : sample.fx === 'storm' ? Math.max(13, radius * 4) : Math.max(7.5, radius * 4.2);
  world = { crew, reach, wide, hit, terrain, items, cut, rest, fx, extra, ring, spot, radius, ground, markAt,
    home: { q: wc, p: wc.clone().addScaledVector(dir, Math.max(13, Math.max(ws.x, ws.z) * 1.5)) },
    near: { q: focus, p: focus.clone().addScaledVector(dir, dist * (innerWidth > 760 ? 1 : 1.7)) } };
}

function fly(target, ms) {
  from.p.copy(camera.position); from.q.copy(controls.target); to.p.copy(target.p); to.q.copy(target.q);
  tween = { at: performance.now(), ms: calm ? 1 : ms };
}
function resize() {
  const w = innerWidth, h = innerHeight, side = w > 760;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.setViewOffset(w, h, side ? 190 : 0, side ? 0 : h * 0.2, w, h); // 카드가 가리지 않는 쪽 가운데로
}
addEventListener('resize', resize); resize();
controls.addEventListener('start', () => { tween = null; });

const GAUGES = {
  air: ['공기', '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>'],
  water: ['물', '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>'],
  food: ['식량', '<path d="M12 21V9M12 13c-4 0-6-2-6-6 4 0 6 2 6 6zM12 11c0-4 2-6 6-6 0 4-2 6-6 6z"/>'],
  power: ['전력', '<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>'],
  home: ['건물', '<path d="M4 20V10l8-6 8 6v10zM12 4l-2 6 4 3-3 7"/>'],
  people: ['대원', '<circle cx="12" cy="6" r="3"/><path d="M5 21c0-6 3-9 7-9s7 3 7 9M20 4v4M20 10.5v.5"/>']
};
const svg = key => {
  const s = make('span', 'ico');
  s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' + GAUGES[key][1] + '</svg>';
  return s;
};
// 손익 표시: 정확한 숫자 대신 크기만 (▼ 작음 · ▼▼ 보통 · ▼▼▼ 큼). 숫자는 게임 계산(events.js outcome)을 그대로 쓴다
const grade = v => (Math.abs(v) <= 6 ? 1 : Math.abs(v) <= 14 ? 2 : 3);
function chips(response) {
  const row = make('span', 'fx-chips');
  outcome(event, response, sample.selection, sample.week).forEach((part, i) => {
    for (const [key, value, weekly] of [...Object.entries(part.now ?? {}), ...Object.entries(part.weekly ?? {}).map(e => [...e, true])]) {
      if (!value) continue;
      const word = GAUGES[key][0], chip = make('span', 'chip-fx' + (value > 0 ? ' up' : ''));
      chip.append(svg(key), make('b', null, word + ' ' + (value > 0 ? '▲' : '▼').repeat(grade(value)) + (weekly ? ' 매주' : i ? ' 다음 주' : '')));
      row.append(chip);
    }
  });
  return row;
}
const meets = r => Object.entries(r ?? {}).every(([k, ids]) => ids.includes(sample.selection[k]));
const open = event.responses.filter(r => meets(r.requires));
const SECONDS = PLANET.events.timerSeconds;

function showCard() {
  const card = $('#lab-card');
  card.className = 'ask'; card.hidden = false;
  const head = make('div', 'head'), words = make('div'), title = make('h2', null, event.name), big = svg(sample.icon);
  title.id = 'lab-title'; big.classList.add('big');
  words.append(title, make('p', null, sample.short)); head.append(big, words);
  const timer = make('div', 'timer'), fill = make('i'), bar = make('span'), num = make('b', null, SECONDS + '초');
  bar.append(fill); timer.setAttribute('role', 'timer'); timer.append(bar, num);
  const list = make('div', 'options');
  open.forEach((r, i) => {
    const b = make('button'); b.type = 'button';
    b.append(make('kbd', null, String(i + 1)), make('b', 'name', r.label), chips(r));
    b.addEventListener('click', () => answer(r)); list.append(b);
  });
  card.replaceChildren(head, timer, list);
  view = { fill, num, card }; left = SECONDS; clockOn = true; lastTick = performance.now();
  list.firstChild.focus({ preventScroll: true });
}
function answer(r) {
  if (state !== 'ask') return;
  state = 'done'; answered = r.id; clockOn = false; healTo = sample.heal[r.id] ?? 0;
  document.body.classList.remove('alarm');
  const card = $('#lab-card'), late = r.id === 'timeout', again = make('button', 'again', '다시 보기'), title = make('h2', null, late ? '시간 초과' : r.label);
  card.className = late ? 'result bad' : 'result'; title.id = 'lab-title';
  again.type = 'button'; again.addEventListener('click', play);
  card.replaceChildren(title, chips(r), make('p', 'note', r.result), again);
  again.focus({ preventScroll: true });
  if (healTo >= 1) $('#lab-mark').hidden = true;
}
let startTimer, cardTimer;
function play() {
  clearTimeout(startTimer); clearTimeout(cardTimer);
  state = 'calm'; answered = null; heal = healTo = 0; clockOn = false;
  $('#lab-card').hidden = true; $('#lab-mark').hidden = true; document.body.classList.remove('alarm');
  fly(world.home, 500);
  startTimer = setTimeout(() => {
    state = 'ask'; t0 = performance.now();
    document.body.classList.add('alarm'); $('#lab-mark').hidden = false; fly(world.near, 1500);
  }, 1400);
  cardTimer = setTimeout(showCard, 2500);
}
$('#lab-play').addEventListener('click', () => world && play());
addEventListener('keydown', e => { const r = open[Number(e.key) - 1]; if (state === 'ask' && clockOn && r) { e.preventDefault(); answer(r); } });

const v = new THREE.Vector3();
function draw(now, dt) {
  const { terrain, items, cut, rest, fx, extra, ring, spot, radius, ground } = world, on = state === 'ask' || state === 'done', t = on ? (now - t0) / 1000 : 0;
  heal += clamp(healTo - heal, -dt / 1.6, dt / 1.6);
  const focus = on ? smooth(0, 0.8, t) * (1 - heal) : 0, broken = on ? smooth(0, 1.2, t) * (1 - heal) : 0;
  // 꺼질 때 깜빡임: 1초에 세 번보다 적게 번쩍인다
  const flick = sample.fx === 'powerdown' && !calm && t < 2.2 ? (hash(Math.floor(t * 5)) > 0.45 ? 1 : 0.12) : 1;
  const hitLight = { powerdown: 0.42 + 0.22 * Math.sin(t * 4), pipeBurst: 0.8 + 0.2 * Math.sin(t * 4), quake: 0.85 + 0.15 * Math.sin(t * 4), spread: 1, crew: 1, storm: 1 - 0.6 * smooth(2, 6, t) }[sample.fx];
  for (const item of items) {
    const a = item.col.array, b = item.base, c = item.hit ? item.alarm : item.cold, light = item.hit ? 1 + (hitLight * flick - 1) * broken : 1;
    if (item.far) { // 번짐: 앞면이 지나간 점은 주황, 앞면은 밝게, 아직 멀쩡한 점은 크림
      const front = (item.outer ? world.wide(t) : world.reach(t)) * broken;
      for (let i = 0; i < item.far.length; i++) {
        const d = front - item.far[i], sick = focus > 0 ? smooth(-0.1, 0.25, d) : 0, edge = focus > 0 ? Math.max(0, 1 - Math.abs(d) / 0.3) : 0;
        for (let k = i * 3; k < i * 3 + 3; k++) { const well = b[k] + (item.clean[k] - b[k]) * focus; a[k] = (well + (c[k] - well) * sick) * (1 + 1.5 * edge); }
      }
    } else for (let i = 0; i < a.length; i++) a[i] = (b[i] + (c[i] - b[i]) * focus) * light;
    if (item.rest) { // 흔들림: 떨다가 (2.5초) 기운 채로 남는다. 고치면 되돌아온다
      const quiver = calm ? 0 : 0.05 * broken * (1 - smooth(1.2, 3.2, t) * 0.85), tilt = 0.1 * smooth(0.4, 2, t) * broken, co = Math.cos(tilt), si = Math.sin(tilt), p = item.pos.array, o = item.rest;
      const qx = quiver * Math.sin(now / 37), qz = quiver * Math.sin(now / 29 + 1);
      for (let i = 0; i < p.length; i += 3) { const x = o[i] - spot[0], y = o[i + 1] - spot[1]; p[i] = spot[0] + x * co - y * si + qx; p[i + 1] = spot[1] + x * si + y * co; p[i + 2] = o[i + 2] + qz; }
      item.pos.needsUpdate = true;
    }
    item.col.needsUpdate = true;
  }
  const lit = 1 - (sample.fx === 'storm' ? 0.85 : 0.8) * focus;
  if (terrain.lit !== lit) {
    for (let i = 0; i < terrain.base.length; i++) terrain.col.array[i] = terrain.base[i] * lit;
    terrain.col.needsUpdate = true; terrain.lit = lit;
  }
  if (rest) { rest.clock += dt; rest.animate(rest.pos.array, rest.col.array, rest.base, rest.clock, 1 - 0.5 * focus); rest.pos.needsUpdate = rest.col.needsUpdate = true; }
  if (cut) {
    const freeze = sample.fx === 'pipeBurst';
    cut.clock += dt * (1 - broken);
    cut.animate(cut.pos.array, cut.col.array, cut.base, cut.clock, freeze ? 1 - 0.9 * broken : 0.04 + (1 - broken) * 0.96 * flick);
    if (freeze) for (let i = 0; i < cut.base.length; i++) if (cut.weights[i / 3 | 0] > 0) cut.col.array[i] += cut.frost[i] * 0.12 * broken; // 관만 얼어 빛나고 물 덩어리는 어두워진다
    cut.pos.needsUpdate = cut.col.needsUpdate = true;
  }
  world.crew?.frame(dt, on ? state : 'calm', answered, t, heal);
  extra.points.visible = on && broken > 0.01;
  if (extra.points.visible) { fx.frame(extra.pos.array, extra.col.array, extra.base, t, broken); extra.pos.needsUpdate = extra.col.needsUpdate = true; }
  ring.points.visible = on && focus > 0.01;
  if (ring.points.visible) {
    const u = calm ? 0.3 : (t * 0.7) % 1;
    for (let i = 0; i < 360; i++) {
      const a = i / 180 * Math.PI, wave = i % 2, r = (radius + 0.25) * (wave ? 1 + 0.7 * u : 1), x = spot[0] + Math.cos(a) * r, z = spot[2] + Math.sin(a) * r;
      ring.pos.setXYZ(i, x, ground(x, z) + 0.05, z);
      for (let c = 0; c < 3; c++) ring.col.array[i * 3 + c] = ring.base[i * 3 + c] * focus * (wave ? 1 - u : 0.8);
    }
    ring.pos.needsUpdate = ring.col.needsUpdate = true;
  }
  const mark = $('#lab-mark');
  if (!mark.hidden) { v.copy(world.markAt).project(camera); mark.style.transform = `translate(${Math.round((v.x + 1) / 2 * innerWidth)}px,${Math.round((1 - v.y) / 2 * innerHeight)}px)`; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.5, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  if (tween) {
    const e = smooth(0, 1, (now - tween.at) / tween.ms);
    camera.position.lerpVectors(from.p, to.p, e); controls.target.lerpVectors(from.q, to.q, e);
    if (e >= 1) tween = null;
  }
  controls.update();
  camera.updateMatrixWorld();
  if (world) draw(now, dt);
  if (clockOn) {
    left -= Math.max(0, now - lastTick) / 1000; lastTick = now;
    view.fill.style.transform = 'scaleX(' + clamp(left / SECONDS) + ')';
    view.num.textContent = Math.max(0, Math.ceil(left)) + '초';
    view.card.classList.toggle('urgent', left <= 5);
    if (left <= 0) answer({ ...event.ignore, id: 'timeout' });
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
build().then(() => {
  $('#lab-status').hidden = true; $('#lab-mark b').textContent = sample.tag;
  camera.position.copy(world.home.p); controls.target.copy(world.home.q);
  play();
}).catch(error => { $('#lab-status').textContent = '견본을 열지 못했어요: ' + error.message; console.error(error); });
