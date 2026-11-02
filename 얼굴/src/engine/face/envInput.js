// 환경 입력 형식 + 입력원(슬라이더 / 게임 스탯) 연결부
// 모든 값은 단위를 이름에 붙여요. 게임 쪽은 getEnv() 하나만 바꿔 끼우면 돼요.

/**
 * @typedef {Object} SuitInput
 * @property {boolean} worn          우주복 착용 여부
 * @property {number}  o2Supply      산소 공급 상태 0~1 (1 = 정상)
 * @property {number}  cooling       냉각 상태 0~1 (1 = 정상)
 * @property {number}  pressureHold  압력 유지 상태 0~1 (1 = 완전 밀폐)
 * @property {number}  setpointKPa   우주복 내부 목표 압력 kPa
 *
 * @typedef {Object} HabitatInput    실내(거주지) 공기 설정
 * @property {number} o2Pct @property {number} pressureKPa @property {number} tempC @property {number} humidityPct
 *
 * @typedef {Object} EnvInput
 * @property {number} o2Pct          산소 농도, 부피 % (지구 대기 약 20.9)
 * @property {number} pressureKPa    절대기압, kPa (지구 해수면 101.3)
 * @property {number} tempC          기온, °C
 * @property {number} humidityPct    상대습도, %
 * @property {number} activityMET    활동량, MET (1 = 가만히 쉬는 상태)
 * @property {number} exposureMin    현재 환경에 노출된 시간, 분
 * @property {'outdoor'|'habitat'} location  실외 / 실내(거주지)
 * @property {HabitatInput} habitat
 * @property {SuitInput} suit
 */

/** 기본값. 지구 해수면 실내와 비슷한 상태 */
export const DEFAULT_ENV = Object.freeze({
  o2Pct: 20.9, pressureKPa: 101.3, tempC: 22, humidityPct: 45,
  activityMET: 1.5, exposureMin: 0, location: 'outdoor',
  habitat: { o2Pct: 20.9, pressureKPa: 101.3, tempC: 22, humidityPct: 45 },
  // 29.6 kPa(4.3 psi) 순수 산소는 미국 EMU 우주복 운용 압력을 참고한 기본값이에요.
  suit: { worn: false, o2Supply: 1, cooling: 1, pressureHold: 1, setpointKPa: 29.6 },
});

/** 입력 범위 (슬라이더와 검증에 같이 써요) */
export const ENV_RANGES = {
  o2Pct:       { min: 0,   max: 100, step: 0.5, unit: '%' },
  pressureKPa: { min: 0,   max: 150, step: 0.5, unit: 'kPa' },
  tempC:       { min: -60, max: 80,  step: 0.5, unit: '°C' },
  humidityPct: { min: 0,   max: 100, step: 1,   unit: '%' },
  activityMET: { min: 1,   max: 10,  step: 0.5, unit: 'MET' },
  exposureMin: { min: 0,   max: 480, step: 5,   unit: '분' },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 들어온 값을 기본값으로 채우고 범위 안으로 정리해요. 잘못된 값이 와도 계산이 멈추지 않게 */
export function normalizeEnv(raw = {}) {
  const d = DEFAULT_ENV, r = ENV_RANGES;
  const pick = (k) => clamp(num(raw[k], d[k]), r[k].min, r[k].max);
  const h = raw.habitat || {}, s = raw.suit || {};
  return {
    o2Pct: pick('o2Pct'), pressureKPa: pick('pressureKPa'), tempC: pick('tempC'),
    humidityPct: pick('humidityPct'), activityMET: pick('activityMET'), exposureMin: pick('exposureMin'),
    location: raw.location === 'habitat' ? 'habitat' : 'outdoor',
    habitat: {
      o2Pct: clamp(num(h.o2Pct, d.habitat.o2Pct), 0, 100),
      pressureKPa: clamp(num(h.pressureKPa, d.habitat.pressureKPa), 0, 150),
      tempC: clamp(num(h.tempC, d.habitat.tempC), -60, 80),
      humidityPct: clamp(num(h.humidityPct, d.habitat.humidityPct), 0, 100),
    },
    suit: {
      worn: !!s.worn,
      o2Supply: clamp(num(s.o2Supply, 1), 0, 1),
      cooling: clamp(num(s.cooling, 1), 0, 1),
      pressureHold: clamp(num(s.pressureHold, 1), 0, 1),
      setpointKPa: clamp(num(s.setpointKPa, d.suit.setpointKPa), 0, 150),
    },
  };
}

/**
 * 게임 스탯 → EnvInput 연결 예시.
 * 지금 선지 JSON의 stats(온도, 산소 %)만 있고 기압·습도는 아직 없어서, 없는 값은 extra나 기본값으로 채워요.
 * 게임 스탯 이름이 정해지면 이 함수만 고치면 돼요.
 */
export function fromGameStats(stats = {}, extra = {}) {
  return normalizeEnv({
    ...extra,
    o2Pct: stats.oxygenPct ?? stats.oxygen ?? extra.o2Pct,
    tempC: stats.tempC ?? stats.temperature ?? extra.tempC,
    pressureKPa: stats.pressureKPa ?? extra.pressureKPa,
    humidityPct: stats.humidityPct ?? extra.humidityPct,
    activityMET: stats.activityMET ?? extra.activityMET,
    exposureMin: stats.exposureMin ?? extra.exposureMin,
  });
}
