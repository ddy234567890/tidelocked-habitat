import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildStarfield, buildTransitSurface, transitionTiming, assemblyBrightness, SITE_TRAVEL_MS, ORBIT_TRAVEL_MS, ARRIVAL_HOLD_MS, ASSEMBLE_MS } from '../src/effects.js';
const stars = buildStarfield();
assert.deepEqual(stars, buildStarfield());
assert.ok(stars.positions.every(Number.isFinite));
assert.ok(stars.colors.every(v => v >= 0 && v <= 1));
for (const kind of ['site', 'orbit']) {
  const duration = kind === 'site' ? SITE_TRAVEL_MS : ORBIT_TRAVEL_MS;
  for (let time = 0; time < duration; time += 16) {
    const state = transitionTiming(time, kind);
    assert.equal(state.phase, 'travel');
    assert.equal(state.render, 0, '이동 중에는 도착 모델을 그리지 않는다');
  }
  assert.equal(transitionTiming(duration, kind).phase, 'settle');
  assert.equal(transitionTiming(duration + ARRIVAL_HOLD_MS + 1, kind).travel, 1);
  assert.equal(transitionTiming(duration + ARRIVAL_HOLD_MS + ASSEMBLE_MS, kind).phase, 'done');
  assert.equal(transitionTiming(duration + ARRIVAL_HOLD_MS + ASSEMBLE_MS, kind).render, 1);
}
for (const direction of ['in', 'out']) for (const y of [0, 0.2, 0.5, 0.9, 1]) for (const seed of [0, 0.3, 0.9]) {
  assert.equal(assemblyBrightness(y, 0, direction, seed), 0);
  assert.equal(assemblyBrightness(y, 1, direction, seed), 1);
}
assert.equal(assemblyBrightness(0.8, 0.5, 'in', 0.5), 1, '아래부터 구성');
assert.equal(assemblyBrightness(0.2, 0.5, 'in', 0.5), 0);
assert.equal(assemblyBrightness(0.2, 0.5, 'out', 0.5), 1, '위부터 구성');
const a = new THREE.Vector3(-2, 3, 7), b = new THREE.Vector3(-1, -3, 7);
const corridor = buildTransitSurface(a, b);
assert.deepEqual(corridor.positions, buildTransitSurface(a, b).positions);
assert.ok(corridor.positions.every(Number.isFinite));
assert.ok(corridor.colors.every(v => v >= 0 && v <= 1));
console.log('PASS: camera travel before assembly; delayed reveal, final color restoration, fixed background and travel guide.');
