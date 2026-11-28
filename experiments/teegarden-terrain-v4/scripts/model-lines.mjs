// 모델이 점 선 표현에 얼마나 가벼운지 잰다: 삼각형 수와, 실제로 그려지는 모서리 선 수 (placement.js EDGE_ANGLE 14°)
//   node scripts/model-lines.mjs 파일.glb …
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self ??= globalThis;
const loader = new GLTFLoader();
for (const file of process.argv.slice(2)) {
  const b = fs.readFileSync(file);
  try {
    const gltf = await loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    let tris = 0, lines = 0; const box = new THREE.Box3().setFromObject(gltf.scene), s = box.getSize(new THREE.Vector3());
    gltf.scene.traverse(m => { if (!m.isMesh) return; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; lines += new THREE.EdgesGeometry(g, 14).attributes.position.count / 2; });
    console.log(file.split(/[\/]/).pop().padEnd(26), '삼각형', String(Math.round(tris)).padStart(6), ' 선', String(lines).padStart(6), ' 크기', [s.x, s.y, s.z].map(v => v.toFixed(2)).join('×'));
  } catch (e) { console.log(file.split(/[\/]/).pop(), 'ERR', e.message.slice(0, 80)); }
}
