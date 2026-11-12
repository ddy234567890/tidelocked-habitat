// 육각 토큰 선지판 (2026-11 시안 experiments/choice-hex-mockup 을 게임에 옮김)
// 선지를 글 카드 대신 육각 토큰으로 보여 준다. 단계마다 벌집 묶음 하나, 고른 토큰끼리는 빛줄기로 잇는다.
// 이 판은 '보여 주기'만 한다: 무엇을 고를 수 있는지·결정했는지는 main.js 가 정해 update() 로 넘기고,
// 누르면 onPick / onDecide 로 main.js 에 돌려준다 (기존 카드·결정 버튼과 같은 함수를 부른다)
import { ICONS } from './hexIcons.js';
import { createFieldNotes } from './fieldNotes.js';

const SVG = 'http://www.w3.org/2000/svg';
const SHORT = { location: '위치', module: '짓는 방식', oxygen: '산소', power: '발전', storage: '전기 저장', heat: '열 빼기', source: '물 구하기', reuse: '물 재사용', share: '물 나누기', farm: '농장', balance: '비축·확장', crop: '작물', fix: '보강', pool: '사고 대비', arrive: '입주' };
export const shortName = step => SHORT[step.id] ?? step.short ?? step.id;

// 판 크기 (화면 픽셀과 1:1 로 그린다 → 픽셀 폰트가 뭉개지지 않는다)
const R = 52, SQ = Math.sqrt(3), HW = SQ / 2 * R, PAD = 4;   // HW: 뾰족한 육각의 가로 반폭
const CW = 2 * HW + PAD, RH = 1.5 * R + PAD * SQ / 2;         // 벌집 칸 간격 (가로, 세로)
const PER_ROW = 2, GROUP_COLS = 3, TOP = 40, SIDE = 14;       // GROUP_COLS: 단계 묶음 사이 간격 (격자 칸 수) → 토큰이 늘 배경 격자 칸에 딱 맞는다
const GW = CW * (PER_ROW - 1) + CW / 2 + 2 * HW;               // 단계 묶음 하나의 너비
const ONE_LINE = 8;                                            // 이 글자 수까지는 이름을 한 줄로
const GROW = 450;                                              // 새 연결 빛줄기가 뻗어 가는 시간 (ms)
// 화면에는 단계 묶음 하나만 크게 비춘다 (세 묶음을 한꺼번에 보이면 산만해서). 단계가 넘어가면 빛 한 점이 연결선을 따라가고 화면이 그 점을 따라 옮겨 간다
const VIEW_PAD = 64;                                           // 비추는 묶음 양옆으로 함께 보이는 여유 (앞 단계에서 들어오는 선이 보이게)
const VIEW_W = GW + 2 * VIEW_PAD;
const ZOOM_MAX = 1.9;                                          // 최대 확대 배율
const HEIGHT_SHARE = 0.45;                                     // 판 높이는 창 높이의 이 비율까지 (3D 화면을 너무 밀어내지 않게)
const VIEW_TOP = TOP - 14;                                     // 판 위쪽 빈 줄(예전 단계 제목 자리)은 잘라 내고 토큰을 그만큼 크게
const NEIGHBOR = 150;                                          // 지금 묶음 양옆으로 흐리게 보이는 이웃 폭 (판 좌표)
const DOLLY = 0.3;                                             // 단계를 넘어갈 때 가운데쯤 물러서는 정도 (0.3 = 30% 넓게)
const ZOOM_OUT = 1200, ZOOM_IN = 900;                          // 한 주를 다 결정하면 물러서기 / 둘러보다 다시 다가가기 (ms)
const CHEER_STEP = 280, CHEER_MS = n => n * CHEER_STEP + 900;  // '다음 주로': 고른 토큰이 앞에서부터 이 간격으로 번쩍, 전체 시간 (ms)
const TRAVEL = 1100, LOOK = 550;                               // 다음 단계로 따라가는 시간 / 단계 이름을 눌러 둘러보는 시간 (ms)
const easeInOut = x => x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const cubicAt = (p, t) => { const u = 1 - t; return [u*u*u*p[0] + 3*u*u*t*p[2] + 3*u*t*t*p[4] + t*t*t*p[6], u*u*u*p[1] + 3*u*u*t*p[3] + 3*u*t*t*p[5] + t*t*t*p[7]]; };

const hex = r => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const rowsFor = n => Math.ceil(n / PER_ROW);
// 배경 벌집 격자 칸 (c 열, r 줄). 홀수 줄은 반 칸 밀린다. 토큰도 반드시 이 칸 위에 놓는다
const odd = r => ((r % 2) + 2) % 2 === 1;
const cellX = (c, r) => SIDE + HW + c * CW + (odd(r) ? CW / 2 : 0), cellY = r => TOP + R + r * RH;
const esc = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function wrap(label) {
  if (label.length <= ONE_LINE) return [label];
  const words = label.split(' ');
  if (words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const m = Math.max(a.length, b.length);
      if (!best || m < best.m) best = { m, lines: [a, b] };
    }
    return best.lines;
  }
  const p = label.indexOf('(');
  if (p > 0) return [label.slice(0, p), label.slice(p)];
  const h = Math.ceil(label.length / 2);
  return [label.slice(0, h), label.slice(h)];
}

// 두 토큰을 잇는 3차 곡선 [x1,y1, mx,y1, mx,y2, x2,y2]
const bez = (a, b) => { const x1 = a.x + HW - 6, x2 = b.x - HW + 6, m = (x1 + x2) / 2; return [x1, a.y, m, a.y, m, b.y, x2, b.y]; };
const curve = (a, b) => { const [x1, y1, m, , , y2, x2] = bez(a, b); return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${m.toFixed(1)} ${y1.toFixed(1)} ${m.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`; };

// 빛줄기 모양: 곡선을 따라 점을 찍고 점마다 두께를 정해 리본(채운 면)으로 만든다.
// 가는 줄기 + 토큰과 맞닿는 양 끝만 부풂(천천히 숨 쉼). prog(0~1) 만큼만 그리고, 뻗어 가는 머리는 밝고 둥글게
function ribbon(p, t0, scale, prog = 1) {
  const N = 40, L = [], Rt = [];
  for (let i = 0; i <= N; i++) {
    const t = prog * i / N, u = 1 - t;
    const x = u*u*u*p[0] + 3*u*u*t*p[2] + 3*u*t*t*p[4] + t*t*t*p[6];
    const y = u*u*u*p[1] + 3*u*u*t*p[3] + 3*u*t*t*p[5] + t*t*t*p[7];
    let dx = 3*u*u*(p[2]-p[0]) + 6*u*t*(p[4]-p[2]) + 3*t*t*(p[6]-p[4]);
    let dy = 3*u*u*(p[3]-p[1]) + 6*u*t*(p[5]-p[3]) + 3*t*t*(p[7]-p[5]);
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const end = Math.pow(Math.abs(2 * t - 1), 10);
    const breathe = 0.85 + 0.15 * Math.sin(t0 * 2.4);
    const wave = Math.sin((t * 1.4 - t0 * 0.45) * Math.PI * 2);
    const taper = Math.sin(Math.PI / 2 * Math.min(1, Math.min(t, prog - t) * 12));
    const head = prog < 1 ? 3.2 * Math.exp(-(((prog - t) * 9) ** 2)) : 0;
    const w = (1.1 + 4.6 * (prog < 1 && t > 0.5 ? 0 : end) * breathe + head + 0.2 * wave * (1 - end)) * scale * Math.max(.15, taper);
    L.push(`${(x - dy * w).toFixed(1)} ${(y + dx * w).toFixed(1)}`);
    Rt.push(`${(x + dy * w).toFixed(1)} ${(y - dx * w).toFixed(1)}`);
  }
  return `M${L.join('L')}L${Rt.reverse().join('L')}Z`;
}

/**
 * root: 판을 넣을 요소. onPick(stepId, choiceId) · onDecide() 는 main.js 가 준다
 * update(state) 의 state:
 *   steps: [{ id, label, short, status: 'done'|'open'|'locked', selected, choices: [{ id, label, line, gain, cost }] }]
 *   decide: { label, disabled, hidden }   — 판 오른쪽 결정 버튼
 *   busy: 이동 중이라 누를 수 없음
 */
export function createHexBoard(root, { onPick, onDecide }) {
  root.classList.add('hexboard');
  root.innerHTML = `
    <div class="hb-head"><p class="hb-prompt"><b></b><span></span></p><nav class="hb-steps" aria-label="단계"></nav><span class="hb-count"></span><button type="button" class="hb-notes" aria-haspopup="dialog">▤ 메모장</button></div>
    <div class="hb-body">
      <div class="hb-view"><svg class="hb-map" role="group" aria-label="선지 토큰" xmlns="${SVG}">
        <defs>
          <filter id="hb-glow" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
          <linearGradient id="hb-chosen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E4DBD"/><stop offset="1" stop-color="#121F5C"/></linearGradient>
          ${Object.entries(ICONS).map(([id, d]) => `<symbol id="hb-ic-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}
        </defs>
        <g class="hb-content"></g>
      </svg></div>
      <button type="button" class="decide hb-decide"></button>
    </div>
    <div class="hb-tip" role="tooltip"></div>`;
  const svg = root.querySelector('.hb-map'), content = root.querySelector('.hb-content');
  const tip = root.querySelector('.hb-tip'), decideButton = root.querySelector('.hb-decide');
  const viewBox = root.querySelector('.hb-view'), stepNav = root.querySelector('.hb-steps');
  // 메모장 창: 주차별로 이어 온 노드만 모아 보는 창 (src/fieldNotes.js)
  const notes = createFieldNotes(), notesButton = root.querySelector('.hb-notes');
  notesButton.addEventListener('click', () => notes.open());
  let state = null, lastOpen = null;
  // 카메라: 판 좌표에서 지금 비추는 가운데 x 와 위아래 흔들림 y
  let L = null, cam = null, focus = -1, lookAt = null, tween = null, sig = '', lastWant = -1;
  const born = new Map();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const icon = id => (ICONS[id] ? id : '_');
  const findChoice = id => { for (const step of state?.steps ?? []) { const c = step.choices.find(x => x.id === id); if (c) return { step, choice: c }; } };

  function layout(steps) {
    const rows = Math.max(1, ...steps.map(s => rowsFor(s.choices.length)));
    const height = TOP + 2 * R + (rows - 1) * RH + 10;
    const pos = {}, ghosts = [], centers = [], lefts = [];
    steps.forEach((step, k) => {
      const c0 = k * GROUP_COLS;
      const shown = step.status !== 'locked';
      const n = shown ? step.choices.length : 2, nr = rowsFor(n);   // 아직 열리지 않은 단계는 "?" 두 칸만 (몇 개인지 미리 알리지 않는다)
      const r0 = Math.floor((rows - nr) / 2);
      const ps = Array.from({ length: n }, (_, i) => { const r = r0 + Math.floor(i / PER_ROW); return { x: cellX(c0 + i % PER_ROW, r), y: cellY(r) }; });
      ps.forEach((p, i) => { if (shown) pos[step.choices[i].id] = p; else ghosts.push(p); });
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      centers.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });  // 화면은 묶음마다 이 가운데를 비춘다
      lefts.push(Math.min(...xs));
    });
    const width = cellX((steps.length - 1) * GROUP_COLS + PER_ROW - 1, 1) + HW + SIDE;
    return { pos, ghosts, centers, lefts, height, rows, width };
  }

  function nodeSvg(step, c, p, i, k) {
    const chosen = step.selected === c.id;
    const st = chosen ? 'chosen' : step.status === 'open' ? (step.selected ? 'other' : 'open') : 'done';
    const lines = wrap(c.label), ty = lines.length === 1 ? 24 : 20;
    const label = lines.map((l, j) => `<text y="${ty + j * 13}">${esc(l)}</text>`).join('');
    const clickable = step.status === 'open' && !state.busy;
    return `<g class="hb-node s-${st}${clickable ? ' can' : ''}" data-id="${esc(c.id)}" data-step="${esc(step.id)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" style="--i:${i};--o:${k}"
      ${clickable ? 'tabindex="0" role="button"' : ''} aria-label="${esc(c.label)}${chosen ? ' (고름)' : ''}">
      <g class="body">
        <polygon class="glow" points="${hex(R + 5)}"/><polygon class="outer" points="${hex(R)}"/><polygon class="inner" points="${hex(R - 6)}"/>
        <use href="#hb-ic-${icon(c.id)}" class="icon" x="-16" y="${lines.length === 1 ? -26 : -30}" width="32" height="32"/>${label}
      </g></g>`;
  }
  const ghostSvg = p => `<g class="hb-ghost" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" aria-hidden="true"><g class="body">
    <polygon class="outer" points="${hex(R)}"/><g class="lock" transform="translate(-8 -16)"><rect x="0" y="6" width="16" height="12"/><path d="M4 6V4a4 4 0 0 1 8 0v2"/></g><text y="24">?</text></g></g>`;

  // 판 그림(격자·연결선·토큰)을 steps 로 다시 그린다. reveal: 지금 단계 토큰이 차례로 켜지는 연출을 강제로 켠다
  function drawContent(steps, reveal = false) {
    L = layout(steps);
    const { pos, ghosts, width, height } = L;

    // 배경 격자: 토큰과 같은 칸 규칙(cellX·cellY)으로 그려서 어떤 배율에서도 토큰과 겹친다. 넓은 화면·물러선 화면까지 덮도록 넉넉히
    let lattice = '';
    for (let r = -4; cellY(r - 1) < height + 3 * RH; r++)
      for (let c = -14; c * CW < width + 14 * CW; c++) lattice += `<polygon points="${hex(R + PAD / 2)}" transform="translate(${cellX(c, r).toFixed(1)} ${cellY(r).toFixed(1)})"/>`;

    // 연결선: 앞 단계에서 고른 토큰 → 다음 단계 토큰. 고른 길은 빛줄기, 아직 고를 후보는 가는 선
    let edges = '', beams = '';
    steps.forEach((step, k) => {
      const from = k && pos[steps[k - 1].selected];
      if (!from || step.status === 'locked') return;
      for (const c of step.choices) {
        if (!pos[c.id]) continue;
        if (step.selected === c.id) {
          beams += `<g class="hb-beam" style="--o:${k}" data-k="${esc(steps[k - 1].selected)}>${esc(c.id)}" data-p="${bez(from, pos[c.id]).map(v => v.toFixed(1)).join(',')}"><path class="b0"/><path class="b1"/><path class="b2"/></g>`;
        } else if (step.status === 'open') edges += `<path class="hb-edge" pathLength="1" data-step="${esc(step.id)}" d="${curve(from, pos[c.id])}"/>`;
      }
    });

    let i = 0;
    const nodes = steps.map((step, k) => step.status === 'locked' ? '' : step.choices.map(c => nodeSvg(step, c, pos[c.id], i++, k)).join('')).join('');
    content.innerHTML = `<g class="hb-lattice">${lattice}</g><g>${edges}</g><g>${beams}</g>${ghosts.map(ghostSvg).join('')}${nodes}<g class="hb-comet" style="opacity:0" aria-hidden="true"><circle class="c0" r="14"/><circle class="c1" r="6"/><circle class="c2" r="3"/></g>`;

    // 새 단계가 열렸으면: 앞 빛줄기가 닿은 뒤 → 후보 선이 그려지고 → 토큰이 차례로 켜진다
    const cur = steps.findIndex(s => s.status === 'open');
    const openKey = cur >= 0 ? steps.map(s => s.id).join('/') + ':' + steps[cur].id : null;
    if (openKey && (reveal || (lastOpen !== null && openKey !== lastOpen))) {
      let j = 0;
      content.querySelectorAll(`.hb-node[data-step="${steps[cur].id}"]`).forEach(n => { n.classList.add('reveal'); n.style.setProperty('--j', j++); });
      content.querySelectorAll(`.hb-edge[data-step="${steps[cur].id}"]`).forEach(e => e.classList.add('grow'));
    }
    lastOpen = openKey;
    return cur;
  }

  function update(next) {
    const wasDone = allDone(state);
    state = next;
    hideTip();
    notes.record(next.steps);   // 메모장에 주차별 결정을 적어 둔다
    if (!wasDone && allDone(next)) { notesButton.classList.remove('new'); void notesButton.offsetWidth; notesButton.classList.add('new'); }  // 한 주를 다 적으면 단추가 두 번 반짝

    if (cheering) { renderHead(); return; }   // 다음 주로 넘어가는 강조 연출 중에는 판 그림을 그대로 둔다
    draw();
  }

  const allDone = s => Boolean(s?.steps.length) && s.steps.every(x => x.status === 'done');
  const wantOf = steps => { const cur = steps.findIndex(s => s.status === 'open'); return cur >= 0 ? cur : 'all'; };

  function draw() {
    const steps = state.steps;
    drawContent(steps);

    // 비출 곳: 단계 이름을 눌러 둘러보는 중이면 그 묶음, 아니면 지금 고를 단계. 한 주를 다 결정했으면('all') 물러서서 한 주 전체
    const nextSig = steps.map(s => s.id).join('/');
    const want = wantOf(steps);
    if (nextSig !== sig || want !== lastWant) lookAt = null;   // 새 단계가 열리면 둘러보기를 끝내고 그 단계로
    lastWant = want;
    const target = lookAt ?? want;
    fit();
    const goal = viewOf(target);
    if (nextSig !== sig || !cam) { tween = null; cam = goal; }                       // 첫 화면·새 주: 바로 그 자리
    else if (target !== focus) {
      if (target === 'all') tween = { start: null, delay: lookAt === null ? GROW + 250 : 0, ms: still.matches ? 1 : ZOOM_OUT, from: { ...cam }, to: goal };  // 마지막 빛줄기가 닿은 뒤 물러선다
      else if (focus === 'all') tween = { start: null, ms: still.matches ? 1 : ZOOM_IN, from: { ...cam }, to: goal };
      else startTravel(focus, target, lookAt === null);
    }
    sig = nextSig; focus = target;
    root.classList.toggle('hb-overview', target === 'all');
    if (!tween) aim(cam);
    renderHead();
  }

  // 머리 글: 지금 고를 단계의 질문, 결정한 수, 단계 이름 줄
  function renderHead() {
    const steps = state.steps, cur = steps.findIndex(s => s.status === 'open'), open = steps[cur];
    root.querySelector('.hb-prompt b').textContent = open ? cur + 1 : '✓';
    root.querySelector('.hb-prompt span').textContent = cheering ? '이번 주에 이어 온 길' : open ? open.label : '이번 주 결정을 마쳤어요 · 이어 온 길';
    root.querySelector('.hb-count').textContent = `${steps.filter(s => s.status === 'done').length} / ${steps.length} 결정`;
    renderSteps(steps, cur);
    decideButton.hidden = Boolean(state.decide?.hidden);
    decideButton.textContent = cheering ? '▶ 다음 주로 넘어가는 중…' : state.decide?.label ?? '';
    decideButton.disabled = Boolean(state.decide?.disabled || state.busy || cheering);
  }

  // ---- '다음 주로': 한 주 전체가 보이는 화면에서 고른 토큰과 빛줄기가 앞에서부터 한 번씩 번쩍인 뒤 넘어간다 ----
  // 시간은 setTimeout 으로 잰다 → 화면이 가려져 애니메이션이 멈춰도 반드시 넘어간다
  let cheering = false;
  function cheer() {
    cheering = true;
    const zoomOut = focus !== 'all';
    if (zoomOut) { lookAt = null; tween = { start: null, ms: still.matches ? 1 : ZOOM_OUT, from: { ...cam }, to: overview() }; focus = 'all'; root.classList.add('hb-overview'); }
    renderHead();
    const wait = zoomOut && !still.matches ? ZOOM_OUT : 0;
    setTimeout(() => root.classList.add('hb-cheer'), wait);
    setTimeout(() => {
      cheering = false;
      root.classList.remove('hb-cheer');
      onDecide();                       // main.js 가 다음 주로 넘기고 update() 로 새 주 판을 준다
      if (allDone(state)) draw();       // 넘어가지 않았으면 원래 화면으로
    }, wait + (still.matches ? 300 : CHEER_MS(state.steps.length)));
  }

  // ---- 카메라: 묶음 하나를 크게 비추고, 단계가 넘어가면 연결선을 따라 옮겨 간다 ----
  // cam = { x: 비추는 가운데, y: 판 가운데에서 위아래로 벗어난 정도, z: 물러선 정도 (1 = 묶음 하나 크게, 클수록 넓게) }
  const viewH = () => L.height - VIEW_TOP;
  const midY = () => VIEW_TOP + viewH() / 2;
  const viewOf = k => k === 'all' ? overview() : { x: L.centers[k].x, y: L.centers[k].y - midY(), z: 1 };
  const overview = () => ({ x: L.width / 2, y: 0, z: Math.max(1.15, (L.width + 2 * HW) / baseW, (L.height + 30) / viewH()) });
  function aim({ x, y, z }) {
    const w = baseW * z, h = viewH() * z, cy = midY() + y;
    svg.setAttribute('viewBox', `${(x - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  }
  // 칸 너비·화면 높이에 맞춰 배율을 정한다. 판은 칸 너비를 다 쓰고(가장자리는 그라데이션으로 사라짐),
  // 배율은 0.05 단위로 맞춰 창 크기를 조금 바꿀 때마다 토큰 크기가 출렁이지 않게 한다
  let baseW = VIEW_W, zoom = 1;
  function fit() {
    if (!L) return;
    const avail = viewBox.clientWidth || VIEW_W;
    zoom = Math.max(0.6, Math.floor(Math.min(ZOOM_MAX, avail / VIEW_W, innerHeight * HEIGHT_SHARE / viewH()) * 20) / 20);
    baseW = avail / zoom;
    svg.setAttribute('width', Math.floor(avail)); svg.setAttribute('height', (viewH() * zoom).toFixed(0));
    if (cam && !tween) {
      if (typeof focus === 'number' && focus >= 0 && L.centers[focus]) cam = viewOf(focus);
      else if (focus === 'all') cam = overview();   // 물러선 화면은 새 너비에 맞춰 다시 맞춘다
      aim(cam);
    }
  }
  new ResizeObserver(fit).observe(viewBox);
  addEventListener('resize', fit);

  // 앞 단계에서 고른 토큰 → 다음 묶음 입구까지 빛 한 점(혜성)이 지나가고, 화면은 그 점을 따라가며 잠깐 물러섰다 다시 다가간다.
  // 따라갈 길이 없으면(둘러보기·앞 단계 미선택) 옆으로 미끄러지기만 한다
  function startTravel(from, to, auto) {
    const steps = state.steps, prev = from >= 0 && to === from + 1 && auto ? steps[from] : null;
    const a = prev && L.pos[prev.selected];
    let path = null;
    if (a) {
      const b = { x: L.lefts[to] - HW * 0.6, y: L.centers[to].y };
      path = [a.x + HW - 6, a.y, (a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, b.x, b.y];
    }
    tween = { start: null, ms: still.matches ? 1 : path ? TRAVEL : LOOK, from: { ...cam }, to: viewOf(to), path, dolly: path ? DOLLY : DOLLY / 2 };
  }
  function travelFrame(time) {
    if (!tween) return;
    tween.start ??= time;
    const x = Math.min(1, Math.max(0, time - tween.start - (tween.delay ?? 0)) / tween.ms), e = easeInOut(x);
    const comet = content.querySelector('.hb-comet'), f = tween.from, t = tween.to;
    const z = (f.z + (t.z - f.z) * e) * (1 + (tween.dolly ?? 0) * Math.sin(Math.PI * e));
    if (tween.path) {
      // 혜성 위치 + (처음 묶음 가운데 → 다음 묶음 가운데로 서서히 바뀌는 간격) = 카메라. 시작과 끝에서 정확히 묶음 가운데
      const p = tween.path, [cx, cy] = cubicAt(p, e);
      const off = (f.x - p[0]) * (1 - e) + (t.x - p[6]) * e;
      cam = { x: cx + off, y: (cy - (p[1] + (p[7] - p[1]) * e)) * 0.5 + f.y + (t.y - f.y) * e, z };
      if (comet) { comet.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`); comet.style.opacity = x < 1 ? Math.min(1, x * 8, (1 - x) * 6).toFixed(2) : 0; }
    } else {
      cam = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, z };
      if (comet) comet.style.opacity = 0;
    }
    aim(cam);
    root.classList.toggle('hb-moving', x < 1);
    if (x >= 1) tween = null;
  }

  // 머리 줄 단계 이름: 결정한 단계·지금 단계는 눌러서 그 묶음을 둘러볼 수 있다 (고르는 건 지금 단계에서만)
  function renderSteps(steps, cur) {
    const whole = allDone(state)   // 한 주를 다 결정했으면 '전체'(물러선 화면)로 돌아가는 단추도 둔다
      ? `<i aria-hidden="true"></i><button type="button" class="ok${focus === 'all' ? ' on' : ''}" data-k="all" ${focus === 'all' ? 'aria-current="step"' : ''}>⤢ 전체</button>` : '';
    stepNav.innerHTML = steps.map((step, k) => {
      const cls = step.status === 'done' ? 'ok' : k === cur ? 'now' : 'wait';
      const mark = step.status === 'done' ? '●' : k === cur ? '▶' : '○';
      return `${k ? '<i aria-hidden="true"></i>' : ''}<button type="button" class="${cls}${k === focus ? ' on' : ''}" data-k="${k}" ${step.status === 'locked' ? 'disabled' : ''}
        ${k === focus ? 'aria-current="step"' : ''}>${mark} ${k + 1} ${esc(step.short)}</button>`;
    }).join('') + whole;
  }
  stepNav.addEventListener('click', e => {
    const button = e.target.closest('button[data-k]');
    if (!button || button.disabled || !state || cheering) return;
    const k = button.dataset.k === 'all' ? 'all' : Number(button.dataset.k);
    lookAt = k === wantOf(state.steps) ? null : k;
    draw();
  });

  // ---- 마우스를 올리면 뜨는 설명 팝업 ----
  function showTip(node) {
    const f = node && findChoice(node.dataset.id);
    if (!f) return;
    const { step, choice: c } = f, k = state.steps.indexOf(step), chosen = step.selected === c.id;
    const hint = step.status !== 'open' || state.busy ? '' : chosen ? '' : step.selected ? '누르면 이걸로 바꿔요.' : '누르면 이걸로 골라요.';
    tip.innerHTML = `<div class="t-step">STEP ${k + 1} · ${esc(step.short)}${chosen ? ' · <b>고름</b>' : ''}</div>
      <div class="t-name">${esc(c.label)}</div>
      ${c.line ? `<p>${esc(c.line)}</p>` : ''}
      ${c.gain ? `<div class="t-row"><span>얻는 것</span><span>${esc(c.gain)}</span></div>` : ''}
      ${c.cost ? `<div class="t-row cost"><span>감수</span><span>${esc(c.cost)}</span></div>` : ''}
      ${hint ? `<div class="t-hint">${hint}</div>` : ''}`;
    tip.classList.add('on');
    const b = root.getBoundingClientRect(), r = node.getBoundingClientRect();
    let left = r.right - b.left + 8;
    if (left + tip.offsetWidth > b.width - 8) left = r.left - b.left - tip.offsetWidth - 8;
    if (left < 8) left = Math.max(8, (b.width - tip.offsetWidth) / 2);
    // 판 아래쪽이 화면 끝이라, 팝업은 토큰 위쪽에 맞춰 띄운다 (넘치면 위로 올린다)
    let top = r.top - b.top;
    if (b.top + top + tip.offsetHeight > window.innerHeight - 8) top = window.innerHeight - 8 - tip.offsetHeight - b.top;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }
  function hideTip() { tip.classList.remove('on'); }

  const pick = node => {
    if (!node?.classList.contains('can') || state.busy) return;
    hideTip();
    onPick(node.dataset.step, node.dataset.id);
  };
  svg.addEventListener('click', e => pick(e.target.closest('.hb-node')));
  svg.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('.hb-node')); } });
  svg.addEventListener('pointerover', e => { const n = e.target.closest('.hb-node'); if (n) showTip(n); });
  svg.addEventListener('pointerout', e => { const n = e.target.closest('.hb-node'); if (n && !n.contains(e.relatedTarget)) hideTip(); });
  svg.addEventListener('focusin', e => { const n = e.target.closest('.hb-node'); if (n && n.matches(':focus-visible')) showTip(n); });
  svg.addEventListener('focusout', hideTip);
  decideButton.addEventListener('click', () => {
    if (decideButton.disabled || cheering) return;
    if (allDone(state)) cheer(); else onDecide();
  });

  // 빛줄기: 매 프레임 모양을 다시 그린다. 새로 이어진 연결은 앞 토큰에서 뻗어 가 닿고, 닿는 순간 그 토큰이 번쩍
  function frame(time) {
    travelFrame(time);
    const t0 = still.matches ? 0 : time / 1000, seen = new Set();
    content.querySelectorAll('.hb-beam').forEach((g, i) => {
      const p = g._p ??= g.dataset.p.split(',').map(Number), key = g.dataset.k;
      seen.add(key);
      if (!born.has(key)) born.set(key, still.matches ? -GROW : time);
      const x = Math.min(1, Math.max(0, (time - born.get(key)) / GROW)), prog = 1 - (1 - x) ** 3;
      g.style.visibility = prog > 0.01 ? '' : 'hidden';
      if (prog <= 0.01) return;
      const [b0, b1, b2] = g.children, t = t0 + i * 0.37;
      b0.setAttribute('d', ribbon(p, t, 2.3, prog));
      b1.setAttribute('d', ribbon(p, t, 1.1, prog));
      b2.setAttribute('d', ribbon(p, t, 0.5, prog));
      if (x >= 1 && !g._hit) {
        g._hit = true;
        if (time - born.get(key) < GROW + 200) content.querySelector(`.hb-node[data-id="${CSS.escape(key.split('>')[1])}"]`)?.classList.add('fire');
      }
    });
    for (const key of born.keys()) if (!seen.has(key)) born.delete(key); // 끊긴 연결은 잊는다 → 다시 이으면 또 뻗어 나감
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { update };
}
