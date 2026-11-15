import assert from 'node:assert/strict';
import { Person, placeOf, envFor, DOWN_AFTER, UP_AFTER, ACT_MET } from '../src/peopleSim.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { prepareRig, createSkinner } from '../src/pointRig.js';
import hud from '../src/hud.json' with { type: 'json' };
import fs from 'node:fs';

const run = (p, env, seconds) => { for (let t = 0; t < seconds; t += 0.1) p.step(env); return p; };

// 집 바닥 반지름 안이면 집 안, 밖이면 바깥
const homes = [{ at: [2, 0, 1], r: 1 }];
assert.equal(placeOf(2.5, 1, homes), 'home');
assert.equal(placeOf(4, 1, homes), 'outside');
assert.equal(placeOf(0, 0, []), 'outside');

// 바깥 공기: 지대 기온 범위 가운데 · 바깥 산소(약 14%)
const plainOut = envFor({ site: 'plain', place: 'outside' });
assert.equal(plainOut.oxygenPct, hud.outsideOxygen);
assert.equal(plainOut.tempC, (hud.sites.plain.temperature[0] + hud.sites.plain.temperature[1]) / 2);
// 집 안: 산소 방식을 결정하기 전에는 바깥 산소, 결정하면 실내 산소 + 선지 stats
assert.equal(envFor({ site: 'plain', place: 'home' }).oxygenPct, hud.outsideOxygen);
assert.equal(envFor({ site: 'plain', place: 'home', stats: { oxygenPct: -1 }, decided: { oxygen: 'O1' } }).oxygenPct, 19.9);

// 평원 바깥(약 60°C)에 오래 있으면 더위로 쓰러진다
const hot = run(new Person(0, 0), plainOut, 20);
assert.equal(hot.status, 'down');
assert.equal(hot.cause, '더위');

// 동굴 바깥(약 28°C, 산소 14%)은 힘들지만 쓰러지지는 않는다
const cave = run(new Person(0, 0), envFor({ site: 'lavaTube', place: 'outside' }), 30);
assert.equal(cave.status, 'tired');

// 산소 방식을 정한 집 안은 괜찮다
const safe = run(new Person(0, 0), envFor({ site: 'plain', place: 'home', decided: { oxygen: 'O1' } }), 30);
assert.equal(safe.status, 'ok');

// 쓰러진 사람도 좋은 환경으로 옮기면 시간이 지나 다시 일어난다
run(hot, envFor({ site: 'plain', place: 'home', decided: { oxygen: 'O1' } }), 40);
assert.notEqual(hot.status, 'down');
assert.ok(DOWN_AFTER > 0 && UP_AFTER > 0);

// 사람 모델: 뼈대가 있고 src/people.js 가 쓰는 동작이 모두 들어 있다
{
  const glb = fs.readFileSync(new URL('../src/models/human.glb', import.meta.url));
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  assert.ok(gltf.skins?.[0]?.joints.length > 20, '뼈대');
  const names = gltf.animations.map(a => a.name), code = fs.readFileSync(new URL('../src/people.js', import.meta.url), 'utf8');
  for (const used of new Set([...code.matchAll(/'([A-Z][A-Za-z]+(?:_[A-Za-z0-9]+)+|Death01|Interact)'/g)].map(m => m[1]))) assert.ok(names.includes(used), '동작 ' + used);
}

// people.js 의 모든 행동에 활동량(MET)이 있다 (없으면 몸 계산이 기본값으로 흐려진다)
{
  const code = fs.readFileSync(new URL('../src/people.js', import.meta.url), 'utf8');
  const names = code.match(/const ACT_NAMES = \{([^}]*)\}/)[1];
  for (const [, act] of names.matchAll(/(\w+):/g)) assert.ok(act in ACT_MET, '활동량 ' + act);
}

// 같은 곳에 여럿을 놓아도 버티는 힘·행동에 따라 쓰러지는 때가 다르다 (뛰면 더 빨리)
{
  const downAt = (fit, met) => { const p = new Person(0, 0, { fit }); for (let t = 0; t < 30; t += 0.1) if (p.step(envFor({ site: 'plain', place: 'outside', met })) === 'down') return t; return Infinity; };
  const weak = downAt(0.6, ACT_MET.idle), strong = downAt(1.9, ACT_MET.idle), running = downAt(1, ACT_MET.sprint), resting = downAt(1, ACT_MET.rest);
  assert.ok(strong - weak > 2, `버티는 힘에 따라 2초 넘게 차이 (${weak.toFixed(1)} → ${strong.toFixed(1)})`);
  assert.ok(running < resting, '뛰면 더 빨리 쓰러진다');
}

// 점 스키닝: 걷는 자세에서 three.js 계산과 같은 자리 (src/pointRig.js)
{
  const buf = fs.readFileSync(new URL('../src/models/human.glb', import.meta.url));
  const gltf = await new Promise((ok, no) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '', ok, no));
  const prep = prepareRig(gltf.scene, { samples: 500 });
  assert.ok(Math.abs(prep.height - 1.83) < 0.05, '모델 키 약 1.83');
  const rig = clone(gltf.scene), mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(gltf.animations.find(a => a.name === 'Walk_Loop')).play(); mixer.update(0.4);
  const out = createSkinner(rig, prep)(new Float32Array(500 * 3));
  const meshes = []; rig.traverse(o => o.isSkinnedMesh && meshes.push(o));
  const v = new THREE.Vector3();
  for (const s of [0, 99, 321]) {
    const m = meshes[prep.sMesh[s]], pm = prep.meshes[prep.sMesh[s]], acc = new THREE.Vector3(), pos = m.geometry.getAttribute('position');
    for (let k = 0; k < 3; k++) {
      const id = prep.sIds[s * 3 + k];
      let orig = 0; while (Math.hypot(pos.getX(orig) - pm.pos[id * 3], pos.getY(orig) - pm.pos[id * 3 + 1], pos.getZ(orig) - pm.pos[id * 3 + 2]) > 1e-4) orig++;
      acc.addScaledVector(m.getVertexPosition(orig, v).applyMatrix4(m.matrixWorld), prep.sBary[s * 3 + k]);
    }
    assert.ok(acc.distanceTo(new THREE.Vector3().fromArray(out, s * 3)) < 1e-4, '스키닝 점 ' + s);
  }
}

console.log('PASS people: 모델 뼈대·동작, 사람마다 다른 때 쓰러짐, 점 스키닝, 자리별 환경, 더위에 쓰러짐, 동굴은 힘들어함, 집 안은 괜찮음, 회복');
