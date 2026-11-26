// Teegarden c 화면 데이터 검사: 지형이 유한하고 가운데가 평평한지, 선지가 가리키는 집·장치·모델이 모두 있는지, 잠긴 선지가 보이는지
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
globalThis.startParams = '?planet=c';
const { PLANET } = await import('../src/planets/index.js');
const { choiceData, ALL_STEPS, WEEKS, floorAt, lockedChoices, availableChoices, flowsFor, findSpot, resolve } = await import('../src/choices.js');
const { buildBasin, buildRift, buildShore, COLD } = await import('../src/coldLands.js');
const { buildSurroundings } = await import('../src/surroundings.js');
for (const [name, build] of Object.entries({ basin: buildBasin, rift: buildRift, shore: buildShore })) {
  const def = PLANET.sites[name], a = build(4000, def), b = build(4000, def);
  assert.ok(a.positions.every(Number.isFinite) && a.colors.every(v => v >= 0 && Number.isFinite(v)), name);
  assert.deepEqual(a.positions, b.positions, name + ' 같은 씨앗이면 같은 지형');
  for (let t = 0; t < 12; t++) assert.ok(Math.abs(floorAt(name, Math.cos(t) * 4, Math.sin(t) * 4)) < 0.05, name + ' 집 자리는 평평하다');
  assert.ok(buildSurroundings(name, def, false, 2000).positions.every(Number.isFinite));
  // 장치 놓을 자리를 찾을 수 있다
  assert.ok(findSpot(name, [0, 0, 3.6], { r: 1.2, h: 1 }, new Map(), true), name + ' 장치 자리');
}
assert.ok(COLD.rift.surface(PLANET.sites.rift)(8, 0) < -3, '열곡은 깊다');
const placement = ['placement', 'coldModels'].map(f => readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8')).join('');
const { layers } = choiceData;
for (const step of ALL_STEPS) {
  assert.ok(step.boardName && step.short, step.id);
  for (const c of step.choices) {
    if (step.id === 'module') assert.ok(layers.module[c.module], c.id);
    else if (step.id !== 'location') assert.ok(c.overlays?.length && layers.overlay[c.overlays[0]], c.id + ' 장치');
  }
}
for (const layer of [...Object.values(layers.module), ...Object.values(layers.overlay)]) for (const part of layer.parts) {
  if (part.box) continue;
  assert.ok(existsSync(new URL(`../src/models/${part.asset}.glb`, import.meta.url)) && placement.includes(`'./models/${part.asset}.glb'`), part.asset);
}
assert.deepEqual(lockedChoices('source', { location: 'A' }).map(c => c.id), ['hydro']);
assert.deepEqual(lockedChoices('source', { location: 'B' }), []);
assert.deepEqual(lockedChoices('arrive', { heat: 'shrink' }).map(c => c.id), ['full']);
assert.equal(lockedChoices('module', { location: 'A' }).length, 0, '위치가 다른 집은 잠긴 채로 보이지 않는다');
const sel = {}; for (const s of ALL_STEPS) sel[s.id] = availableChoices(s.id, sel)[0].id;
assert.ok(flowsFor(sel).length >= 3 && resolve(sel).overlays.length === 13, '흐름과 장치');
assert.ok(WEEKS.every(w => w.brief));
console.log('PASS scene c: 지형 3곳 · 집 6 · 장치 ' + Object.keys(layers.overlay).length);
