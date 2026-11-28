// 돌발 사건 3D 연출 설정 (src/eventStage.json · eventStage.js): 모든 나쁜 사건에 연출이 있고, 대상 단계·연출 종류가 실제로 있으며,
// 대응을 고르면 시간 초과보다 많이 되돌아온다. 좋은 소식도 모두 민트 연출이 있다
import assert from 'node:assert/strict';
const planet = process.argv[2] ?? 'b';
globalThis.startParams = '?planet=' + planet;
const { STAGED, healOf, targetLayers } = await import('../src/eventStage.js');
const { FX } = await import('../src/eventFx.js');
const { EVENTS, timeoutResponse } = await import('../src/events.js').then(m => ({ ...m, timeoutResponse: m.timeoutResponse ?? (e => ({ id: 'timeout', timeout: true, ...e.ignore })) }));
const { ALL_STEPS } = await import('../src/choices.js');
const steps = new Set(ALL_STEPS.map(s => s.id));
const bad = EVENTS.filter(e => e.kind === 'bad');
assert.ok(bad.length > 3, '나쁜 사건이 있다');
for (const e of bad) {
  const s = STAGED[e.id];
  assert.ok(s, e.id + ' 연출이 있다');
  assert.ok(FX[s.fx], e.id + ' 연출 종류 ' + s.fx);
  assert.ok(s.target === 'module' || steps.has(s.target), e.id + ' 대상 단계 ' + s.target + ' 가 ' + planet + ' 에 있다');
  assert.ok(Array.isArray(s.flows) && s.tag, e.id + ' 흐름 목록 · 표지');
  assert.equal(healOf(e, timeoutResponse(e)), 0, e.id + ' 시간 초과는 그대로');
  const heals = e.responses.map(r => healOf(e, r));
  assert.ok(heals.every(h => h >= 0 && h <= 1), e.id + ' 0~1');
}
const GOOD_FX = ['drop', 'spring', 'surge', 'bloom'];
for (const e of EVENTS.filter(e => e.kind === 'good')) {
  const s = STAGED[e.id];
  assert.ok(s && GOOD_FX.includes(s.fx), e.id + ' 좋은 소식은 민트 연출');
  assert.ok(s.target === 'module' || steps.has(s.target), e.id + ' 대상 단계 ' + s.target);
}
for (const e of bad) assert.ok(!GOOD_FX.includes(STAGED[e.id].fx), e.id + ' 나쁜 사건에 좋은 소식 연출이 섞이지 않는다');
// 모든 연출·변형이 만들어지고, 움직여도 점 자리가 숫자로 남는다 (NaN·무한대 없음)
const box = Float32Array.from({ length: 900 }, (_, i) => (i % 3 === 1 ? (i % 7) / 4 : ((i * 37) % 100) / 50 - 1));
const ctx = { center: [0, 0, 0], radius: 1, top: 1.5, segments: [[[0, 0, 0], [3, 0, 1]]], ground: () => 0, burst: [1.5, 0.3, 0.5], targetPoints: box, dir: [0.94, -0.34], spots: [[1, 1], [2, 1]], seedAt: [0, 0, 0], reach: t => t, wide: t => t, wideFar: 1.8 };
const variants = [...Object.keys(FX).map(fx => [fx]), ...Object.values(STAGED).filter(s => s.style).map(s => [s.fx, s.style])];
for (const [fx, style] of variants) {
  const cloud = FX[fx]({ ...ctx, style }), pos = cloud.positions.slice(), col = cloud.colors.slice();
  assert.ok(cloud.positions.length > 0, fx + ' 점이 있다');
  for (const time of [0.3, 2, 6]) { cloud.frame(pos, col, cloud.colors, time, 1); assert.ok(pos.every(Number.isFinite) && col.every(Number.isFinite), fx + (style ? ':' + style : '') + ' ' + time + '초에 숫자'); }
}
// 대상 단계에서 고른 선지가 레이어를 놓는다
const step = ALL_STEPS.find(s => s.choices.some(c => c.overlays?.length));
const choice = step.choices.find(c => c.overlays?.length);
assert.deepEqual(targetLayers(step.id, { [step.id]: choice.id }), choice.overlays);
assert.deepEqual(targetLayers('module', {}), ['module']);
console.log('eventStage ' + planet + ': 나쁜 사건 ' + bad.length + '개 · 좋은 소식 ' + EVENTS.filter(e => e.kind === 'good').length + '개 연출 확인');
