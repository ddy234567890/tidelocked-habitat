// 메모장 창 = 지난 선택 돌아보기 (전개도). 선지판(hexBoard)이 받은 단계 상태를 주차별로 적어 두었다가, 열면 화면을 꽉 채운 전개도로 보여 준다.
// 시간은 왼쪽 → 오른쪽, 영향을 주고받은 선택끼리 가까이 모이고 바닥을 흐르는 선으로 이어진다 (굵을수록 영향이 크다).
// 토큰이 클수록 중대한 선택, 파랑은 얻은 게 많은 선택 · 주황은 잃은 게 많은 선택. 토큰에 올리거나 누르면 아래에 정보가 뜬다.
// 기록은 이 판 안에서만 한다 (main.js 는 기록만 넘긴다). 새로고침하면 처음부터 다시 적는다.
// (2026-11-28 사용자 요청으로 거품 지도 보기는 지웠다)
import { WEEKS } from './choices.js';
import { ICONS, iconOf } from './hexIcons.js';
import { relationsFor, weightsFor, balanceFor } from './relations.js';
import './field-notes.css';

const SVG = 'http://www.w3.org/2000/svg';
// 선지판 토큰과 같은 육각형 (꼭짓점이 위)
const hex = r => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const esc = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 득실 → 색 이름
const sideOf = b => (Math.abs(b.net) < 2 ? 'even' : b.net > 0 ? 'gain' : 'loss');

export function createFieldNotes() {
  const log = new Map();   // 주차 번호 → [{ short, step, done, choice }]

  const modal = document.createElement('div');
  modal.className = 'fn-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'fn-title');
  modal.innerHTML = `
    <section class="fn-full">
      <header class="fn-head"><h2 id="fn-title">MEMO://지난 선택 돌아보기</h2><p class="fn-legend"></p>
        <button type="button" class="fn-x" aria-label="지난 선택 닫기">×</button></header>
      <div class="fn-rows"></div>
      <ol class="fn-rank" aria-label="연관 순위"></ol>
    </section>
    <svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
      ${Object.entries(ICONS).map(([id, d]) => `<symbol id="fn-ic-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}
    </defs></svg>
    <div class="fn-tip" role="tooltip"></div>`;
  document.body.append(modal);
  const rows = modal.querySelector('.fn-rows'), tip = modal.querySelector('.fn-tip'), rankList = modal.querySelector('.fn-rank');
  let opener = null, pinned = null, links = [], nodes = [];
  const legend = modal.querySelector('.fn-legend');
  const LEGEND = '<span class="fn-key gain">파랑</span> 얻은 게 더 많은 선택 · <span class="fn-key loss">주황</span> 잃은 게 더 많은 선택 · <span class="fn-key even">회색</span> 비슷함. 왼쪽에서 오른쪽으로 고른 차례예요. 좌우로 끌어 둘러보고, 휠·방향키로 주차마다 당겨 볼 수 있어요. <b>선</b>은 앞 선택이 뒤 선택에 준 영향이고 <b>굵을수록</b> 영향이 커요. <b>토큰이 클수록</b> 중대한 선택이에요. 토큰에 올리면 그 선택의 영향만 보이고, 정보는 왼쪽 아래에 떠요.';

  // ---- 기록: 선지판이 update 받을 때마다 부른다 ----
  // history: 게임의 선택 전체 { selection, decided }. 있으면 지난 주차도 그것으로 다시 적는다 (바로가기로 건너뛴 주차도 채워진다)
  function record(steps, history) {
    const ids = steps.map(s => s.id).join('/');
    const k = WEEKS.findIndex(w => w.steps.map(s => s.id).join('/') === ids);
    if (k < 0) return;
    if (history) for (let w = 0; w < k; w++) log.set(w + 1, WEEKS[w].steps.map(s => {
      const c = history.decided[s.id] ? s.choices.find(x => x.id === history.selection[s.id]) : null;
      return { short: s.boardName ?? s.short ?? s.label, step: s.id, done: Boolean(c), choice: c && { id: c.id, label: c.label, line: c.line, gain: c.gain, cost: c.cost } };
    }));
    for (const w of [...log.keys()]) if (w > k + 1) log.delete(w); // 처음부터 다시 시작했으면 뒤 주차 기록을 지운다
    const prev = log.get(k + 1);
    log.set(k + 1, steps.map((s, i) => {
      const done = s.status === 'done';
      if (!done && prev?.[i]?.done) return prev[i];   // 한 번 결정한 단계는 이동 중 잠깐 들어오는 빈 상태로 덮이지 않게
      const c = done ? s.choices.find(x => x.id === s.selected) : null;
      return { short: s.short, step: s.id, done, choice: c && { id: c.id, label: c.label, line: c.line, gain: c.gain, cost: c.cost } };
    }));
    if (!modal.hidden) render();
  }

  // ---- 그리기 ----
  function render() {
    unpin(); stopFlow();
    const selection = {}, info = new Map();
    for (const wk of [...log.keys()].sort((a, b) => a - b)) log.get(wk).forEach((s, i) => {
      if (s.done && s.choice) { selection[s.step] = s.choice.id; info.set(s.step, { ...s, week: wk, order: i }); }
    });
    links = relationsFor(selection).filter(l => info.has(l.from.step) && info.has(l.to.step));
    const weights = weightsFor(selection), degree = {};
    for (const l of links) for (const s of [l.from.step, l.to.step]) degree[s] = (degree[s] ?? 0) + l.score;
    const bal = balanceFor(selection);
    nodes = [...info.values()].map(s => ({ ...s, w: (weights[s.step]?.weight ?? 1) + 0.12 * (degree[s.step] ?? 0), parts: weights[s.step], bal: bal[s.step] ?? { gain: 0, loss: 0, net: 0 } }));
    legend.innerHTML = LEGEND;
    if (!nodes.length) { rows.innerHTML = '<p class="fn-empty">아직 결정한 선택이 없어요.</p>'; rankList.hidden = true; return; }
    rankList.innerHTML = links.slice(0, 3).map((l, k) => `<li data-k="${k}"><b>${k + 1}</b><span>W${l.from.week} ${esc(l.from.label)} → W${l.to.week} ${esc(l.to.label)}</span><small>${esc(l.reasons[0].text)}${l.reasons.length > 1 ? ` 외 ${l.reasons.length - 1}가지` : ''}</small></li>`).join('');
    rankList.hidden = !links.length;
    renderNodes(Math.max(320, rows.clientWidth), Math.max(260, rows.clientHeight));
  }
  // ---- 전개도 보기 (2026-11-28 기본, 투시): 비스듬히 내려다보는 점 바닥 위에 토큰을 세운다 ----
  // 시간은 왼쪽 → 오른쪽 (고른 차례마다 한 칸), 앞뒤(깊이)는 영향을 주고받은 선택끼리 가까워지게 잡는다. 선은 영향뿐이고 셀수록 굵다.
  // 바닥은 작은 점들이고, 중대한 토큰 아래는 언덕처럼 솟는다. 열면: 점 바닥이 깔리고 → 토큰마다 위에서 점이 쏟아져 육각형으로 모이고 → 영향 선이 그려진다.
  // 휠 · 손가락으로 밀기 · 방향키 · 오른쪽 아래 단추로 주차 단위로 당겨 확대된다 (전체 → W1 → W2 …).
  const TILT = 38 * Math.PI / 180, FOCAL = 1000, ZOOM_MS = 950;
  const smooth01 = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  let flow = null;
  function stopFlow() { if (flow) cancelAnimationFrame(flow.raf); flow = null; }
  function renderNodes(W, H) {
    stopFlow();
    const list = nodes.slice().sort((a, b) => a.week - b.week || a.order - b.order), n = list.length, STEP = 150;
    const lo = Math.min(...list.map(p => p.w)), hi = Math.max(...list.map(p => p.w));
    // 평면 자리 (X 시간, Z 깊이: 앞쪽이 +)
    const pts = list.map((p, i) => ({ ...p, X: i * STEP, Z: ((i * 7) % 5 - 2) * 70, r: 15 + 13 * Math.pow((p.w - lo) / (hi - lo || 1), 0.8) }));
    const at = new Map(pts.map(p => [p.step, p]));
    const edges = links.map((l, k) => ({ l, k, a: at.get(l.from.step), b: at.get(l.to.step) })).filter(e => e.a && e.b);
    const sMin = Math.min(...links.map(l => l.score)), sMax = Math.max(...links.map(l => l.score));
    const widthOf = score => 1.2 + 6.3 * Math.pow((score - sMin) / (sMax - sMin || 1), 1.2);
    for (let it = 0; it < 360; it++) {
      for (const { a, b, l } of edges) { const d = (b.Z - a.Z) * 0.006 * l.score; a.Z += d; b.Z -= d; }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = pts[i], b = pts[j], dx = Math.abs(b.X - a.X);
        if (dx > 190) continue;
        const need = 90 + a.r + b.r - dx * 0.3, dz = b.Z - a.Z;
        if (Math.abs(dz) < need) { const push = (need - Math.abs(dz)) * 0.25 * (dz >= 0 ? 1 : -1) || 0.5; a.Z -= push; b.Z += push; }
      }
      for (const p of pts) { p.Z *= 0.998; p.Z = Math.max(-300, Math.min(300, p.Z)); }
    }
    const minX = pts[0].X, maxX = pts.at(-1).X, minZ = Math.min(...pts.map(p => p.Z)), maxZ = Math.max(...pts.map(p => p.Z));
    // 바닥 높이: 중대한 토큰 아래가 솟는다
    const hill = (X, Z) => pts.reduce((h, p) => h + p.r * 2.4 * Math.exp(-((X - p.X) ** 2 + (Z - p.Z) ** 2) / (2 * 75 * 75)), 0);
    pts.forEach(p => { p.ground = hill(p.X, p.Z); p.Y = p.ground + p.r * 1.6 + 10; });
    // 점 바닥
    const floor = [];
    for (let X = minX - 300; X <= maxX + 300; X += 48) for (let Z = minZ - 260; Z <= maxZ + 260; Z += 48) floor.push({ X, Z, Y: hill(X, Z) });
    // 영향 선: 바닥에 붙어 흐르는 곡선. 앞 토큰 그림자 가장자리에서 나가 뒤 토큰 그림자 가장자리로 들어간다.
    // 두 점을 잇는 방향으로 부드럽게 휘고 (꺾임 없음), 바닥 높이를 따라 살짝만 뜬다
    const curves = edges.map(e => {
      const dx = e.b.X - e.a.X, dz = e.b.Z - e.a.Z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      const A = [e.a.X + ux * e.a.r * 1.25, e.a.Z + uz * e.a.r * 1.25], B = [e.b.X - ux * e.b.r * 1.25, e.b.Z - uz * e.b.r * 1.25];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), bend = Math.min(0.35, 40 / (len || 1)) * (e.k % 2 ? 1 : -1); // 겹치지 않게 번갈아 살짝 휜다
      const C = [(A[0] + B[0]) / 2 - uz * len * bend, (A[1] + B[1]) / 2 + ux * len * bend], samples = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32, u = 1 - t, X = u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], Z = u * u * A[1] + 2 * u * t * C[1] + t * t * B[1];
        samples.push([X, hill(X, Z) + 3, Z]);
      }
      return { ...e, samples };
    });
    const weeks = [...new Set(pts.map(p => p.week))].map(wk => {
      const row = pts.filter(p => p.week === wk);
      return { wk, x0: row[0].X - STEP / 2, x1: row.at(-1).X + STEP / 2, cx: row.reduce((s, p) => s + p.X, 0) / row.length, cz: row.reduce((s, p) => s + p.Z, 0) / row.length };
    });

    // ---- 그리기 요소 ----
    const svg = [];
    svg.push(`<g class="fn-floor">${floor.map(() => '<circle r="1"/>').join('')}</g>`);
    svg.push(`<g class="fn-bands">${weeks.map(w => `<polygon class="fn-band${w.wk % 2 ? '' : ' alt'}"/><text class="fn-wkl">W${w.wk}</text>`).join('')}</g>`);
    svg.push(`<g class="fn-shadows">${pts.map(() => '<polygon class="fn-shadow"/><line class="fn-stem"/>').join('')}</g>`);
    svg.push(`<g class="fn-wires">${curves.slice().reverse().map(({ l, k }) => `<path class="fn-wire${k < 3 ? ' top' : ''}" data-a="${esc(l.from.step)}" data-b="${esc(l.to.step)}" data-k="${k}"/>`).join('')}</g>`);
    svg.push(`<g class="fn-badges">${curves.filter(c => c.k < 3).map(({ k }) => `<g class="fn-badge" data-k="${k}"><circle r="10"/><text y="4">${k + 1}</text></g>`).join('')}</g>`);
    // 토큰: 위에서 쏟아지는 점(불꽃)이 육각형 자리로 모인 뒤 몸체가 나타난다
    const sparkOf = r => {
      const out = [];
      for (let i = 0; i < 54; i++) {
        let tx, ty;
        if (i < 42) { const k = i / 42 * 6, side = Math.floor(k), f = k - side, a0 = Math.PI / 3 * side - Math.PI / 2, a1 = a0 + Math.PI / 3; tx = r * (Math.cos(a0) * (1 - f) + Math.cos(a1) * f); ty = r * (Math.sin(a0) * (1 - f) + Math.sin(a1) * f); }
        else { const a = Math.random() * 6.28, d = Math.random() * r * 0.6; tx = Math.cos(a) * d; ty = Math.sin(a) * d; }
        out.push({ tx, ty, sx: tx + (Math.random() - 0.5) * 70, sy: -160 - Math.random() * 220, lag: Math.random() * 0.35 });
      }
      return out;
    };
    pts.forEach(p => { p.sparks = sparkOf(p.r); });
    for (const p of pts) svg.push(`<g class="fn-n ${sideOf(p.bal)}" data-step="${esc(p.step)}" tabindex="0" role="button" aria-label="W${p.week} ${esc(p.short)}: ${esc(p.choice.label)}">
        <g class="fn-body" style="opacity:0"><circle class="hit" r="${(p.r + 6).toFixed(1)}"/><polygon class="halo" points="${hex(p.r + 6)}"/><polygon class="tok" points="${hex(p.r)}"/><polygon class="tok-in" points="${hex(p.r - 4)}"/>
        <use href="#fn-ic-${iconOf(p.choice.id)}" x="${(-p.r * 0.55).toFixed(1)}" y="${(-p.r * 0.55).toFixed(1)}" width="${(p.r * 1.1).toFixed(1)}" height="${(p.r * 1.1).toFixed(1)}" class="ic"/>
        <g class="fn-sign" transform="translate(${(p.r * 0.8).toFixed(1)} ${(-p.r * 0.8).toFixed(1)})"><circle r="7"/><text y="4">${p.bal.net > 1 ? '+' : p.bal.net < -1 ? '−' : '='}</text></g></g>
        <g class="fn-spark">${p.sparks.map(() => '<circle r="1.4"/>').join('')}</g>
        <g class="fn-labels" style="opacity:0"><text class="lab">${esc(p.choice.label)}</text><text class="sub">${esc(p.short)} · <tspan class="g">득 +${p.bal.gain}</tspan> <tspan class="l">실 −${p.bal.loss}</tspan></text></g>
      </g>`);
    const pager = `<nav class="fn-pager" aria-label="주차 보기"><button type="button" data-f="-1">전체</button>${weeks.map((w, i) => `<button type="button" data-f="${i}">W${w.wk}</button>`).join('')}<span class="fn-hint">휠 · 밀기 · ←→ 로 주차 넘기기</span></nav>`;
    rows.innerHTML = `<svg class="fn-map nodes flow3d" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="${SVG}">${svg.join('')}</svg>${pager}`;
    const map = rows.querySelector('.fn-map');
    const el = {
      dots: [...map.querySelectorAll('.fn-floor circle')], bands: [...map.querySelectorAll('.fn-band')], wkl: [...map.querySelectorAll('.fn-wkl')],
      shadows: [...map.querySelectorAll('.fn-shadow')], stems: [...map.querySelectorAll('.fn-stem')], wires: new Map([...map.querySelectorAll('.fn-wire')].map(w => [Number(w.dataset.k), w])),
      badges: new Map([...map.querySelectorAll('.fn-badge')].map(b => [Number(b.dataset.k), b])), nodes: [...map.querySelectorAll('.fn-n')]
    };
    el.nodes.forEach((g, i) => { pts[i].g = g; pts[i].body = g.querySelector('.fn-body'); pts[i].labels = g.querySelector('.fn-labels'); pts[i].lab = g.querySelector('.lab'); pts[i].sub = g.querySelector('.sub'); pts[i].sparkEls = [...g.querySelectorAll('.fn-spark circle')]; });

    // ---- 카메라 ----
    const bottom = rankList.hidden ? 60 : rankList.offsetHeight + 70, top = 54, cx = W / 2, cy = top + (H - top - bottom) / 2;
    const project = (X, Y, Z, cam) => {
      const dx = (X - cam.tx) * cam.s, dy = Y * cam.s, dz = (Z - cam.tz) * cam.s;
      const up = dy * Math.cos(TILT) - dz * Math.sin(TILT), depth = -dy * Math.sin(TILT) - dz * Math.cos(TILT), k = FOCAL / Math.max(120, FOCAL + depth);
      return [cx + cam.ox + dx * k, cy + cam.oy - up * k, k];
    };
    // 전체 보기: 모든 토큰이 화면에 들어오게 크기와 가운데를 맞춘다
    const overview = () => {
      const cam = { tx: (minX + maxX) / 2, tz: (minZ + maxZ) / 2, s: 1, ox: 0, oy: 0 };
      for (let it = 0; it < 4; it++) {
        const sp = pts.map(p => project(p.X, p.Y, p.Z, cam));
        const x0 = Math.min(...sp.map(q => q[0])), x1 = Math.max(...sp.map(q => q[0])), y0 = Math.min(...sp.map(q => q[1])), y1 = Math.max(...sp.map(q => q[1]));
        cam.s *= Math.min((W - 220) / (x1 - x0 || 1), (H - top - bottom - 90) / (y1 - y0 || 1));
        const sp2 = pts.map(p => project(p.X, p.Y, p.Z, cam));
        cam.ox += cx - (Math.min(...sp2.map(q => q[0])) + Math.max(...sp2.map(q => q[0]))) / 2;
        cam.oy += cy - (Math.min(...sp2.map(q => q[1])) + Math.max(...sp2.map(q => q[1]))) / 2;
      }
      return cam;
    };
    const home = overview();
    // 주차 보기: 그 주 토큰들이 화면 가운데에 오게 (토큰이 바닥보다 떠 있어서 그만큼 내려 맞춘다)
    const weekCam = i => {
      const cam = { tx: weeks[i].cx, tz: weeks[i].cz, s: Math.min(2.4, Math.max(home.s * 2, (W * 0.55) / (weeks[i].x1 - weeks[i].x0))), ox: 0, oy: 0 };
      const sp = pts.filter(p => p.week === weeks[i].wk).map(p => project(p.X, p.Y, p.Z, cam));
      cam.ox = cx - (Math.min(...sp.map(q => q[0])) + Math.max(...sp.map(q => q[0]))) / 2;
      cam.oy = cy - (Math.min(...sp.map(q => q[1])) + Math.max(...sp.map(q => q[1]))) / 2 - 20;
      return cam;
    };
    flow = { raf: 0, t0: performance.now(), focus: -1, cam: { ...home }, from: null, to: null, tw: 0, weeks, pager: rows.querySelector('.fn-pager') };
    const calm = reduced();
    if (calm) flow.t0 -= 60000;
    const setFocus = f => {
      if (!flow) return;
      f = Math.max(-1, Math.min(weeks.length - 1, f));
      flow.focus = f; unpin();
      flow.from = { ...flow.cam }; flow.to = f < 0 ? { ...home } : weekCam(f); flow.tw = performance.now();
      if (calm) flow.cam = { ...flow.to };
      flow.pager.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.f) === f));
      kick();
    };
    flow.setFocus = setFocus;
    // 좌우로 밀기: 카메라 중심을 시간 줄 위에서 옮긴다 (판 양끝을 조금 넘어서까지)
    flow.pan = tx => { flow.to = null; flow.cam.tx = Math.max(minX - STEP, Math.min(maxX + STEP, tx)); kick(); };
    flow.pager.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { e.stopPropagation(); setFocus(Number(b.dataset.f)); } });
    flow.pager.querySelector('[data-f="-1"]').classList.add('on');

    const ease = u => 1 - Math.pow(1 - u, 3);
    function tick(now) {
      if (!flow) return;
      const t = (now - flow.t0) / 1000;
      let moving = false;
      if (flow.to) {
        const u = Math.min(1, (now - flow.tw) / ZOOM_MS), e = ease(u);
        for (const key of ['tx', 'tz', 's', 'ox', 'oy']) flow.cam[key] = flow.from[key] + (flow.to[key] - flow.from[key]) * e;
        if (u >= 1) flow.to = null; else moving = true;
      }
      const cam = flow.cam;
      // 점 바닥: 왼쪽부터 깔린다, 멀수록 흐리다
      floor.forEach((d, i) => {
        const [x, y, k] = project(d.X, d.Y, d.Z, cam), show = smooth01(0, 0.7, t - (d.X - minX + 300) / (maxX - minX + 600) * 0.8);
        const c = el.dots[i], vis = x > -20 && x < W + 20 && y > -20 && y < H + 20;
        c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1)); c.setAttribute('r', Math.max(0.4, Math.min(2.6, 1.15 * k * Math.sqrt(cam.s))).toFixed(2));
        c.style.opacity = vis ? (show * Math.min(1, 0.25 + 0.75 * k * k) * (0.35 + Math.min(0.65, d.Y / 60))).toFixed(2) : 0;
      });
      weeks.forEach((w, i) => {
        const z0 = minZ - 200, z1 = maxZ + 200, q = [[w.x0, z0], [w.x1, z0], [w.x1, z1], [w.x0, z1]].map(([X, Z]) => project(X, 0, Z, cam));
        el.bands[i].setAttribute('points', q.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
        el.bands[i].style.opacity = smooth01(0.2, 0.9, t);
        const lp = project((w.x0 + w.x1) / 2, 0, z0, cam);
        el.wkl[i].setAttribute('x', lp[0].toFixed(1)); el.wkl[i].setAttribute('y', (lp[1] - 8).toFixed(1)); el.wkl[i].style.opacity = smooth01(0.3, 1, t) * (flow.focus < 0 || flow.focus === i ? 1 : 0.35);
      });
      // 토큰
      const lastIn = 0.35 + (n - 1) * 0.09 + 1.1;
      pts.forEach((p, i) => {
        const [x, y, k] = project(p.X, p.Y, p.Z, cam), g = cam.s * k, start = 0.35 + i * 0.09;
        p.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${g.toFixed(3)})`);
        const sh = [...Array(6)].map((_, j) => { const a = Math.PI / 3 * j - Math.PI / 2; return project(p.X + Math.cos(a) * p.r * 1.25, p.ground + 1, p.Z + Math.sin(a) * p.r * 1.25, cam); });
        el.shadows[i].setAttribute('points', sh.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '));
        el.shadows[i].style.opacity = smooth01(start + 0.5, start + 1, t);
        const foot = project(p.X, p.ground + 1, p.Z, cam), stem = el.stems[i]; // 그림자에서 토큰까지 가는 기둥
        stem.setAttribute('x1', foot[0].toFixed(1)); stem.setAttribute('y1', foot[1].toFixed(1)); stem.setAttribute('x2', x.toFixed(1)); stem.setAttribute('y2', (y + p.r * g * 0.9).toFixed(1));
        stem.style.opacity = smooth01(start + 0.7, start + 1.05, t);
        p.body.style.opacity = smooth01(start + 0.7, start + 1.05, t);
        p.labels.style.opacity = smooth01(start + 0.8, start + 1.2, t);
        // 이름은 화면에서 읽을 만한 크기로 (토큰이 작아져도)
        const ls = Math.max(1, 0.9 / g), base = (p.r + 6) / ls + 14; // 이름 줄 단위 (글자 크기와 같은 단위라 겹치지 않는다)
        p.labels.setAttribute('transform', `scale(${ls.toFixed(3)})`);
        p.lab.setAttribute('y', base.toFixed(1)); p.sub.setAttribute('y', (base + 15).toFixed(1));
        if (t < start + 1.6) {
          p.sparks.forEach((s, j) => {
            const u = smooth01(start + s.lag, start + s.lag + 0.75, t), c = p.sparkEls[j];
            c.setAttribute('cx', (s.sx + (s.tx - s.sx) * u).toFixed(1)); c.setAttribute('cy', (s.sy + (s.ty - s.sy) * u).toFixed(1));
            c.style.opacity = t < start + s.lag ? 0 : (1 - smooth01(start + 1.05, start + 1.5, t)).toFixed(2);
          });
          moving = true;
        } else if (p.sparkEls[0].style.opacity !== '0') p.sparkEls.forEach(c => { c.style.opacity = 0; });
      });
      // 영향 선: 토큰이 다 나온 뒤 차례로 그려진다
      curves.forEach(cv => {
        const path = el.wires.get(cv.k), q = cv.samples.map(([X, Y, Z]) => project(X, Y, Z, cam));
        path.setAttribute('d', 'M' + q.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));
        const mid = q[14], width = widthOf(cv.l.score) * Math.max(0.6, Math.min(1.3, Math.sqrt(cam.s * mid[2])));
        path.style.setProperty('--w', width.toFixed(2) + 'px');
        const begin = lastIn + (cv.l.from.week - 1) * 0.12 + cv.k * 0.05, draw = smooth01(begin, begin + 0.8, t);
        if (draw < 1) { const len = path.getTotalLength(); path.style.strokeDasharray = `${(len * draw).toFixed(1)} ${len.toFixed(1)}`; moving = true; }
        else if (path.style.strokeDasharray) path.style.strokeDasharray = '';
        const b = el.badges.get(cv.k);
        if (b) { b.setAttribute('transform', `translate(${mid[0].toFixed(1)} ${mid[1].toFixed(1)})`); b.style.opacity = smooth01(begin + 0.7, begin + 1, t); }
      });
      flow.raf = moving ? requestAnimationFrame(tick) : 0;
    }
    function kick() { if (flow && !flow.raf) flow.raf = requestAnimationFrame(tick); }
    flow.kick = kick;
    kick();
  }
  // 주차 넘기기: 휠 · 손가락으로 밀기 · 방향키 (전개도 보기에서만)
  let wheelAt = 0, swipe = null;
  rows.addEventListener('wheel', e => {
    if (!flow?.setFocus) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 520 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
    wheelAt = now; flow.setFocus(flow.focus + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
  }, { passive: false });
  rows.addEventListener('pointerdown', e => { if (flow && e.pointerType !== 'mouse') swipe = [e.clientX, e.clientY]; });
  // 마우스로 끌어 둘러보기: 좌우로 끌면 시간 줄을 따라 판이 옆으로 밀린다
  let drag = null, dragged = false;
  rows.addEventListener('pointerdown', e => {
    if (!flow?.pan || e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.fn-pager')) return;
    drag = { x: e.clientX, tx: flow.cam.tx, moved: false }; dragged = false;
  });
  addEventListener('pointermove', e => {
    if (!drag || !flow?.pan) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true; dragged = true; rows.classList.add('dragging');
    flow.pan(drag.tx - dx / (flow.cam.s || 1));
    if (pinned) unpin();
  });
  addEventListener('pointerup', () => { if (drag) { drag = null; rows.classList.remove('dragging'); setTimeout(() => { dragged = false; }, 0); } });
  rows.addEventListener('pointerup', e => {
    if (!flow?.setFocus || !swipe) return;
    const dx = e.clientX - swipe[0], dy = e.clientY - swipe[1]; swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 40) flow.setFocus(flow.focus + ((Math.abs(dx) > Math.abs(dy) ? -dx : -dy) > 0 ? 1 : -1));
  });
  addEventListener('keydown', e => {
    if (modal.hidden || !flow?.setFocus) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); flow.setFocus(flow.focus + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); flow.setFocus(flow.focus - 1); }
    else if (e.key === 'Home') { e.preventDefault(); flow.setFocus(-1); }
  });
  // 토큰이나 순위에 올리면 그와 이어진 토큰·선만 밝게 (나머지는 물러난다)
  function focusOn(steps) {
    const map = rows.querySelector('.fn-map');
    if (!map) return;
    map.classList.toggle('focus', Boolean(steps));
    map.querySelectorAll('[data-step]').forEach(n => n.classList.toggle('lit', Boolean(steps) && steps.includes(n.dataset.step)));
    map.querySelectorAll('.fn-wire').forEach(p => p.classList.toggle('lit', Boolean(steps) && steps.includes(p.dataset.a) && steps.includes(p.dataset.b)));
  }
  // ---- 정보: 마우스를 올리면 뜨고, 한 번 누르면 고정(다시 누르거나 다른 곳을 누르면 풀림) ----
  function showTip(el) {
    if (el.dataset.k != null) return showLink(el);
    const n = nodes.find(x => x.step === el.dataset.step);
    if (!n) return;
    const c = n.choice, mine = links.filter(l => l.from.step === n.step || l.to.step === n.step), parts = n.parts ?? {};
    focusOn([n.step, ...mine.flatMap(l => [l.from.step, l.to.step])]);
    const weight = [parts.effect ? `게이지 효과 ${parts.effect}` : '', parts.events ? `얽힌 사건 ${parts.events}개` : '', parts.tests ? `엔딩 시험 ${parts.tests}개` : ''].filter(Boolean).join(' · ');
    tip.innerHTML = `<div class="t-step">W${n.week} · ${esc(n.short)}</div><div class="t-name">${esc(c.label)}</div>
      ${c.line ? `<p>${esc(c.line)}</p>` : ''}
      ${c.gain ? `<div class="t-row"><span>얻은 것</span><span>${esc(c.gain)}</span></div>` : ''}
      ${c.cost ? `<div class="t-row cost"><span>감수</span><span>${esc(c.cost)}</span></div>` : ''}
      ${n.bal ? `<div class="t-bal ${sideOf(n.bal)}"><span>득 +${n.bal.gain}</span><i><b style="width:${(100 * n.bal.gain / (n.bal.gain + n.bal.loss || 1)).toFixed(0)}%"></b></i><span>실 −${n.bal.loss}</span><em>${sideOf(n.bal) === 'gain' ? '얻은 게 더 많은 선택' : sideOf(n.bal) === 'loss' ? '잃은 게 더 많은 선택' : '얻고 잃은 게 비슷한 선택'}</em></div>` : ''}
      ${weight ? `<div class="t-links">무게 · ${weight}</div>` : ''}
      ${mine.length ? `<ul class="t-why">${mine.slice(0, 3).map(l => `<li class="${l.reasons[0].kind}">${esc(l.from.step === n.step ? l.to.label : l.from.label)} · ${l.score}점</li>`).join('')}</ul>` : ''}`;
    place(el);
  }
  function showLink(el) {
    const l = links[Number(el.dataset.k)];
    if (!l) return;
    focusOn([l.from.step, l.to.step]);
    tip.innerHTML = `<div class="t-step">연관 ${Number(el.dataset.k) + 1}위 · 영향 ${l.score}점</div>
      <div class="t-name">W${l.from.week} ${esc(l.from.label)} → W${l.to.week} ${esc(l.to.label)}</div>
      <ul class="t-why">${l.reasons.map(r => `<li class="${r.kind}">${esc(r.text)}</li>`).join('')}</ul>`;
    place(el);
  }
  function place(node) {
    tip.classList.add('on');
    const docked = true; // 아래에 고정, 순위 목록은 잠시 숨긴다
    tip.classList.toggle('dock', docked); modal.classList.toggle('tip-on', docked);
    if (docked) { tip.style.left = ''; tip.style.top = ''; return; }
    const r = node.getBoundingClientRect();
    const left = Math.min(innerWidth - tip.offsetWidth - 10, Math.max(10, r.right + 10 + tip.offsetWidth > innerWidth - 10 ? r.left - tip.offsetWidth - 10 : r.right + 10));
    const top = Math.min(innerHeight - tip.offsetHeight - 10, Math.max(10, r.top + r.height / 2 - tip.offsetHeight / 2));
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }
  const hideTip = () => { if (!pinned) { tip.classList.remove('on'); modal.classList.remove('tip-on'); focusOn(null); } };
  function unpin() { pinned?.classList.remove('pinned'); pinned = null; tip.classList.remove('on'); modal.classList.remove('tip-on'); focusOn(null); }
  const nodeOf = e => e.target.closest?.('.fn-n[data-step], .fn-wire, .fn-badge, .fn-rank li');
  for (const box of [rows, rankList]) {
    box.addEventListener('pointerover', e => { const n = nodeOf(e); if (!n || n.contains(e.relatedTarget)) return; if (!pinned) showTip(n); });
    box.addEventListener('pointerout', e => { const n = nodeOf(e); if (n && !n.contains(e.relatedTarget)) hideTip(); });
  }
  rows.addEventListener('focusin', e => { const n = nodeOf(e); if (n && !pinned) showTip(n); });
  rows.addEventListener('focusout', hideTip);
  rows.addEventListener('scroll', unpin);
  function toggle(n) {
    if (pinned === n) return unpin();
    unpin(); pinned = n; n.classList.add('pinned'); showTip(n);
  }
  modal.addEventListener('click', e => {
    if (dragged) return; // 둘러보느라 끈 것은 클릭이 아니다
    const n = nodeOf(e);
    if (n) return toggle(n);
    if (e.target === modal || e.target.classList?.contains('fn-full')) return close();
    unpin();
  });
  rows.addEventListener('keydown', e => { const n = nodeOf(e); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(n); } });

  // ---- 열고 닫기 ----
  function open() {
    opener = document.activeElement;
    modal.hidden = false;
    render();
    modal.querySelector('.fn-x').focus();
  }
  function close() {
    if (modal.hidden) return;
    unpin(); stopFlow(); modal.hidden = true;
    opener?.focus?.();
  }
  modal.querySelector('.fn-x').addEventListener('click', close);
  let resizeTimer = 0;
  addEventListener('resize', () => { if (modal.hidden) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  addEventListener('keydown', e => {
    if (modal.hidden || e.key !== 'Escape') return;
    e.stopPropagation();
    if (pinned) unpin(); else close();
  }, true);

  return { record, open, close };
}
