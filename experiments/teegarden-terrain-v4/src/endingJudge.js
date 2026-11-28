// 엔딩 판정 (2026-11-23). 팀 플레이테스트 페이지 「기지 5주 플레이테스트」(docs/playtest/five-week-playtest.html, PR #28)의
// judge · verify · stress 를 게임 데이터(gauges.json · 선지 id)에 맞춰 그대로 옮겼다. three.js·화면 없이 돌아서 tests/ending.test.js 가 검사한다.
//
//   E1 생존 실패      5주 준비 중 어느 게이지든 0 (게임의 '기지 운영 실패')
//   E2 수용 준비 미달  살아남았지만 입주 날 최저 게이지 ACCEPT(40) 미만
//   E3 시한부 정착     최저 40 이상, 입주 후 4주 운영 검증에서 무언가 0 이 됨
//   E4 취약한 정착     검증 통과, 그러나 최저 MARGIN(50) 미만 또는 고장 시험 최저 SHOCK(25) 미만
//   E5 안정적 이주     최저 50 이상, 검증 통과, 고장 시험 25 이상
// 기준값 (2026-11-23 사용자: 결말 4 가 81% 라 너무 많다 → 플레이테스트의 30·60·30 에서 40·50·25 로 바꿈).
//   돌발 사건 없이 모든 선택: 결말 2 약 16% · 3 약 9% · 4 약 56% · 5 약 19%. 입주 날 최저 게이지가 45~49 에 몰려 있어
//   MARGIN 을 45 근처로 내리면 결말 5 가 갑자기 절반을 넘는다
//
// 입주 후 4주 운영 검증: 이주민이 들어오면 매주 DEMAND 만큼 더 쓴다 (나눠 입주면 처음 2주는 절반, 대신 식량·전력 1씩 더).
//   물 재생 설비 +2, 물 회수형 산소 설비 +1 (나눠 입주 2주는 절반), 모두 함께 나눠 쓰기면 가장 낮은 것 +3. 매주 선지 효과·수확은 그대로 이어진다.
// 고장 시험 2종: 주 전원 정지 · 주 정수 설비 고장을 가정하고 가장 낮아지는 값을 본다 (실제 사건이 아니라 판정용 가상 시험).
import { gaugeState, GAUGE_KEYS } from './gauges.js';
import { ALL_STEPS } from './choices.js';
import { PLANET } from './planets/index.js';

const data = PLANET.judge; // 행성별 수요·검증·고장 시험 (planets/<행성>/judge.json)
export const DEMAND = data.demand;
export const ACCEPT = 40, MARGIN = 50, SHOCK = 25;
export const ENDINGS = {
  E1: { n: 1, name: '생존 실패' },
  E2: { n: 2, name: '수용 준비 미달' },
  E3: { n: 3, name: '시한부 정착' },
  E4: { n: 4, name: '취약한 정착' },
  E5: { n: 5, name: '안정적 이주' },
};
const clamp = value => Math.max(-50, Math.min(100, Math.round(value)));
const lowestKey = values => GAUGE_KEYS.reduce((a, b) => values[a] <= values[b] ? a : b);
const meets = (requires, selection) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
const decidedAll = Object.fromEntries(ALL_STEPS.map(step => [step.id, true]));

/** 입주 후 4주 운영 검증 → { ok, key?, week?, trace: [입주 날, 1주, 2주, …] } */
export function verify(selection, start) {
  const S = { ...start }, trace = [{ ...S }];
  const rules = data.verify.filter(rule => meets(rule.requires, selection));
  for (let i = 0; i < 4; i++) {
    const weekly = gaugeState(selection, decidedAll, 6 + i).weekly;   // 매주 선지 효과 + 그 주 수확
    const m = rules.reduce((scale, rule) => scale * (rule.demandScale && i < (rule.weeks ?? 4) ? rule.demandScale : 1), 1), low = lowestKey(S);
    for (const k of GAUGE_KEYS) {
      let v = S[k] + weekly[k] + (DEMAND[k] ?? 0) * m;
      for (const rule of rules) v += (rule.add?.[k] ?? 0) + (rule.demandAdd?.[k] ?? 0) * m + (k === low ? rule.lowest ?? 0 : 0);
      S[k] = clamp(v);
    }
    trace.push({ ...S });
    const dead = GAUGE_KEYS.find(k => S[k] <= 0);
    if (dead) return { ok: false, key: dead, week: i + 1, trace };
  }
  return { ok: true, trace };
}

/** 고장 시험 → { B: 가장 낮아진 값, worst: { name, low, min }, res } */
// ease: 돌발 사건에서 얻은 부품 등으로 덜어 낸 피해 (events.js stressEase)
export function stress(selection, start, ease = 0) {
  const tests = data.tests.map(({ name, damage, adjust }) => {
    const d = { ...damage };
    for (const item of adjust) if (meets(item.requires, selection)) for (const k in item.add) d[k] = (d[k] ?? 0) + item.add[k];
    for (const k in d) d[k] = Math.max(0, d[k] - ease);
    return { name, d };
  });
  const run = (t, ease = 0) => {
    const S = { ...start };
    for (const k in t.d) S[k] -= Math.max(0, t.d[k] - ease);
    const low = lowestKey(S);
    return { name: t.name, S, low, min: S[low] };
  };
  const res = tests.map(t => run(t));
  if (data.reinforce && meets(data.reinforce.requires, selection)) {   // 가장 약한 곳 튼튼하게: 가장 나쁜 시험의 피해를 덜어 준다
    const i = res.indexOf(res.reduce((a, b) => a.min <= b.min ? a : b));
    res[i] = { ...run(tests[i], data.reinforce.ease), name: tests[i].name, reinforced: true };
  }
  const worst = res.reduce((a, b) => a.min <= b.min ? a : b);
  return { B: worst.min, worst, res };
}

/**
 * selection: { 단계id: 선지id }, start: 입주 날 게이지 { air, water, food, power }, failed: 5주 중 0 이 된 게이지 { key, week } | null
 * → { code: 'E1'~'E5', key(이야기의 중심 게이지), M, H, B, weakBy?, week? }
 */
export function judge(selection, start, failed = null, ease = 0) {
  if (failed) return { code: 'E1', key: failed.key, week: failed.week };
  const M = Math.min(...GAUGE_KEYS.map(k => start[k])), Mk = lowestKey(start);
  const H = verify(selection, start), B = stress(selection, start, ease);
  if (M < ACCEPT) return { code: 'E2', key: Mk, M, H, B };
  if (!H.ok) return { code: 'E3', key: H.key, week: H.week, M, H, B };
  if (M < MARGIN || B.B < SHOCK) {
    const weakBy = B.B < SHOCK ? 'test' : 'low';
    return { code: 'E4', key: weakBy === 'test' ? B.worst.low : Mk, weakBy, M, H, B };
  }
  return { code: 'E5', key: Mk, M, H, B };
}

/** 고른 길이 어떤 쪽에 기댔는지 (안정적 이주 이야기에 쓴다, 플레이테스트 strategy 와 같다) */
export function strategy(selection) {
  const t = data.strategies.filter(item => item.any.some(requires => meets(requires, selection))).map(item => item.text);
  return (t.length ? t : [data.fallback]).join('와 ');
}
