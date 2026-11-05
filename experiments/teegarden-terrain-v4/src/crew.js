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
function currentEnv() {
  return fromGameStats({ tempC: siteTempC ?? undefined, oxygenPct: hud.oxygen ?? undefined }, extra);
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
// 기온을 직접 넣을 때 (null = 평소 상태)
export function setCrewTemperature(tempC) { siteTempC = Number.isFinite(tempC) ? tempC : null; }
// 개발용: 콘솔에서 window.crew.setEnv({ o2Pct: 10 }) 처럼 환경을 직접 넣어 볼 수 있다
window.crew = { body, panel, setEnv(next) { Object.assign(extra, next); } };
