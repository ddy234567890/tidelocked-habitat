// 뼈대가 있는 모델(SkinnedMesh)을 점으로 그리기 위한 빠른 스키닝.
// 모델 겉면(삼각형)에서 넓이에 고르게 점을 뽑아 두고, 매 화면 뼈대가 움직인 꼭짓점을 typed array 로 직접 계산해
// 각 점을 그 삼각형 세 꼭짓점의 같은 비율 자리로 옮긴다. three.js 의 getVertexPosition 보다 훨씬 빨라서 사람 여러 명을 촘촘한 점으로 그릴 수 있다.
// 무작위는 mulberry32 (Math.random 금지). three.js 만 쓰고 화면(DOM)은 쓰지 않아 node 에서도 검사할 수 있다 (tests/people.test.js).
import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

const skinnedMeshes = root => { const list = []; root.traverse(o => { if (o.isSkinnedMesh) list.push(o); }); return list; };

/** 모델에서 점 자리(삼각형 + 비율)를 고른다. samples = 한 사람의 점 수 */
export function prepareRig(scene, { samples = 4000, seed = 5150 } = {}) {
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3(), meshes = [], tris = [];
  skinnedMeshes(scene).forEach((m, mi) => {
    const g = m.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    // 면마다 따로 있는 같은 꼭짓점은 하나로 묶는다 (스키닝 계산을 줄인다)
    const ids = new Map(), map = new Uint32Array(pos.count), uPos = [], uIdx = [], uW = [], rest = [];
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)},${si.getX(i)},${si.getY(i)}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = uPos.length / 3; ids.set(key, id);
        uPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        uIdx.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i));
        uW.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); rest.push(v.x, v.y, v.z);
      }
      map[i] = id;
    }
    meshes.push({ count: uPos.length / 3, pos: Float32Array.from(uPos), idx: Uint16Array.from(uIdx), w: Float32Array.from(uW), rest: Float32Array.from(rest) });
    const index = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    for (let t = 0; t < index.length; t += 3) tris.push([mi, map[index[t]], map[index[t + 1]], map[index[t + 2]]]);
  });
  // 삼각형 넓이 (처음 자세 기준) → 넓이에 비례해 점을 뽑는다
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const at = (mi, id, out) => out.fromArray(meshes[mi].rest, id * 3);
  const areas = tris.map(([mi, i, j, k]) => { at(mi, i, a); at(mi, j, b); at(mi, k, c); return n.subVectors(b, a).cross(c.sub(a)).length() / 2; });
  const total = areas.reduce((s, x) => s + x, 0), cum = new Float64Array(areas.length);
  areas.reduce((s, x, i) => (cum[i] = s + x), 0);
  const rand = mulberry32(seed);
  const sMesh = new Uint8Array(samples), sIds = new Uint32Array(samples * 3), sBary = new Float32Array(samples * 3), restY = new Float32Array(samples), normalY = new Float32Array(samples);
  for (let s = 0; s < samples; s++) {
    const r = rand() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const [mi, i, j, k] = tris[lo];
    const r1 = Math.sqrt(rand()), r2 = rand(), u = 1 - r1, w = r1 * r2, vv = r1 * (1 - r2);
    sMesh[s] = mi; sIds.set([i, j, k], s * 3); sBary.set([u, vv, w], s * 3);
    at(mi, i, a); at(mi, j, b); at(mi, k, c);
    restY[s] = a.y * u + b.y * vv + c.y * w;
    normalY[s] = n.subVectors(b, a).cross(c.clone().sub(a)).normalize().y;
  }
  let bottom = Infinity, top = -Infinity;
  for (const y of restY) { bottom = Math.min(bottom, y); top = Math.max(top, y); }
  return { meshes, samples, sMesh, sIds, sBary, restY, normalY, bottom, height: top - bottom };
}

/** rig(모델 복제본)의 지금 자세로 점 위치를 out(Float32Array, samples×3)에 채우는 함수를 만든다 */
export function createSkinner(rig, prep) {
  const list = skinnedMeshes(rig);
  const skinned = prep.meshes.map(m => new Float32Array(m.count * 3));
  const mats = list.map(m => new Float32Array(m.skeleton.bones.length * 16));
  const t = new THREE.Matrix4(), pre = new THREE.Matrix4();
  return function skin(out) {
    rig.updateMatrixWorld(true);
    list.forEach((m, mi) => {
      // 뼈마다: (모델 자리) × 뼈 지금 자리 × 뼈 처음 자리의 역 × 묶을 때 자리
      pre.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
      const bones = m.skeleton.bones, inv = m.skeleton.boneInverses, M = mats[mi];
      for (let j = 0; j < bones.length; j++) {
        t.multiplyMatrices(bones[j].matrixWorld, inv[j]).premultiply(pre).multiply(m.bindMatrix);
        M.set(t.elements, j * 16);
      }
      const { count, pos, idx, w } = prep.meshes[mi], dst = skinned[mi];
      for (let i = 0; i < count; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        let ox = 0, oy = 0, oz = 0;
        for (let k = 0; k < 4; k++) {
          const wt = w[i * 4 + k];
          if (!wt) continue;
          const e = idx[i * 4 + k] * 16;
          ox += wt * (M[e] * x + M[e + 4] * y + M[e + 8] * z + M[e + 12]);
          oy += wt * (M[e + 1] * x + M[e + 5] * y + M[e + 9] * z + M[e + 13]);
          oz += wt * (M[e + 2] * x + M[e + 6] * y + M[e + 10] * z + M[e + 14]);
        }
        dst[i * 3] = ox; dst[i * 3 + 1] = oy; dst[i * 3 + 2] = oz;
      }
    });
    const { samples, sMesh, sIds, sBary } = prep;
    for (let s = 0; s < samples; s++) {
      const src = skinned[sMesh[s]], a = sIds[s * 3] * 3, b = sIds[s * 3 + 1] * 3, c = sIds[s * 3 + 2] * 3;
      const u = sBary[s * 3], v = sBary[s * 3 + 1], w = sBary[s * 3 + 2];
      out[s * 3] = src[a] * u + src[b] * v + src[c] * w;
      out[s * 3 + 1] = src[a + 1] * u + src[b + 1] * v + src[c + 1] * w;
      out[s * 3 + 2] = src[a + 2] * u + src[b + 2] * v + src[c + 2] * w;
    }
    return out;
  };
}
