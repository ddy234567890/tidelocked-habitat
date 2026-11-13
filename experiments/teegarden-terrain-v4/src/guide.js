// 화면 안내 (2026-11-13 요청): 1주차 행성 강의가 끝나고 처음 선지를 고르기 전에, 화면의 칸을 하나씩 밝혀 가며
// 어떤 칸인지 · 사용자가 무엇을 하면 되는지 알려 준다. 아무 데나 누르거나 Enter·→ 를 누르면 다음 칸, Esc 는 건너뛰기.
// 행성 정보 · 대원 상태는 □ 확대 버튼을 직접 눌러 보게 하고(press), 뜬 큰 창을 밝혀 무엇이 나오는지 알려 준 뒤 닫는다(close).
// main.js 는 건드리지 않는다: #intro 가 닫히는 순간(브리핑 끝)을 지켜보다가 한 번만 띄운다.
// 주소 뒤 ?intro=0 이면 브리핑이 없으므로 안내도 없다 (?guide=1 을 함께 붙이면 바로 띄운다).
import './guide.css';

const $ = selector => document.querySelector(selector);

// target: 밝힐 칸. 여러 개를 적으면 화면에 보이는 첫 번째를 쓰고, 하나도 없으면 그 장을 건너뛴다
// say: 설명 문단, list: 설명 아래 항목, todo: 사용자가 할 일 (모두 없어도 된다. 보면 아는 건 적지 않는다)
// press: 밝힌 버튼을 사용자가 직접 눌러야 다음으로 간다 (다른 곳을 누르면 버튼이 깜빡여 알려 준다)
// close: 큰 창을 보여 주는 장. 이 장을 떠날 때 그 창의 닫기 버튼을 대신 누른다
const STEPS = [
  {
    target: ['.p-left'], title: '탐사 상태',
    say: ['기온 · 산소와 지금까지 결정한 기록(LOG)이에요.'],
    todo: 'W1 같은 주차 탭을 누르면 그 주 브리핑을 다시 볼 수 있어요.',
  },
  {
    target: ['.p-stage'], title: '현장 화면',
    say: ['고른 선지가 여기에 지어져요.'],
    todo: '끌어서 돌려 볼 수 있어요.',
  },
  {
    target: ['#planet-max'], title: '행성 정보', press: true,
    todo: '깜빡이는 □ 를 눌러 크게 보세요.',
  },
  {
    target: ['.data-modal:not([hidden]) .data-card'], title: '행성 정보 큰 창', close: '#data-close',
    list: ['수치마다 뜻을 쉬운 말로 풀어 줘요.', '낮 · 밤 · 황혼 지대가 왜 생기는지 알려 줘요.'],
  },
  {
    target: ['.p-crew'], title: '대원 상태',
    say: [
      '아직 아무도 이주하지 않았어요.',
      '이 얼굴은 “지금 이 행성에 사람이 서 있다면 어떤 상태일까”를 보여 줘요.',
      '산소 방식을 정하기 전에는 바깥 공기 그대로라 힘들어 보여요.',
    ],
  },
  {
    target: ['#crew-max'], title: '대원 상태', press: true,
    todo: '깜빡이는 □ 를 눌러 크게 보세요.',
  },
  {
    target: ['.crew-modal:not([hidden]) .crew-card'], title: '대원 상태 큰 창', close: '#crew-close',
    list: ['맨 위: 지금 가장 힘든 점과 그 정도', 'SpO₂: 피 속 산소', '막대: 증상마다 얼마나 심한지', '모두 추정 값이에요.'],
  },
  {
    target: ['.hb-head', '.p-decision .step-title'], title: '지금 할 일',
    say: ['1 위치 → 2 짓는 방식 → 3 산소 순서로 정해요.'],
    todo: '▤ 메모장에서 고른 길을 다시 볼 수 있어요.',
  },
  {
    target: ['.hb-view', '.p-decision .sites'], title: '선지',
    say: ['육각형 하나가 선지 하나예요.'],
    todo: '결정하기 전까지는 마음껏 눌러 봐도 돼요.',
  },
  {
    target: ['.hb-decide'], title: '결정 버튼',
    say: ['고른 선지를 확정해요.'],
    todo: '이제 위치 A · B · C 중 하나를 골라 보세요.',
  },
];

function visible(selector) {
  const node = $(selector);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return box.width > 4 && box.height > 4 ? node : null;
}
const targetOf = step => step.target.map(visible).find(Boolean) ?? null;
// 큰 창 장은 바로 앞 확대 버튼 장에서 버튼을 눌러야만 들어간다 (그냥 넘기거나 뒤로 갈 때는 건너뛴다)
const reachable = step => !step.close && targetOf(step);

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
     <ul class="guide-list"></ul>
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
  root.querySelector('.guide-next').addEventListener('click', event => { event.stopPropagation(); forward(); });
  root.addEventListener('click', event => {
    // 확대 버튼 장: 밝힌 버튼 자리를 눌러야 버튼이 눌린다. 다른 곳을 누르면 버튼이 깜빡여 알려 준다
    if (STEPS[index]?.press) {
      const box = current.getBoundingClientRect(), pad = 8;
      const inside = event.clientX >= box.left - pad && event.clientX <= box.right + pad && event.clientY >= box.top - pad && event.clientY <= box.bottom + pad;
      if (inside) press();
      else if (!card.contains(event.target)) nudge();
      return;
    }
    forward();
  });
}

function nudge() {
  spot.classList.remove('guide-nudge'); void spot.offsetWidth; spot.classList.add('guide-nudge');
}
/** 밝힌 확대 버튼을 진짜로 누르고, 뜬 큰 창을 보여 주는 다음 장으로 */
let pressing = false; // 큰 창이 뜨기 전에 여러 번 눌러도 한 번만
function press() {
  if (pressing) return;
  pressing = true;
  current.click();
  requestAnimationFrame(() => { pressing = false; go(index + 1, { fromPress: true }); });
}
function forward() {
  if (STEPS[index]?.press) return press(); // 확대 버튼 장의 Enter 는 그 버튼을 누른 것과 같다
  go(index + 1);
}
/** 큰 창 장을 떠날 때 그 창을 닫는다 */
function leave() {
  const step = STEPS[index];
  if (step?.close) document.body.classList.remove('guide-modal');
  if (step?.close && targetOf(step)) $(step.close)?.click();
}

/** 다음 칸을 보여 줄 수 있으면 보여 주고, 다 봤으면 닫는다 */
function go(next, { fromPress = false, back = false } = {}) {
  leave();
  const ok = n => (fromPress && n === next ? targetOf(STEPS[n]) : reachable(STEPS[n]));
  if (back) { while (next > 0 && !ok(next)) next--; }
  else while (next < STEPS.length && !ok(next)) next++;
  if (next >= STEPS.length || next < 0) return close();
  index = next;
  const step = STEPS[index];
  // 큰 창은 넓은 화면에서 왼쪽으로 비켜 서서, 안내 카드가 오른쪽 옆에 설 자리를 만든다 (guide.css)
  document.body.classList.toggle('guide-modal', Boolean(step.close));
  current = targetOf(step);
  current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  root.querySelector('#guide-title').textContent = step.title;
  root.querySelector('.guide-say').replaceChildren(...(step.say ?? []).map(text => Object.assign(document.createElement('p'), { textContent: text })));
  root.querySelector('.guide-list').replaceChildren(...(step.list ?? []).map(text => Object.assign(document.createElement('li'), { textContent: text })));
  root.querySelector('.guide-todo span').textContent = step.todo ?? '';
  root.querySelector('.guide-todo').hidden = !step.todo;
  root.querySelector('.guide-count').textContent = `${index + 1} / ${STEPS.length}`;
  const last = !STEPS.slice(index + 1).some(reachable);
  // 확대 버튼 장에는 다음 버튼이 없다: 깜빡이는 테두리 속 버튼을 직접 눌러야 넘어간다 (키보드는 Enter 로도 누를 수 있다)
  root.querySelector('.guide-next').textContent = last ? '시작하기 ▶' : '다음 ▶';
  root.querySelector('.guide-next').hidden = Boolean(step.press);
  root.classList.toggle('guide-pressing', Boolean(step.press));
  spot.classList.remove('guide-nudge');
  card.classList.remove('guide-in'); void card.offsetWidth; card.classList.add('guide-in');
  place();
  // 창이 비켜 서는 움직임이 끝난 뒤 자리를 다시 잰다
  if (step.close) setTimeout(place, 60);
  root.querySelector(step.press ? '.guide-skip' : '.guide-next').focus({ preventScroll: true });
}

/** 밝힌 칸 둘레에 빛 테두리, 카드는 칸 옆 빈 곳에 (오른쪽 → 왼쪽 → 아래 → 위 순서로 자리를 찾는다) */
function place() {
  if (!current) return;
  const box = current.getBoundingClientRect(), pad = STEPS[index]?.press ? 4 : 6, gap = 18, edge = 12;
  Object.assign(spot.style, { left: box.left - pad + 'px', top: box.top - pad + 'px', width: box.width + 2 * pad + 'px', height: box.height + 2 * pad + 'px' });
  const w = card.offsetWidth, h = card.offsetHeight, W = innerWidth, H = innerHeight;
  const clampX = x => Math.min(Math.max(x, edge), W - w - edge), clampY = y => Math.min(Math.max(y, edge), H - h - edge);
  let x, y;
  if (box.right + gap + w <= W - edge) { x = box.right + gap; y = clampY(box.top); }
  else if (box.left - gap - w >= edge) { x = box.left - gap - w; y = clampY(box.top); }
  else if (box.bottom + gap + h <= H - edge) { x = clampX(box.left); y = box.bottom + gap; }
  else if (box.top - gap - h >= edge) { x = clampX(box.left); y = box.top - gap - h; }
  else { x = clampX(box.right - w); y = H - h - edge; } // 자리가 없으면(좁은 화면의 큰 창) 화면 아래쪽에 겹쳐 둔다
  Object.assign(card.style, { left: x + 'px', top: y + 'px' });
}

function onKey(event) {
  if (!root || root.hidden) return;
  // 안내가 떠 있는 동안 게임의 키(◀ ▶ 선택, Enter 확정, 큰 창의 Esc)는 막는다
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); forward(); }
  else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); go(index - 1, { back: true }); }
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
  // 대원 상태 큰 창(crew.js)이 window 에서 키를 먼저 잡으므로 같은 window 에 건다 (그쪽은 stopPropagation 만 해서 여기까지 온다)
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  go(0);
}
function close() {
  if (!root) return;
  leave();
  root.hidden = true; current = null;
  removeEventListener('keydown', onKey, true);
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
