import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gaugeState, GAUGE_KEYS } from '../src/gauges.js';
import { ALL_STEPS } from '../src/choices.js';

const data = JSON.parse(readFileSync(new URL('../src/gauges.json', import.meta.url)));

// 게임의 모든 선지에 게이지 효과 항목이 있다 (없는 선지는 빈 목록 [])
for (const step of ALL_STEPS) for (const choice of step.choices) assert.ok(Array.isArray(data.choices[choice.id]), `gauges.json 에 ${choice.id} 가 있다`);

// 시작은 모두 60, 아무것도 안 골랐으면 매주 기본 소비
const empty = gaugeState({}, {}, 1);
assert.deepEqual(empty.values, { air: 60, water: 60, food: 60, power: 60 });
assert.deepEqual(empty.weekly, data.weekly);

// 플레이테스트와 같은 계산: A → A1 → O1 → (2주) P1 · S1 · T2
const sel = { location: 'A', module: 'A1', oxygen: 'O1', power: 'P1', storage: 'S1', heat: 'T2' };
const w1 = { location: true, module: true, oxygen: true };
assert.deepEqual(gaugeState(sel, w1, 1).values, { air: 60, water: 60, food: 60, power: 58 }, '결정하자마자 즉시 변화만');
assert.deepEqual(gaugeState(sel, w1, 2).values, { air: 61, water: 55, food: 57, power: 52 }, '주가 끝나면 매주 변화 한 번');
const w2 = { ...w1, power: true, storage: true, heat: true };
assert.equal(gaugeState(sel, w2, 2).values.power, 43);
assert.equal(gaugeState(sel, w2, 2).weekly.power, 16);
// 고르기만 하고 결정하지 않으면 바뀌지 않는다
assert.deepEqual(gaugeState(sel, {}, 1).values, empty.values);

// 실패 판정: 0 이하가 된 게이지와 주차를 알려 준다. 지금 숫자로는 5주 안에 0 이 되는 경로가 없어서(가장 낮아도 8),
// 결정 전 상태를 직접 낮춰 볼 수 없으므로 failed 가 비어 있는 것만 확인한다
assert.equal(gaugeState(sel, w2, 3).failed, null);
assert.ok(GAUGE_KEYS.every(key => key in empty.values));

console.log('PASS: gauges — every choice has data, start 60, playtest numbers, decide-only, no failure on a normal path.');
