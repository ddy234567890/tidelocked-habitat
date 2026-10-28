import * as THREE from 'three';
import { createPointMaterial, addPointAttributes, TEMP_MIN, TEMP_MAX } from './engine/pointMaterial.js';
import { sampleModel, sampleObject } from './engine/sampleModel.js';
import { createMorph } from './engine/morph.js';

// 데모 장면: 모프 전환(e03) 확인용. 엔진 카드(e01~e07)가 끝나면 composer로 교체한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// 모든 모양을 같은 점 개수로 뽑아야 모프할 수 있다
const count = 30000;
const shapes = {
  sphere: sampleObject(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32)), count),
  box: sampleObject(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5)), count),
  cylinder: sampleObject(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 64)), count),
  habitat: centered(await sampleModel('/models/test-habitat.glb', count)),
};

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

// 별은 +x 방향에 고정: 별 쪽일수록 뜨겁다
function temperatureOf(positions) {
  const temps = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = THREE.MathUtils.smoothstep(positions[i * 3], -1, 1);
    temps[i] = THREE.MathUtils.lerp(TEMP_MIN, TEMP_MAX, t);
  }
  return temps;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(shapes.sphere.slice(), 3));
addPointAttributes(geometry, { temperature: temperatureOf(shapes.sphere) });

const material = createPointMaterial({ size: 5, reveal: 0 });
const points = new THREE.Points(geometry, material);
scene.add(points);

const morph = createMorph(points);
const buttons = document.querySelectorAll('#demo-ui button');
buttons.forEach((button) => {
  button.addEventListener('click', () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    const next = shapes[button.dataset.shape];
    morph.to(next, { temperature: temperatureOf(next) });
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
