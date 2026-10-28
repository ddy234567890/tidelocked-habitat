import * as THREE from 'three';
import { createPointMaterial, addPointAttributes, TEMP_MIN, TEMP_MAX } from './engine/pointMaterial.js';
import { sampleModel } from './engine/sampleModel.js';

// 데모 장면: .glb → 포인트 클라우드 변환기(e02) 확인용. 엔진 카드(e01~e07)가 끝나면 composer로 교체한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// 시험용 주거 모델 표면에서 점 3만 개를 뽑는다. 별은 +x 방향에 고정, 별 쪽 벽일수록 뜨겁다
const count = 30000;
const positions = await sampleModel('/models/test-habitat.glb', count);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.computeBoundingBox();
const { min, max } = geometry.boundingBox;
const temperature = new Float32Array(count);
for (let i = 0; i < count; i++) {
  const t = (positions[i * 3] - min.x) / (max.x - min.x);
  temperature[i] = THREE.MathUtils.lerp(TEMP_MIN, TEMP_MAX, t);
}
addPointAttributes(geometry, { temperature });
geometry.center();

const halfHeight = (max.y - min.y) / 2;
const material = createPointMaterial({ size: 5, reveal: 0, revealMin: -halfHeight, revealMax: halfHeight });
const points = new THREE.Points(geometry, material);
scene.add(points);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const revealSeconds = 2.5;
const start = performance.now();
renderer.setAnimationLoop(() => {
  const t = (performance.now() - start) / 1000;
  material.uniforms.uTime.value = t;
  material.uniforms.uReveal.value = Math.min(t / revealSeconds, 1);

  // 모델과 별은 고정, 카메라만 천천히 돈다
  camera.position.set(Math.sin(t * 0.15) * 4, 1.6, Math.cos(t * 0.15) * 4);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});
