// Teegarden c 돌발 사건 검사 (src/planets/c/events.json): 형식, 늦게 오는 피해, 기회 1번 규칙, 난이도 범위
import assert from 'node:assert/strict';
globalThis.startParams = '?planet=c';
const { PLANET, PLANETS } = await import('../src/planets/index.js');
const { ALL_STEPS, choose } = await import('../src/choices.js');
const { gaugeState, GAUGE_KEYS } = await import('../src/gauges.js');
const { stress } = await import('../src/endingJudge.js');
const { EVENTS, pickEvent, outcome, harsh, SEVERITY } = await import('../src/events.js');
assert.equal(PLANET.id, 'c');
const keys = new Set([...GAUGE_KEYS, 'lowest']), ids = new Set(EVENTS.map(e => e.id));
const steps = Object.fromEntries(ALL_STEPS.map(s => [s.id, new Set(s.choices.map(c => c.id))]));
const req = (r, at) => { for (const [s, list] of Object.entries(r ?? {})) for (const id of list) assert.ok(steps[s]?.has(id), at + ': ' + s + ' ' + id); };
const eff = (e, at) => { for (const k of Object.keys(e ?? {})) assert.ok(keys.has(k), at + ': ' + k); };
const total = e => Object.values(e ?? {}).reduce((a, b) => a + b, 0);
const loss = r => total(r.now) + total(r.later) + 3 * total(r.weekly);

assert.equal(EVENTS.filter(e => e.kind === 'bad').length, 7);
assert.equal(EVENTS.filter(e => e.kind === 'good').length, 5);
assert.equal(ids.size, EVENTS.length);
const names = new Set(PLANETS.b.eventData.events.map(e => e.name));
for (const e of EVENTS) {
  assert.ok(!names.has(e.name), e.id + ': b 와 이름이 겹치지 않는다');
  for (const f of ['name', 'hint', 'lockedHint', 'text']) assert.ok(e[f], e.id + ' ' + f);
  e.when.forEach(w => req(w, e.id)); (e.excludes ?? []).forEach(x => assert.ok(ids.has(x)));
  for (const a of e.adjust) { req(a.requires, e.id); eff(a.now, e.id); eff(a.later, e.id); assert.ok(a.text); }
  const open = e.responses.filter(r => !r.requires), locked = e.responses.filter(r => r.requires);
  assert.equal(open.length, 2, e.id + ': 누구나 대응 2개');
  for (const r of e.responses) { assert.ok(r.label && r.line && r.result, e.id + '.' + r.id); req(r.requires, e.id); eff(r.now, e.id); eff(r.later, e.id); }
  if (e.kind === 'bad') {
    assert.equal(locked.length, 1, e.id + ': 선지로 열리는 대응 1개');
    for (const r of open) assert.ok(loss(e.ignore) < loss(r), e.id + ': 시간 초과가 ' + r.id + ' 보다 손해');
    for (const r of open) assert.ok(loss(locked[0]) > loss(r), e.id + ': 열린 대응이 ' + r.id + ' 보다 낫다');
    if ([...e.responses, e.ignore].some(r => r.later)) assert.ok(e.laterText, e.id + ': 다음 주 안내');
  } else for (const r of e.responses) assert.ok(loss(r) > 0, e.id + ': 좋은 소식은 이득');
}
// 어느 게이지든 나쁜 사건의 대상이 된다
for (const k of GAUGE_KEYS) assert.ok(EVENTS.some(e => e.kind === 'bad' && ((e.ignore.now?.[k] ?? 0) < 0 || (e.ignore.later?.[k] ?? 0) < 0)), k);

// 늦게 오는 피해: 다음 주 항목으로 나뉘고, 5주차에는 그 주에 들어온다
const cold = EVENTS.find(e => e.id === 'coldwave'), brace = cold.responses.find(r => r.id === 'brace'), sel = { location: 'A', module: 'shell', heat: 'hp' };
const list = outcome(cold, brace, sel, 3);
assert.deepEqual(list.map(x => x.week), [3, 4]);
assert.equal(list[1].now.power, Math.round(brace.later.power * SEVERITY));
assert.equal(list[1].text, cold.laterText);
assert.deepEqual(outcome(cold, brace, sel, 5).map(x => x.week), [5, 5]);
const before = gaugeState({}, {}, 3).values.power;
assert.equal(gaugeState({}, {}, 3, list.map(x => ({ ...x }))).values.power, before, '그 주에는 그대로');
assert.equal(gaugeState({}, {}, 4, list.map(x => ({ ...x }))).values.power, gaugeState({}, {}, 4).values.power + list[1].now.power, '다음 주에 들어온다');
// 데울 공간이 작으면 덜 아프고, 전기 히터면 더 아프다
const later = heat => outcome(cold, brace, { ...sel, heat }, 3)[1].now.power;
assert.ok(later('shrink') > later('hp') && later('resist') < later('hp'));
// 도움(adjust +)이 피해보다 커도 이득이 되지는 않는다
const store = cold.responses.find(r => r.id === 'store');
assert.ok(outcome(cold, store, { ...sel, heat: 'shrink' }, 3)[1].now.power <= 0);

// 뽑기: 종류 · 마지막 주 · 함께 나오지 않는 사건 · 위치
const all = (selection, used, opt) => { const out = new Set(); for (let i = 0; i < 400; i++) out.add(pickEvent(selection, new Set(used), new Set(), () => i / 400, null, opt)?.id); return out; };
assert.ok([...all({ location: 'A' }, [], { kind: 'good', week: 2 })].every(id => EVENTS.find(e => e.id === id).kind === 'good'));
assert.ok(!all({ location: 'A' }, [], { kind: 'bad', week: 5 }).has('coldwave'));
assert.ok(!all({ location: 'A' }, ['freeze'], { kind: 'bad', week: 3 }).has('heatfail'));
const atB = all({ location: 'B' }, [], { kind: 'bad', week: 3 });
assert.ok(atB.has('gas') && !atB.has('dust') && !atB.has('sink') && !atB.has('culture'));
assert.deepEqual(harsh({ lowest: 12 }), { lowest: 12 }, '좋은 값은 세기를 곱하지 않는다');

// 현지 자재: 고장 시험 피해가 8 덜하다 (0 아래로는 안 내려간다)
const start = { air: 60, water: 60, food: 60, power: 60 };
assert.equal(stress({}, start, 8).res[0].S.power, stress({}, start).res[0].S.power + 8);
assert.equal(stress({}, start, 8).res[1].S.food, 60);

// 처음부터 끝까지 사건이 나오는 주는 3주, 그중 좋은 소식 1번
assert.equal(PLANET.events.eventsPerGame, 3); assert.equal(PLANET.events.goodPerGame, 1);
console.log('PASS events c:', EVENTS.length, '개');
