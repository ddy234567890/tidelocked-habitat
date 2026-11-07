// 칸의 창 버튼 (PLANET_DATA, CREW_LINK): _ · × 는 칸을 접고 펴고, □ 는 자세한 내용을 큰 창으로 띄운다.
// CREW_LINK 의 큰 창은 crew.js 의 대원 상태 창을 그대로 연다.
// PLANET_DATA 의 수치는 칸(#planet-facts)의 값을 읽고, MEANING 은 그 뜻을 쉬운 말로 적은 것이다.
const $ = selector => document.querySelector(selector);

/** 칸 하나에 접기·펴기 버튼을 건다 */
function collapsible(panel, buttons, name) {
  buttons.forEach(button => button.addEventListener('click', () => {
    const collapsed = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', collapsed);
    buttons.forEach(b => b.setAttribute('aria-expanded', String(!collapsed)));
    buttons[0].setAttribute('aria-label', name + (collapsed ? ' 펴기' : ' 접기'));
  }));
}
collapsible($('.p-right'), [$('#planet-min'), $('#planet-close')], '행성 정보');
collapsible($('.p-crew'), [$('#crew-min'), $('#crew-close-panel')], '대원 상태');
$('#crew-max').addEventListener('click', () => $('#crew-open').click());

// PLANET_DATA 큰 창
const MEANING = {
  '최소질량': '지구 질량(M⊕)의 1.16배 이상이에요. 관측으로는 가장 작은 값만 알 수 있어요.',
  '추정 반지름': '지구 반지름(R⊕)의 약 1.04배예요. 크기는 지구와 거의 같아요.',
  '공전주기': '별을 한 바퀴 도는 시간, 곧 이 행성의 1년이에요.',
  '낮 최고': '늘 별을 향한 낮 쪽에서 가장 더운 기온이에요.',
  '밤 최저': '별 반대편 밤 쪽에서 가장 추운 기온이에요.',
};
const dialog = document.createElement('div');
dialog.className = 'data-modal'; dialog.hidden = true;
dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'data-title');
dialog.innerHTML = `
 <div class="data-card">
  <div class="titlebar"><span id="data-title">PLANET_DATA · 행성 정보</span><span class="wbtns"><button type="button" class="wbtn" id="data-close" aria-label="큰 창 닫기">×</button></span></div>
  <div class="data-body">
   <header class="data-hero"><div class="data-globe" aria-hidden="true"></div><div class="data-meta"></div></header>
   <section><h2>기본 수치</h2><div class="data-stats"></div></section>
   <section><h2>조석 고정</h2>
    <ul class="data-points">
     <li>행성이 늘 같은 면만 별을 향해요.</li>
     <li>낮 쪽은 계속 낮, 밤 쪽은 계속 밤이에요.</li>
     <li>그 사이, 해가 지평선에 걸린 곳이 황혼 지대예요.</li>
     <li>현무암 평원과 용암동굴은 낮 쪽에, 황혼 능선은 그 경계에 있어요.</li>
    </ul>
   </section>
  </div>
 </div>`;
document.body.append(dialog);

function fill() {
  dialog.querySelector('.data-stats').replaceChildren(...[...$('#planet-facts').querySelectorAll('li')].map(item => {
    const label = item.querySelector('span').textContent.trim(), value = item.querySelector('b').textContent.trim();
    const tile = document.createElement('div');
    tile.className = 'data-stat';
    tile.innerHTML = '<span></span><b></b><p></p>';
    tile.querySelector('span').textContent = label;
    tile.querySelector('b').textContent = value;
    tile.querySelector('p').textContent = MEANING[label] ?? '';
    return tile;
  }));
  dialog.querySelector('.data-meta').replaceChildren(...[...$('.p-right .meta').children].map(node => node.cloneNode(true)));
  const small = $('.globe canvas');
  if (small) {
    const copy = document.createElement('canvas');
    copy.width = small.width; copy.height = small.height;
    copy.getContext('2d').drawImage(small, 0, 0);
    dialog.querySelector('.data-globe').replaceChildren(copy);
  }
}
let opener = null;
const open = () => { fill(); opener = document.activeElement; dialog.hidden = false; $('#data-close').focus(); };
const close = () => { dialog.hidden = true; opener?.focus?.(); };
$('#planet-max').addEventListener('click', open);
$('#data-close').addEventListener('click', close);
dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialog.hidden) close(); });
