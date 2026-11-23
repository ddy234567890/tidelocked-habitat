// 엔딩 판정 (src/endingJudge.js) — 팀 플레이테스트 E1~E5 기준
import assert from 'node:assert/strict';
import { ALL_STEPS, availableChoices, choose } from '../src/choices.js';
import { gaugeState } from '../src/gauges.js';
import { judge, verify, stress, DEMAND, ACCEPT, MARGIN, SHOCK } from '../src/endingJudge.js';

// 모든 선택 조합을 돌려 결말이 어떻게 나뉘는지 센다 (돌발 사건 제외)
const paths = [];
(function walk(i, sel) {
  if (i === ALL_STEPS.length) { paths.push(sel); return; }
  const step = ALL_STEPS[i];
  const opts = step.id === 'location' ? ['A', 'B', 'C'] : availableChoices(step.id, sel).map(c => c.id);
  for (const id of opts) walk(i + 1, choose(sel, step.id, id));
})(0, {});
const decided = Object.fromEntries(ALL_STEPS.map(s => [s.id, true]));
const count = {};
for (const sel of paths) {
  const { values } = gaugeState(sel, decided, 5);
  const j = judge(sel, values);
  count[j.code] = (count[j.code] ?? 0) + 1;
  assert.ok(['air', 'water', 'food', 'power'].includes(j.key), `${j.code} 중심 게이지`);
  if (j.code === 'E2') assert.ok(j.M < ACCEPT);
  if (j.code === 'E3') assert.ok(j.M >= ACCEPT && !j.H.ok && j.week >= 1 && j.week <= 4);
  if (j.code === 'E4') assert.ok(j.H.ok && (j.M < MARGIN || j.B.B < SHOCK));
  if (j.code === 'E5') assert.ok(j.H.ok && j.M >= MARGIN && j.B.B >= SHOCK);
}
// 돌발 사건 없이도 결말 2~5 는 모두 나올 수 있어야 한다
for (const code of ['E2', 'E3', 'E4', 'E5']) assert.ok(count[code] > 0, `${code} 가 나오는 선택이 있다`);
// 결말 4 가 너무 많지 않게 (2026-11-23 기준값 조정: 약 56%)
assert.ok(count.E4 / paths.length < 0.65, `결말 4 비중 ${Math.round(count.E4 / paths.length * 100)}% 는 65% 미만`);
assert.ok(count.E5 / paths.length > 0.1, '결말 5 는 열 번에 한 번 넘게 나온다');
// 결말 1 은 준비 중 게이지가 0 이 되면 (게임의 기지 운영 실패)
assert.equal(judge(paths[0], { air: 30, water: 0, food: 40, power: 40 }, { key: 'water', week: 3 }).code, 'E1');
// 입주 후 수요는 플레이테스트와 같다
assert.deepEqual(DEMAND, { air: -8, water: -13, food: -15, power: -12 });
// 검증 기록은 입주 날 + 버틴 주 수만큼
const v = verify(paths[0], gaugeState(paths[0], decided, 5).values);
assert.ok(v.trace.length >= 2 && v.trace.length <= 5);
assert.ok(stress(paths[0], gaugeState(paths[0], decided, 5).values).res.length === 2);
console.log(`PASS ending: ${paths.length} 가지 선택 → ${Object.entries(count).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
