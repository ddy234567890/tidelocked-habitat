// 얼굴 반응 테스트 페이지
// 연결부: 지금은 슬라이더가 환경 입력이에요. 게임에서는 FaceTest.setSource(() => fromGameStats(...))로 바꿔 끼우면 돼요.
import { DEFAULT_ENV, ENV_RANGES, fromGameStats } from './src/engine/face/envInput.js';
import { createBodyLoop } from './src/engine/face/bodyLoop.js';
import { createFacePanel } from './src/engine/face/facePanel.js';
import { LEVEL_NAMES, SCI } from './src/engine/face/physiology.js';
import { CANONICAL } from './src/engine/face/blendshapeMap.js';
import { createTempHead } from './src/engine/face/tempHead.js';

const $ = (s) => document.querySelector(s);
const env = structuredClone(DEFAULT_ENV);
let source = () => env;                                    // ← 게임 스탯으로 교체하는 자리

// ── 슬라이더 ──
const sliders = {};
function addSlider(box, key, label, obj, { min, max, step, unit, fmt = (v) => v.toFixed(step < 1 ? 1 : 0), big = false, scale = 1 }) {
  const id = 's-' + key.replace(/\W/g, '');
  const row = document.createElement('div'); row.className = 'slider' + (big ? ' big' : '');
  row.innerHTML = `<label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><output for="${id}"></output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  const get = () => obj()[key] * scale, set = (v) => { obj()[key] = v / scale; };
  const sync = () => { input.value = get(); out.textContent = `${fmt(get())} ${unit}`; };
  input.addEventListener('input', () => { set(+input.value); sync(); markPreset(null); });
  sliders[key] = sync; sync(); box.appendChild(row);
}
const R = ENV_RANGES;
addSlider($('#main-sliders'), 'o2Pct', '산소 농도', () => env, { ...R.o2Pct, big: true });
addSlider($('#main-sliders'), 'pressureKPa', '절대기압', () => env, { ...R.pressureKPa, big: true });
addSlider($('#main-sliders'), 'tempC', '온도', () => env, { ...R.tempC, big: true });
addSlider($('#more-sliders'), 'humidityPct', '습도', () => env, R.humidityPct);
addSlider($('#more-sliders'), 'activityMET', '활동량', () => env, R.activityMET);
addSlider($('#more-sliders'), 'exposureMin', '노출 시간', () => env, R.exposureMin);
const pct = { min: 0, max: 100, step: 5, unit: '%', scale: 100, fmt: (v) => v.toFixed(0) };
addSlider($('#suit-sliders'), 'o2Supply', '산소 공급', () => env.suit, pct);
addSlider($('#suit-sliders'), 'cooling', '냉각', () => env.suit, pct);
addSlider($('#suit-sliders'), 'pressureHold', '압력 유지', () => env.suit, pct);
const syncAll = () => { Object.values(sliders).forEach(f => f()); $('#suit-worn').checked = env.suit.worn;
  document.querySelectorAll('[data-loc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.loc === env.location))); };
$('#suit-worn').addEventListener('change', (e) => { env.suit.worn = e.target.checked; markPreset(null); });
document.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => { env.location = b.dataset.loc; syncAll(); markPreset(null); }));

// ── 상황 바로 넣기 ──
const PRESETS = {
  normal: {},
  lowO2: { o2Pct: 10 },
  lowP: { pressureKPa: 40 },
  heat: { tempC: 45, humidityPct: 60, activityMET: 3, exposureMin: 30 },
  suit: { o2Pct: 1, pressureKPa: 0.5, tempC: -60, suit: { worn: true } },
  cold: { tempC: -20, humidityPct: 30, activityMET: 1.2 },
  pressure: { pressureKPa: 80 },
  tired: { activityMET: 6, exposureMin: 300, tempC: 28 },
};
function markPreset(p) { document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === p))); }
function applyPreset(p) {
  const d = structuredClone(DEFAULT_ENV), x = PRESETS[p];
  if (p === 'pressure') { Object.assign(env, d, { pressureKPa: 101.3 }); syncAll(); setTimeout(() => { env.pressureKPa = 80; syncAll(); }, 50); markPreset(p); return; }
  Object.assign(env, d, x, { suit: { ...d.suit, ...(x.suit || {}) }, habitat: { ...d.habitat } });
  syncAll(); markPreset(p);
}
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.p)));
markPreset('normal');

// ── 신체 상태 루프 (화면과 따로) ──
const body = createBodyLoop({ getEnv: () => source() });

// ── 얼굴 패널 ──
const panel = createFacePanel({
  container: $('#face-stage'), getBody: () => body.state,
  modelUrl: 'models/face/face.glb',   // 실제 모델 (아티팩트에서는 .glb를 못 올려서 .glb.b64.txt로 감싸 씀)
  style: 'hologram',
  onModel: renderModel,
});

// ── 개발용 표시 (화면 갱신과 별개로 5번/초) ──
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const T = { sci: '<span class="tag sci">SCI</span>', mix: '<span class="tag mix">근사</span>', game: '<span class="tag game">GAME</span>' };
const SEV = [['hypoxia', '호흡곤란', 'd'], ['heat', '열 스트레스', 'w'], ['cold', '추위', ''], ['pressure', '압력 불편', ''], ['fatigue', '피로', '']];
function renderDev() {
  const s = body.state; if (!s) return;
  const e = s.eff;
  const rows = [
    ['숨 쉬는 공기', `${e.source} · O₂ ${f1(e.o2Pct)}% · ${f1(e.pressureKPa)} kPa`, ''],
    ['느끼는 온도·습도', `${f1(e.tempC)}°C · ${e.humidityPct.toFixed(0)}%`, T.game],
    ['흡입 산소 분압', `${f2(s.inspiredO2KPa)} kPa (${(s.inspiredO2KPa * 7.50062).toFixed(0)} mmHg)`, T.sci],
    ['폐포 산소 분압', `${f2(s.alveolarO2KPa)} kPa`, T.mix],
    ['동맥 산소 분압 (추정)', `${f2(s.arterialO2KPa)} kPa`, T.mix],
    ['동맥 CO₂ 분압 (추정)', `${f2(s.paco2KPa)} kPa`, T.game],
    ['산소포화도 (추정)', `${f1(s.spo2Pct)}% → 목표 ${f1(s.spo2TargetPct)}%`, T.mix],
    ['습구온도', `${f1(s.wetBulbC)}°C`, T.sci],
    ['심부 체온 (추정)', `${f2(s.coreC)}°C`, T.game],
    ['귀 안팎 압력 차', `${f2(s.earDiffKPa)} kPa`, T.game],
    ['호흡 · 심박 (추정)', `${s.breathsPerMin.toFixed(0)}/분 · ${s.heartBpm.toFixed(0)} bpm`, T.game],
  ];
  $('#dev-table').innerHTML = rows.map(r => `<tr><td>${r[0]}${r[2]}</td><td class="v">${r[1]}</td></tr>`).join('');
  $('#sev-bars').innerHTML = SEV.map(([k, n, c]) => `<span>${n}</span><span class="bar ${c}"><i style="width:${(s.sev[k] * 100).toFixed(0)}%"></i></span><span class="lv" data-lv="${s.level[k]}">${LEVEL_NAMES[s.level[k]]}</span>`).join('');
  const flags = [];
  if (s.flags.armstrong) flags.push(`기압 ${SCI.armstrongKPa} kPa 미만: 우주복 없이는 생존 불가 (암스트롱 한계)`);
  if (s.flags.hypoxemia) flags.push(`산소포화도 ${SCI.hypoxemiaSpO2}% 미만 (저산소혈증 기준)`);
  if (s.flags.wetBulbOverLimit) flags.push(`습구온도 ${SCI.wetBulbLimitC}°C 이상: 땀으로 식히기 어려운 한계`);
  e.notes.forEach(n => flags.push(n));
  $('#flags').innerHTML = flags.map(f => `<span class="flag">${f}</span>`).join('');

  // 얼굴 패널의 게임용 표시
  $('#c-spo2').textContent = `${s.spo2Pct.toFixed(0)}%`;
  $('#c-core').textContent = `${s.coreC.toFixed(1)}°`;
  $('#c-rr').textContent = `${s.breathsPerMin.toFixed(0)}/분`;
  const worst = SEV.map(([k, n]) => [k, n, s.level[k], s.sev[k]]).sort((a, b) => b[2] - a[2] || b[3] - a[3])[0];
  const st = $('#status'); st.dataset.lv = worst[2]; st.textContent = worst[2] ? `${worst[1]} · ${LEVEL_NAMES[worst[2]]}` : '정상';

  const f = panel.face; if (!f) return;
  const map = panel.mapping;
  const wl = Object.entries(f.weights).filter(([, v]) => v > 0.02).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const fx = [['땀', f.fx.sweat, 'w'], ['피부 광택', f.fx.gloss, ''], ['홍조', f.fx.flush, 'w'], ['창백', f.fx.pallor, ''], ['입술 청색', f.fx.cyanosis, 'd']];
  $('#w-bars').innerHTML = wl.map(([k, v]) => `<span title="${map[k] || '매핑 없음'}">${k}${map[k] ? '' : ' ⚠'}</span><span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span class="n">${v.toFixed(2)}</span>`).join('')
    + fx.map(([n, v, c]) => `<span>${n} <span class="tag game">효과</span></span><span class="bar ${c}"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span class="n">${v.toFixed(2)}</span>`).join('');
}
setInterval(renderDev, 200);

// ── 모델 · 매핑 ──
function renderModel(info) {
  $('#model-name').textContent = info.name;
  const ok = CANONICAL.length - info.unmapped.length;
  const synth = info.synthesized ? ` (블렌드셰이프가 없는 스캔이라 얼굴 기준점${info.landmarksEstimated ? ' 추정값' : ''}으로 자동 생성)` : '';
  const c = info.credit;
  $('#model-sum').textContent = `블렌드셰이프 ${info.names.length}개${synth} · 자동 매핑 ${ok}/${CANONICAL.length}` + (info.unmapped.length ? ` · 못 찾은 것은 표에서 직접 골라 주세요` : '')
    + (c ? ` · 모델: "${c.title || info.name}" ${c.author || ''} · ${c.license || ''}` : '');
  setTimeout(renderPointCount, 0);
  const opts = ['<option value="">— 없음 —</option>', ...info.names.map(n => `<option>${n.replace(/</g, '&lt;')}</option>`)].join('');
  $('#map-body').innerHTML = CANONICAL.map(c => `<tr class="${info.map[c] ? '' : 'miss'}"><td>${c}</td><td><select data-c="${c}" aria-label="${c} 매핑">${opts}</select></td></tr>`).join('');
  document.querySelectorAll('#map-body select').forEach(sel => {
    sel.value = info.map[sel.dataset.c] || '';
    sel.addEventListener('change', () => { panel.setMapping({ [sel.dataset.c]: sel.value || null }); sel.closest('tr').className = sel.value ? '' : 'miss'; });
  });
}
const drop = $('#drop');
async function loadFile(file) {
  if (!file) return;
  $('#model-name').textContent = '불러오는 중…';
  try { await panel.loadArrayBuffer(await file.arrayBuffer(), file.name); }
  catch (err) { $('#model-name').textContent = '불러오지 못했어요'; $('#model-sum').textContent = `.glb(glTF 2.0) 파일인지 확인해 주세요. Draco 압축 파일은 아직 지원하지 않아요 (KTX2·meshopt 압축은 돼요). (${err.message || err})`; }
}
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
drop.addEventListener('dragleave', () => drop.classList.remove('on'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); loadFile(e.dataTransfer.files[0]); });
$('#use-temp').addEventListener('click', () => panel.useTemp());
document.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', async () => {
  $('#model-name').textContent = '불러오는 중…';
  try { await panel.loadUrl(b.dataset.model); } catch (err) { $('#model-name').textContent = '불러오지 못했어요'; $('#model-sum').textContent = String(err.message || err); }
}));
$('#export-temp').addEventListener('click', async () => {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const glb = await new GLTFExporter().parseAsync(createTempHead(), { binary: true });
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'temp-face.glb' }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('#copy-map').addEventListener('click', async () => {
  const txt = JSON.stringify(panel.mapping, null, 2);
  try { await navigator.clipboard.writeText(txt); $('#copy-map').textContent = '복사됨'; } catch { console.log(txt); $('#copy-map').textContent = '콘솔에 출력함'; }
  setTimeout(() => { $('#copy-map').textContent = '매핑 JSON 복사'; }, 1500);
});
// ── 점 구름 설정 ──
const pt = { size: panel.points.size };
function renderPointCount() { $('#pt-count').textContent = `점 ${panel.points.count.toLocaleString()}개`; }
addSlider($('#pt-sliders'), 'size', '점 크기', () => pt, { min: 0.8, max: 3, step: 0.1, unit: 'px', fmt: (v) => v.toFixed(1) });
$('#pt-sliders input').addEventListener('input', () => panel.setPoints({ size: pt.size }));
document.querySelectorAll('[data-density]').forEach(b => b.addEventListener('click', () => {
  panel.setPoints({ density: +b.dataset.density }); renderPointCount();
  document.querySelectorAll('[data-density]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));

document.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => {
  panel.setStyle(b.dataset.style);
  document.querySelectorAll('[data-style]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));

// ── 게임 연결부 ──
// 예) FaceTest.setSource(() => fromGameStats({ temperature: 66, oxygen: 18 }, { pressureKPa: 90 }))
//     FaceTest.useSliders()  // 다시 슬라이더로
window.FaceTest = {
  env, body, panel, fromGameStats,
  setSource(fn) { source = () => fn(); },
  useSliders() { source = () => env; },
};
