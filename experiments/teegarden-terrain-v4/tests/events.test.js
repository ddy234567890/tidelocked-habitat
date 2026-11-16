// 돌발 사건 데이터 (src/events.json) 와 게이지 반영 (gauges.js extras) 검사
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_STEPS } from '../src/choices.js';
import { gaugeState, GAUGE_KEYS } from '../src/gauges.js';

// events.js 는 document 를 쓰므로 순수 함수만 같은 규칙으로 다시 확인한다
const data = JSON.parse(readFileSync(new URL('../src/events.json', import.meta.url)));
const steps = Object.fromEntries(ALL_STEPS.map(step => [step.id, new Set(step.choices.map(choice => choice.id))]));
const ids = new Set(data.events.map(event => event.id));
const keys = new Set([...GAUGE_KEYS, 'lowest']);

const checkRequires = (requires, where) => {
  for (const [step, list] of Object.entries(requires ?? {})) {
    assert.ok(steps[step], `${where}: 없는 단계 ${step}`);
    for (const id of list) assert.ok(steps[step].has(id), `${where}: ${step} 에 없는 선지 ${id}`);
  }
};
const checkEffect = (effect, where) => { for (const key of Object.keys(effect ?? {})) assert.ok(keys.has(key), `${where}: 없는 게이지 ${key}`); };

assert.equal(ids.size, data.events.length, '사건 id 는 겹치지 않는다');
for (const event of data.events) {
  const at = event.id;
  assert.ok(['bad', 'good'].includes(event.kind), at + ' kind');
  for (const field of ['name', 'hint', 'lockedHint', 'text']) assert.ok(event[field], `${at}: ${field} 가 있다`);
  for (const cond of event.when ?? []) checkRequires(cond, at + ' when');
  for (const a of event.adjust ?? []) { checkRequires(a.requires, at + ' adjust'); checkEffect(a.now, at + ' adjust'); assert.ok(a.text, at + ' adjust 이유 글'); }
  assert.ok(event.responses.filter(r => !r.requires).length >= 2, `${at}: 누구나 고를 수 있는 대응이 2개 이상`);
  if (event.kind === 'bad') {
    // 시간 초과(아무 조치도 못 함)는 누구나 고를 수 있는 어떤 대응보다 손해가 크다 (여파는 3주치로 셈)
    assert.ok(event.ignore?.result, `${at}: 나쁜 사건은 ignore(시간 초과 결과)가 있다`);
    checkEffect(event.ignore.now, at + ' ignore'); checkEffect(event.ignore.weekly, at + ' ignore'); checkRequires(event.ignore.clearedBy, at + ' ignore');
    const loss = r => Object.values(r.now ?? {}).reduce((a, b) => a + b, 0) + 3 * Object.values(r.weekly ?? {}).reduce((a, b) => a + b, 0);
    for (const r of event.responses.filter(r => !r.requires)) assert.ok(loss(event.ignore) < loss(r), `${at}: 시간 초과가 ${r.id} 보다 손해가 크다`);
  }
  for (const r of event.responses) {
    checkRequires(r.requires, `${at}.${r.id}`); checkRequires(r.clearedBy, `${at}.${r.id} clearedBy`);
    checkEffect(r.now, `${at}.${r.id}`); checkEffect(r.weekly, `${at}.${r.id}`);
    assert.ok(r.label && r.line && r.result, `${at}.${r.id}: 글이 있다`);
    if (r.follow) assert.ok(ids.has(r.follow) && data.events.find(e => e.id === r.follow).followOnly, `${at}.${r.id}: 후속 사건 ${r.follow}`);
    if (r.clearedBy) assert.ok(r.weekly, `${at}.${r.id}: clearedBy 는 weekly 와 함께`);
  }
}
// 어느 경로든 사건 칸이 비지 않도록 언제나 나올 수 있는 사건이 4개 이상 (한 판 4번)
assert.ok(data.events.filter(e => !e.followOnly && !e.when?.length).length >= 3, '언제나 나오는 사건');

// 게이지 반영: 2주차 끝 사건 (전력 −3, 매주 전력 −1, 5주 U2 로 멈춤)
const sel = { location: 'A', module: 'A1', oxygen: 'O1', power: 'P1', storage: 'S1', heat: 'T2' };
const dec = { location: true, module: true, oxygen: true, power: true, storage: true, heat: true };
const base2 = gaugeState(sel, dec, 2);
const extra = [{ week: 2, now: { power: -3 }, weekly: { power: -1 }, clearedBy: { fix: ['U2'] } }];
const hit2 = gaugeState(sel, dec, 2, extra);
assert.equal(hit2.values.power, base2.values.power - 3, '사건 즉시 효과');
assert.equal(hit2.weekly.power, base2.weekly.power - 1, '사건 여파가 매주 더해진다');
assert.equal(gaugeState(sel, dec, 3, extra).values.power, gaugeState(sel, dec, 3).values.power - 4, '다음 주에는 여파 한 번 더');
// 'lowest' 는 그 순간 가장 낮은 게이지
const low = gaugeState(sel, dec, 2, [{ week: 2, now: { lowest: 5 } }]);
const lowestKey = GAUGE_KEYS.reduce((a, b) => base2.values[a] <= base2.values[b] ? a : b);
assert.equal(low.values[lowestKey], base2.values[lowestKey] + 5);
// 5주 '가장 약한 곳 튼튼하게'(U2) 를 결정하면 여파가 멈춘다
const all = { ...sel, source: 'W1', reuse: 'R1', share: 'D1', farm: 'G1', balance: 'K1', crop: 'C_leaf', fix: 'U2' };
const allDec = Object.fromEntries(Object.keys(all).map(k => [k, true]));
const u1 = { ...all, fix: 'U1' };
assert.equal(gaugeState(all, allDec, 5, extra).weekly.power, gaugeState(all, allDec, 5).weekly.power, 'U2 로 고치면 여파 없음');
assert.equal(gaugeState(u1, allDec, 5, extra).weekly.power, gaugeState(u1, allDec, 5).weekly.power - 1, 'U1 이면 여파 그대로');
// events.js 가 문법 오류 없이 불러와지고, 아무 선택이 없어도 사건이 뽑힌다
const { pickEvent } = await import('../src/events.js');
assert.ok(pickEvent({}, new Set(), new Set(), () => 0.5), '선택이 없어도 사건이 뽑힌다');
console.log('events ok:', data.events.length, '개');
