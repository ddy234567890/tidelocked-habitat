// Teegarden c 숫자 검사: 모든 선택 조합을 돌려 결말 분포와 잠긴 선지를 확인한다 (돌발 사건 제외, 화면 없음)
import assert from 'node:assert/strict';
globalThis.startParams = '?planet=c'; // 불러오기 전에 정해야 c 로 열린다
const { PLANET } = await import('../src/planets/index.js');
const { ALL_STEPS, availableChoices, choose } = await import('../src/choices.js');
const { gaugeState } = await import('../src/gauges.js');
const { judge } = await import('../src/endingJudge.js');
assert.equal(PLANET.id, 'c');

const decided = Object.fromEntries(ALL_STEPS.map(step => [step.id, true]));
const total = {}, best = {}, used = {};
let count = 0;
(function walk(i, sel) {
  if (i < ALL_STEPS.length) {
    for (const choice of availableChoices(ALL_STEPS[i].id, sel)) walk(i + 1, choose(sel, ALL_STEPS[i].id, choice.id));
    return;
  }
  count++;
  const state = gaugeState(sel, decided, 5), { code } = judge(sel, state.values, state.failed);
  total[code] = (total[code] ?? 0) + 1;
  for (const id of Object.values(sel)) { used[id] = (used[id] ?? 0) + 1; if (code === 'E5') best[id] = (best[id] ?? 0) + 1; }
  // 잠긴 선지는 조건을 갖춘 판에만 나온다
  if (sel.source === 'hydro') assert.equal(sel.location, 'B');
  if (sel.crop === 'microbe') assert.equal(sel.storage, 'h2');
  if (sel.arrive === 'full') assert.notEqual(sel.heat, 'shrink');
})(0, {});
assert.equal(count, 201600, '조합 수');

// 난이도 범위는 사건을 넣고 scripts/balance.mjs check 가 본다. 여기서는 사건 없이도 다섯 결말이 모두 나오는지만 본다
for (const code of ['E1', 'E2', 'E3', 'E4', 'E5']) assert.ok(total[code] > 0, `${code} 가 나오는 선택이 있다`);
// 모든 선지로 (사건 없이) 안정적 이주에 닿을 수 있다 (막힌 선지 없음)
for (const step of ALL_STEPS) for (const { id } of step.choices) assert.ok(best[id] > 0, `${id} 로도 안정적 이주에 닿는다`);
// 어느 선지 하나가 거의 모든 성공을 차지하지 않는다 (위치 · 발전)
for (const id of ['A', 'B', 'C', 'csp', 'geo', 'rtg']) assert.ok(best[id] / total.E5 < 0.7, `${id} 쏠림`);

// 수확: 생활 구역 축소 ×0.75 · 완전 순환 ×0.9 · 저온 −1 과 7주차 +4(배율 없음)
const base = { location: 'A', module: 'dome', oxygen: 'stdp', power: 'csp', storage: 'thermal', heat: 'shrink', source: 'closed', melt: 'emelt', keep: 'ice', crop: 'hydroponic', growTemp: 'lowtemp', waste: 'seal' };
const foodAt = week => gaugeState(base, decided, week).weekly.food;
assert.equal(foodAt(5) - foodAt(4), 8, '13 × 0.75 × 0.9 → 9, 저온 −1');
assert.equal(foodAt(7) - foodAt(6), 4, '7주차 추가 수확');
console.log(`PASS planet c: ${count} 가지 선택 → ${Object.entries(total).sort().map(([c, n]) => `${c} ${(n / count * 100).toFixed(1)}%`).join(' · ')}`);
const low = ALL_STEPS.flatMap(s => s.choices.map(c => [c.label, best[c.id] / used[c.id]])).sort((a, b) => a[1] - b[1]).slice(0, 6);
console.log('  안정적 이주가 적은 선지:', low.map(([name, r]) => `${name} ${(r * 100).toFixed(1)}%`).join(' · '));
