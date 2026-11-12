// 화면 안내 (2026-11-13 요청): 1주차 행성 강의가 끝나고 처음 선지를 고르기 전에, 화면의 칸을 하나씩 밝혀 가며
// 어떤 칸인지 · 사용자가 무엇을 하면 되는지 알려 준다. 아무 데나 누르거나 Enter·→ 를 누르면 다음 칸, Esc 는 건너뛰기.
// main.js 는 건드리지 않는다: #intro 가 닫히는 순간(브리핑 끝)을 지켜보다가 한 번만 띄운다.
// 주소 뒤 ?intro=0 이면 브리핑이 없으므로 안내도 없다 (?guide=1 을 함께 붙이면 바로 띄운다).
import './guide.css';

const $ = selector => document.querySelector(selector);

// target 은 밝힐 칸. 여러 개를 적으면 화면에 보이는 첫 번째를 쓰고, 하나도 없으면 그 장을 건너뛴다
const STEPS = [
  {
    target: ['.p-left'], title: '탐사 상태',
    say: ['지금 몇 주차인지, 고른 곳의 기온(TEMP)과 산소(O₂), 지금까지 결정한 기록(LOG)이 나와요.'],
    todo: '읽기만 하면 돼요. 위쪽 W1 같은 주차 탭을 누르면 그 주 브리핑을 다시 볼 수 있어요.',
  },
  {
    target: ['.p-stage'], title: '현장 화면',
    say: ['행성과 기지를 점으로 보여 주는 화면이에요. 고른 선지가 여기에 바로 지어져요.'],
    todo: '마우스로 끌면 돌려 볼 수 있어요. 행성 위 A · B · C 를 눌러도 그 지점으로 다가가요.',
  },
  {
    target: ['.p-right'], title: '행성 정보',
    say: ['방금 브리핑에서 들은 이 행성의 기본 수치예요.'],
    todo: '오른쪽 위 □ 버튼을 누르면 크게, 뜻까지 쉽게 풀어서 보여 줘요.',
  },
  {
    target: ['.p-crew'], title: '대원 상태',
    say: [
      '아직 아무도 이 행성으로 이주하지 않았어요.',
      '이 얼굴은 “지금 이 행성에 사람이 서 있다면 어떤 상태일까”를 미리 보여 주는 거예요.',
      '기지와 산소 방식을 정하기 전에는 바깥 공기를 그대로 마시는 셈이라 힘들어 보여요. 선택할수록 표정이 바뀌어요.',
    ],
    todo: '얼굴을 누르면 산소포화도 · 체온 · 호흡 같은 자세한 상태를 볼 수 있어요.',
  },
  {
    target: ['.hb-head', '.p-decision .step-title'], title: '지금 할 일',
    say: ['지금 해야 할 일과 순서가 나와요. 1주차는 1 위치 → 2 짓는 방식 → 3 산소 순서로 정해요.'],
    todo: '오른쪽 숫자는 몇 개를 결정했는지예요. ▤ 메모장을 누르면 지금까지 고른 길을 볼 수 있어요.',
  },
  {
    target: ['.hb-view', '.p-decision .sites'], title: '선지',
    say: ['육각형 하나가 선지 하나예요. 지금은 기지를 세울 위치 세 곳이 있어요.'],
    todo: '하나를 눌러 보세요. 현장 화면에 그 선택이 보여요. 결정하기 전까지는 다른 것도 마음껏 눌러 봐도 돼요.',
  },
  {
    target: ['.hb-decide'], title: '결정 버튼',
    say: ['마음에 드는 선지를 골랐으면 이 버튼으로 확정해요. 결정하면 다음 단계가 열려요.'],
    todo: '이제 기지를 세울 위치 A · B · C 중 하나를 눌러 시작해 보세요.',
  },
];

function visible(selector) {
  const node = $(selector);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return box.width > 4 && box.height > 4 ? node : null;
}
const targetOf = step => step.target.map(visible).find(Boolean) ?? null;

let root = null, spot = null, card = null, index = -1, current = null;

function build() {
  root = document.createElement('div');
  root.className = 'guide';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'guide-title');
  root.innerHTML = `
   <div class="guide-spot" aria-hidden="true"></div>
   <div class="guide-card">
    <div class="titlebar"><span>ORI://GUIDE · 화면 안내</span><span class="guide-count"></span></div>
    <div class="guide-body">
     <h2 id="guide-title"></h2>
     <div class="guide-say"></div>
     <p class="guide-todo"><b>이렇게 하세요</b><span></span></p>
     <div class="guide-actions">
      <button type="button" class="guide-skip">안내 건너뛰기</button>
      <button type="button" class="guide-next"></button>
     </div>
    </div>
   </div>`;
  document.body.append(root);
  spot = root.querySelector('.guide-spot');
  card = root.querySelector('.guide-card');
  root.querySelector('.guide-skip').addEventListener('click', event => { event.stopPropagation(); close(); });
  // 카드 버튼이든 어두운 바깥이든, 한 번 누르면 다음 칸
  root.addEventListener('click', () => go(index + 1));
}

/** 다음 칸을 보여 줄 수 있으면 보여 주고, 다 봤으면 닫는다 */
function go(next) {
  while (next < STEPS.length && !targetOf(STEPS[next])) next++;
  if (next >= STEPS.length) return close();
  index = next;
  const step = STEPS[index];
  current = targetOf(step);
  current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  root.querySelector('#guide-title').textContent = step.title;
  root.querySelector('.guide-say').replaceChildren(...step.say.map(text => Object.assign(document.createElement('p'), { textContent: text })));
  root.querySelector('.guide-todo span').textContent = step.todo;
  root.querySelector('.guide-count').textContent = `${index + 1} / ${STEPS.length}`;
  const last = !STEPS.slice(index + 1).some(targetOf);
  root.querySelector('.guide-next').textContent = last ? '시작하기 ▶' : '다음 ▶';
  card.classList.remove('guide-in'); void card.offsetWidth; card.classList.add('guide-in');
  place();
  root.querySelector('.guide-next').focus({ preventScroll: true });
}

/** 밝힌 칸 둘레에 빛 테두리, 카드는 칸 옆 빈 곳에 (오른쪽 → 왼쪽 → 아래 → 위 순서로 자리를 찾는다) */
function place() {
  if (!current) return;
  const box = current.getBoundingClientRect(), pad = 6, gap = 18, edge = 12;
  Object.assign(spot.style, { left: box.left - pad + 'px', top: box.top - pad + 'px', width: box.width + 2 * pad + 'px', height: box.height + 2 * pad + 'px' });
  const w = card.offsetWidth, h = card.offsetHeight, W = innerWidth, H = innerHeight;
  const clampX = x => Math.min(Math.max(x, edge), W - w - edge), clampY = y => Math.min(Math.max(y, edge), H - h - edge);
  let x, y;
  if (box.right + gap + w <= W - edge) { x = box.right + gap; y = clampY(box.top); }
  else if (box.left - gap - w >= edge) { x = box.left - gap - w; y = clampY(box.top); }
  else if (box.bottom + gap + h <= H - edge) { x = clampX(box.left); y = box.bottom + gap; }
  else if (box.top - gap - h >= edge) { x = clampX(box.left); y = box.top - gap - h; }
  else { x = clampX(box.left + (box.width - w) / 2); y = clampY(box.top + (box.height - h) / 2); } // 자리가 없으면 칸 위에 겹쳐 둔다
  Object.assign(card.style, { left: x + 'px', top: y + 'px' });
}

function onKey(event) {
  if (!root || root.hidden) return;
  // 안내가 떠 있는 동안 게임의 키(◀ ▶ 선택, Enter 확정)는 막는다
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); go(index + 1); }
  else if (event.key === 'ArrowLeft' && index > 0) {
    event.preventDefault();
    let back = index - 1;
    while (back > 0 && !targetOf(STEPS[back])) back--;
    go(back);
  }
  else if (event.key === 'Tab') { // 안내 밖으로 포커스가 나가지 않게
    event.preventDefault();
    const buttons = [...root.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
    buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
}

function open() {
  if (root && !root.hidden) return;
  if (!root) build();
  root.hidden = false;
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  go(0);
}
function close() {
  if (!root) return;
  root.hidden = true; current = null;
  document.removeEventListener('keydown', onKey, true);
  removeEventListener('resize', place);
  removeEventListener('scroll', place, true);
  (visible('.hb-node.can') ? $('.hb-node.can') : $('.p-decision button:not([hidden])'))?.focus?.({ preventScroll: true });
}

/** 메인 창들이 홀로그램처럼 다 뜬 뒤(holo-boot.css 의 booting 이 끝난 뒤)에 연다 */
function openWhenReady() {
  const hud = $('#hud');
  const wait = () => (hud.classList.contains('booting') || !$('#intro').hidden ? setTimeout(wait, 150) : setTimeout(open, 250));
  setTimeout(wait, 300);
}

const params = new URLSearchParams(window.startParams ?? location.search);
const intro = $('#intro');
if (params.get('guide') === '1') openWhenReady();
else if (params.get('guide') !== '0' && !intro.hidden) {
  // 첫 브리핑(1주차 행성 강의)이 닫히는 순간 한 번만
  const watch = new MutationObserver(() => {
    if (!intro.hidden) return;
    watch.disconnect();
    openWhenReady();
  });
  watch.observe(intro, { attributes: true, attributeFilter: ['hidden'] });
}
