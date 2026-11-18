// 왼쪽 아래 대원 얼굴 + 누르면 가운데 팝업으로 세부 상태.
// 얼굴 엔진은 src/face (얼굴 반응 테스트 페이지에서 가져옴). 여기서는 화면 연결만 한다.
// 환경 값은 hud.json 에 정해진 것만 쓰고, 없는 값(산소·기압 등)은 얼굴 엔진 기본값(지구 해수면 공기)이다.
import { createBodyLoop } from './face/bodyLoop.js';
import { createFacePanel } from './face/facePanel.js';
import { LEVEL_NAMES } from './face/physiology.js';
import { STATUS_NAMES } from './peopleSim.js';
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
const OUTSIDE_O2 = hud.outsideOxygen ?? 14; // 바깥 공기의 산소 %: 1주차 행성 강의와 같은 약 14% (지구보다 조금 부족해 숨이 찬 정도, 2026-11-13 사용자 요청). hud.json oxygen 이 정해지면 그 값이 먼저다
// 산소 방식을 정하기 전 대원은 바깥에서 기지 공사를 하고 있다: 활동량 4 MET (짐을 들고 빠르게 걷는 정도).
// 산소 14% 에서 이만큼 움직이면 호흡곤란·피로가 '경미'로 떠서 힘들어 보인다 (2026-11-13 사용자: 좀 더 힘들어 보이게). 얼굴 엔진 기준은 그대로 둔다
const OUTSIDE_MET = 4;
let decidedStats = null;
function currentEnv() {
  if (decidedStats) {
    const sum = key => INDOOR[key] + (decidedStats[key] ?? 0);
    return fromGameStats({ tempC: sum('tempC'), oxygenPct: hud.oxygen ?? sum('oxygenPct'), activityMET: sum('activityMET') }, extra);
  }
  // 산소 방식을 결정하기 전에는 바깥 공기(산소 약 14%)를 그대로 마신다: 숨이 찬 상태로 보인다 (가상의 대원으로 바깥 상태를 보여 준다)
  return fromGameStats({ tempC: siteTempC ?? undefined, oxygenPct: hud.oxygen ?? OUTSIDE_O2, activityMET: OUTSIDE_MET }, extra);
}
const body = createBodyLoop({ getEnv: currentEnv });

// 얼굴의 주인: 지역 화면의 대원 10명 중 마우스를 올린(또는 가장 최근에 올렸던) 사람 (people.js 가 'crew-focus' 로 알린다).
// 그 사람의 몸 상태를 그대로 보여 준다. 아직 대원이 없으면(행성 화면) 바깥 공기를 마시는 가상의 대원
let person = null;
// 마우스가 대원 위에 있으면 얼굴이 밝게, 떼면 마지막 대원 얼굴이 흐리게 남는다. 아직 아무도 가리키지 않았으면 안내 문구
let hovering = false, everHovered = false, pinned = null;
const hint = document.createElement('span'); hint.className = 'crew-hint-idle'; hint.textContent = '▲ 가운데 화면에서 걸어다니는 대원에게 마우스를 올려 보세요. 누르면 그 대원으로 고정돼요';
addEventListener('crew-pin', e => { pinned = e.detail.person; everHovered = true; renderIdle(); renderDetails(); });
addEventListener('crew-hover', e => { hovering = e.detail.on; if (hovering) everHovered = true; renderIdle(); renderDetails(); });
function renderIdle() {
  const slot = $('#crew-slot'); if (!hint.isConnected) slot.append(hint);
  const live = hovering || (pinned && person === pinned);   // 마우스를 올렸거나, 고른 대원이면 밝게
  slot.classList.toggle('crew-idle', Boolean(person) && !live);
  slot.classList.toggle('crew-pinned', Boolean(pinned) && person === pinned);
  hint.hidden = !person || everHovered;
}
addEventListener('crew-focus', e => { person = e.detail.person; renderIdle(); renderDetails(); if (e.detail.at) signalSwitch(e.detail.at); });
// 마우스로 대원을 바꾸면: 얼굴 창이 지지직 다시 그려지고, 그 대원 머리 위 이름표에서 얼굴 창까지 가는 선이 잠깐 이어진다
const link = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
link.classList.add('crew-link'); link.setAttribute('aria-hidden', 'true'); link.innerHTML = '<line/><circle r="4"/>';
document.body.append(link);
let switchTimer = null;
function signalSwitch(at) {
  const slot = $('#crew-slot'), r = slot.getBoundingClientRect();
  slot.classList.remove('crew-switch'); void slot.offsetWidth; slot.classList.add('crew-switch');
  const line = link.querySelector('line'), dot = link.querySelector('circle');
  line.setAttribute('x1', at.x); line.setAttribute('y1', at.y - 34);
  line.setAttribute('x2', r.left + r.width / 2); line.setAttribute('y2', r.top + 8);
  dot.setAttribute('cx', at.x); dot.setAttribute('cy', at.y - 34);
  link.classList.remove('on'); void link.getBoundingClientRect(); link.classList.add('on');
  clearTimeout(switchTimer); switchTimer = setTimeout(() => { slot.classList.remove('crew-switch'); link.classList.remove('on'); }, 1100);
}
const current = () => person?.state ?? body.state;

// 대원 상태(괜찮음 · 힘들어함 · 쓰러짐)를 얼굴에도: 장면의 사람과 같은 상태로 보이게 표정을 더한다 (2026-11-18 사용자 요청)
//  쓰러짐: 눈이 거의 감기고, 턱이 풀려 입이 벌어지고, 고개가 숙여지고, 창백하고 기운이 없다
//  힘들어함: 미간을 찌푸리고 눈을 가늘게, 입을 조금 벌려 숨을 쉰다
const LOOK = {
  down: { weights: { eyeBlinkLeft: 0.82, eyeBlinkRight: 0.88, jawOpen: 0.32, mouthFrownLeft: 0.25, mouthFrownRight: 0.25, browInnerUp: 0.2 }, pitch: 0.32, fx: { pallor: 0.75, tired: 1 } },
  tired: { weights: { browDownLeft: 0.3, browDownRight: 0.3, eyeSquintLeft: 0.35, eyeSquintRight: 0.35, jawOpen: 0.15, browInnerUp: 0.2 }, pitch: 0.06, fx: { tired: 0.5 } },
};
const blend = { down: 0, tired: 0 }; let blendAt = null, blendWho = null;
function faceBias() {
  const now = performance.now() / 1000, dt = blendAt === null ? 0 : Math.min(0.1, now - blendAt); blendAt = now;
  if (person !== blendWho) { blendWho = person; for (const k in blend) blend[k] = person?.status === k ? 1 : 0; }   // 사람을 바꾸면 그 사람 상태로 바로
  for (const k in blend) blend[k] += ((person?.status === k ? 1 : 0) - blend[k]) * (1 - Math.exp(-dt / 0.6));      // 상태가 바뀌면 0.6초쯤에 걸쳐 천천히
  const out = { weights: { ...(person?.face?.weights ?? {}) }, pitch: 0, fx: {} };
  for (const k in blend) {
    const a = blend[k], look = LOOK[k]; if (a < 0.01) continue;
    for (const w in look.weights) out.weights[w] = (out.weights[w] ?? 0) * (1 - a) + look.weights[w] * a;
    out.pitch += look.pitch * a;
    for (const f in look.fx) out.fx[f] = Math.max(out.fx[f] ?? 0, look.fx[f] * a);
  }
  return out;
}

const stage = $('#face-stage');
const panel = createFacePanel({
  container: stage, getBody: current, getBias: faceBias, modelUrl: faceUrl, modelOptions: { landmarks, credit },
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
  const s = current(); if (!s) return;
  const [name, level] = worst(s);
  // 대원이 있으면 장면 정보창과 같은 말(괜찮음 · 힘들어함 · 쓰러짐 + 원인)을 쓴다
  const text = person ? STATUS_NAMES[person.status] + (person.status !== 'ok' && person.cause ? ` · ${person.cause}` : '')
    : level ? `${name} · ${LEVEL_NAMES[level]}` : '정상';
  const live = hovering || (pinned && person === pinned);
  $('#crew-state').textContent = person ? `${person.name}${pinned === person ? ' (고정)' : ''} · ${live ? text : '대기'}` : text;
  $('#crew-title').textContent = person ? `${person.name} 상태` : '대원 상태';
  for (const el of [$('#crew-status')]) { el.textContent = text; el.dataset.lv = person ? { ok: 0, tired: 1, down: 2 }[person.status] : level; }
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
