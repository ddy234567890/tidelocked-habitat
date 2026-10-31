import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PIN_DISK, pinNormalFromImage, siteFrame, surfacePose, poseQuaternion, prepareFlight, flightSample } from '../src/navigation.js';
const definitions = JSON.parse(readFileSync(new URL('../src/sites.json', import.meta.url)));
const camera = new THREE.PerspectiveCamera(43, 820 / 540, 0.01, 200);
camera.position.set(0, 2, 29); camera.lookAt(-3.2, 0, 0); camera.updateMatrixWorld();
const center = new THREE.Vector3().project(camera);
const radius = 8 / Math.sqrt(camera.position.lengthSq() - 64) / Math.tan(43 * Math.PI / 360);
for (const [name, [x, y]] of Object.entries(PIN_DISK)) {
  const pin = pinNormalFromImage(x, y).multiplyScalar(8).project(camera);
  assert.ok(Math.abs((pin.x - center.x) * camera.aspect / radius - x) < 1e-8, name + ' 표시 위치 가로');
  assert.ok(Math.abs((pin.y - center.y) / radius - y) < 1e-8, name + ' 표시 위치 세로');
}
for (const name of Object.keys(definitions)) {
  const site = siteFrame(name, definitions[name]);
  for (const aspect of [0.8, 1.52, 2.25]) {
    const destination = surfacePose(name, site, aspect, false, name === 'lavaTube');
    for (const returning of [false, true]) {
      const from = returning ? destination : { position: camera.position, target: new THREE.Vector3(-3.2, 0, 0), up: camera.up };
      const to = returning ? { position: camera.position, target: new THREE.Vector3(-3.2, 0, 0), up: camera.up } : destination;
      const flight = prepareFlight({
        returning,
        fromPosition: from.position,
        startDirection: from.position.clone().normalize(),
        arc: new THREE.Quaternion().setFromUnitVectors(from.position.clone().normalize(), to.position.clone().normalize()),
        fromRadius: from.position.length(), toRadius: to.position.length(), fromTarget: from.target,
        fromQuaternion: poseQuaternion(from.position, from.target, from.up),
        toQuaternion: poseQuaternion(to.position, to.target, to.up), destination: to
      });
      let previous = flightSample(flight, 0);
      assert.ok(previous.position.distanceTo(from.position) < 1e-10);
      for (let frame = 1; frame <= 180; frame++) {
        const next = flightSample(flight, frame / 180);
        assert.ok([...next.position, ...next.quaternion].every(Number.isFinite));
        assert.ok(Math.abs(next.quaternion.length() - 1) < 1e-9);
        assert.ok(previous.quaternion.angleTo(next.quaternion) < 0.04, name + ' 순간 뒤집힘 없음');
        if (!returning && frame >= 100) {
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(next.quaternion);
          const toSite = to.target.clone().sub(next.position).normalize();
          assert.ok(forward.dot(toSite) > 0.9999, '확대 중 목적지를 화면 중앙에 유지');
        }
        previous = next;
      }
      assert.ok(previous.position.distanceTo(to.position) < 1e-10, '도착 위치 연속');
      assert.ok(previous.quaternion.angleTo(flight.toQuaternion) < 1e-7, '도착 후 조작 카메라 방향 연속');
      assert.ok(flightSample(flight, 0.999).position.distanceTo(to.position) < 0.00001, '끝에서 감속');
    }
  }
}
for (const fromName of Object.keys(definitions)) for (const toName of Object.keys(definitions)) {
  if (fromName === toName) continue;
  const from = surfacePose(fromName, siteFrame(fromName, definitions[fromName]), 1.52, false, fromName === 'lavaTube');
  const to = surfacePose(toName, siteFrame(toName, definitions[toName]), 1.52, false, toName === 'lavaTube');
  const flight = prepareFlight({ kind: 'site', fromPosition: from.position, fromTarget: from.target,
    fromQuaternion: poseQuaternion(from.position, from.target, from.up),
    toQuaternion: poseQuaternion(to.position, to.target, to.up), destination: to });
  let previous = flightSample(flight, 0);
  assert.ok(previous.position.distanceTo(from.position) < 1e-10, '시작할 때 카메라를 순간 이동시키지 않는다');
  for (let i = 1; i <= 180; i++) {
    const next = flightSample(flight, i / 180);
    assert.ok(next.position.length() < 10, '지역 이동 중 궤도 전체 시점으로 멀어지지 않는다');
    assert.ok(next.position.length() > 7.3, '행성 중심을 통과하지 않는다');
    assert.ok(previous.position.distanceTo(next.position) < 0.25, '지역 이동 위치가 연속이다');
    assert.ok(previous.quaternion.angleTo(next.quaternion) < 0.05, '지역 이동 시 회전이 튀지 않는다');
    previous = next;
  }
  assert.ok(previous.position.distanceTo(to.position) < 1e-10);
  assert.ok(previous.quaternion.angleTo(flight.toQuaternion) < 1e-7);
}
console.log('PASS: pin mapping, orbital flights, six continuous local routes, no orbit detour, stable endpoints.');
