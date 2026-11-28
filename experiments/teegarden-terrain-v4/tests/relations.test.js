// 지난 선택 연관 (src/relations.js): 앞 선지 → 뒤 선지 방향, 점수 순, 근거 문장
import assert from 'node:assert/strict';
const planet = process.argv[2] ?? 'b';
globalThis.startParams = '?planet=' + planet;
const { relationsFor, weightsFor, balanceFor } = await import('../src/relations.js');
const { ALL_STEPS, availableChoices, choose } = await import('../src/choices.js');
const pick = ids => { let s = {}; for (const st of ALL_STEPS) { const o = availableChoices(st.id, s); const id = ids[st.id] && o.some(c => c.id === ids[st.id]) ? ids[st.id] : o[0].id; s = choose(s, st.id, id); } return s; };
const sel = planet === 'c' ? pick({ location: 'B', storage: 'h2', crop: 'microbe', source: 'hydro' }) : pick({ location: 'B', module: 'B2', power: 'P1' });
const rel = relationsFor(sel);
assert.ok(rel.length > 5, '연관이 여럿');
for (let i = 1; i < rel.length; i++) assert.ok(rel[i - 1].score >= rel[i].score, '점수 순');
for (const r of rel) {
  assert.ok(r.from.week < r.to.week || (r.from.week === r.to.week && r.from.order < r.to.order), '앞 → 뒤');
  assert.ok(r.reasons.length && r.reasons.every(x => x.text && !/undefined/.test(x.text)));
}
const find = (a, b) => rel.find(r => r.from.id === a && r.to.id === b);
if (planet === 'c') {
  assert.ok(find('h2', 'microbe').reasons.some(x => x.kind === 'unlock'), '수소 저장 → 미생물 발효는 열림 조건');
  assert.ok(find('B', 'hydro').reasons.some(x => x.kind === 'unlock'));
} else {
  assert.ok(find('B', 'P1').reasons.some(x => x.kind === 'effect'), '동굴이면 태양광 효과가 달라진다');
}
// 무게 (메모장 거품 크기): 고른 단계마다 1 이상의 숫자, 가장 무거운 선택은 가장 가벼운 선택보다 확실히 크다
const weights = weightsFor(sel), ws = Object.values(weights).map(w => w.weight);
assert.equal(Object.keys(weights).length, Object.keys(sel).length, '고른 단계마다 무게');
assert.ok(ws.every(w => Number.isFinite(w) && w >= 1), '무게는 1 이상');
assert.ok(Math.max(...ws) > Math.min(...ws) * 2, '무게 차이가 보인다');
// 득실 (메모장 전개도 색): 고른 단계마다 있고, 득·실은 0 이상, 득이 큰 선택과 실이 큰 선택이 둘 다 있다
const bal = Object.values(balanceFor(sel));
assert.equal(bal.length, Object.keys(sel).length, '고른 단계마다 득실');
assert.ok(bal.every(b => b.gain >= 0 && b.loss >= 0 && b.net === b.gain - b.loss), '득실 숫자');
assert.ok(bal.some(b => b.net > 1) && bal.some(b => b.net < -1), '득이 많은 선택과 실이 많은 선택이 함께 있다');
console.log('PASS relations', planet + ':', rel.length, '개 · 1위', rel[0].from.label, '→', rel[0].to.label, rel[0].score + '점');
