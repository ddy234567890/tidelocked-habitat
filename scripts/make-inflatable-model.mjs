// 팽창식 모듈 .glb 만들기: 공기를 넣어 부풀린 집처럼 보이도록 코드로 만든 도형.
//   - 돔은 공기 칸마다 볼록하게 부풀어 있고(칸 사이 이음매는 안으로 들어감), 바닥에는 공기 튜브 링이 둘러 있다
//   - 돔 사이 통로는 마디마다 볼록한 공기 튜브 모양
//   - 칸 사이 이음매와 통로 마디는 밝게 칠해 둔다 (정점 색. toneColors 가 밝기만 써서 이음매가 밝은 선으로 보인다)
// 외부 에셋이 아니라 직접 만든 도형이라 출처·라이선스 기록이 필요 없다.
// 다른 모델처럼 바닥 가운데를 원점에, 가장 긴 변을 1로 맞춰 저장한다.
// 실행: npm run make:inflatable  →  public/models/inflatable.glb
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { fileURLToPath } from 'node:url';

const TAU = Math.PI * 2;

/** 공기 칸마다 볼록한 반구 돔 */
function lobedDome(radius, lobes = 10, bulge = 0.16) {
  const g = new THREE.SphereGeometry(radius, 96, 28, 0, TAU, 0, Math.PI / 2);
  const p = g.getAttribute('position');
  const color = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const az = Math.atan2(v.z, v.x) + Math.PI; // 0~2π
    const side = Math.sqrt(Math.max(0, 1 - (v.y / radius) ** 2)); // 꼭대기는 0, 바닥 둘레는 1
    const cell = Math.sin(Math.PI * ((az * lobes) / TAU % 1)); // 칸 가운데 1, 이음매 0
    v.multiplyScalar(1 + bulge * Math.pow(cell, 0.6) * side);
    p.setXYZ(i, v.x, v.y, v.z);
    color.fill(cell < 0.22 && side > 0.15 ? 1 : 0.45, i * 3, i * 3 + 3); // 이음매는 밝게
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}

/** 돔 바닥을 두르는 공기 튜브 링 */
function baseRing(radius, tube) {
  const g = new THREE.TorusGeometry(radius, tube, 18, 120);
  g.rotateX(Math.PI / 2);
  g.translate(0, tube, 0);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(0.8), 3));
  return g;
}

/** 마디마다 볼록한 공기 튜브 통로 (x 방향으로 누움) */
function segmentedTunnel(length, radius, segments) {
  const g = new THREE.CylinderGeometry(radius, radius, length, 40, segments * 12, true);
  const p = g.getAttribute('position');
  const color = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / length + 0.5;
    const swell = Math.abs(Math.sin(Math.PI * segments * t));
    const f = 1 + 0.3 * swell;
    p.setXYZ(i, p.getX(i) * f, y, p.getZ(i) * f);
    color.fill(swell < 0.25 ? 1 : 0.45, i * 3, i * 3 + 3); // 마디(잘록한 곳)는 밝게
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.rotateZ(Math.PI / 2);
  return g;
}

// 배치: 큰 돔 하나 + 양옆 작은 돔 두 개, 사이를 공기 튜브 통로로 잇는다
const shapes = [
  { name: 'dome-main', geometry: lobedDome(0.6, 12), at: [0, 0, 0] },
  { name: 'ring-main', geometry: baseRing(0.62, 0.07), at: [0, 0, 0] },
  { name: 'tunnel-right', geometry: segmentedTunnel(0.55, 0.15, 4), at: [0.88, 0.17, 0] },
  { name: 'dome-right', geometry: lobedDome(0.36, 9), at: [1.45, 0, 0] },
  { name: 'ring-right', geometry: baseRing(0.38, 0.05), at: [1.45, 0, 0] },
  { name: 'tunnel-left', geometry: segmentedTunnel(0.4, 0.13, 3), at: [-0.8, 0.15, 0.15] },
  { name: 'dome-left', geometry: lobedDome(0.3, 8), at: [-1.25, 0, 0.3] },
  { name: 'ring-left', geometry: baseRing(0.32, 0.045), at: [-1.25, 0, 0.3] },
];

// 전체 크기를 재서 바닥 가운데를 원점, 가장 긴 변을 1로
const bounds = new THREE.Box3();
for (const s of shapes) {
  s.geometry.computeBoundingBox();
  bounds.union(s.geometry.boundingBox.clone().translate(new THREE.Vector3(...s.at)));
}
const size = bounds.getSize(new THREE.Vector3());
const k = 1 / Math.max(size.x, size.y, size.z);
const cx = (bounds.min.x + bounds.max.x) / 2;
const cz = (bounds.min.z + bounds.max.z) / 2;

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('inflatable');
for (const s of shapes) {
  const g = s.geometry;
  g.translate(s.at[0] - cx, s.at[1] - bounds.min.y, s.at[2] - cz).scale(k, k, k);
  const position = doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.getAttribute('position').array)).setBuffer(buffer);
  const indices = doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(g.index.array)).setBuffer(buffer);
  const color = doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.getAttribute('color').array)).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('COLOR_0', color).setIndices(indices);
  const mesh = doc.createMesh(s.name).addPrimitive(prim);
  scene.addChild(doc.createNode(s.name).setMesh(mesh));
}

const out = fileURLToPath(new URL('../public/models/inflatable.glb', import.meta.url));
await new NodeIO().write(out, doc);
console.log(`public/models/inflatable.glb (원래 크기 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)})`);
