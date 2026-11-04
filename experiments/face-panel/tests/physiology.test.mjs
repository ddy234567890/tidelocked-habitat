import { normalizeEnv } from '../src/engine/face/envInput.js';
import { applyProtection } from '../src/engine/face/protection.js';
import { Physiology, inspiredO2KPa, severinghausSpO2, wetBulbStullC, LEVEL_NAMES } from '../src/engine/face/physiology.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const run = (raw, sec = 60) => { const p = new Physiology(); const env = normalizeEnv(raw); const eff = applyProtection(env); let s; for (let i = 0; i < sec * 10; i++) s = p.step(env, eff, 0.1); return s; };

// 관계식 확인
ok(Math.abs(inspiredO2KPa(20.9, 101.3) - 19.86) < 0.05, 'PiO2 해수면 ≈ 19.9 kPa (150 mmHg)');
ok(Math.abs(inspiredO2KPa(20.9, 33.7) * 7.50062 - 43) < 1.5, 'PiO2 에베레스트 정상(33.7 kPa) ≈ 43 mmHg');
ok(Math.abs(severinghausSpO2(60 / 7.50062) - 91) < 1.5, 'Severinghaus: PO2 60 mmHg ≈ 91%');
ok(Math.abs(severinghausSpO2(27 / 7.50062) - 50) < 3, 'Severinghaus: PO2 27 mmHg ≈ 50% (P50)');
ok(Math.abs(wetBulbStullC(20, 50) - 13.7) < 0.3, 'Stull: 20°C 50% ≈ 13.7°C');

// 실측 비교 (대략): 에베레스트 정상 동맥혈 산소포화도 약 54% (Grocott 등, 2009)
{ const e = run({ o2Pct: 20.9, pressureKPa: 33.7 }); console.log('에베레스트', e.spo2Pct.toFixed(1), 'PaCO2', e.paco2KPa.toFixed(2)); ok(e.spo2Pct > 40 && e.spo2Pct < 65, '에베레스트 정상 SpO2 40~65% 범위'); }
// 상태
const normal = run({});
console.log('정상', normal.spo2Pct.toFixed(1), normal.coreC.toFixed(2), normal.sev);
ok(normal.spo2Pct > 95 && normal.level.hypoxia === 0 && normal.level.heat === 0, '정상: SpO2>95, 단계 정상');

const lowO2 = run({ o2Pct: 10 });
console.log('산소 10%', lowO2.spo2Pct.toFixed(1), LEVEL_NAMES[lowO2.level.hypoxia]);
ok(lowO2.level.hypoxia >= 1, '산소 10% 해수면 → 호흡곤란');

// 같은 21%라도 기압이 낮으면 분압이 떨어져요
const lowP = run({ o2Pct: 20.9, pressureKPa: 40 });
console.log('21% / 40 kPa', lowP.spo2Pct.toFixed(1), LEVEL_NAMES[lowP.level.hypoxia]);
ok(lowP.level.hypoxia >= 1, '산소 농도는 정상이어도 기압 40 kPa면 호흡곤란 (분압 기준)');

// 산소 100%면 낮은 기압(30 kPa)에서도 괜찮아요 (우주복 원리)
const pureLow = run({ o2Pct: 100, pressureKPa: 30 });
ok(pureLow.level.hypoxia === 0, '산소 100% / 30 kPa → 정상');

const suit = run({ o2Pct: 2, pressureKPa: 1, tempC: -60, suit: { worn: true } });
ok(suit.level.hypoxia === 0 && suit.level.cold === 0, '우주복 정상 작동이면 거의 진공·−60°C에서도 정상');
const suitLeak = run({ o2Pct: 2, pressureKPa: 1, suit: { worn: true, pressureHold: 0.2 } }, 30);
ok(suitLeak.level.hypoxia === 2, '우주복 압력 유지 20% → 심한 호흡곤란');

const hot = run({ tempC: 45, humidityPct: 60, activityMET: 3 }, 120);
console.log('고온', hot.coreC.toFixed(2), hot.wetBulbC.toFixed(1), hot.sev.heat.toFixed(2), hot.sev.sweat.toFixed(2));
ok(hot.level.heat >= 1 && hot.sev.sweat > 0.8, '45°C 60% 활동 → 열 스트레스 + 땀');

const habitat = run({ o2Pct: 2, pressureKPa: 1, tempC: 60, location: 'habitat' });
ok(habitat.level.hypoxia === 0 && habitat.level.heat === 0, '실내(거주지)는 바깥 대신 실내 공기');

// 경계값 근처 흔들림: 심각도가 문턱 근처에서 출렁여도 단계가 자주 바뀌지 않아야 해요
{
  const p = new Physiology(); const env = normalizeEnv({});
  let changes = 0, prev = null;
  for (let i = 0; i < 600; i++) {
    const o2 = 14.2 + Math.sin(i * 0.9) * 0.6;     // 0.1초마다 흔들리는 입력
    const s = p.step(env, applyProtection(normalizeEnv({ o2Pct: o2 })), 0.1);
    if (prev !== null && s.level.hypoxia !== prev) changes++; prev = s.level.hypoxia;
  }
  console.log('흔들리는 입력에서 단계 변경 횟수', changes);
  ok(changes <= 2, '경계값 근처 반복 전환 없음');
}

// 회복: 산소 10% 후 정상으로 돌리면 서서히 회복
{
  const p = new Physiology(); const a = normalizeEnv({ o2Pct: 10 }), b = normalizeEnv({});
  for (let i = 0; i < 300; i++) p.step(a, applyProtection(a), 0.1);
  const peak = p.state.sev.hypoxia; const trace = [];
  for (let i = 0; i < 300; i++) { p.step(b, applyProtection(b), 0.1); if (i % 30 === 0) trace.push(p.state.sev.hypoxia.toFixed(2)); }
  console.log('회복', peak.toFixed(2), trace.join(' '));
  ok(p.state.sev.hypoxia < 0.05 && trace.every((v, i, a) => i === 0 || +v <= +a[i - 1] + 1e-9), '회복이 끊김 없이 줄어듦');
}

// 압력 급변 → 귀 불편 → 시간이 지나면 풀림
{
  const p = new Physiology(); const a = normalizeEnv({}), b = normalizeEnv({ pressureKPa: 80 });
  for (let i = 0; i < 50; i++) p.step(a, applyProtection(a), 0.1);
  let peak = 0; for (let i = 0; i < 200; i++) { p.step(b, applyProtection(b), 0.1); peak = Math.max(peak, p.state.sev.pressure); }
  console.log('압력 급변', peak.toFixed(2), '→', p.state.sev.pressure.toFixed(2));
  ok(peak > 0.5 && p.state.sev.pressure < 0.1, '기압 급변 시 불편했다가 맞춰지면 풀림');
}
process.exit(fail ? 1 : 0);
