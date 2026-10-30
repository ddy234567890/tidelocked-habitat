import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildPlain, plainSurface } from '../src/plain.js';
import { buildRidge, ridgeProfile, ridgeSurface } from '../src/ridge.js';
import { buildLavaTube, tubeFrame, tubeWall, tubeBackWall, CAVE_PARTS } from '../src/lavaTube.js';
import { buildPlanet, planetRadius } from '../src/planet.js';
import { starDirection } from '../src/terrain.js';
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
      if (name === 'ridge' && Math.abs(x) <= 0.45) assert.equal(y, 0, '정상 띠 높이');
      if (name === 'lavaTube') assert.ok(z <= 0.00001, '반쪽 튜브 절단면');
    }
  }
  if (name === 'lavaTube') {
    for (let i = 30000 * CAVE_PARTS.surface; i < 30000 * CAVE_PARTS.cut; i++) {
      assert.equal(first.positions[i * 3 + 2], 0);
      const y = first.positions[i * 3 + 1];
      const f = tubeFrame(first.positions[i * 3]);
      const floor = tubeWall(first.positions[i * 3], Math.PI, def).y;
      assert.ok(y <= floor + 0.00001 || y >= f.center + f.height - 0.00001, '절개면의 동굴은 비어 있어야 한다');
    }
  }
  results.push({ site: name, coldMs: +times[0].toFixed(1), warmMedianMs: +times.slice(1).sort((a, b) => a - b)[1].toFixed(1) });
}
assert.equal(plainSurface(definitions.plain)(0, 0), 0);
for (const u of [-0.45, 0, 0.45]) {
  assert.equal(ridgeProfile(u), 0);
  assert.equal(ridgeSurface(u, 4, definitions.ridge), 0);
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
assert.ok(tubeFrame(-3.8).width > tubeFrame(1).width + 1, '넓은 공동과 목 구간의 차이');
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
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(!html.includes('type="range"'), '파라미터 슬라이더 제거');
console.table(results);
console.log('PASS: fixed seeds, 30,000 points, finite colors, protected pads, variable cave, ridge variation, planet, relief=2, no sliders.');
