// 3단계: 신체 상태 계산 (게임용 근사 모델 · 의학적으로 검증된 시뮬레이션이 아니에요)
// 화면 갱신과 따로, 고정 간격(기본 0.1초)으로 step()을 불러요.
//
// [SCI]  잘 알려진 생리학 관계식·기준값 (출처를 적어 둠). 단, 게임에서는 단순화해서 써요.
// [GAME] 게임 연출을 위한 조정값. 실제 수치가 아니에요.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const KPA_TO_MMHG = 7.50062;

/** 과학 근거가 있는 상수 [SCI] */
export const SCI = {
  waterVaporKPa: 6.3,      // 체온 37°C에서 폐 속 수증기압 47 mmHg ≈ 6.3 kPa (흡입 산소 분압 계산의 표준값)
  respQuotient: 0.8,       // 호흡률 RQ, 폐포 산소식에 쓰는 일반값
  normalPaCO2KPa: 5.3,     // 정상 동맥 이산화탄소 분압 약 40 mmHg
  aaGradientKPa: 1.0,      // 건강한 사람의 폐포-동맥 산소 차이, 대략 1 kPa 안팎
  armstrongKPa: 6.3,       // 암스트롱 한계: 이보다 낮은 기압에선 체온에서 체액이 끓어요
  hypoxemiaSpO2: 90,       // 산소포화도 90% 미만을 흔히 저산소혈증 기준으로 써요
  wetBulbLimitC: 35,       // 습구온도 35°C: 사람이 오래 버틸 수 있는 이론상 한계 (Sherwood & Huber, 2010). 실험 연구는 더 낮을 수 있다고 봐요
};

/** 게임 조정값 [GAME] — 여기 숫자는 연출용이에요 */
export const GAME = {
  dt: 0.1,                 // 계산 간격, 초
  pace: 4,                 // 몸 상태 변화를 몇 배 빠르게 보여 줄지. 선지를 고르면 얼굴이 바로 반응하도록 시간을 압축해요 (1 = 아래 초 값 그대로)
  spo2TauDown: 6, spo2TauUp: 4,     // 산소포화도가 따라가는 속도, 초 (실제보다 훨씬 빠르게 압축)
  coreTau: 10,             // 체온이 따라가는 속도, 초 (실제는 수십 분, 게임용 압축)
  earTau: 3,               // 귀 안쪽 압력이 바깥에 맞춰지는 속도, 초
  hypoxicDriveStartKPa: 8, // 동맥 산소 분압이 이 아래로 떨어지면 숨이 가빠지기 시작 (약 60 mmHg 부근을 참고한 근사)
  activityO2DropKPa: 0.35, // 활동량 1 MET당 산소 분압 감소 (산소가 부족할 때만) — 근사
  levelDwellSec: 0.4,      // 상태 단계가 바뀐 뒤 최소 유지 시간 (깜빡거림 방지)
  levels: { mildOn: 0.25, mildOff: 0.15, severeOn: 0.6, severeOff: 0.48 }, // 단계 문턱 (켜질 때 > 꺼질 때)
};

/** 흡입 산소 분압 PiO2 = FiO2 × (기압 − 수증기압) [SCI] */
export function inspiredO2KPa(o2Pct, pressureKPa) {
  return Math.max(0, (o2Pct / 100) * (pressureKPa - SCI.waterVaporKPa));
}

/** Severinghaus(1979) 식: 산소 분압 → 산소포화도 % [SCI] */
export function severinghausSpO2(po2KPa) {
  const p = po2KPa * KPA_TO_MMHG;
  if (p <= 0) return 0;
  return 100 / (23400 / (p * p * p + 150 * p) + 1);
}

/** Stull(2011) 식: 기온·상대습도 → 습구온도 °C [SCI] (유효 범위 대략 −20~50°C, 습도 5~99%) */
export function wetBulbStullC(tempC, rhPct) {
  const T = clamp(tempC, -20, 50), RH = clamp(rhPct, 5, 99);
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.676331)
    + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
}

/** 단계(정상/경미/심함)를 문턱 두 개 + 최소 유지 시간으로 정해요. 경계값 근처에서 왔다 갔다 하지 않게 */
class LevelGate {
  constructor() { this.level = 0; this.since = 0; }
  update(v, t) {
    const L = GAME.levels; let want = this.level;
    if (this.level === 0 && v >= L.mildOn) want = v >= L.severeOn ? 2 : 1;
    else if (this.level === 1) { if (v >= L.severeOn) want = 2; else if (v <= L.mildOff) want = 0; }
    else if (this.level === 2 && v <= L.severeOff) want = v <= L.mildOff ? 0 : 1;
    if (want !== this.level && t - this.since >= GAME.levelDwellSec) { this.level = want; this.since = t; }
    return this.level;
  }
}
export const LEVEL_NAMES = ['정상', '경미', '심함'];

const follow = (cur, target, dt, tauUp, tauDown) => {
  const tau = target > cur ? tauUp : (tauDown ?? tauUp);
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
};

export class Physiology {
  constructor() { this.reset(); }

  reset() {
    this.t = 0;
    this.spo2 = 98; this.core = 37.0; this.earKPa = null; this.paco2 = SCI.normalPaCO2KPa;
    this.sev = { hypoxia: 0, heat: 0, sweat: 0, cold: 0, shiver: 0, pressure: 0, fatigue: 0 };
    this.gates = { hypoxia: new LevelGate(), heat: new LevelGate(), cold: new LevelGate(), pressure: new LevelGate(), fatigue: new LevelGate() };
    this.state = null;
  }

  /**
   * @param {object} env  normalizeEnv 결과 (활동량·노출 시간 사용)
   * @param {object} eff  applyProtection 결과 (실제로 숨 쉬는 공기·느끼는 온도)
   * @param {number} dt   초
   */
  step(env, eff, dt = GAME.dt) {
    this.t += dt;
    dt *= GAME.pace;  // 아래 따라가기 계산은 압축된 시간으로, 단계 유지 시간(this.t)은 실제 시간으로
    const met = env.activityMET;
    if (this.earKPa === null) this.earKPa = eff.pressureKPa;

    // ── 산소 ──
    const piO2 = inspiredO2KPa(eff.o2Pct, eff.pressureKPa);
    let paco2 = SCI.normalPaCO2KPa, pao2 = 0, alv = 0, drive = 0;
    for (let i = 0; i < 8; i++) {                          // 숨이 가빠지면 CO2가 줄고 폐포 산소가 조금 올라가요 (방향은 SCI, 크기는 근사)
      alv = Math.max(0, piO2 - paco2 / SCI.respQuotient);  // 폐포 산소식 [SCI]
      const exerciseDrop = GAME.activityO2DropKPa * Math.max(0, met - 1) * clamp((12 - alv) / 6, 0, 1); // [GAME]
      pao2 = Math.max(0, alv - SCI.aaGradientKPa * clamp(alv / 13, 0.3, 1) - exerciseDrop);
      drive = clamp((GAME.hypoxicDriveStartKPa - pao2) / 5, 0, 1);  // [GAME 크기]
      // 에베레스트 정상 실측(동맥 CO2 약 1.7 kPa)까지 내려갈 수 있게 맞춘 근사 [GAME]
      paco2 = 0.5 * paco2 + 0.5 * (SCI.normalPaCO2KPa - 3.6 * drive);
    }
    const armstrong = eff.pressureKPa < SCI.armstrongKPa;
    const spo2Target = armstrong ? 0 : severinghausSpO2(pao2);
    this.spo2 = follow(this.spo2, spo2Target, dt, GAME.spo2TauUp, GAME.spo2TauDown);

    // ── 열·추위 ──
    const tw = wetBulbStullC(eff.tempC, eff.humidityPct);
    let coreTarget = 37.0
      + 0.12 * Math.max(0, tw - 25)                                   // [GAME] 습구온도가 높을수록 체온 상승
      + 0.2 * Math.max(0, met - 1) * ss(10, 25, tw)                   // [GAME] 더운 곳에서 움직이면 더 오름
      - 0.03 * Math.max(0, 15 - eff.tempC) * (1 - 0.15 * Math.min(4, met - 1)); // [GAME] 추우면 내려감, 움직이면 덜 내려감
    coreTarget = clamp(coreTarget, 33, 41.5);
    this.core = follow(this.core, coreTarget, dt, GAME.coreTau);

    // ── 압력 변화 (귀·코 안쪽과 바깥의 압력 차이) ──
    this.earKPa = follow(this.earKPa, eff.pressureKPa, dt, GAME.earTau);
    const earDiff = eff.pressureKPa - this.earKPa;

    // ── 심각도 목표 (0~1) — 매핑 구간은 [GAME] ──
    const tgt = {
      hypoxia: ss(93, 72, this.spo2),
      heat: ss(37.4, 39.2, this.core),
      sweat: Math.max(ss(22, 30, tw), ss(37.2, 38.2, this.core)),
      cold: clamp(Math.max(ss(14, -10, eff.tempC) - 0.08 * (met - 1), ss(36.5, 35, this.core)), 0, 1),
      pressure: ss(1.0, 6.0, Math.abs(earDiff)),  // 몇 kPa 차이부터 귀가 먹먹·아픔 (근사)
    };
    tgt.fatigue = clamp(0.1 * (met - 1) + 0.35 * this.sev.hypoxia + 0.3 * this.sev.heat + 0.25 * this.sev.cold
      + 0.35 * ss(30, 300, env.exposureMin), 0, 1);

    // 켜질 때와 풀릴 때 속도를 다르게 해서 회복이 부드럽게 이어지게 [GAME]
    const S = this.sev;
    S.hypoxia = follow(S.hypoxia, tgt.hypoxia, dt, 1.5, 4);
    S.heat = follow(S.heat, tgt.heat, dt, 2, 5);
    S.sweat = follow(S.sweat, tgt.sweat, dt, 5, 12);
    S.cold = follow(S.cold, tgt.cold, dt, 3, 6);
    S.shiver = ss(0.35, 0.75, S.cold);
    S.pressure = follow(S.pressure, tgt.pressure, dt, 0.4, 2);
    S.fatigue = follow(S.fatigue, tgt.fatigue, dt, 15, 30);

    const level = {};
    for (const k of Object.keys(this.gates)) level[k] = this.gates[k].update(S[k], this.t);

    const breathsPerMin = clamp(14 + 14 * drive + 10 * S.heat + 2.5 * (met - 1) - 2 * S.fatigue, 8, 45);  // [GAME]
    const heartBpm = clamp(68 + 35 * S.hypoxia + 40 * S.heat + 10 * (met - 1) + 8 * S.cold, 50, 190);  // [GAME]

    this.state = {
      t: this.t, eff,
      inspiredO2KPa: piO2, alveolarO2KPa: alv, arterialO2KPa: pao2, paco2KPa: paco2,
      spo2TargetPct: spo2Target, spo2Pct: this.spo2,
      wetBulbC: tw, coreC: this.core, earDiffKPa: earDiff,
      breathsPerMin, heartBpm, hypoxicDrive: drive,
      sev: { ...S }, level,
      flags: { armstrong, wetBulbOverLimit: tw >= SCI.wetBulbLimitC, hypoxemia: this.spo2 < SCI.hypoxemiaSpO2 },
    };
    return this.state;
  }
}
