// 돌발 사건 3D 연출 (2026-11-27). 견본 페이지(event-lab.html, src/lab/eventLab.js)의 연출을 게임 장면에 옮겼다.
// 사건이 터지면: 화면 테두리 경고 → 카메라가 고장 난 장치로 다가감 → 장치만 주황으로 남고 나머지는 어두워짐 →
// 연출(eventFx.js: 꺼짐·물관 파열·먼지 폭풍·흔들림·번짐·대원) → 대응을 고르면 고친 만큼 되돌아오고 → 카드를 닫으면 원래대로.
// 새 셰이더·머티리얼 없이 같은 점 머티리얼로 그린다. main.js 는 hooks(장면 손잡이)만 넘기고 매 장면 frame 을 부른다.
// events.js 는 setStage 로 받은 이 객체의 start · answer · end 를 부른다. 어떤 사건에 어떤 연출인지는 eventStage.json.
import { FX, hash } from './eventFx.js';
import { ALL_STEPS } from './choices.js';
import { blue, blueStep, orange, mint } from './palette.js';
import { smooth, clamp } from './terrain.js';
import { arcPath } from './flows.js';
import config from './eventStage.json' with { type: 'json' };

const SPREAD_WIDE = 1.8, SPREAD_WIDE_SECONDS = 6, SPREAD_SECONDS = 5, HEAL_SECONDS = 1.6;
export const ENTER_MS = 1300; // 경보가 울리고 카메라가 다가간 뒤 카드가 뜨기까지
const loss = r => ['now', 'later'].reduce((s, k) => s + Object.values(r?.[k] ?? {}).reduce((a, v) => a + Math.min(0, v), 0), 0)
  + 3 * Object.values(r?.weekly ?? {}).reduce((a, v) => a + Math.min(0, v), 0);
/** 대응 → 되돌아오는 정도 (0 그대로 ~ 1 다 고침). 시간 초과의 손해에 견준다 */
export function healOf(event, response) {
  if (!response || response.timeout || response.id === 'timeout' || !event.ignore) return 0;
  const worst = loss(event.ignore);
  return worst < 0 ? clamp(1 - loss(response) / worst) : 1;
}
/** 그 단계에서 고른 선지가 놓은 레이어 id 들 ('module' 이면 집) */
export function targetLayers(step, selection) {
  if (step === 'module') return ['module'];
  const choice = ALL_STEPS.find(s => s.id === step)?.choices.find(c => c.id === selection[step]);
  return choice?.overlays ?? (choice?.module ? ['module'] : []);
}
export const STAGED = config.events;

/**
 * hooks (main.js): layers() [{ id, data, points }] · flows() [{ kind, segments }] · ground(x, z) · addPoints({ positions, colors, weights? }, weight) → THREE.Points ·
 *   removePoints(points) · linear(srgb) · tint(levels, role) (placement.js tintLayer) · focus(center [x,y,z], distance) · restore() · people() [{ x, z }] ·
 *   toward([x,y,z]) 그 자리에서 카메라 쪽 바닥 방향 [x, z] · idle() 장면이 멈춰 있으면 true · project([x,y,z]) → [화면 x, y] | null · dimFlows(k) · dimTerrain(k) · dimFaces(k) · ready() 지역 화면이면 true · reducedMotion
 */
export function createEventStage(hooks) {
  let show = null;
  const mark = Object.assign(document.createElement('div'), { className: 'event-mark', hidden: true });
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = '<i></i><b></b>';
  document.body.append(mark);

  function build(event, selection) {
    const setup = STAGED[event.id], layers = hooks.layers();
    if (!setup || !layers.length) return null;
    const ids = targetLayers(setup.target, selection);
    let hit = layers.find(l => ids.includes(l.id)) ?? layers.find(l => l.id === 'module') ?? layers[0], fx = setup.fx;
    const cut = hooks.flows().filter(f => setup.flows.includes(f.kind)), segments = cut.flatMap(f => f.segments);
    if (fx === 'pipeBurst' && !segments.length) fx = 'powerdown';
    const crewSpots = hooks.people().slice(0, 6).map(p => [p.x, p.z]);
    if (fx === 'crew' && !crewSpots.length) fx = 'powerdown';
    const good = event.kind === 'good', ground = hooks.ground, p = hit.data.positions.slice();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
    }
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size = [x1 - x0, y1 - y0, z1 - z0];
    let radius = Math.max(size[0], size[2]) / 2, spot = [mid[0], y0, mid[2]], burst = spot, focus = mid, markAt = [mid[0], y1 + 0.35, mid[2]];
    if (fx === 'pipeBurst') { // 가장 긴 물관의 가운데가 터진다
      const seg = segments.reduce((a, b) => (arcPath(b[0], b[1], ground).length > arcPath(a[0], a[1], ground).length ? b : a));
      burst = arcPath(seg[0], seg[1], ground).at(0.5);
      focus = burst; spot = [burst[0], ground(burst[0], burst[2]), burst[2]]; radius = 1.3; markAt = [burst[0], burst[1] + 1, burst[2]];
    }
    if (fx === 'drop') { // 보급 캡슐은 대상(집) 옆 빈 땅에 내린다
      const r = radius + 1.1, x = mid[0] + 0.94 * r, z = mid[2] - 0.34 * r, y = ground(x, z);
      spot = [x, y, z]; focus = [x, y + 1.1, z]; markAt = [x, y + 1.7, z]; radius = 1;
    }
    if (fx === 'crew') { // 그 자리에 있던 대원들 머리 위로 땀·숨 (장치는 멀쩡하다)
      const cx = crewSpots.reduce((s, q) => s + q[0], 0) / crewSpots.length, cz = crewSpots.reduce((s, q) => s + q[1], 0) / crewSpots.length;
      radius = Math.min(3, Math.max(1.2, ...crewSpots.map(q => Math.hypot(q[0] - cx, q[1] - cz) + 0.3)));
      spot = [cx, ground(cx, cz), cz]; focus = [cx, spot[1] + 0.3, cz]; markAt = [cx, spot[1] + 1.05, cz]; hit = null;
    }
    const items = layers.filter(l => l.data.levels).map(l => {
      const lv = l.data.levels, geometry = l.points.geometry;
      const tint = (fn, low, span) => { const o = new Float32Array(lv.length * 3); for (let i = 0; i < lv.length; i++) o.set(fn(low + span * lv[i]), i * 3); return hooks.linear(o); };
      const base = geometry.userData.baseColor;
      // 나쁜 사건: 대상은 주황, 나머지는 어두운 파랑 / 좋은 소식: 대상은 민트로 밝게, 나머지는 원래 색 그대로 조금 어둡게
      const item = { ...l, hit: l === hit, base, visible: l.points.visible, cold: good ? base.map(v => v * 0.55) : tint(blue, 0.12, 0.14), alarm: good ? tint(mint, 0.45, 0.45) : fx === 'frost' ? tint(blueStep, 0.7, 0.3) : tint(orange, 0.42, 0.3) };
      if (item.hit) l.points.visible = true; // 지난 주차 장치(면으로 그린 것)도 사건 중에는 선으로 보인다
      return item;
    });
    const hitItem = items.find(i => i.hit);
    let seedAt = null, reach = null, wide = null;
    if (fx === 'spread' && hitItem) { // 한쪽 끝에서 시작해 장치 전체로, 그다음 바닥을 타고 둘레 건물로 번진다
      seedAt = [x0, y0, z1];
      const far = Math.hypot(...size) + 0.5;
      reach = t => 0.3 + far * smooth(0.3, SPREAD_SECONDS, t);
      hitItem.far = Float32Array.from({ length: p.length / 3 }, (_, i) => Math.hypot(p[i * 3] - seedAt[0], p[i * 3 + 1] - seedAt[1], p[i * 3 + 2] - seedAt[2]));
      hitItem.clean = hooks.linear(hooks.tint(hitItem.data.levels, 'new'));
      wide = t => radius * 0.5 + (SPREAD_WIDE + radius * 0.5) * smooth(1, SPREAD_WIDE_SECONDS, t);
      for (const item of items) if (item !== hitItem) {
        const q = item.data.positions;
        item.far = Float32Array.from({ length: q.length / 3 }, (_, i) => Math.hypot(q[i * 3] - spot[0], q[i * 3 + 2] - spot[2]));
        item.clean = item.cold; item.outer = true;
      }
    }
    const motion = setup.motion ?? (fx === 'quake' ? 'tilt' : fx === 'rockfall' ? 'quiver' : null); // 대상 건물이 흔들리는 모양
    if (motion && hitItem) hitItem.rest = p;
    const effect = FX[fx]({ center: spot, radius, top: y1, segments, ground, burst, targetPoints: p, dir: fx === 'rockfall' ? hooks.toward?.(mid) ?? [0.94, -0.34] : [0.94, -0.34], spots: crewSpots, style: setup.style, seedAt, reach, wide, wideFar: SPREAD_WIDE });
    const extra = hooks.addPoints(effect, 0);
    const ring = hooks.addPoints({ positions: new Float32Array(360 * 3), colors: Float32Array.from({ length: 360 * 3 }, (_, i) => (good ? mint(1) : orange(1))[i % 3]) }, 0.3); // 바닥 고리 (경고 주황 · 좋은 소식 민트)
    const dist = fx === 'vent' ? 11 : fx === 'frost' || fx === 'cracks' ? Math.max(9, radius * 3.5) : fx === 'rockfall' ? Math.max(8, radius * 3.2) : fx === 'drop' ? 9.5 : fx === 'surge' ? Math.max(9, radius * 3.5) : fx === 'crew' ? 4.6 : fx === 'spread' ? 8.5 : fx === 'quake' ? Math.max(9, radius * 3) : fx === 'storm' ? Math.max(13, radius * 4) : Math.max(7.5, radius * 4.2);
    return { event, good, fx, motion, items, effect, extra, ring, spot, radius, focus, dist, markAt, reach, wide, cut: cut.length > 0, tag: setup.tag };
  }

  const stage = {
    /** 브리핑 창이 닫히고 장면이 멈출 때까지 (카메라 이동·건물 나타남은 길어도 6초) 기다린다. 사건 직전 게임을 멈출 때 쓴다 */
    settle() {
      const until = performance.now() + 6000;
      return new Promise(resolve => { const check = () => (!hooks.blocked?.() && (hooks.idle() || performance.now() > until) ? resolve() : setTimeout(check, 150)); check(); });
    },
    /** 사건이 뜰 때. 카메라가 다가간 뒤 끝나는 Promise (카드는 그 뒤에 뜬다). 연출이 없는 사건은 바로 끝난다 */
    start(event, selection) {
      stage.end(true);
      if (!STAGED[event.id] || !hooks.ready()) return Promise.resolve(false);
      try { show = build(event, selection); } catch (error) { console.warn('사건 연출을 만들지 못했어요', error); show = null; }
      if (!show) return Promise.resolve(false);
      Object.assign(show, { t0: performance.now(), last: performance.now(), heal: 0, healTo: 0 });
      hooks.focus(show.focus, show.dist);
      mark.querySelector('b').textContent = show.tag; mark.classList.toggle('good', show.good); mark.hidden = false; mark.style.visibility = 'hidden';
      document.body.classList.add('event-staged');
      if (window.terrainDiagnostics) window.terrainDiagnostics.eventStage = { id: event.id, fx: show.fx, hit: show.items.find(i => i.hit)?.id ?? null };
      return new Promise(resolve => setTimeout(() => resolve(true), hooks.reducedMotion ? 0 : ENTER_MS));
    },
    /** 대응을 골랐을 때 (시간 초과도) */
    answer(event, response) {
      if (!show) return;
      if (show.good) { show.healTo = 0.5; return; } // 좋은 소식: 고르면 잔잔해진 채로 카드를 닫을 때까지 남는다
      show.healTo = healOf(event, response);
      if (show.healTo >= 0.95) mark.hidden = true;
    },
    /** 카드를 닫았을 때: 더한 점을 지우고 색·자리·보임·카메라를 되돌린다 */
    end(quiet = false) {
      mark.hidden = true; document.body.classList.remove('event-staged');
      if (!show) return;
      const s = show; show = null;
      hooks.removePoints(s.extra); hooks.removePoints(s.ring);
      for (const item of s.items) {
        const geometry = item.points.geometry, col = geometry.getAttribute('color');
        if (col) { col.array.set(item.base); col.needsUpdate = true; }
        if (item.rest) { const pos = geometry.getAttribute('position'); pos.array.set(item.rest); pos.needsUpdate = true; }
        item.points.visible = item.visible;
      }
      hooks.dimFlows(1); hooks.dimTerrain(1); hooks.dimFaces(1);
      if (!quiet) hooks.restore();
    },
    frame(now) {
      if (!show) return;
      const s = show, dt = Math.min(0.1, Math.max(0, now - s.last) / 1000), t = Math.max(0, now - s.t0) / 1000, calm = hooks.reducedMotion;
      s.last = now;
      s.heal += clamp(s.healTo - s.heal, -dt / HEAL_SECONDS, dt / HEAL_SECONDS);
      const focus = smooth(0, 0.8, t) * (1 - s.heal), broken = smooth(0, 1.2, t) * (1 - s.heal);
      // 꺼질 때 깜빡임: 1초에 세 번보다 적게 번쩍인다
      const flick = !s.good && s.fx === 'powerdown' && !calm && t < 2.2 ? (hash(Math.floor(t * 5)) > 0.45 ? 1 : 0.12) : 1;
      const hitLight = { powerdown: 0.42 + 0.22 * Math.sin(t * 4), pipeBurst: 0.8 + 0.2 * Math.sin(t * 4), quake: 0.85 + 0.15 * Math.sin(t * 4), spread: 1, crew: 1, storm: 1 - 0.6 * smooth(2, 6, t), heat: 1.15 + 0.25 * Math.sin(t * 5), rockfall: 0.85, signal: hash(Math.floor(t * 8)) > 0.5 ? 0.95 : 0.45, cracks: 0.8, frost: 0.9, vent: 0.9 }[s.fx] ?? 1 + 0.25 * Math.sin(t * 3); // 좋은 소식: 민트로 숨 쉬듯 밝아진다
      for (const item of s.items) {
        const geometry = item.points.geometry, col = geometry.getAttribute('color'), a = col.array, b = item.base, c = item.hit ? item.alarm : item.cold;
        const light = item.hit ? 1 + (hitLight * flick - 1) * broken : 1;
        if (item.far) { // 번짐: 앞면이 지나간 점은 주황, 앞면은 밝게, 아직 멀쩡한 점은 크림
          const front = (item.outer ? s.wide(t) : s.reach(t)) * broken;
          for (let i = 0; i < item.far.length; i++) {
            const d = front - item.far[i], sick = focus > 0 ? smooth(-0.1, 0.25, d) : 0, edge = focus > 0 ? Math.max(0, 1 - Math.abs(d) / 0.3) : 0;
            for (let k = i * 3; k < i * 3 + 3; k++) { const well = b[k] + (item.clean[k] - b[k]) * focus; a[k] = (well + (c[k] - well) * sick) * (1 + 1.5 * edge); }
          }
        } else for (let i = 0; i < a.length; i++) a[i] = (b[i] + (c[i] - b[i]) * focus) * light;
        col.needsUpdate = true;
        if (item.rest) { // 흔들림: 떨다가 기운 채로 남는다. 고치면 되돌아온다
          // tilt: 떨다가 기운 채로 · quiver: 돌이 떨어지는 동안만 떨림 · sink: 조금 기울며 바닥으로 내려앉는다
          const m = s.motion, quiver = calm ? 0 : (m === 'quiver' ? 0.035 * (1 - smooth(3, 4.5, t)) : 0.05 * (1 - smooth(1.2, 3.2, t) * 0.85)) * broken;
          const tilt = (m === 'tilt' ? 0.1 : m === 'sink' ? 0.04 : 0) * smooth(0.4, 2, t) * broken, drop = m === 'sink' ? 0.22 * smooth(0.5, 3.5, t) * broken : 0, co = Math.cos(tilt), si = Math.sin(tilt);
          const pos = geometry.getAttribute('position'), q = pos.array, o = item.rest, qx = quiver * Math.sin(now / 37), qz = quiver * Math.sin(now / 29 + 1);
          for (let i = 0; i < q.length; i += 3) { const x = o[i] - s.spot[0], y = o[i + 1] - s.spot[1]; q[i] = s.spot[0] + x * co - y * si + qx; q[i + 1] = s.spot[1] + x * si + y * co - drop; q[i + 2] = o[i + 2] + qz; }
          pos.needsUpdate = true;
        }
      }
      hooks.dimTerrain(1 - (s.good ? 0.5 : s.fx === 'storm' ? 0.85 : 0.8) * focus);
      hooks.dimFaces(1 - (s.good ? 0.5 : 0.75) * focus); // 지난 주차 건물의 회색 면도 함께 물러난다
      // 끊긴 흐름: 물관 파열은 얼어붙듯 어두워지고, 나머지는 깜빡이며 거의 꺼진다. 끊긴 흐름이 없으면 함께 조금만 어두워진다
      hooks.dimFlows(s.good ? 1 : !s.cut ? 1 - 0.5 * focus : s.fx === 'pipeBurst' ? 1 - 0.9 * broken : 0.04 + (1 - broken) * 0.96 * flick);
      const ex = s.extra.geometry, exPos = ex.getAttribute('position'), exCol = ex.getAttribute('color');
      s.extra.visible = broken > 0.01;
      if (s.extra.visible) { s.effect.frame(exPos.array, exCol.array, ex.userData.baseColor, t, broken); exPos.needsUpdate = exCol.needsUpdate = true; }
      const rg = s.ring.geometry, rPos = rg.getAttribute('position'), rCol = rg.getAttribute('color'), base = rg.userData.baseColor;
      s.ring.visible = focus > 0.01;
      if (s.ring.visible) {
        const u = calm ? 0.3 : (t * 0.7) % 1;
        for (let i = 0; i < 360; i++) {
          const ang = i / 180 * Math.PI, wave = i % 2, r = (s.radius + 0.25) * (wave ? 1 + 0.7 * u : 1), x = s.spot[0] + Math.cos(ang) * r, z = s.spot[2] + Math.sin(ang) * r;
          rPos.setXYZ(i, x, hooks.ground(x, z) + 0.05, z);
          for (let c = 0; c < 3; c++) rCol.array[i * 3 + c] = base[i * 3 + c] * focus * (wave ? 1 - u : 0.8);
        }
        rPos.needsUpdate = rCol.needsUpdate = true;
      }
      if (!mark.hidden) {
        const at = hooks.project(s.markAt);
        mark.style.visibility = at ? 'visible' : 'hidden';
        if (at) mark.style.transform = `translate(${Math.round(at[0])}px,${Math.round(at[1])}px)`;
      }
    },
    get active() { return Boolean(show); },
  };
  return stage;
}
