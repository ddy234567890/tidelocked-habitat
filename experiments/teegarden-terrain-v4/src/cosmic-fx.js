// 낯선 행성 탐사 화면 효과 (2026-11-16): 행성 둘레 레이더 고리 · 창에서 행성으로 이어지는 지시선 ·
// 메인 화면이 처음 나올 때 창 펼침 + 제목 글자 해독. 겉모습만 더한다 (main.js 와 게임 상태는 건드리지 않음).
const NS = 'http://www.w3.org/2000/svg';
const $ = (s) => document.querySelector(s);
const hud = $('#hud'), body = $('#stage .window-body');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// 행성 화면에서 행성이 놓이는 자리 (카메라 기본 구도 기준, 1366×768 · 1440×900 화면에서 잼: 가로 59%, 세로 40%, 반지름 = 높이의 37%)
let CENTER_X = 0.5, CENTER_Y = 0.435, PLANET_R = 0.378;   // 2026-11-18: 행성이 화면 가운데로 옮겨짐 (main.js overviewPose)

function el(tag, attrs = {}, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; }

// ── 레이더 고리: 동심원 · 눈금 · 천천히 훑는 빛 ──
const radar = document.createElement('div'); radar.className = 'k-radar'; radar.setAttribute('aria-hidden', 'true');
const rs = el('svg', {}, radar); body?.appendChild(radar);
function drawRadar() {
  const w = body.clientWidth, h = body.clientHeight, cx = w * CENTER_X, cy = h * CENTER_Y, R = h * PLANET_R;
  rs.setAttribute('viewBox', `0 0 ${w} ${h}`); rs.innerHTML = '';
  const defs = el('defs', {}, rs), g = el('radialGradient', { id: 'k-sweep-g', cx: cx, cy: cy, r: R * 1.45, gradientUnits: 'userSpaceOnUse' }, defs);
  el('stop', { offset: '0', 'stop-color': '#8FC1FF', 'stop-opacity': '0' }, g); el('stop', { offset: '.6', 'stop-color': '#8FC1FF', 'stop-opacity': '.05' }, g); el('stop', { offset: '1', 'stop-color': '#8FC1FF', 'stop-opacity': '.12' }, g);
  [1.08, 1.24, 1.42].forEach((k, i) => el('circle', { class: 'ring' + (i === 1 ? ' dash' : ''), cx, cy, r: R * k }, rs));
  for (let a = 0; a < 360; a += 5) {           // 바깥 고리 눈금 (숫자는 쓰지 않음)
    const rad = a * Math.PI / 180, major = a % 30 === 0, r0 = R * 1.42, r1 = r0 + (major ? 12 : 5);
    el('line', { class: 'tick' + (major ? ' major' : ''), x1: cx + Math.cos(rad) * r0, y1: cy + Math.sin(rad) * r0, x2: cx + Math.cos(rad) * r1, y2: cy + Math.sin(rad) * r1 }, rs);
  }
  el('line', { class: 'axis', x1: cx - R * 1.6, y1: cy, x2: cx + R * 1.6, y2: cy }, rs); el('line', { class: 'axis', x1: cx, y1: cy - R * 1.6, x2: cx, y2: cy + R * 1.6 }, rs);
  if (!reduced) {                               // 훑는 빛: 부채꼴 하나가 9초에 한 바퀴
    const sw = el('g', { class: 'sweep', style: `--cx:${cx}px;--cy:${cy}px` }, rs), r = R * 1.42, a0 = -Math.PI / 2, a1 = a0 + 0.5;
    el('path', { d: `M${cx},${cy} L${cx + Math.cos(a0) * r},${cy + Math.sin(a0) * r} A${r},${r} 0 0 1 ${cx + Math.cos(a1) * r},${cy + Math.sin(a1) * r} Z` }, sw);
  }
}

// ── 지시선: 각 창 가장자리 → 꺾임 → 행성 고리 위 한 점 ──
const leads = document.createElement('div'); leads.className = 'k-leads'; leads.setAttribute('aria-hidden', 'true');
const ls = el('svg', {}, leads); /* 2026-11-18: 상자 없는 배치로 바꾸며 지시선은 뺌 */
let lastKey = '';
function drawLeads() {
  return;
  if (!body) return;
  const b = body.getBoundingClientRect(), cx = b.left + b.width * CENTER_X, cy = b.top + b.height * CENTER_Y, R = b.height * PLANET_R * 1.08;
  const items = ['.p-left', '.p-right', '.p-crew'].map(s => $(s)).filter(p => p && p.offsetParent && getComputedStyle(p).position === 'absolute');
  const boxes = items.map(p => p.getBoundingClientRect());
  const key = boxes.map(r => [r.left, r.top, r.width, r.height].map(Math.round).join(',')).join('|') + `|${innerWidth}x${innerHeight}`;
  if (key === lastKey) return; lastKey = key;
  ls.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`); ls.innerHTML = '';
  boxes.forEach((r) => {
    const left = r.left + r.width / 2 < cx, sx = left ? r.right : r.left, sy = Math.min(Math.max(r.top + 34, cy - R), r.bottom - 20);
    const ex0 = sx + (left ? 28 : -28), ang = Math.atan2(sy - cy, ex0 - cx), ex = cx + Math.cos(ang) * R, ey = cy + Math.sin(ang) * R;
    el('path', { d: `M${sx},${sy} H${ex0} L${ex},${ey}` }, ls);
    el('circle', { class: 'end', cx: sx, cy: sy, r: 2.5 }, ls);
    el('circle', { class: 'dot', cx: ex, cy: ey, r: 2 }, ls);
    if (!reduced) el('circle', { class: 'pulse', cx: ex, cy: ey, r: 3 }, ls);
  });
}

// ── 화면 장식: 제목 블록 · 모서리 꺾쇠 · 위쪽 계기선 (글은 장식이고 기능은 없음) ──
if (hud) {
  const t = document.createElement('div'); t.className = 'k-title'; t.setAttribute('aria-hidden', 'true');
  t.innerHTML = '<span class="k-name">TEEGARDEN <b>b</b></span><span class="k-sub"><i></i>SITE SURVEY · <em>YEAR 7777</em></span>';
  hud.appendChild(t);
  ['tl', 'tr', 'bl', 'br'].forEach(c => { const e = document.createElement('i'); e.className = 'k-corner ' + c; e.setAttribute('aria-hidden', 'true'); hud.appendChild(e); });
  const line = document.createElement('i'); line.className = 'k-topline'; line.setAttribute('aria-hidden', 'true'); hud.appendChild(line);
}
// 행성에서 탐사 지점으로 들어가면(지역 화면) 레이더를 감춘다
const nav = $('#local-nav');
const syncLocal = () => hud?.classList.toggle('k-local', !!nav && !nav.hidden);
if (nav) new MutationObserver(syncLocal).observe(nav, { attributes: true, attributeFilter: ['hidden'] });

// ── 메인 화면 첫 등장: 창이 차례로 펼쳐지고 제목 글자가 해독되듯 나타남 ──
const GLYPH = '▓▒░/\\|#=+<>';
function decode(span) {
  const node = [...span.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); if (!node || span.dataset.kDecoding) return;
  const text = span.dataset.kText ??= node.textContent; span.dataset.kDecoding = '1'; let f = 0;   // 원래 글자는 처음 한 번만 기억
  const id = setInterval(() => {
    f++; const n = Math.floor(text.length * f / 14);
    node.textContent = text.slice(0, n) + [...text.slice(n)].map(c => c === ' ' ? ' ' : GLYPH[(Math.random() * GLYPH.length) | 0]).join('');
    if (f >= 14) { clearInterval(id); node.textContent = text; delete span.dataset.kDecoding; }
  }, 45);
}
let booted = false;
function boot() {
  if (!hud || reduced || booted) return; booted = true;
  hud.classList.add('k-boot'); setTimeout(() => hud.classList.remove('k-boot'), 1600);
  document.querySelectorAll('.panel>.titlebar>span:first-child').forEach((s, i) => setTimeout(() => decode(s), 120 + i * 150));
  lastKey = ''; setTimeout(() => { lastKey = ''; drawLeads(); }, 900);
}
const intro = $('#intro');
if (intro) new MutationObserver(() => { if (intro.hidden) boot(); }).observe(intro, { attributes: true, attributeFilter: ['hidden'] });

if (body) { new ResizeObserver(() => { drawRadar(); lastKey = ''; drawLeads(); }).observe(body); drawRadar(); }
// 창을 접거나 닫으면 지시선도 따라가게 (가볍게 0.5초마다 확인, 바뀐 게 없으면 다시 그리지 않음)
setInterval(drawLeads, 500); syncLocal();

// 행성이 돌다가 지점 표시(A·B·C)가 아래 선지판 쪽으로 내려가면 흐리게 감춘다 (선지판 글과 겹치지 않게)
const deck = $('.p-decision');
setInterval(() => {
  if (!deck || getComputedStyle(deck).position !== 'absolute') return;
  const top = deck.getBoundingClientRect().top - 8;
  document.querySelectorAll('#planet-labels .pin').forEach(p => { const r = p.getBoundingClientRect(); p.classList.toggle('k-under', r.bottom > top); });
}, 120);
