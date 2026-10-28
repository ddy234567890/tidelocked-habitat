import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

/**
 * .glb → 포인트 클라우드 변환기 (카드 e02)
 *
 * .glb 모델 표면에서 정확히 N개의 점을 뽑아 위치 배열로 돌려준다.
 * 점 개수가 항상 N으로 고정이라, 같은 N으로 뽑은 두 모델은 모프 전환(e03)에 바로 쓸 수 있다.
 *
 * 사용법:
 *   import { sampleModel } from './engine/sampleModel.js';
 *   import { addPointAttributes, createPointMaterial } from './engine/pointMaterial.js';
 *
 *   const positions = await sampleModel('/models/habitat.glb', 30000);
 *   const geometry = new THREE.BufferGeometry();
 *   geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
 *   addPointAttributes(geometry, { temperature });
 *   scene.add(new THREE.Points(geometry, createPointMaterial()));
 *
 * - 메시가 여러 개면 겉넓이 비율대로 점을 나눠 뽑는다 (큰 부분에 점이 더 많이).
 * - 위치는 모델 안의 위치·회전·크기를 모두 적용한 좌표다 (모델 파일 기준, 장면 배치 전).
 * - 같은 경로를 여러 번 불러도 파일은 한 번만 내려받는다.
 */

const loader = new GLTFLoader();
const cache = new Map();

function loadModel(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((gltf) => gltf.scene));
  return cache.get(url);
}

/**
 * @param {string} url    .glb 경로 (예: '/models/habitat.glb')
 * @param {number} count  뽑을 점 개수 N
 * @returns {Promise<Float32Array>} 길이 N*3 의 위치 배열
 */
export async function sampleModel(url, count) {
  const root = await loadModel(url);
  return sampleObject(root, count);
}

/**
 * 이미 불러온 Object3D(메시 묶음)에서 점 N개를 뽑는다. 코드로 만든 도형에도 쓸 수 있다.
 * @param {THREE.Object3D} root
 * @param {number} count
 * @returns {Float32Array}
 */
export function sampleObject(root, count) {
  root.updateWorldMatrix(true, true);

  // 메시마다 월드 좌표 기준 겉넓이를 잰다
  const parts = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry.getAttribute('position')) return;
    const area = surfaceArea(obj.geometry, obj.matrixWorld);
    if (area > 0) parts.push({ mesh: obj, area });
  });
  if (!parts.length) throw new Error('sampleModel: 모델에 표면이 있는 메시가 없어요');

  // 넓이 비율로 나누고, 반올림 때문에 생긴 나머지는 몫이 큰 메시부터 하나씩 더 준다
  const total = parts.reduce((sum, p) => sum + p.area, 0);
  let assigned = 0;
  for (const p of parts) {
    const exact = (p.area / total) * count;
    p.count = Math.floor(exact);
    p.rest = exact - p.count;
    assigned += p.count;
  }
  [...parts].sort((a, b) => b.rest - a.rest).slice(0, count - assigned).forEach((p) => p.count++);

  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  let i = 0;
  for (const { mesh, count: n } of parts) {
    if (!n) continue;
    const sampler = new MeshSurfaceSampler(mesh).build();
    for (let k = 0; k < n; k++, i++) {
      sampler.sample(v);
      v.applyMatrix4(mesh.matrixWorld);
      positions.set([v.x, v.y, v.z], i * 3);
    }
  }
  return positions;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const tri = new THREE.Triangle();

function surfaceArea(geometry, matrix) {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const faces = (index ? index.count : pos.count) / 3;
  let area = 0;
  for (let f = 0; f < faces; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
    b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
    c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
    area += tri.set(a, b, c).getArea();
  }
  return area;
}
