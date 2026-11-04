import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { choiceData, availableChoices, choose, resolve, placeAt, overlaySpot, floorAt, STEP_IDS, findSpot, fitsAt, occupancy, WEEKS, ALL_STEPS, textsFor } from '../src/choices.js';
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
const assets = [...Object.values(layers.module).flatMap(l => l.parts), ...Object.values(layers.overlay).flatMap(l => l.parts ?? [l])].map(p => p.asset).filter(Boolean);
for (const asset of new Set(assets)) {
  assert.ok(existsSync(new URL(`../src/models/${asset}.glb`, import.meta.url)), `모델 파일 ${asset}.glb`);
  assert.ok(placement.includes(`'./models/${asset}.glb'`), `placement.js 가 ${asset}.glb 를 불러온다`);
}

// 주차가 이어진다: 뒤 주차 선지도 레이어가 있고, 앞 주차 선택이 지워지지 않으며, 장치가 쌓이고, 앞 주차 선택에 따라 문구가 달라진다
assert.equal(new Set(ALL_STEPS.map(step => step.id)).size, ALL_STEPS.length, '단계 id 는 주차를 넘어서도 겹치지 않는다');
for (const week of WEEKS.slice(1)) for (const step of week.steps) {
  assert.ok(step.short, `${step.id} 결정 버튼 이름`);
  for (const choice of step.choices) {
    assert.ok(choice.label && choice.line && choice.gain && choice.cost, `${choice.id} 카드 글`);
    for (const id of choice.overlays ?? []) assert.ok(layers.overlay[id], `오버레이 레이어 ${id}`);
  }
}
{
  let picked = { location: 'B', module: 'B2', oxygen: 'O1' };
  picked = choose(picked, 'power', 'P1');
  picked = choose(picked, 'storage', 'S1');
  assert.deepEqual(resolve(picked).overlays, ['big_machine', 'solar_field', 'battery_main']);
  assert.equal(resolve(picked).module, resolve({ location: 'B', module: 'B2' }).module);
  assert.equal(picked.oxygen, 'O1');
  assert.equal(choose(picked, 'power', 'P2').storage, undefined, '앞 단계를 바꾸면 뒤 단계 선택은 지운다');
  const panel = ALL_STEPS.find(step => step.id === 'power').choices.find(choice => choice.id === 'P1');
  assert.equal(textsFor(panel.extra, picked).length, 1, '동굴이면 전선 문장이 붙는다');
  assert.equal(textsFor(panel.extra, { location: 'A' }).length, 0, '평원이면 붙지 않는다');
  assert.ok(layers.overlay.solar_field.outside.B, '동굴에서는 태양광을 굴 밖에 둔다');
  assert.ok(layers.overlay.radiator.parts.every(part => part.box), '방열판은 모델 없이 상자로 그린다');
  const situation = WEEKS[1].situation;
  assert.equal(textsFor(situation, picked).length, 2);
  assert.equal(textsFor(situation, { location: 'C', module: 'C2' }).length, 2);
}

// 플레이테스트 1주차 갈래: 위치 3개 → 위치마다 짓는 방식 2개 → 공기 방식 3개(모든 위치 공통)
// 앞 단계를 고르면 다음 단계 선지가 열리고, 앞 단계를 바꾸면 뒤 단계 선택은 지운다
assert.deepEqual(availableChoices('location', {}).map(c => c.id), ['A', 'B', 'C']);
for (const [letter, ids] of Object.entries({ A: ['A1', 'A2'], B: ['B1', 'B2'], C: ['C1', 'C2'] })) {
  assert.deepEqual(availableChoices('module', { location: letter }).map(c => c.id), ids);
  for (const id of ids) assert.deepEqual(availableChoices('oxygen', { location: letter, module: id }).map(c => c.id), ['O1', 'O2', 'O3']);
}
for (const step of choiceData.steps) for (const choice of step.choices) assert.ok(choice.label && choice.line, `${choice.id} 이름과 한 줄 설명`);
// 선지 카드 글: 이름·한 줄 설명·얻는 것·감수할 것이 모두 있고, 카드에 들어갈 만큼 짧다. 말투는 해요체로 맞춘다
for (const step of choiceData.steps) {
  assert.ok(step.label.endsWith('주세요'), `${step.id} 단계 질문은 '~골라 주세요'로 끝난다`);
  for (const choice of step.choices) {
    assert.ok(choice.gain && choice.cost, `${choice.id} 얻는 것과 감수할 것`);
    assert.ok(choice.label.length <= 12, `${choice.id} 이름은 12자 이하`);
    assert.ok(choice.line.length <= 36 && choice.line.endsWith('요.'), `${choice.id} 한 줄 설명은 36자 이하, 해요체`);
    for (const text of [choice.gain, choice.cost]) assert.ok(text.length <= 28, `${choice.id} '${text}' 는 28자 이하`);
  }
}
// 화면 칸에 채우는 값: 모르는 값은 지어내지 않고 null
const hud = JSON.parse(readFileSync(new URL('../src/hud.json', import.meta.url)));
assert.ok(hud.temperature.night < hud.temperature.day, '밤 최저 < 낮 최고');
for (const site of Object.keys(definitions)) if (site !== 'planet' && hud.sites[site]) assert.ok(hud.sites[site].temperature[0] <= hud.sites[site].temperature[1], `${site} 기온 범위`);
assert.ok(hud.oxygen === null || typeof hud.oxygen === 'number');
let selection = choose({}, 'location', 'C');
selection = choose(selection, 'module', 'C2');
selection = choose(selection, 'oxygen', 'O3');
assert.deepEqual(resolve(selection), { module: 'scattered', overlays: ['small_units'] });
assert.deepEqual(choose(selection, 'location', 'A'), { location: 'A' }, '지대를 바꾸면 거주·산소 선택을 지운다');
assert.deepEqual(choose(selection, 'module', 'C1'), { location: 'C', module: 'C1' });

// 모든 자리는 그 지대의 바닥 위에 놓인다. B 는 동굴 안, C 탑은 정상 띠 안
const siteOf = Object.fromEntries(Object.entries(choiceData.sites).map(([site, letter]) => [letter, site]));
const moduleSite = { tent_deploy: 'A', soil_cover: 'A', cave_entrance: 'B', cave_deep: 'B', terrace: 'C', scattered: 'C' };
assert.deepEqual(Object.keys(layers.module).sort(), Object.keys(moduleSite).sort());
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
for (const part of layers.module.terrace.parts.filter(p => p.position[0] === 0)) {
  const [x, y, z] = placeAt('ridge', part.position, part.crest);
  assert.ok(Math.abs(ridgeFrame(x, z).u) <= 0.45 && y === 0, '계단식 동네의 맨 윗집은 굽은 정상 띠 위');
}
// 집(home)이 있어야 O-3 이 집마다 장치를 둔다
for (const id of Object.keys(moduleSite)) assert.ok(layers.module[id].parts.some(p => p.home), `${id} 에 집이 있다`);
assert.ok(layers.overlay.small_units.perHome, 'O-3 은 집마다 둔다');
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
console.log('PASS: playtest week-1 branches (3 sites, 2 builds each, 3 air), requires, reset on change, layer and model files, ground placement, homes, cave seal shape, device spots clear of modules and terrain.');
