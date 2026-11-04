// 2단계: 보호장비와 실내 환경 반영
// "몸이 실제로 들이마시는 공기"와 "몸이 실제로 느끼는 온도·습도"를 계산해요.
// [GAME] 표시가 붙은 값은 게임용 조정값이에요 (실측 근거 아님).

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const PROTECTION_TUNING = {
  suitComfortC: 22,        // [GAME] 냉각이 정상일 때 우주복 안 온도
  suitInsulation: 0.85,    // [GAME] 우주복이 바깥 온도를 막아 주는 정도 0~1
  suitMetabolicHeatC: 4,   // [GAME] 냉각이 꺼졌을 때 활동량 1 MET당 안쪽 온도 상승
  suitRebreathO2Pct: 12,   // [GAME] 산소 공급이 끊긴 밀폐 우주복 안 산소 농도 (다시 들이마시는 공기)
  suitHumidHighPct: 85,    // [GAME] 냉각이 꺼졌을 때 안쪽 습도
  suitHumidLowPct: 40,     // [GAME] 냉각이 정상일 때 안쪽 습도
};

/**
 * @param {import('./envInput.js').EnvInput} env  normalizeEnv를 거친 입력
 * @returns {{o2Pct:number, pressureKPa:number, tempC:number, humidityPct:number,
 *            ambientKPa:number, source:string, notes:string[]}}
 */
export function applyProtection(env, T = PROTECTION_TUNING) {
  const notes = [];
  // 실내면 거주지 공기가 바깥 공기를 대신해요
  const base = env.location === 'habitat'
    ? { ...env.habitat, label: '실내' }
    : { o2Pct: env.o2Pct, pressureKPa: env.pressureKPa, tempC: env.tempC, humidityPct: env.humidityPct, label: '실외' };

  if (!env.suit.worn) {
    return { o2Pct: base.o2Pct, pressureKPa: base.pressureKPa, tempC: base.tempC, humidityPct: base.humidityPct,
      ambientKPa: base.pressureKPa, source: base.label, notes };
  }

  const s = env.suit;
  const seal = s.pressureHold;                       // 1 = 완전 밀폐
  // 압력: 밀폐된 만큼 목표 압력을 유지 (바깥이 더 높으면 바깥 압력)
  const inside = Math.max(base.pressureKPa, s.setpointKPa);
  const pressureKPa = lerp(base.pressureKPa, inside, seal);
  // 산소: 밀폐된 부분은 공급 상태에 따라 100% ↔ 재호흡 공기, 새는 만큼 바깥 공기가 섞여요 [GAME 혼합 방식]
  const sealedO2 = lerp(T.suitRebreathO2Pct, 100, s.o2Supply);
  const o2Pct = lerp(base.o2Pct, sealedO2, seal);
  // 온도: 단열 + 냉각. 냉각이 꺼지면 몸에서 나온 열이 갇혀요 [GAME]
  const insulated = lerp(base.tempC, T.suitComfortC, T.suitInsulation * seal);
  const trapped = insulated + T.suitMetabolicHeatC * Math.max(0, env.activityMET - 1) * (1 - s.cooling);
  const tempC = lerp(trapped, T.suitComfortC, s.cooling * seal);
  const humidityPct = clamp(lerp(base.humidityPct, lerp(T.suitHumidHighPct, T.suitHumidLowPct, s.cooling), seal), 0, 100);

  if (seal < 0.999) notes.push('우주복 압력이 새고 있어요');
  if (s.o2Supply < 0.999) notes.push('산소 공급이 줄었어요');
  if (s.cooling < 0.999) notes.push('냉각이 약해졌어요');
  return { o2Pct, pressureKPa, tempC, humidityPct, ambientKPa: base.pressureKPa, source: '우주복', notes };
}
