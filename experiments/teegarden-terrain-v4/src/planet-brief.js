import brief from './planet-brief.json' with { type: 'json' };

// 1주차 ORI 브리핑 = 행성 강의 (데이터 담당 요청, 2026-11-11). 글은 planet-brief.json 의 pages.
// intro.js 가 한 장씩 넘기고, 여기서는 풍경 속 망점 행성(wire-art.js, 왼쪽 절반이 낮) 위에 얇은 선 표시를 얹는다.
// 표시는 장마다 쌓인다: sides(별 쪽·낮 쪽·밤 쪽·경계) → temps(기온). 새로 생기는 표시만 그려지는 움직임이 있다.
// 별 방향은 빨강 대신 주황(#FF993D, 팀 규칙). 선·글은 화면 토큰(#8FC1FF, #DCE6FF, 크림 #E8DFC8).
export const lecture = brief;
const NS = 'http://www.w3.org/2000/svg';
const LEVELS = ['sides', 'temps'];

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

/** 풍경 캔버스(object-fit: cover)에 그린 행성과 네모 칸의 화면 위치 */
function planetOnScreen(view) {
  const canvas = view.querySelector('canvas.scene');
  if (!canvas?.dataset.planet) return null;
  const [px, py, pr] = canvas.dataset.planet.split(',').map(Number);
  const width = view.clientWidth, height = view.clientHeight; // 테두리 안쪽 (칸·표시가 그려지는 자리와 같게)
  if (!width) return null;
  const scale = Math.max(width / canvas.width, height / canvas.height);
  const left = (width - canvas.width * scale) / 2, top = (height - canvas.height * scale) / 2;
  const box = (canvas.dataset.frame ?? '').split(',').map(Number).map((v, i) => (i % 2 ? top : left) + v * scale);
  return { width, height, cx: left + px * scale, cy: top + py * scale, r: pr * scale, box: box.length === 4 ? box : null };
}

/** 행성 뒤 네모 칸: 별을 치운 자리에 칸 배경과 테두리 (모든 주차) */
function placePanel(view, place) {
  const panel = view.querySelector('.brief-panel');
  if (!panel) return;
  panel.hidden = !place?.box;
  if (panel.hidden) return;
  const [x0, y0, x1, y1] = place.box;
  Object.assign(panel.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
}

let shown = -1; // 지금 그려 둔 표시 단계 (LEVELS 의 번호)

/** level: 'sides' | 'temps' | undefined. 이전보다 단계가 오르면 새 표시만 움직이며 나타난다 */
export function showPlanetMarks(svg, level, { animate = true } = {}) {
  const target = level ? LEVELS.indexOf(level) : -1;
  const place = planetOnScreen(svg.parentElement);
  placePanel(svg.parentElement, place);
  const bubble = svg.parentElement.querySelector('.bubble');
  bubble.style.maxWidth = '';
  // 말풍선 글이 행성 칸에 닿지 않게 (넓은 화면에서만. 좁은 화면은 말풍선이 아래에 있다)
  const room = place?.box ? place.box[0] - 24 - bubble.offsetLeft : 0;
  if (innerWidth > 1100 && room > 280) bubble.style.maxWidth = room + 'px';
  if (target < 0 || !place) { svg.toggleAttribute('hidden', true); svg.replaceChildren(); shown = -1; return; }
  const { width, height, cx, cy, r } = place, { art } = brief;
  svg.toggleAttribute('hidden', false);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const label = (x, y, text, anchor = 'middle', cls = '') => el('text', { x, y, 'text-anchor': anchor, class: 'mk-t ' + cls }, text);
  const line = (points, cls = '') => el('polyline', { points: points.map(p => p.join(',')).join(' '), pathLength: 1, class: 'mk-l ' + cls });
  const [x0, y0, x1, y1] = place.box ?? [cx - 1.75 * r, cy - 1.32 * r, cx + 1.9 * r, cy + 1.55 * r];
  // 별: 칸 왼쪽 밖에 중심을 둔 큰 원이라 해처럼 일부만 보인다. 열은 별에서 행성 낮 쪽으로 가는 화살표 (흐르는 점선)
  const sunR = r * 0.95, sunX = x0 - r * 0.65;
  const heat = [-0.45, 0, 0.45].map(k => {
    const y = cy + k * r, limb = cx - r * Math.sqrt(1 - k * k) - 8, start = sunX + Math.sqrt(sunR * sunR - (y - cy) ** 2) + 8;
    return [el('line', { x1: start, y1: y, x2: limb - 8, y2: y, class: 'mk-heat' }), el('path', { d: `M${limb} ${y} l-10 -6 v12 Z`, class: 'mk-arrow' })];
  }).flat();
  const groups = [
    // 별과 열 · 낮/밤 · 경계
    [
      el('clipPath', { id: 'mk-box' }, null),
      el('pattern', { id: 'mk-dots', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, null), // 망점 그림과 어울리게 점으로 채운다
      el('circle', { cx: sunX, cy, r: sunR, class: 'mk-sun', fill: 'url(#mk-dots)', 'clip-path': 'url(#mk-box)' }),
      ...heat,
      el('path', { d: `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r}`, class: 'mk-rim' }), // 밤 쪽은 빛이 없어 윤곽만 점선으로
      el('line', { x1: cx, y1: cy - r - 14, x2: cx, y2: cy + r + 12, class: 'mk-edge' }),
      label(cx - r * 0.55, cy + r + 32, art.daySide),
      label(cx, cy + r + 32, art.edge, 'middle', 'mk-cream'),
      label(cx + r * 0.55, cy + r + 32, art.nightSide),
    ],
    // 기온
    [
      line([[cx - r * 0.5, cy - r * 0.4], [cx - r * 0.3, cy - r - 26], [cx - r * 0.3 - 18, cy - r - 26]]),
      label(cx - r * 0.3 - 24, cy - r - 21, art.day, 'end'),
      line([[cx + r * 0.5, cy - r * 0.4], [cx + r * 0.3, cy - r - 26], [cx + r * 0.3 + 18, cy - r - 26]]),
      label(cx + r * 0.3 + 24, cy - r - 21, art.night, 'start'),
      label(cx, Math.min(cy + r + 56, y1 - 10), art.mean, 'middle', 'mk-mean'),
    ],
  ];
  groups[0][0].append(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
  groups[0][1].append(el('rect', { width: 2, height: 2, class: 'mk-dot' }));
  svg.replaceChildren(...groups.slice(0, target + 1).map((items, index) => {
    const group = el('g', { class: animate && index > shown ? 'mk-g mk-in' : 'mk-g' });
    group.append(...items);
    return group;
  }));
  shown = target;
}
export function resetPlanetMarks() { shown = -1; }
