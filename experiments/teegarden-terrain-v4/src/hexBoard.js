// 육각 토큰 선지판 (2026-11 시안 experiments/choice-hex-mockup 을 게임에 옮김)
// 선지를 글 카드 대신 육각 토큰으로 보여 준다. 단계마다 벌집 묶음 하나, 고른 토큰끼리는 빛줄기로 잇는다.
// 이 판은 '보여 주기'만 한다: 무엇을 고를 수 있는지·결정했는지는 main.js 가 정해 update() 로 넘기고,
// 누르면 onPick / onDecide 로 main.js 에 돌려준다 (기존 카드·결정 버튼과 같은 함수를 부른다)
import { ICONS } from './hexIcons.js';

const SVG = 'http://www.w3.org/2000/svg';
const SHORT = { location: '위치', module: '짓는 방식', oxygen: '산소', power: '발전', storage: '전기 저장', heat: '열 빼기', source: '물 구하기', reuse: '물 재사용', share: '물 나누기', farm: '농장', balance: '비축·확장', crop: '작물', fix: '보강', pool: '사고 대비', arrive: '입주' };
export const shortName = step => SHORT[step.id] ?? step.short ?? step.id;

// 판 크기 (화면 픽셀과 1:1 로 그린다 → 픽셀 폰트가 뭉개지지 않는다)
const R = 52, SQ = Math.sqrt(3), HW = SQ / 2 * R, PAD = 4;   // HW: 뾰족한 육각의 가로 반폭
const CW = 2 * HW + PAD, RH = 1.5 * R + PAD * SQ / 2;         // 벌집 칸 간격 (가로, 세로)
const PER_ROW = 2, GROUP_GAP = 56, TOP = 40, SIDE = 14;
const GW = CW * (PER_ROW - 1) + CW / 2 + 2 * HW;               // 단계 묶음 하나의 너비
const ONE_LINE = 8;                                            // 이 글자 수까지는 이름을 한 줄로
const GROW = 450;                                              // 새 연결 빛줄기가 뻗어 가는 시간 (ms)

const hex = r => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const rowsFor = n => Math.ceil(n / PER_ROW);
const spots = n => Array.from({ length: n }, (_, i) => { const r = Math.floor(i / PER_ROW), c = i % PER_ROW; return { dx: c * CW + (r % 2) * CW / 2, dy: r * RH }; });
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
    <div class="hb-head"><p class="hb-prompt"><b></b><span></span></p><span class="hb-count"></span></div>
    <div class="hb-body">
      <svg class="hb-map" role="group" aria-label="선지 토큰" xmlns="${SVG}">
        <defs>
          <filter id="hb-glow" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
          <linearGradient id="hb-chosen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E4DBD"/><stop offset="1" stop-color="#121F5C"/></linearGradient>
          ${Object.entries(ICONS).map(([id, d]) => `<symbol id="hb-ic-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')}
        </defs>
        <g class="hb-content"></g>
      </svg>
      <button type="button" class="decide hb-decide"></button>
    </div>
    <div class="hb-tip" role="tooltip"></div>`;
  const svg = root.querySelector('.hb-map'), content = root.querySelector('.hb-content');
  const tip = root.querySelector('.hb-tip'), decideButton = root.querySelector('.hb-decide');
  let state = null, lastOpen = null;
  const born = new Map();
  const icon = id => (ICONS[id] ? id : '_');
  const findChoice = id => { for (const step of state?.steps ?? []) { const c = step.choices.find(x => x.id === id); if (c) return { step, choice: c }; } };

  function layout(steps) {
    const rows = Math.max(1, ...steps.map(s => rowsFor(s.choices.length)));
    const height = TOP + 2 * R + (rows - 1) * RH + 10;
    const pos = {}, ghosts = [], heads = [];
    steps.forEach((step, k) => {
      const x0 = SIDE + k * (GW + GROUP_GAP);
      heads.push(x0);
      const shown = step.status !== 'locked';
      const n = shown ? step.choices.length : 2, nr = rowsFor(n);   // 아직 열리지 않은 단계는 "?" 두 칸만 (몇 개인지 미리 알리지 않는다)
      const y0 = TOP + R + (rows - nr) * RH / 2;
      const xs = nr === 1 && n < PER_ROW ? CW / 2 : 0;
      spots(n).forEach((s, i) => {
        const p = { x: x0 + HW + xs + s.dx, y: y0 + s.dy };
        if (shown) pos[step.choices[i].id] = p; else ghosts.push(p);
      });
    });
    return { pos, ghosts, heads, height, width: SIDE * 2 + steps.length * GW + (steps.length - 1) * GROUP_GAP };
  }

  function nodeSvg(step, c, p, i) {
    const chosen = step.selected === c.id;
    const st = chosen ? 'chosen' : step.status === 'open' ? (step.selected ? 'other' : 'open') : 'done';
    const lines = wrap(c.label), ty = lines.length === 1 ? 24 : 20;
    const label = lines.map((l, j) => `<text y="${ty + j * 13}">${esc(l)}</text>`).join('');
    const clickable = step.status === 'open' && !state.busy;
    return `<g class="hb-node s-${st}${clickable ? ' can' : ''}" data-id="${esc(c.id)}" data-step="${esc(step.id)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" style="--i:${i}"
      ${clickable ? 'tabindex="0" role="button"' : ''} aria-label="${esc(c.label)}${chosen ? ' (고름)' : ''}">
      <g class="body">
        <polygon class="glow" points="${hex(R + 5)}"/><polygon class="outer" points="${hex(R)}"/><polygon class="inner" points="${hex(R - 6)}"/>
        <use href="#hb-ic-${icon(c.id)}" class="icon" x="-16" y="${lines.length === 1 ? -26 : -30}" width="32" height="32"/>${label}
      </g></g>`;
  }
  const ghostSvg = p => `<g class="hb-ghost" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" aria-hidden="true"><g class="body">
    <polygon class="outer" points="${hex(R)}"/><g class="lock" transform="translate(-8 -16)"><rect x="0" y="6" width="16" height="12"/><path d="M4 6V4a4 4 0 0 1 8 0v2"/></g><text y="24">?</text></g></g>`;

  function update(next) {
    state = next;
    hideTip();
    const steps = state.steps;
    const { pos, ghosts, heads, width, height } = layout(steps);
    svg.setAttribute('viewBox', `0 0 ${width.toFixed(0)} ${height.toFixed(0)}`);
    svg.setAttribute('width', width.toFixed(0)); svg.setAttribute('height', height.toFixed(0));

    let lattice = '';
    for (let r = -1; TOP + R + (r - 1) * RH < height; r++)
      for (let c = -1; c * CW < width + CW; c++) lattice += `<polygon points="${hex(R + PAD / 2)}" transform="translate(${(SIDE + HW + c * CW + (r % 2 ? CW / 2 : 0)).toFixed(1)} ${(TOP + R + r * RH).toFixed(1)})"/>`;

    // 연결선: 앞 단계에서 고른 토큰 → 다음 단계 토큰. 고른 길은 빛줄기, 아직 고를 후보는 가는 선
    let edges = '', beams = '';
    steps.forEach((step, k) => {
      const from = k && pos[steps[k - 1].selected];
      if (!from || step.status === 'locked') return;
      for (const c of step.choices) {
        if (!pos[c.id]) continue;
        if (step.selected === c.id) {
          beams += `<g class="hb-beam" data-k="${esc(steps[k - 1].selected)}>${esc(c.id)}" data-p="${bez(from, pos[c.id]).map(v => v.toFixed(1)).join(',')}"><path class="b0"/><path class="b1"/><path class="b2"/></g>`;
        } else if (step.status === 'open') edges += `<path class="hb-edge" pathLength="1" data-step="${esc(step.id)}" d="${curve(from, pos[c.id])}"/>`;
      }
    });

    const cur = steps.findIndex(s => s.status === 'open');
    const headSvg = steps.map((step, k) => {
      const cls = step.status === 'done' ? 'ok' : k === cur ? 'now' : 'wait';
      const mark = step.status === 'done' ? '●' : k === cur ? '▶' : '';
      return `<text class="hb-head-t ${cls}" x="${heads[k] + 4}" y="22">${mark} ${k + 1} ${esc(step.short)}</text>`;
    }).join('');

    let i = 0;
    const nodes = steps.map(step => step.status === 'locked' ? '' : step.choices.map(c => nodeSvg(step, c, pos[c.id], i++)).join('')).join('');
    content.innerHTML = `<g class="hb-lattice">${lattice}</g>${headSvg}<g>${edges}</g><g>${beams}</g>${ghosts.map(ghostSvg).join('')}${nodes}`;

    // 새 단계가 열렸으면: 앞 빛줄기가 닿은 뒤 → 후보 선이 그려지고 → 토큰이 차례로 켜진다
    const openKey = cur >= 0 ? steps.map(s => s.id).join('/') + ':' + steps[cur].id : null;
    if (openKey && lastOpen !== null && openKey !== lastOpen) {
      let j = 0;
      content.querySelectorAll(`.hb-node[data-step="${steps[cur].id}"]`).forEach(n => { n.classList.add('reveal'); n.style.setProperty('--j', j++); });
      content.querySelectorAll(`.hb-edge[data-step="${steps[cur].id}"]`).forEach(e => e.classList.add('grow'));
    }
    lastOpen = openKey;

    // 머리 글: 지금 고를 단계의 질문, 결정한 수
    const open = steps[cur];
    root.querySelector('.hb-prompt b').textContent = open ? cur + 1 : '✓';
    root.querySelector('.hb-prompt span').textContent = open ? open.label : '이번 주 결정을 마쳤어요';
    root.querySelector('.hb-count').textContent = `${steps.filter(s => s.status === 'done').length} / ${steps.length} 결정`;
    decideButton.hidden = Boolean(state.decide?.hidden);
    decideButton.textContent = state.decide?.label ?? '';
    decideButton.disabled = Boolean(state.decide?.disabled || state.busy);
  }

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
  decideButton.addEventListener('click', () => { if (!decideButton.disabled) onDecide(); });

  // 빛줄기: 매 프레임 모양을 다시 그린다. 새로 이어진 연결은 앞 토큰에서 뻗어 가 닿고, 닿는 순간 그 토큰이 번쩍
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function frame(time) {
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
