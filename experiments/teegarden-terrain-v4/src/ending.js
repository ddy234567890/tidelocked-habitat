// 엔딩 ② 철수 (체험판: 느낌만 보기, 2026-11-16). 판정 없이 5주차 마지막 단계(입주 방법 M1/M2)를 결정하면 뜬다.
// main.js 는 건드리지 않고 화면(DOM)만 읽는다: 육각형 판에서 고른 선지, 왼쪽 게이지 값.
// 장면 = 무엇이 바닥났나(가장 낮은 게이지) × 입주 방식. 그림은 src/assets/endings/{게이지}-{M1|M2}.(svg|jpg|png|webp)
//   예: water-M2.jpg. 그림이 없으면 '그림 자리' 칸이 보인다. 그림은 출처·라이선스를 ASSETS.md 에 적는다.
// 그림 색은 SVG 필터로 게임 팔레트(파랑 단계 → 크림)로만 바꾼다 (빨강·초록·보라가 나오지 않게).
// 아래 한 줄: 고른 선지 중 그 게이지를 가장 많이 깎은 선지 = "N주차 「…」에서 물이 모자라기 시작했어요".
import { WEEKS } from './choices.js';
import { effectsFor, GAUGE_KEYS, GAUGE_LABELS } from './gauges.js';
import './ending.css';

const IMAGES = import.meta.glob('./assets/endings/*.{svg,jpg,png,webp}', { eager: true, query: '?url', import: 'default' });
const imageFor = (key, move) => Object.entries(IMAGES).find(([path]) => path.includes(`/${key}-${move}.`))?.[1];

const SCENE = {
  water: '마지막 물탱크 앞에 줄이 서 있어요.',
  food: '빈 식량 선반 앞에 줄이 서 있어요.',
  power: '꺼진 기지에서 손전등을 든 줄이 서 있어요.',
  air: '마지막 산소통 앞에 줄이 서 있어요.',
};
const MOVE = {
  M1: { line: '한꺼번에 입주했기에, 모두 다시 이주선에 올라요.', cost: '기지에는 불이 켜진 채 아무도 남지 않았어요.' },
  M2: { line: '나눠 입주했기에, 이주선에서 기다리던 절반은 끝내 내려오지 못해요.', cost: '이주선에는 아직 절반이 기다리고 있어요.' },
};
const particle = (word, yes, no) => word + ((word.charCodeAt(word.length - 1) - 0xAC00) % 28 ? yes : no);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 육각형 판에서 고른 선지 → { 단계id: 선지id }
function readSelection() {
  const selection = {};
  for (const node of document.querySelectorAll('.hb-node.s-chosen')) selection[node.dataset.step] = node.dataset.id;
  return selection;
}
// 그 게이지를 가장 많이 깎은 선지 (즉시 효과 + 매주 효과 × 남은 주)
function causeFor(key, selection) {
  let worst = null;
  WEEKS.forEach(({ steps }, w) => steps.forEach(step => {
    const id = selection[step.id]; if (!id) return;
    const hit = effectsFor(id, selection).reduce((sum, e) => sum + (e.now?.[key] ?? 0) + (e.weekly?.[key] ?? 0) * (WEEKS.length - w), 0);
    const choice = step.choices?.find(c => c.id === id);
    if (hit < 0 && (!worst || hit < worst.hit)) worst = { hit, week: w + 1, label: choice?.label ?? id };
  }));
  return worst;
}

let shown = false;
function showEnding(move, key) {
  if (shown) return; shown = true;
  document.getElementById('fail')?.setAttribute('hidden', '');
  const name = GAUGE_LABELS[key] ?? '물', text = MOVE[move] ?? MOVE.M1, src = imageFor(key, move);
  const cause = causeFor(key, readSelection());
  const root = document.createElement('div');
  root.className = 'ending'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ending-title');
  root.innerHTML = `
    <svg width="0" height="0" aria-hidden="true" style="position:absolute"><filter id="ending-tone" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values=".3 .59 .11 0 0  .3 .59 .11 0 0  .3 .59 .11 0 0  0 0 0 1 0"/>
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0.008 0.071 0.180 0.451 0.949"/>
        <feFuncG type="table" tableValues="0.016 0.122 0.302 0.659 0.922"/>
        <feFuncB type="table" tableValues="0.047 0.361 0.741 1.000 0.859"/>
      </feComponentTransfer></filter></svg>
    <div class="ending-frame">
      <p class="ending-tag">ORI · SIMULATION FORECAST · 입주 후 4주</p>
      <figure class="ending-shot">${src
        ? `<img src="${src}" alt="${esc(SCENE[key])}">`
        : `<div class="ending-empty">그림 자리<small>src/assets/endings/${key}-${move}.jpg</small></div>`}</figure>
      <div class="ending-text">
        <p class="ending-code">결말 ② · 철수</p>
        <h2 id="ending-title">${esc(particle(name, '이', '가'))} 바닥나 기지를 떠나요</h2>
        <p>${esc(SCENE[key])} ${esc(text.line)}</p>
        ${cause ? `<p class="ending-cause">${cause.week}주차 「${esc(cause.label)}」에서 ${esc(particle(name, '이', '가'))} 모자라기 시작했어요.</p>` : ''}
        <p class="ending-cost">${esc(text.cost)}</p>
        <button type="button" class="decide" id="ending-restart">▶ 처음부터 다시</button>
      </div>
    </div>`;
  document.body.append(root);
  const button = root.querySelector('#ending-restart');
  button.addEventListener('click', () => { location.href = location.pathname; });
  button.focus();
}

// 5주차 마지막 단계(입주) 결정 버튼: 고른 입주 방식과 가장 낮은 게이지를 읽고, 게이지가 다시 그려진 뒤 엔딩을 띄운다
document.addEventListener('click', (event) => {
  if (!event.target.closest('.hb-decide')) return;
  const node = document.querySelector('.hb-node.s-chosen[data-step="arrive"]');
  if (!node) return;
  const move = node.dataset.id;
  setTimeout(() => {
    const byLabel = Object.fromEntries(GAUGE_KEYS.map(k => [GAUGE_LABELS[k], k]));
    const rows = [...document.querySelectorAll('#hud-gauges .gauge-row')]
      .map(row => [byLabel[row.querySelector('.g-name').textContent], Number(row.querySelector('.g-val').textContent)])
      .sort((a, b) => a[1] - b[1]);
    showEnding(move, rows[0]?.[0] ?? 'water');
  }, 1800);
}, true);
window.ending = { show: showEnding };   // 개발용: window.ending.show('M2', 'water')
