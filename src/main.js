import * as THREE from 'three';
import { createCameraRig } from './engine/cameraRig.js';
import { createComposer } from './engine/composer.js';
import week1 from './data/choices/week1.json';

// 데모 장면: 레이어 조합기(e05) 확인용. 1주차 선지를 버튼으로 골라 장면을 조합한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const rig = createCameraRig(camera, canvas);
const composer = createComposer({ scene, rig, data: week1 });

// 선택 상태: { 단계id: 선지id }
const selection = { location: week1.steps[0].choices[0].id };
const ui = document.getElementById('demo-ui');
const statsBox = document.getElementById('stats');

function choose(stepId, choiceId) {
  if (choiceId) selection[stepId] = choiceId;
  else delete selection[stepId];
  // 앞 단계가 바뀌어 더는 고를 수 없게 된 뒤 단계 선택은 지운다
  for (const step of week1.steps) {
    const id = selection[step.id];
    if (id && !composer.availableChoices(step.id, selection).some((c) => c.id === id)) delete selection[step.id];
  }
  render();
}

function render() {
  ui.replaceChildren(
    ...week1.steps.map((step) => {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = step.label;
      row.append(label);
      for (const choice of composer.availableChoices(step.id, selection)) {
        const button = document.createElement('button');
        button.textContent = choice.hidden ? `${choice.label} (히든)` : choice.label;
        button.setAttribute('aria-pressed', String(selection[step.id] === choice.id));
        button.addEventListener('click', () => choose(step.id, selection[step.id] === choice.id ? null : choice.id));
        row.append(button);
      }
      return row;
    }),
  );

  const { stats } = composer.resolve(selection);
  const show = (v, unit) => (v == null ? '미정' : `${v}${unit}`);
  statsBox.textContent = `온도 ${show(stats.temperature, '°C')} · 산소 ${show(stats.oxygen, '%')} · 에너지 ${show(stats.energy, '')}`;

  composer.apply(selection);
}

rig.goTo(week1.steps[0].choices[0].cameraShot, { instant: true });
render();

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const start = performance.now();
renderer.setAnimationLoop(() => {
  composer.update((performance.now() - start) / 1000);
  rig.update();
  renderer.render(scene, camera);
});
