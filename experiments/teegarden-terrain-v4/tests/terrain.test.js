import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildPlain, plainSurface } from '../src/plain.js';
import { buildRidge, ridgeProfile, ridgeSurface, ridgeFrame, ridgeCrest, SPUR } from '../src/ridge.js';
import { buildLavaTube, tubeFrame, tubeWall, tubeBackWall, caveSection, CAVE_PARTS } from '../src/lavaTube.js';
import { buildPlanet, planetRadius } from '../src/planet.js';
import { starDirection, EXTENT } from '../src/terrain.js';
import { buildSurroundings, SURROUND_COUNT } from '../src/surroundings.js';
const definitions = JSON.parse(readFileSync(new URL('../src/sites.json', import.meta.url)));
const builders = { plain: buildPlain, lavaTube: buildLavaTube, ridge: buildRidge };
const results = [];
for (const [name, build] of Object.entries(builders)) {
  const def = definitions[name], serialized = JSON.stringify(def), times = [];
  let first;
  for (let run = 0; run < 4; run++) {
    const start = performance.now(), data = build(30000, def);
    times.push(performance.now() - start);
    assert.equal(data.positions.length, 90000);
    assert.equal(data.colors.length, 90000);
    assert.equal(data.shake.length, 30000);
    assert.ok(data.positions.every(Number.isFinite));
    assert.ok(data.colors.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
    if (first) {
      assert.deepEqual(data.positions, first.positions);
      assert.deepEqual(data.colors, first.colors);
      assert.deepEqual(data.shake, first.shake);
    } else first = data;
  }
  assert.equal(JSON.stringify(def), serialized, '입력 정의를 변경하지 않는다');
  assert.notDeepEqual(build(30000, { ...def, seed: def.seed + 1 }).positions, first.positions);
  for (const relief of [0, 2]) for (const rocks of [0, 2]) {
    const data = build(30000, { ...def, relief, rocks });
    assert.equal(data.positions.length, 90000);
    assert.ok(data.positions.every(Number.isFinite));
    for (let i = 0; i < 30000; i++) {
      const [x, y, z] = data.positions.subarray(i * 3, i * 3 + 3);
      if (name === 'plain' && Math.hypot(x, z) < 1.65) assert.equal(y, 0, '주거지 높이');
      if (name === 'ridge' && Math.abs(ridgeFrame(x, z).u) <= 0.45) assert.equal(y, 0, '정상 띠 높이 (굽은 마루를 따라)');
      if (name === 'lavaTube') assert.ok(z <= 0.00001, '반쪽 튜브 절단면');
    }
  }
  if (name === 'lavaTube') {
    for (let i = 30000 * CAVE_PARTS.surface; i < 30000 * CAVE_PARTS.cut; i++) {
      assert.equal(first.positions[i * 3 + 2], 0);
      const y = first.positions[i * 3 + 1];
      const s = caveSection(first.positions[i * 3], def);
      assert.ok(!s || y <= s.bottom + 0.00001 || y >= s.top - 0.00001, '절개면의 동굴은 비어 있어야 한다');
    }
    assert.ok(first.shake.every(v => v === 0), '무너질 위험의 떨림 표시는 쓰지 않는다');
    for (let i = 30000 * CAVE_PARTS.cut; i < 30000; i++) {
      const [r, g, b] = first.colors.subarray(i * 3, i * 3 + 3);
      assert.ok(!(r > g && g > b && r - b > 0.3), '동굴 벽·바위·기둥에 주황 점이 없다');
    }
  }
  results.push({ site: name, coldMs: +times[0].toFixed(1), warmMedianMs: +times.slice(1).sort((a, b) => a - b)[1].toFixed(1) });
}
assert.equal(plainSurface(definitions.plain)(0, 0), 0);
for (const u of [-0.45, 0, 0.45]) {
  assert.equal(ridgeProfile(u), 0);
  for (const z of [-9, 0, 4, 9]) assert.ok(Math.abs(ridgeSurface(ridgeCrest(z) + u, z, definitions.ridge)) < 1e-9, '굽은 마루의 정상 띠 높이');
}
assert.equal(ridgeCrest(0), 0, '주거 띠 가운데의 마루 위치');
const crest = Array.from({length:23}, (_, i) => ridgeCrest(i - 11));
assert.ok(Math.max(...crest) - Math.min(...crest) > 2, '능선 마루가 길이 방향으로 굽이친다');
for (const step of [5, 8, 12]) {
  const u = SPUR.u + SPUR.dir[0] * step, v = SPUR.v + SPUR.dir[1] * step, flat = { ...definitions.ridge, relief: 0 };
  const on = ridgeSurface(u + ridgeCrest(v), v, flat), side = ridgeSurface(u + SPUR.dir[1] * 3 + ridgeCrest(v - SPUR.dir[0] * 3), v - SPUR.dir[0] * 3, flat);
  assert.ok(on > side + 0.4 && on < 0, '곁가지 능선은 사면보다 솟되 원래 마루보다 낮다');
}
const sun = starDirection(definitions.plain.star);
assert.ok(Math.abs(Math.hypot(sun.x, sun.y, sun.z) - 1) < 1e-12);
for (const file of ['terrain.js', 'plain.js', 'ridge.js', 'lavaTube.js', 'planet.js', 'main.js'])
  assert.ok(!readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').includes('Math.random'));
for (const def of Object.values(definitions)) assert.equal(def.relief, 2);
const globe = buildPlanet(30000);
assert.deepEqual(globe.positions, buildPlanet(30000).positions);
assert.equal(globe.positions.length, 90000);
assert.ok(globe.positions.every(Number.isFinite));
assert.ok(globe.colors.every(v => v >= 0 && v <= 1));
for (let i = 0; i < 30000; i++) {
  const p = globe.positions.subarray(i * 3, i * 3 + 3), r = Math.hypot(...p);
  assert.ok(r > 7 && r < 9, '구형 지형 범위');
}
assert.equal(planetRadius(0, 1, 0), planetRadius(0, 1, 0));
const widths = Array.from({length:41}, (_, i) => tubeFrame(i / 2 - 10).width);
assert.ok(Math.max(...widths) - Math.min(...widths) > 0.3, '동굴 폭의 변화');
const heights = Array.from({length:41}, (_, i) => tubeFrame(i / 2).height);
assert.ok(Math.max(...heights) > Math.min(...heights) * 1.2, '넓은 방과 좁은 목이 번갈아 나온다');
const interior = buildLavaTube(30000, { ...definitions.lavaTube, view: 'interior' });
assert.deepEqual(interior.positions, buildLavaTube(30000, { ...definitions.lavaTube, view: 'interior' }).positions);
assert.equal(interior.positions.length, 90000);
assert.ok(interior.positions.every(Number.isFinite));
assert.ok(interior.positions.some((value, i) => i % 3 === 2 && value > 1), '내부 시점의 반대편 벽');
let asymmetry = 0;
for (let x = -10; x <= 10; x += 0.5) {
  const left = tubeWall(x, Math.PI / 2, definitions.lavaTube), right = tubeBackWall(x, Math.PI / 2, definitions.lavaTube);
  asymmetry += Math.abs(left.z + right.z);
  for (const theta of [0, Math.PI]) {
    const a = tubeWall(x, theta, definitions.lavaTube), b = tubeBackWall(x, theta, definitions.lavaTube);
    assert.ok(Math.abs(a.y - b.y) < 1e-8 && Math.abs(a.z - b.z) < 1e-8, '천장과 바닥의 연결부 유지');
  }
}
assert.ok(asymmetry / 41 > 0.1, '상부에서 보이는 양쪽 벽을 비대칭으로');
for (const x of [-8, 0, 6]) for (const theta of [0, 0.7, 1.9, Math.PI]) {
  const p = tubeWall(x, theta, definitions.lavaTube);
  assert.ok(Number.isFinite(p.y) && p.z <= 0);
}
const ridgeCross = Array.from({length:41}, (_, i) => ridgeSurface(2.8, i / 2 - 10, definitions.ridge));
assert.ok(Math.max(...ridgeCross) - Math.min(...ridgeCross) > 0.5, '길이 방향으로 복제되지 않는 사면');
for (const name of Object.keys(builders)) {
  const half = name === 'lavaTube', around = buildSurroundings(name, definitions[name], half);
  assert.equal(around.positions.length, SURROUND_COUNT * 3);
  assert.deepEqual(around.positions, buildSurroundings(name, definitions[name], half).positions);
  assert.ok(around.positions.every(Number.isFinite));
  assert.ok(around.colors.every(v => v >= 0 && v <= 1));
  let outside = 0;
  for (let i = 0; i < SURROUND_COUNT; i++) {
    const [x, , z] = around.positions.subarray(i * 3, i * 3 + 3);
    if (half) assert.ok(z <= 0, '동굴 주변 지형도 절개면 앞쪽은 비운다');
    if (Math.hypot(x / EXTENT.x, z / EXTENT.z) > 1) outside++;
  }
  assert.ok(outside / SURROUND_COUNT > 0.9, '주변 지형은 지정 지형 바깥에 놓인다');
}
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(!html.includes('type="range"'), '파라미터 슬라이더 제거');
console.table(results);
console.log('PASS: fixed seeds, 30,000 points, finite colors, protected pads, variable cave, ridge variation, planet, relief=2, no sliders.');
