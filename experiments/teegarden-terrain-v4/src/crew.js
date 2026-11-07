// 왼쪽 아래 대원 얼굴 + 누르면 가운데 팝업으로 세부 상태.
// 얼굴 엔진은 src/face (얼굴 반응 테스트 페이지에서 가져옴). 여기서는 화면 연결만 한다.
// 환경 값은 hud.json 에 정해진 것만 쓰고, 없는 값(산소·기압 등)은 얼굴 엔진 기본값(지구 해수면 공기)이다.
import { createBodyLoop } from './face/bodyLoop.js';
import { createFacePanel } from './face/facePanel.js';
import { LEVEL_NAMES } from './face/physiology.js';
import { fromGameStats } from './face/envInput.js';
import faceUrl from './assets/face/face.glb';
import landmarks from './assets/face/face.landmarks.json' with { type: 'json' };
import credit from './assets/face/face.credit.json' with { type: 'json' };
import hud from './hud.json' with { type: 'json' };

const $ = (s) => document.querySelector(s);
const SEVERITY = [['hypoxia', '호흡곤란'], ['heat', '열 스트레스'], ['cold', '추위'], ['pressure', '압력 불편'], ['fatigue', '피로']];
const f1 = (v) => v.toFixed(1);

// 지금 선택된 지점의 기온. 범위의 가운데 값을 쓴다 (지점을 고르기 전에는 평소 상태)
let siteTempC = null;
const extra = {}; // 개발용으로 덮어쓰는 값 (window.crew.setEnv)
// 산소 방식을 결정한 뒤에는 실내 기본값에 결정한 선지들의 stats(weeks/weekN.json)를 더한 값이 계속 유지된다
const INDOOR = { tempC: 22, oxygenPct: 20.9, activityMET: 1.5 };
const OUTSIDE_O2 = 0; // 바깥 공기의 산소 % (hud.json oxygen 이 정해지면 그 값을 쓴다)
let decidedStats = null;
function currentEnv() {
  if (decidedStats) {
    const sum = key => INDOOR[key] + (decidedStats[key] ?? 0);
    return fromGameStats({ tempC: sum('tempC'), oxygenPct: hud.oxygen ?? sum('oxygenPct'), activityMET: sum('activityMET') }, extra);
  }
  // 산소 방식을 결정하기 전에는 바깥 공기를 그대로 마신다: 이 행성은 숨 쉴 산소가 없다 (가상의 대원으로 바깥 상태를 보여 준다)
  return fromGameStats({ tempC: siteTempC ?? undefined, oxygenPct: hud.oxygen ?? OUTSIDE_O2 }, extra);
}
const body = createBodyLoop({ getEnv: currentEnv });

const stage = $('#face-stage');
const panel = createFacePanel({
  container: stage, getBody: () => body.state, modelUrl: faceUrl, modelOptions: { landmarks, credit },
  style: 'surface',
});
$('#crew-credit').textContent = `얼굴 모델 "${credit.title}" · ${credit.author.replace(/ \(.*\)$/, '')} · CC BY 4.0`;

// ── 팝업: 같은 얼굴 화면(표면 보기)을 팝업 안으로 옮겼다가 닫으면 제자리로 ──
const modal = $('#crew-modal'), openBtn = $('#crew-open'), slotSmall = $('#crew-slot'), slotBig = $('#crew-big');
function open() {
  slotBig.append(stage);
  modal.hidden = false; $('#crew-close').focus();
  renderDetails();
}
function close() {
  if (modal.hidden) return;
  slotSmall.append(stage);
  modal.hidden = true; openBtn.focus();
}
openBtn.addEventListener('click', open);
$('#crew-close').addEventListener('click', close);
modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
addEventListener('keydown', (e) => {
  if (modal.hidden) return;
  if (e.key === 'Escape') { e.stopPropagation(); close(); }
  else if (e.key === 'Tab') { // 팝업 밖으로 포커스가 나가지 않게
    const items = [...modal.querySelectorAll('button')];
    if (!items.length) return;
    e.preventDefault(); $('#crew-close').focus();
  }
}, true);

// ── 숫자 표시 (0.2초마다) ──
function worst(s) {
  return SEVERITY.map(([k, n]) => [n, s.level[k], s.sev[k]]).sort((a, b) => b[1] - a[1] || b[2] - a[2])[0];
}
function renderDetails() {
  const s = body.state; if (!s) return;
  const [name, level] = worst(s);
  const text = level ? `${name} · ${LEVEL_NAMES[level]}` : '정상';
  $('#crew-state').textContent = text;
  for (const el of [$('#crew-status')]) { el.textContent = text; el.dataset.lv = level; }
  $('#c-spo2').textContent = `${s.spo2Pct.toFixed(0)}%`;
  $('#c-core').textContent = `${s.coreC.toFixed(1)}°`;
  $('#c-rr').textContent = `${s.breathsPerMin.toFixed(0)}/분`;
  if (modal.hidden) return;
  const e = s.eff;
  $('#crew-rows').innerHTML = [
    ['심박 (추정)', `${s.heartBpm.toFixed(0)} bpm`],
    ['느끼는 온도', `${f1(e.tempC)}°C`],
    ['습구온도', `${f1(s.wetBulbC)}°C`],
    ['숨 쉬는 공기', `O₂ ${f1(e.o2Pct)}% · ${f1(e.pressureKPa)} kPa`],
  ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
  $('#crew-bars').innerHTML = SEVERITY.map(([k, n]) =>
    `<li><span>${n}</span><span class="bar" data-lv="${s.level[k]}"><i style="width:${(s.sev[k] * 100).toFixed(0)}%"></i></span><em data-lv="${s.level[k]}">${LEVEL_NAMES[s.level[k]]}</em></li>`).join('');
}
setInterval(renderDetails, 200);

// main.js 가 지점을 바꿀 때 부른다 (null = 지점을 아직 안 고른 상태)
export function setCrewSite(id) {
  const range = id ? hud.sites[id]?.temperature : null;
  siteTempC = range ? (range[0] + range[1]) / 2 : null;
}
// main.js 가 결정할 때마다 부른다: 지금까지 결정한 선지 stats 의 합 (null = 산소 방식을 아직 결정하지 않아 바깥 공기)
export function setCrewStats(stats) { decidedStats = stats; }
// 기온을 직접 넣을 때 (null = 평소 상태)
export function setCrewTemperature(tempC) { siteTempC = Number.isFinite(tempC) ? tempC : null; }
// 개발용: 콘솔에서 window.crew.setEnv({ o2Pct: 10 }) 처럼 환경을 직접 넣어 볼 수 있다
window.crew = { body, panel, setEnv(next) { Object.assign(extra, next); } };
