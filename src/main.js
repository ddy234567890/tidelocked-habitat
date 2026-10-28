import * as THREE from 'three';
import { createPointMaterial, addPointAttributes } from './engine/pointMaterial.js';
import { sampleModel, sampleObject } from './engine/sampleModel.js';
import { createMorph } from './engine/morph.js';
import { toneColors, scanify } from './engine/palette.js';

// 데모 장면: 모프 전환(e03) + 색 규칙 확인용. 엔진 카드(e01~e07)가 끝나면 composer로 교체한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// 모든 모양을 같은 점 개수로 맞춰야 모프할 수 있다 (직접 만든 도형은 scanify 로 3배가 된다)
const count = 30000;
const starDir = new THREE.Vector3(1, 0.3, 0.2).normalize(); // 별은 고정
const under = (y) => THREE.MathUtils.smoothstep(-y, 0.35, 0.9); // 데모: y < -0.35 아래를 땅속으로

// 시험용 원래 색: 별을 향한 쪽이 밝은 회색 (실제 모델은 sampleModel 의 colors 로 받는다)
function litColors(positions) {
  const colors = new Float32Array(positions.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    const l = 0.15 + 0.85 * Math.max(0, v.fromArray(positions, i).normalize().dot(starDir));
    colors.fill(l, i, i + 3);
  }
  return colors;
}

function madeShape(geometry) {
  const positions = sampleObject(new THREE.Mesh(geometry), count / 3);
  return scanify(positions, toneColors(positions, litColors(positions), { under }));
}

async function modelShape(url) {
  const positions = centered(await sampleModel(url, count));
  return { positions, colors: toneColors(positions, litColors(positions), { under }) };
}

function centered(positions) {
  const box = new THREE.Box3().setFromArray(positions);
  const c = box.getCenter(new THREE.Vector3());
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= c.x;
    positions[i + 1] -= c.y;
    positions[i + 2] -= c.z;
  }
  return positions;
}

const shapes = {
  sphere: madeShape(new THREE.SphereGeometry(1, 64, 32)),
  box: madeShape(new THREE.BoxGeometry(1.5, 1.5, 1.5)),
  cylinder: madeShape(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 64)),
  habitat: await modelShape('/models/test-habitat.glb'),
};

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(shapes.sphere.positions.slice(), 3));
addPointAttributes(geometry, { color: shapes.sphere.colors.slice() });

const material = createPointMaterial({ size: 12, reveal: 0, focus: 5 });
const points = new THREE.Points(geometry, material);
scene.add(points);

const morph = createMorph(points);
const buttons = document.querySelectorAll('#demo-ui button');
buttons.forEach((button) => {
  button.addEventListener('click', () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    const next = shapes[button.dataset.shape];
    morph.to(next.positions, { color: next.colors });
  });
});

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

  // 모양과 별은 고정, 카메라만 천천히 돈다
  camera.position.set(Math.sin(t * 0.15) * 5, 1.8, Math.cos(t * 0.15) * 5);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});
