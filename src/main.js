import * as THREE from 'three';
import { createPointMaterial, addPointAttributes, TEMP_MIN, TEMP_MAX } from './engine/pointMaterial.js';

// 데모 장면: 공통 포인트 머티리얼(e01) 확인용. 엔진 카드(e01~e07)가 끝나면 composer로 교체한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// 행성 점 구: 별은 +x 방향에 고정 (조석 고정), 낮 쪽 주황 ↔ 밤 쪽 파랑
const starDir = new THREE.Vector3(1, 0, 0);
const count = 50000;
const positions = new Float32Array(count * 3);
const temperature = new Float32Array(count);
const v = new THREE.Vector3();
for (let i = 0; i < count; i++) {
  v.randomDirection();
  positions.set([v.x, v.y, v.z], i * 3);
  // 별을 정면으로 보는 곳이 가장 뜨겁고, 경계를 지나 밤 쪽으로 갈수록 식는다
  const t = THREE.MathUtils.smoothstep(v.dot(starDir), -0.6, 0.6);
  temperature[i] = THREE.MathUtils.lerp(TEMP_MIN, TEMP_MAX, t);
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
addPointAttributes(geometry, { temperature });

const material = createPointMaterial({ size: 6, reveal: 0 });
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
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000;
  material.uniforms.uTime.value = t;
  material.uniforms.uReveal.value = Math.min(t / revealSeconds, 1);

  // 행성과 별은 고정, 카메라만 천천히 돌며 낮·밤 면을 보여 준다
  camera.position.set(Math.sin(t * 0.15) * 4.5, 1.5, Math.cos(t * 0.15) * 4.5);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});
