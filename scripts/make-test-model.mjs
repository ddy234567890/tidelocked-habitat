// 시험용 .glb 만들기: 큰 돔 + 통로 + 작은 돔으로 된 간단한 주거 모양.
// 외부 에셋이 아니라 코드로 직접 만든 도형이라 출처·라이선스 기록이 필요 없다.
// 실행: npm run make:test-model  →  public/models/test-habitat.glb
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';

const halfSphere = (r) => new THREE.SphereGeometry(r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const tunnel = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 24, 1, true);
const sideways = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const parts = [
  { name: 'base', geometry: new THREE.CylinderGeometry(0.6, 0.6, 0.3, 48), translation: [0, 0.15, 0] },
  { name: 'dome', geometry: halfSphere(0.6), translation: [0, 0.3, 0] },
  { name: 'tunnel', geometry: tunnel, translation: [0.95, 0.15, 0], rotation: sideways.toArray() },
  { name: 'pod', geometry: halfSphere(0.35), translation: [1.6, 0, 0] },
];

const chunks = [];
let byteLength = 0;
const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };

function addView(typed, target) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
  chunks.push(bytes);
  byteLength += bytes.length;
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
  return json.bufferViews.length - 1;
}

for (const p of parts) {
  const position = Float32Array.from(p.geometry.getAttribute('position').array);
  const index = Uint32Array.from(p.geometry.index.array);
  const box = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position'));

  json.accessors.push({ bufferView: addView(position, 34962), componentType: 5126, count: position.length / 3, type: 'VEC3', min: box.min.toArray(), max: box.max.toArray() });
  const posAccessor = json.accessors.length - 1;
  json.accessors.push({ bufferView: addView(index, 34963), componentType: 5125, count: index.length, type: 'SCALAR' });
  const indexAccessor = json.accessors.length - 1;

  json.meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: posAccessor }, indices: indexAccessor }] });
  json.nodes.push({ name: p.name, mesh: json.meshes.length - 1, translation: p.translation, ...(p.rotation && { rotation: p.rotation }) });
  json.scenes[0].nodes.push(json.nodes.length - 1);
}
json.buffers.push({ byteLength });

const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
const binChunk = Buffer.concat(chunks);

const header = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const glbHeader = Buffer.alloc(12);
glbHeader.writeUInt32LE(0x46546c67, 0);
glbHeader.writeUInt32LE(2, 4);
glbHeader.writeUInt32LE(total, 8);

const out = new URL('../public/models/test-habitat.glb', import.meta.url);
writeFileSync(out, Buffer.concat([glbHeader, header(jsonChunk.length, 0x4e4f534a), jsonChunk, header(binChunk.length, 0x004e4942), binChunk]));
console.log(`public/models/test-habitat.glb (${total} bytes)`);
