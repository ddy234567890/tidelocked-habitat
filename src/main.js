import * as THREE from 'three';

// 빈 장면: 엔진 카드(e01~e07)가 끝나면 composer로 교체한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 1.5, 5);
camera.lookAt(0, 0, 0);

// 자리표시용 점 구: 점 렌더링이 되는지만 확인
const count = 20000;
const positions = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
  const v = new THREE.Vector3().randomDirection();
  positions.set([v.x, v.y, v.z], i * 3);
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x6f8cff, size: 0.012 }));
scene.add(points);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((t) => {
  points.rotation.y = t * 0.0001;
  renderer.render(scene, camera);
});
