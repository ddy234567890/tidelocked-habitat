import hud from './hud.json' with { type: 'json' };

// 시작 화면: ⓪ 이동 중 → ① 브리핑(탐사 로봇 보고) → 결정 화면. 팀 디자인 캔버스 「1주차 화면 3종」을 따른다.
// 주소 뒤에 ?intro=0 을 붙이면 건너뛴다. 움직임 줄이기 설정이면 이동 화면을 거의 바로 넘긴다.
const $ = selector => document.querySelector(selector);
const intro = $('#intro'), travel = $('#intro-travel'), brief = $('#intro-brief');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL_MS = reduced ? 400 : 3400;

function finish() {
  intro.hidden = true;
  document.removeEventListener('keydown', onKey);
  $('#hud').querySelector('.site')?.focus({ preventScroll: true });
}
function showBrief() {
  if (travel.hidden) return; // 이미 브리핑이다
  travel.hidden = true; brief.hidden = false;
  $('#intro-next').focus();
}
function onKey(event) {
  if (event.key === 'Enter' && !brief.hidden) { event.preventDefault(); finish(); }
}

// 브리핑 글: 값이 없는 항목(현재 기온, 산소 농도)은 지어내지 않고 '측정 중'으로 적는다
const { night, day, now } = hud.temperature;
$('#brief-crew').textContent = hud.crewName ?? '대원';
$('#brief-year').textContent = 'YEAR ' + hud.year;
$('#brief-temp').textContent = (now == null ? '' : `현재 기온은 ${now}°C예요. `) + `밤에는 ${night}°C까지 내려가고, 낮에는 ${day}°C까지 올라가요.`;
$('#brief-o2').textContent = (hud.oxygen == null ? '산소 농도는 아직 측정 중이에요.' : `산소 농도는 ${hud.oxygen}%예요.`) + ' 그냥은 숨을 쉴 수 없어서 어떤 조치가 필요해 보여요.';

if (new URLSearchParams(window.startParams ?? location.search).get('intro') === '0') {
  intro.hidden = true;
} else {
  const fill = $('#travel-fill'), rocket = $('#travel-rocket'), pct = $('#travel-pct'), bar = $('#travel-bar');
  const start = performance.now();
  const step = time => {
    if (travel.hidden) return;
    const t = Math.min((time - start) / TRAVEL_MS, 1), percent = Math.round(t * 100);
    fill.style.width = percent + '%';
    rocket.style.left = `calc(${percent}% - ${percent / 100 * 132}px)`; // 로켓이 끝에서 트랙 밖으로 나가지 않게
    pct.textContent = percent + '%'; bar.setAttribute('aria-valuenow', String(percent));
    $('#travel-eta').textContent = percent < 100 ? '행성 궤도 진입 준비 중' : '궤도 진입 완료';
    if (t < 1) requestAnimationFrame(step); else setTimeout(showBrief, 350);
  };
  requestAnimationFrame(step);
  $('#intro-skip').addEventListener('click', showBrief);
  $('#intro-next').addEventListener('click', finish);
  document.addEventListener('keydown', onKey);
}
