// 행성 데이터 묶음 (src/planets) 검사: 모든 행성이 같은 모양이고, 판정·칭호 조건이 실제 단계·선지를 가리킨다
import assert from 'node:assert/strict';
import { PLANETS, PLANET, planetSearch } from '../src/planets/index.js';

const KEYS = ['air', 'water', 'food', 'power'];
assert.equal(PLANET.id, 'b', '주소에 행성이 없으면 b');
const stored = new Set();
for (const [id, planet] of Object.entries(PLANETS)) {
  assert.equal(planet.id, id, `${id}: 폴더 이름과 id 가 같다`);
  // 준비 중인 행성(ready: false)은 숫자만 있으면 된다
  for (const field of ['name', 'level', 'events', 'storage', 'gauges', 'judge', ...(planet.ready ? ['siteCopy', 'sites', 'hud', 'brief', 'eventData', 'story'] : [])]) assert.ok(planet[field], `${id}: ${field} 가 있다`);
  assert.equal(planet.weeks.length, 5, `${id}: 5주`);
  for (const week of planet.weeks) assert.equal(week.steps.length, 3, `${id}: ${week.week}주차 결정 3개`);
  for (const key of KEYS) assert.ok(planet.gauges.start[key] > 0, `${id}: 시작 ${key}`);
  assert.deepEqual(Object.keys(planet.judge.demand).sort(), [...KEYS].sort(), `${id}: 입주 후 수요`);
  assert.equal(planet.judge.tests.length, 2, `${id}: 고장 시험 2종`);
  assert.ok(planet.events.severity > 0 && planet.events.timerSeconds > 0 && planet.events.eventsPerGame <= 4, `${id}: 난이도 값`);
  // 지역 이름: 글·지형·1주차 데이터가 같은 지역을 말한다
  const sites = Object.keys(planet.weeks[0].sites).sort();
  if (planet.ready) for (const list of [planet.siteCopy, planet.sites, planet.hud.sites]) assert.deepEqual(Object.keys(list).sort(), sites, `${id}: 지역 목록`);
  if (planet.ready) for (const name of sites) assert.equal(planet.siteCopy[name].letter, planet.weeks[0].sites[name], `${id}: ${name} 글자`);
  // 조건에 적힌 단계·선지가 모두 있다
  const steps = Object.fromEntries(planet.weeks.flatMap(w => w.steps).map(s => [s.id, new Set(s.choices.map(c => c.id))]));
  const check = (requires, where) => {
    for (const [step, ids] of Object.entries(requires ?? {})) for (const choice of ids) assert.ok(steps[step]?.has(choice), `${id} ${where}: ${step} ${choice}`);
  };
  // 모든 선지에 게이지 항목이 있고, 조건도 실제 선지를 가리킨다. 선지 id 는 한 행성 안에서 겹치지 않는다
  const choices = planet.weeks.flatMap(w => w.steps.flatMap(s => s.choices));
  assert.equal(new Set(choices.map(c => c.id)).size, choices.length, `${id}: 선지 id`);
  for (const choice of choices) { assert.ok(Array.isArray(planet.gauges.choices[choice.id]), `${id}: 게이지 ${choice.id}`); check(choice.requires, choice.id); planet.gauges.choices[choice.id].forEach(e => check(e.requires, choice.id)); if (choice.lockHint) assert.ok(choice.requires, `${id}: ${choice.id} 잠긴 조건`); }
  planet.judge.verify.forEach(r => check(r.requires, 'verify'));
  planet.judge.tests.forEach(t => t.adjust.forEach(a => check(a.requires, t.name)));
  check(planet.judge.reinforce?.requires, 'reinforce');
  planet.judge.strategies.forEach(s => s.any.forEach(r => check(r, 'strategies')));
  for (const rule of planet.story?.badgeRules ?? []) { check(rule.requires, 'badge'); assert.ok(planet.story.badges[rule.badge], `${id}: 칭호 ${rule.badge}`); }
  // 작물을 고르면 시험에 반영되는 조건은 모든 작물을 담아야 한다 (빠뜨리면 그 작물만 조용히 빠진다)
  for (const t of planet.judge.tests) for (const a of t.adjust) if (a.requires?.crop) assert.equal(a.requires.crop.length, steps.crop.size, `${id}: 모든 작물`);
  // 저장 이름은 행성끼리 겹치지 않는다
  for (const name of Object.values(planet.storage)) { assert.ok(!stored.has(name), `${id}: 저장 이름 ${name}`); stored.add(name); }
}
// 선지 이름은 행성끼리 다시 쓰지 않는다
const names = Object.values(PLANETS).flatMap(p => p.weeks.flatMap(w => w.steps.flatMap(s => s.choices.map(c => c.label))));
assert.equal(new Set(names).size, names.length, '겹치는 선지 이름');
// 접속 화면에서 고른 행성 → 새로 불러올 주소
assert.equal(planetSearch('b'), null, '지금 행성이면 그대로');
assert.equal(planetSearch('zz'), null, '모르는 행성이면 그대로');
assert.equal(planetSearch('c'), '?planet=c&prologue=0');
assert.equal(planetSearch('c', '?week=2&site=plain&guide=0'), '?guide=0&planet=c&prologue=0', '다른 행성의 바로가기는 버린다');
const access = (await import('node:fs')).readFileSync(new URL('../public/web/prologue-access.html', import.meta.url), 'utf8');
for (const [id, planet] of Object.entries(PLANETS)) if (planet.ready) assert.ok(new RegExp(`\n ${id}:\{[^\n]*level:'${planet.level}'`).test(access), `${id}: 접속 화면에 있고 난이도 이름이 같다`);
console.log('PASS planets:', Object.keys(PLANETS).join(', '));
