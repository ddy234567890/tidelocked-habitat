import * as THREE from 'three';
import { createCameraRig } from './engine/cameraRig.js';
import { createComposer } from './engine/composer.js';
import { createLabels } from './engine/labels.js';
import week1 from './data/choices/week1.json';

// 데모 장면: 레이어 조합기(e05) + HUD 라벨(e07) 확인용. 흐름(e06)은 JSON 레이어의 flows 로 그려진다. 1주차 선지를 버튼으로 골라 장면을 조합한다.
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const rig = createCameraRig(camera, canvas);
const composer = createComposer({ scene, rig, data: week1 });
const labels = createLabels(camera, canvas);
const siteTag = labels.add({ position: [-1.2, 0, 1.2], text: '', offset: [-50, -40] });
let moduleTag = null;
let oxygenTag = null;

// 선택 상태: { 단계id: 선지id }
const selection = { location: week1.steps[0].choices[0].id };
const ui = document.getElementById('demo-ui');
const statsBox = document.getElementById('stats');

function choose(stepId, choiceId) {
  // 위치는 늘 하나가 골라져 있어야 무대가 있다. 고른 위치를 다시 눌러도 해제하지 않는다
  if (!choiceId && stepId === week1.steps[0].id) return;
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

  // 라벨: 위치 무대에는 SITE 표시, 주거·산소 장치가 있으면 그 위에 두 번째 표시. 자리는 JSON 레이어의 labelAt
  const choiceOf = (stepId) => week1.steps.find((s) => s.id === stepId).choices.find((c) => c.id === selection[stepId]);
  const { layers } = composer.resolve(selection);
  const labelAt = (kind, id, fallback) => week1.layers[kind]?.[id]?.labelAt ?? fallback;
  siteTag.setText(`SITE ${selection.location} · ${choiceOf('location').label}`);
  siteTag.setPosition(labelAt('location', layers.location, [-1.2, 0, 1.2]));
  moduleTag?.remove();
  moduleTag = selection.module
    ? labels.add({ position: labelAt('module', layers.module, [0, 0.9, 0]), text: choiceOf('module').label, variant: 'amber' })
    : null;
  oxygenTag?.remove();
  oxygenTag = selection.oxygen
    ? labels.add({ position: labelAt('overlay', layers.overlays[0], [1.6, 0.4, 0.9]), text: choiceOf('oxygen').label, variant: 'amber', offset: [-50, 40] })
    : null;

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
  const seconds = (performance.now() - start) / 1000;
  composer.update(seconds);
  rig.update();
  labels.update();
  renderer.render(scene, camera);
});
