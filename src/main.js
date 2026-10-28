import * as THREE from 'three';
import { createCameraRig } from './engine/cameraRig.js';
import { createComposer } from './engine/composer.js';
import { createFlow } from './engine/flow.js';
import week1 from './data/choices/week1.json';

// 데모 장면: 레이어 조합기(e05) + 파티클 흐름(e06) 확인용. 1주차 선지를 버튼으로 골라 장면을 조합한다.
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

// 흐름 시험: 오버레이 자리에서 주거 쪽으로 산소가 흐르는 관. 버튼으로 중간을 끊는다
const flow = createFlow({ path: [[1.6, 0.25, 0.9], [1.4, 1.1, 0.6], [0.6, 1.3, 0.2], [0, 0.6, 0]], count: 700 });
scene.add(flow.points);
const breakButton = document.getElementById('break-flow');
breakButton.addEventListener('click', () => {
  flow.setBroken(flow.broken === null ? 0.5 : null);
  breakButton.setAttribute('aria-pressed', String(flow.broken !== null));
  breakButton.textContent = flow.broken === null ? '관 끊기' : '관 잇기';
});

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
  const seconds = (performance.now() - start) / 1000;
  composer.update(seconds);
  flow.update(seconds);
  rig.update();
  renderer.render(scene, camera);
});
