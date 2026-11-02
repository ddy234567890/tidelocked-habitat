import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { choiceData, availableChoices, choose, resolve, placeAt, overlaySpot, floorAt, STEP_IDS, findSpot, fitsAt, occupancy } from '../src/choices.js';
import { PILLAR_SPOTS } from '../src/lavaTube.js';
import { buildCaveSeal, caveSection, SEAL_STATIONS } from '../src/lavaTube.js';
import { ridgeFrame } from '../src/ridge.js';

const definitions = JSON.parse(readFileSync(new URL('../src/sites.json', import.meta.url)));
const placement = readFileSync(new URL('../src/placement.js', import.meta.url), 'utf8');

// 단계 순서와 선지가 가리키는 레이어·모델이 모두 있어야 한다
assert.deepEqual(STEP_IDS, ['location', 'module', 'oxygen']);
const { layers } = choiceData;
for (const step of choiceData.steps) for (const choice of step.choices) {
  if (choice.module) assert.ok(layers.module[choice.module], `모듈 레이어 ${choice.module}`);
  for (const id of choice.overlays ?? []) assert.ok(layers.overlay[id], `오버레이 레이어 ${id}`);
  for (const [stepId, ids] of Object.entries(choice.requires ?? {})) {
    const step = choiceData.steps.find(s => s.id === stepId);
    for (const id of ids) assert.ok(step.choices.some(c => c.id === id), `${choice.id} 의 requires ${stepId}:${id}`);
  }
}
const assets = [...Object.values(layers.module).flatMap(l => l.parts), ...Object.values(layers.overlay)].map(p => p.asset).filter(Boolean);
for (const asset of new Set(assets)) {
  assert.ok(existsSync(new URL(`../src/models/${asset}.glb`, import.meta.url)), `모델 파일 ${asset}.glb`);
  assert.ok(placement.includes(`'./models/${asset}.glb'`), `placement.js 가 ${asset}.glb 를 불러온다`);
}

// 앞 단계를 고르면 다음 단계 선지가 열리고, 앞 단계를 바꾸면 뒤 단계 선택은 지운다
assert.deepEqual(availableChoices('module', { location: 'B' }).map(c => c.id), ['B1', 'B2']);
assert.ok(!availableChoices('oxygen', { location: 'A', module: 'A1' }).some(c => c.id === 'O_ice'), 'C 전용 산소 선지는 A 에서 숨긴다');
assert.ok(availableChoices('oxygen', { location: 'C', module: 'C2' }).some(c => c.id === 'O_central'));
assert.ok(!availableChoices('oxygen', { location: 'C', module: 'C1' }).some(c => c.id === 'O_central'), 'C2 전용 선지');
let selection = choose({}, 'location', 'C');
selection = choose(selection, 'module', 'C2');
selection = choose(selection, 'oxygen', 'O_central');
assert.deepEqual(resolve(selection), { module: 'solar_village', overlays: ['central_pipe'] });
assert.deepEqual(choose(selection, 'location', 'A'), { location: 'A' }, '지대를 바꾸면 거주·산소 선택을 지운다');
assert.deepEqual(choose(selection, 'module', 'C1'), { location: 'C', module: 'C1' });

// 모든 자리는 그 지대의 바닥 위에 놓인다. B 는 동굴 안, C 탑은 정상 띠 안
const siteOf = Object.fromEntries(Object.entries(choiceData.sites).map(([site, letter]) => [letter, site]));
const moduleSite = { inflatable: 'A', earth_print: 'A', cave_modules: 'B', cave_sealed: 'B', tower: 'C', solar_village: 'C' };
for (const [id, letter] of Object.entries(moduleSite)) for (const part of layers.module[id].parts) {
  if (part.special) continue;
  const site = siteOf[letter], [x, y, z] = placeAt(site, part.position, part.crest);
  assert.ok([x, y, z].every(Number.isFinite), `${id} 자리`);
  assert.equal(y, floorAt(site, x, z));
  if (letter === 'B') {
    const s = caveSection(x, definitions.lavaTube);
    assert.ok(s && y >= s.bottom - 1e-6 && y < s.top, `${id} 는 동굴 안 바닥`);
  }
}
for (const part of layers.module.tower.parts) {
  const [x, y, z] = placeAt('ridge', part.position, part.crest);
  assert.ok(Math.abs(ridgeFrame(x, z).u) <= 0.45 && y === 0, '탑형 집은 굽은 정상 띠 위');
}
for (const [letter, site] of Object.entries(siteOf)) for (const id of Object.keys(layers.overlay)) {
  assert.ok(overlaySpot(site, id).every(Number.isFinite), `${letter} 오버레이 ${id} 자리`);
}

// 동굴 봉쇄막: 상자가 아니라 동굴 단면 테두리 안을 채운다. 반쪽 보기에서는 절개면 뒤(z ≤ 0)에만
for (const half of [true, false]) {
  const seal = buildCaveSeal(6000, definitions.lavaTube, half);
  assert.ok(seal.positions.every(Number.isFinite) && seal.colors.every(v => v >= 0 && v <= 1));
  assert.ok(seal.shake.every(v => v === 0));
  let front = 0, back = 0;
  for (let i = 0; i < 6000; i++) {
    const [x, y, z] = seal.positions.subarray(i * 3, i * 3 + 3);
    if (half) assert.ok(z <= 0, '반쪽 봉쇄막');
    z < 0 ? front++ : back++;
    const s = caveSection(x, definitions.lavaTube);
    assert.ok(s && y > s.bottom - 0.6 && y < s.top + 0.6, '봉쇄막은 동굴 단면 높이 안');
  }
  if (!half) assert.ok(back > 1000 && front > 1000, '내부 보기에서는 양쪽 반을 다 막는다');
}
assert.equal(SEAL_STATIONS.length, 2);
// 산소 장치 자리: 지대마다 맞는 빈 자리를 찾고, 그 자리를 막으면 겹치지 않는 다른 자리로 옮긴다
const device = { r: 0.6, h: 1.2 };
for (const [letter, site] of Object.entries(siteOf)) for (const id of Object.keys(layers.overlay)) {
  const preferred = overlaySpot(site, id), spot = findSpot(site, preferred, device);
  assert.ok(fitsAt(site, spot[0], spot[2], device, new Map()), `${letter} ${id} 는 지형과 겹치지 않는 자리를 찾는다`);
  const block = new Float32Array(300);
  for (let i = 0; i < 100; i++) block.set([spot[0] + (i % 10 - 4.5) * 0.12, spot[1] + 0.3, spot[2] + (Math.floor(i / 10) - 4.5) * 0.12], i * 3);
  const moved = findSpot(site, preferred, device, occupancy(block));
  assert.ok(Math.hypot(moved[0] - spot[0], moved[2] - spot[2]) > device.r + 0.5, `${letter} ${id} 는 모듈과 겹치면 옮긴다`);
  if (letter === 'B') {
    assert.ok(moved[2] < -device.r, '동굴 장치는 절개면 뒤');
    assert.ok(PILLAR_SPOTS.every(([px, pz]) => Math.hypot(moved[0] - px, moved[2] - pz) > device.r + 0.5), '기둥을 피한다');
  }
}
console.log('PASS: three steps, requires, reset on change, layer and model files, ground placement, cave seal shape, device spots clear of modules and terrain.');
