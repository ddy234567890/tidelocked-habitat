import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import definitions from './sites.json' with { type: 'json' };
import { buildPlain } from './plain.js';
import { buildLavaTube } from './lavaTube.js';
import { buildRidge } from './ridge.js';
import { buildSurroundings, joinPoints } from './surroundings.js';
import { availableChoices, choose, resolve, siteLetter, choiceData, WEEKS, ALL_STEPS, textsFor } from './choices.js';
import hud from './hud.json' with { type: 'json' };
import { openBriefing } from './intro.js';
import { createHexBoard, shortName } from './hexBoard.js';
import { setCrewSite, setCrewStats } from './crew.js';
import { buildModule, buildOverlay, tintLayer, TINT, faceColors } from './placement.js';
import { buildPlanet, PLANET_SUN } from './planet.js';
import { smooth, clamp, mulberry32 } from './terrain.js';
import { orange } from './palette.js';
import { siteFrame, surfacePose, LOCAL_SCALE, poseQuaternion, prepareFlight, flightSample } from './navigation.js';
import { buildStarfield, buildTransitSurface, transitionTiming, assemblyBrightness } from './effects.js';

const POINT_COUNT = 30000;
const POINT_SIZE = 0.075;
const LINE_NEAR = 16; // 에셋 선 점: 카메라가 이 거리(지역 단위)보다 가까우면 점을 거리에 비례해 줄인다
const LINE_BASE = 0.5; // 에셋 선 점은 지형 점의 이 비율로 늘 가늘게 그린다
const LINE_MIN = 0.5; // 가까이에서 더 줄이는 가장 작은 비율. LINE_BASE × LINE_MIN × POINT_SIZE 가 placement.js EDGE_SPACING 의 1.5배보다 커야 선이 끊기지 않는다
const BUILDERS = { plain: buildPlain, lavaTube: buildLavaTube, ridge: buildRidge };
const COPY = {
  plain: { letter: 'A', title: '현무암 평원', text: '낮게 겹친 용암엽과 오래된 충돌 흔적. 중앙의 평탄면을 거주 후보지로 남겼습니다.', tag: '주거 후보지', sub: '중앙 평탄면', position: [0, 0, 0] },
  lavaTube: { letter: 'B', title: '용암동굴', text: '아치 입구에서 내려가 큰 방과 좁은 목이 번갈아 이어지고, 옆 굴이 갈라집니다. 천장에서 떨어진 바위가 큰 방 바닥에 쌓여 있습니다.', tag: '용암 유동 통로', sub: '아치 입구 · 큰 방 · 옆 굴 · 바위 더미', position: [2, -2, -0.5] },
  ridge: { letter: 'C', title: '황혼 능선', text: '굽이치는 마루에서 마른 완사면과 곁가지 능선이 갈라져 내려가고, 반대편은 침식 홈과 퇴적 부채, 얼음 골짜기와 낮은 지맥으로 이어집니다.', tag: '거주 가능한 정상 띠', sub: '', position: [0, 0, 0] }
};
const $ = selector => document.querySelector(selector);
const host = $('#canvas-host'), stage = $('#stage');

// 선지 글은 weeks/week1.json 에서 읽어 카드에 채운다: 이름 · 한 줄 설명 · 얻는 것 · 감수할 것
function fillCard(button, choice, selection = {}) {
  button.querySelector('.name').textContent = choice.label;
  button.querySelector('.line').textContent = [choice.line ?? '', ...textsFor(choice.extra, selection)].join(' ');
  button.querySelector('.effects').replaceChildren(...[['gain', '얻는 것', choice.gain], ['cost', '감수', choice.cost]].filter(row => row[2]).map(([kind, tag, text]) => {
    const item = document.createElement('li'), mark = document.createElement('i');
    item.className = kind; mark.textContent = tag; item.append(mark, text);
    return item;
  }));
}
for (const step of choiceData.steps) {
  const title = step.id === 'location' ? $('#step-location-text') : document.querySelector('#step-' + step.id + ' .step-title span');
  if (title) title.textContent = step.label;
}
for (const choice of choiceData.steps[0].choices) {
  const button = document.querySelector('.site[data-site="' + choice.site + '"]');
  if (button) fillCard(button, choice);
}
$('#hud-year').textContent = 'YEAR ' + hud.year;
$('#fact-day').textContent = hud.temperature.day + '°C'; $('#fact-night').textContent = hud.temperature.night + '°C';
let mode = 'planet', currentSite = null, transition = null, localPoints = null, localSection = false, caveInterior = false;
const cache = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setClearColor(0, 0);
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, host.clientWidth / host.clientHeight, 0.0005, 200);
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.autoRotate = false;
  // 행성·지역·별에 같은 머티리얼 하나만 사용한다. 전환도 좌표와 색 버퍼로 처리한다.
  const material = new THREE.PointsMaterial({ size: POINT_SIZE, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  // 선지 에셋의 선 점(lineWeight 1)은 카메라에 가까울수록 원근만큼 커지지 않게 줄여, 다가가면 선이 가늘고 또렷해진다.
  // 같은 머티리얼에 attribute 하나와 uniform 두 개만 더한다. 지형·별(lineWeight 0)은 그대로다
  // 선 점은 서로 겹쳐 그려져 더하기 블렌딩으로 밝아지므로, 점이 작아진 만큼만 밝게 해 멀리서나 가까이서나 같은 밝기로 보이게 한다
  const lineUniforms = { uLineNear: { value: LINE_NEAR * LOCAL_SCALE }, uLineMin: { value: LINE_MIN }, uLineBase: { value: LINE_BASE } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lineUniforms);
    shader.vertexShader = 'attribute float lineWeight;\nuniform float uLineNear;\nuniform float uLineMin;\nuniform float uLineBase;\n' + shader.vertexShader.replace('#include <fog_vertex>',
      '#include <fog_vertex>\nfloat lineSize = uLineBase * clamp(-mvPosition.z / uLineNear, uLineMin, 1.0);\n'
      + 'gl_PointSize *= mix(1.0, lineSize, lineWeight);\nvColor.rgb *= mix(1.0, uLineBase * uLineMin / lineSize, lineWeight);');
  };
  // 지난 주차 건물만 점·선 대신 면(로우 폴리)으로 그린다. 면 머티리얼도 이것 하나만 쓴다 (2026-11-07, CLAUDE.md 예외).
  // 존재감 없게 무채색 반투명: 색은 faceColors(회색 밝기 단계), 깊이를 남기지 않고 점들 뒤에 마지막으로 얹는다
  const FACE_OPACITY = 0.22;
  const faceMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: FACE_OPACITY, depthWrite: false });
  const color = new THREE.Color();
  function geometryFrom(data, lineWeight = 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    const linear = new Float32Array(data.colors.length);
    for (let i = 0; i < linear.length; i += 3) {
      color.setRGB(data.colors[i], data.colors[i + 1], data.colors[i + 2], THREE.SRGBColorSpace);
      color.toArray(linear, i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
    geometry.setAttribute('aColor', geometry.getAttribute('color'));
    geometry.setAttribute('shake', new THREE.BufferAttribute(data.shake ?? new Float32Array(data.positions.length / 3), 1));
    geometry.setAttribute('lineWeight', new THREE.BufferAttribute(new Float32Array(data.positions.length / 3).fill(lineWeight), 1));
    geometry.userData.baseColor = linear.slice();
    const seeded = mulberry32(44701);
    geometry.userData.revealSeeds = Float32Array.from({ length: linear.length / 3 }, () => seeded());
    geometry.computeBoundingSphere();
    return geometry;
  }
  function fadePoints(object, amount) {
    const attribute = object.geometry.getAttribute('color'), original = object.geometry.userData.baseColor;
    for (let i = 0; i < original.length; i++) attribute.array[i] = original[i] * amount;
    attribute.needsUpdate = true;
  }
  const projection = new THREE.Matrix4(), assemblyMatrix = new THREE.Matrix4();
  function assemblePoints(object, progress, direction) {
    assemblyMatrix.multiplyMatrices(projection, object.matrixWorld);
    const m = assemblyMatrix.elements, positions = object.geometry.getAttribute('position').array;
    const attribute = object.geometry.getAttribute('color'), base = object.geometry.userData.baseColor;
    const seeds = object.geometry.userData.revealSeeds;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const screenY = clamp((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / (w || 1e-8)) * 0.5);
      const brightness = w > 0 ? assemblyBrightness(screenY, progress, direction, seeds[i / 3]) : progress;
      attribute.array[i] = base[i] * brightness;
      attribute.array[i + 1] = base[i + 1] * brightness;
      attribute.array[i + 2] = base[i + 2] * brightness;
    }
    attribute.needsUpdate = true;
  }
  const planet = new THREE.Points(geometryFrom(buildPlanet(POINT_COUNT)), material);
  scene.add(planet);
  const localGroup = new THREE.Group();
  localGroup.scale.setScalar(LOCAL_SCALE); localGroup.visible = false; scene.add(localGroup);
  // 선지로 고른 주거 모듈·산소 장치. 지형과 같은 지역 좌표·같은 머티리얼을 쓴다
  const assetGroup = new THREE.Group(); localGroup.add(assetGroup);
  let logWeek = null;
  let selection = {}, decided = {}, week = 1, moduleLayer = null, assetToken = 0, focusTween = null;
  // 육각 토큰 선지판 (src/hexBoard.js). 기존 글 카드·결정 버튼은 숨긴 채 그대로 돌고, 판은 그 상태를 보여 주며 같은 함수를 부른다.
  // 주소에 ?cards=1 을 붙이면 예전 글 카드 화면으로 본다 (비교용)
  const hexMode = !new URLSearchParams(location.search).has('cards');
  $('.p-decision').classList.toggle('hex-mode', hexMode);
  $('#hex-board').hidden = !hexMode;
  const board = hexMode ? createHexBoard($('#hex-board'), {
    onPick(stepId, choiceId) {
      if (stepId === 'location') return selectSite(ALL_STEPS[0].choices.find(c => c.id === choiceId).site);
      pickChoice(stepId, choiceId);
    },
    onDecide() {
      const open = boardSteps(mode === 'local' && !transition).find(step => step.status === 'open');
      if (open) decideStep(open.id); else if (!$('#next-week').hidden) $('#next-week').click();
    }
  }) : null;
  const overlayLayers = new Map(), reveals = [], pastFades = new Set();
  const REVEAL_MS = 1600; // 새 건물 점이 아래에서 위로 채워지는 시간
  const PAST_FADE_MS = 1400; // 지난 주차 건물 선이 사라지며 회색 면으로 바뀌는 시간
  function dropLayer(layer) {
    if (!layer) return;
    pastFades.delete(layer);
    if (layer === hovered) setHover(null);
    assetGroup.remove(layer.points); layer.points.geometry.dispose();
    if (layer.mesh) { assetGroup.remove(layer.mesh); layer.mesh.geometry.dispose(); }
  }
  // 지난 주차 레이어는 면으로 바꾸고 선 점은 숨긴다. 면이 없는 레이어(동굴 봉쇄막·벽 조류 점)는 주황 점 그대로 둔다
  function showPast(layer, past) {
    if (!layer) return;
    const faces = past && layer.data.faces?.length ? layer.data.faces : null;
    if (faces && !layer.mesh) {
      const geometry = new THREE.BufferGeometry(), srgb = faceColors(faces), linear = new Float32Array(srgb.length);
      for (let i = 0; i < srgb.length; i += 3) { color.setRGB(srgb[i], srgb[i + 1], srgb[i + 2], THREE.SRGBColorSpace); color.toArray(linear, i); }
      geometry.setAttribute('position', new THREE.BufferAttribute(faces, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
      layer.mesh = new THREE.Mesh(geometry, faceMaterial);
      layer.mesh.renderOrder = 1;
      assetGroup.add(layer.mesh);
    }
    // 막 지난 주차가 된 건물은 브리핑을 닫은 뒤 선 점이 천천히 사라지며 회색 면으로 바뀐다 (frame 의 pastFades)
    if (faces && !layer.past && !reducedMotion) { layer.fade = { start: null }; pastFades.add(layer); }
    layer.past = Boolean(faces);
    if (layer.fade && faces) { layer.mesh.visible = layer.fade.start != null; layer.points.visible = true; return; }
    if (layer.mesh) layer.mesh.visible = Boolean(faces);
    layer.points.visible = !faces || layer === hovered; // 마우스를 올린 건물은 선(외곽선)도 함께 보인다
  }
  // 지난 주차 건물 호버: 선 점을 다시 켜 외곽선으로 보이고, 어떤 선지였는지 정보창을 건물 옆에 띄운다
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), tip = $('#past-tip');
  let hovered = null, pointerInside = false, pointerDown = false;
  host.addEventListener('pointermove', event => {
    const rect = host.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    pointerInside = true; pointerDown = event.buttons !== 0;
  });
  host.addEventListener('pointerleave', () => { pointerInside = false; });
  // 그 레이어를 만든 선지: 주차 · 단계 이름 · 선지 이름 · 한 줄 설명
  function choiceOf(layer) {
    for (const [w, { steps }] of WEEKS.entries()) for (const step of steps) {
      const choice = step.choices.find(c => c.id === selection[step.id]);
      if (!choice) continue;
      const id = layer === moduleLayer ? null : [...overlayLayers].find(([, l]) => l === layer)?.[0];
      if (id ? choice.overlays?.includes(id) : choice.module && layer === moduleLayer) {
        const short = { location: '위치', module: '건설 방식', oxygen: '산소 방식' }[step.id] ?? step.short ?? step.label;
        return { week: w + 1, short, label: choice.label, line: choice.line };
      }
    }
    return null;
  }
  function setHover(layer) {
    if (layer === hovered) return;
    const before = hovered;
    hovered = layer;
    if (before) showPast(before, before.week < week);
    if (!layer) { tip.hidden = true; return; }
    layer.points.visible = true;
    const info = choiceOf(layer);
    tip.replaceChildren(...[['small', info ? info.week + '주차 · ' + info.short : '지난 주차'], ['b', info?.label ?? ''], ['span', info?.line ?? '']]
      .filter(([, text]) => text).map(([tag, text]) => Object.assign(document.createElement(tag), { textContent: text })));
    tip.hidden = false;
  }
  const corner = new THREE.Vector3();
  // 정보창 자리: 건물의 화면 범위(상자 8개 꼭짓점) 오른쪽 → 왼쪽 → 위 → 아래 중 들어가는 첫 곳. 창 밖으로 나가지 않게 맞춘다
  function placeTip() {
    const box = hovered.mesh.geometry.boundingBox ?? (hovered.mesh.geometry.computeBoundingBox(), hovered.mesh.geometry.boundingBox);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(hovered.mesh.matrixWorld).project(camera);
      const x = (corner.x + 1) * host.clientWidth / 2, y = (1 - corner.y) * host.clientHeight / 2;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const w = tip.offsetWidth, h = tip.offsetHeight, W = host.clientWidth, H = host.clientHeight, gap = 12, pad = 8;
    const middleY = (y0 + y1) / 2 - h / 2, middleX = (x0 + x1) / 2 - w / 2;
    const spots = [[x1 + gap, middleY, x1 + gap + w <= W - pad], [x0 - gap - w, middleY, x0 - gap - w >= pad], [middleX, y0 - gap - h, y0 - gap - h >= pad], [middleX, y1 + gap, y1 + gap + h <= H - pad]];
    const [x, y] = spots.find(spot => spot[2]) ?? [W - w - pad, pad];
    tip.style.left = Math.round(Math.min(Math.max(pad, x), W - w - pad)) + 'px';
    tip.style.top = Math.round(Math.min(Math.max(pad, y), H - h - pad)) + 'px';
  }
  function pickPast() {
    const meshes = mode === 'local' && !transition && pointerInside && !pointerDown
      ? [moduleLayer, ...overlayLayers.values()].filter(layer => layer?.mesh?.visible).map(layer => layer.mesh) : [];
    let found = null;
    if (meshes.length) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      found = hit && [moduleLayer, ...overlayLayers.values()].find(layer => layer?.mesh === hit.object);
    }
    setHover(found ?? null);
    if (hovered) placeTip();
  }
  function clearAssets() {
    assetToken++; selection = {}; decided = {}; week = 1; focusTween = null;
    dropLayer(moduleLayer); moduleLayer = null;
    overlayLayers.forEach(dropLayer); overlayLayers.clear(); reveals.length = 0;
    $('#legend').hidden = true;
  }
  function addLayer(data) {
    const points = new THREE.Points(geometryFrom(data, TINT.new.weight), material);
    assetGroup.add(points); fadePoints(points, 0);
    reveals.push({ points, start: performance.now() });
    return points;
  }
  // 레이어 색만 바꾼다. 점이 채워지는 중이면 그 동작이 baseColor 를 읽어 알아서 새 색으로 그린다
  function paintLayer(layer, role) {
    if (!layer?.data.levels || layer.role === role) return;
    layer.role = role;
    const srgb = tintLayer(layer.data.levels, role), geometry = layer.points.geometry, base = geometry.userData.baseColor;
    for (let i = 0; i < base.length; i += 3) {
      color.setRGB(srgb[i], srgb[i + 1], srgb[i + 2], THREE.SRGBColorSpace);
      color.toArray(base, i);
    }
    const weight = geometry.getAttribute('lineWeight');
    weight.array.fill(TINT[role].weight); weight.needsUpdate = true;
    if (!reveals.some(reveal => reveal.points === layer.points)) fadePoints(layer.points, 1);
  }
  // 선택 상태에 맞춰 레이어를 맞춘다: 바뀐 것만 새로 만들고 점이 아래에서 위로 채워진다
  async function syncAssets() {
    const token = ++assetToken, site = currentSite, layers = resolve(selection);
    const view = site === 'lavaTube' && caveInterior && !localSection ? 'interior' : 'section';
    const moduleKey = layers.module && layers.module + ':' + view;
    let added = false;
    if (moduleLayer?.key !== moduleKey) {
      dropLayer(moduleLayer); moduleLayer = null;
      overlayLayers.forEach(dropLayer); overlayLayers.clear(); // 바깥벽 조류처럼 모듈을 따라가는 오버레이가 있다
      if (layers.module) {
        const data = await buildModule(site, layers.module, view);
        if (token !== assetToken) return;
        moduleLayer = { key: moduleKey, week: layers.weeks.module, data, points: addLayer(data) }; added = true;
      }
    }
    for (const [id, layer] of overlayLayers) if (!layers.overlays.includes(id)) { dropLayer(layer); overlayLayers.delete(id); }
    for (const id of layers.overlays) {
      if (overlayLayers.has(id)) continue;
      const data = await buildOverlay(site, id, moduleLayer?.data, [...overlayLayers.values()].map(layer => layer.data));
      if (token !== assetToken) return;
      if (data.positions.length) { overlayLayers.set(id, { week: layers.weeks[id], data, points: addLayer(data) }); added = true; }
      if (window.terrainDiagnostics) window.terrainDiagnostics.overlaySpots = { ...window.terrainDiagnostics.overlaySpots, [id]: data.spots ?? data.spot };
      if (window.terrainDiagnostics) window.terrainDiagnostics.overlayRadius = { ...window.terrainDiagnostics.overlayRadius, [id]: data.footprint?.r };
    }
    // 가장 최근에 더한 선지만 흰색으로, 그 전 선지는 주황으로 칠한다
    // 지난 주차 레이어는 '방금 추가'가 될 수 없다 (호버 외곽선은 모두 주황)
    const newest = [...overlayLayers.values()].filter(layer => layer.week >= week).at(-1);
    paintLayer(moduleLayer, newest || moduleLayer?.week < week ? 'old' : 'new');
    overlayLayers.forEach(layer => paintLayer(layer, layer === newest ? 'new' : 'old'));
    // 주차가 끝난 선지(앞 주차에 생긴 레이어)는 면으로 그린다
    const all = [moduleLayer, ...overlayLayers.values()].filter(Boolean);
    all.forEach(layer => showPast(layer, layer.week < week));
    $('#legend').hidden = !moduleLayer;
    $('#legend-old').hidden = !all.some(layer => layer.points.visible && layer.role === 'old');
    $('#legend-past').hidden = !all.some(layer => layer.mesh?.visible);
    if (added) focusAssets();
  }
  // 단계별 선지: 1단계 위치(아래 A·B·C 카드) → 2단계 짓는 방식 → 3단계 숨 쉴 공기
  function renderStep(stepId, element, visible) {
    element.hidden = !visible;
    const nav = element.querySelector('nav');
    if (!visible) return nav.replaceChildren();
    nav.replaceChildren(...availableChoices(stepId, selection).map((choice, index) => {
      const button = document.createElement('button');
      button.className = 'site choice'; button.dataset.step = stepId; button.dataset.choice = choice.id;
      const active = selection[stepId] === choice.id;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      // 이름표는 순서 번호만 쓴다. 선지 id(W1·O2 등)는 주차 탭 W1·산소 칸 O₂ 와 헷갈려서 화면에 내지 않는다
      const letter = document.createElement('b'); letter.textContent = index + 1;
      const name = document.createElement('span'), line = document.createElement('em'), effects = document.createElement('ul');
      name.className = 'name'; line.className = 'line'; effects.className = 'effects';
      button.append(letter, name, line, effects); fillCard(button, choice, selection);
      button.addEventListener('click', () => pickChoice(stepId, choice.id));
      return button;
    }));
  }
  // 선지 고르기 (글 카드와 육각 토큰이 같이 쓴다): 앞 단계를 바꾸면 뒤 단계 선택은 지운다
  function pickChoice(stepId, choiceId) {
    if (transition || selection[stepId] === choiceId) return;
    selection = choose(selection, stepId, choiceId); renderSteps(true); syncAssets();
  }
  const DECIDE_SHORT = { location: '위치', module: '건설 방식', oxygen: '산소 방식' };
  function decideStep(stepId) {
    if (transition || !selection[stepId]) return;
    decided[stepId] = true; renderSteps(true);
    if (stepId !== 'location') focusAssets(true); // 결정하면 지금까지 지은 기지 전체가 화면에 알맞게 들어오게 물러선다
  }
  // 토큰판에 넘길 이번 주 단계들: 결정한 단계 'done', 지금 고를 단계 'open' (앞 단계를 결정해야 열린다), 그 뒤는 'locked'("?" 자리)
  function boardSteps(local) {
    const { steps } = WEEKS[week - 1];
    let opened = false;
    return steps.map((step, k) => {
      const done = Boolean(local && decided[step.id]);
      let status = done ? 'done' : 'locked';
      if (!done && !opened && (k === 0 || (local && decided[steps[k - 1].id]))) { status = 'open'; opened = true; }
      const isLocation = step.id === 'location';
      const choices = isLocation ? step.choices : status === 'locked' ? [] : availableChoices(step.id, selection);
      const selected = isLocation ? (local ? selection.location : null) : selection[step.id] ?? null;
      return { id: step.id, label: step.label, short: shortName(step), status, selected, choices };
    });
  }
  function updateBoard(local) {
    if (!board) return;
    const steps = boardSteps(local), open = steps.find(step => step.status === 'open');
    const nextWeek = !$('#next-week').hidden;
    board.update({
      steps, busy: Boolean(transition),
      decide: open ? { label: '▶ ' + (DECIDE_SHORT[open.id] ?? open.short) + ' 결정', disabled: !open.selected || (open.id === 'location' && !local) }
        : nextWeek ? { label: '▶ 다음 주로' } : { hidden: true }
    });
  }
  // 결정 버튼: 결정한 단계의 카드 줄은 접고 다음 단계를 연다. 화면이 복잡해지지 않게 결정한 항목은 한 줄 요약으로만 남긴다
  function decideButton(stepId) {
    const button = document.createElement('button');
    button.className = 'decide'; button.disabled = !selection[stepId];
    const short = { location: '위치', module: '건설 방식', oxygen: '산소 방식' }[stepId] ?? ALL_STEPS.find(step => step.id === stepId).short;
    button.textContent = '▶ ' + short + ' 결정';
    button.addEventListener('click', () => decideStep(stepId));
    return button;
  }
  const choiceLabel = stepId => availableChoices(stepId, selection).find(c => c.id === selection[stepId])?.label;
  // 왼쪽 상태 칸: 기온(행성 전체 또는 고른 지대의 시나리오 범위) · 산소 · 결정 기록. 값이 없으면 '측정 중'이다
  // 값이 실제로 바뀔 때만 글자를 바꾸고 짧게 번쩍인다 (holo-boot.css .holo-flash). 글자만 슬쩍 바뀌어서 모르고 지나가는 일을 막는다
  function setText(element, text) {
    if (element.textContent === text) return;
    element.textContent = text;
    element.classList.remove('holo-flash'); void element.offsetWidth; element.classList.add('holo-flash');
  }
  function updateHud(local) {
    setCrewSite(local ? currentSite : null);
    // 대원 얼굴: 산소 방식을 결정하기 전에는 바깥 공기(숨 쉴 산소 없음)다.
    // 결정한 뒤에는 결정한 선지들의 stats 를 더해 넘긴다. 카드를 눌러 미리 보기만 할 때는 바뀌지 않는다
    if (local && decided.oxygen) {
      const total = {};
      for (const step of ALL_STEPS) {
        if (!decided[step.id]) continue;
        const stats = step.choices.find(choice => choice.id === selection[step.id])?.stats ?? {};
        for (const [key, value] of Object.entries(stats)) total[key] = (total[key] ?? 0) + value;
      }
      setCrewStats(total);
    } else setCrewStats(null);
    const range = local ? hud.sites[currentSite]?.temperature : null;
    setText($('#hud-temp'), range ? range[0] + '° ~ ' + range[1] + '°' : hud.temperature.night + '° / ' + hud.temperature.day + '°');
    setText($('#hud-temp-note'), range ? COPY[currentSite].title + ' 기온 범위' : '밤 최저 / 낮 최고');
    $('#hud-o2').textContent = hud.oxygen == null ? '측정 중' : hud.oxygen + '%';
    $('#hud-o2-bar').style.width = (hud.oxygen ?? 0) + '%';
    const shownWeek = logWeek ?? week; // 왼쪽 주차 탭으로 고른 주 (없으면 지금 주)
    const entries = WEEKS[shownWeek - 1].steps.map(step => step.id === 'location'
      ? (local && decided.location ? siteLetter(currentSite) + ' ' + COPY[currentSite].title : '—')
      : decided[step.id] ? choiceLabel(step.id) : '—');
    entries.forEach((text, i) => { setText($('#hud-log-' + (i + 1)), '▶ LOG 0' + (i + 1) + ' ........ ' + text); });
    document.querySelectorAll('#hud .tab').forEach((tab, i) => {
      tab.hidden = i >= week; // 아직 오지 않은 주차는 탭을 보이지 않는다
      tab.classList.toggle('on', i === shownWeek - 1); tab.setAttribute('aria-selected', String(i === shownWeek - 1));
    });
  }
  // 1단계 지대 카드는 누르면 그 지역으로 날아가 둘러볼 수 있고, '지대 결정'을 눌러야 다음 단계가 열린다
  let lastStepKey, stepTimer;
  function renderSteps(local) {
    logWeek = null; // 무언가 고르거나 결정하면 LOG 는 지금 주로 돌아온다
    if (local) selection.location = siteLetter(currentSite);
    const sites = $('nav.sites');
    sites.querySelector('.decide')?.remove();
    if (local && !decided.location) sites.append(decideButton('location'));
    sites.hidden = $('#step-location-title').hidden = Boolean(local && decided.location);
    renderStep('module', $('#step-module'), local && decided.location && !decided.module);
    renderStep('oxygen', $('#step-oxygen'), local && decided.module && !decided.oxygen);
    for (const stepId of ['module', 'oxygen']) {
      const nav = $('#step-' + stepId + ' nav');
      if (nav.childElementCount) nav.append(decideButton(stepId));
    }
    // 2주차부터: 지금 주차에서 아직 결정하지 않은 첫 단계를 연다. 앞 주차 선택은 selection 에 그대로 남아 있다
    const { steps } = WEEKS[week - 1], open = local && week > 1 ? steps.find(step => !decided[step.id]) : null;
    renderStep(open?.id, $('#step-week'), Boolean(open));
    if (open) {
      $('#step-week .step-title b').textContent = steps.indexOf(open) + 1;
      $('#step-week .step-title span').textContent = open.label;
      $('#step-week nav').append(decideButton(open.id));
    }
    $('#next-week').hidden = !(local && WEEKS[week] && steps.every(step => decided[step.id]));
    $('#back').hidden = week > 1; // 결정은 되돌릴 수 없다. 2주차부터는 행성으로 돌아가 처음부터 고르지 않는다
    // 단계가 바뀌었으면(위치 → 방식 → 공기 → 주차 선지) 선택 영역이 홀로그램처럼 새로 투사된다
    const stepKey = [!sites.hidden && 'loc', !$('#step-module').hidden && 'module', !$('#step-oxygen').hidden && 'oxygen', open && week + ':' + open.id].filter(Boolean).join('/');
    if (lastStepKey !== undefined && stepKey !== lastStepKey && $('#intro').hidden) {
      const area = $('.p-decision');
      area.classList.remove('step-changing'); void area.offsetWidth; area.classList.add('step-changing');
      clearTimeout(stepTimer); stepTimer = setTimeout(() => area.classList.remove('step-changing'), 1500);
    }
    lastStepKey = stepKey;
    updateBoard(local);
    updateHud(local);
  }
  // 짓는 방식 선지를 누르는 순간부터 고른 에셋이 놓인 곳으로 다가가 천천히 오른쪽으로 돈다.
  // 공기 선지를 누르면 그 장치로, 공기 방식을 결정하면 주거와 산소 장치를 함께 담도록 다시 맞춘다.
  // FOCUS 는 모듈 점을 아직 못 만든 경우의 지대별 자리다 (지역 단위)
  const FOCUS = { plain: [[0, 0.6, 0], 4.2], lavaTube: [[3.6, -3.4, -1.1], 6.5], ridge: [[-1.6, -0.6, 0], 5.5] };
  const FOCUS_ELEVATION = 28 * Math.PI / 180;
  const FOCUS_ZOOM = { plain: 1, lavaTube: 0.6, ridge: 1 }; // 동굴 속은 더 가까이 (벽에 가리지 않게 거리만 줄인다)
  const LOCAL_MIN_DISTANCE = 2.5; // 지역에서 카메라가 다가갈 수 있는 가장 가까운 거리. 6 이면 기지 전체 보기가 이 거리에 막혀 건물이 작게 보였다
  const ORBIT_SPEED = 0.25; // OrbitControls 기준. 2.0 이면 30초에 한 바퀴, 0.25 면 약 4분
  function focusAssets(whole = false) {
    if (mode !== 'local' || transition) return;
    if (currentSite === 'lavaTube' && (caveInterior || localSection)) {
      // 동굴 안에서는 돌 수 없으므로 전체 보기로 나와서 다가간다
      caveInterior = false; localSection = false;
      $('#cave-view').textContent = '동굴 내부로'; $('#section').textContent = '단면 보기';
      buildLocal(currentSite); fadePoints(localPoints, 1); setPose(localPose());
      if (moduleLayer) return syncAssets(); // 봉쇄막은 보기마다 모양이 달라 다시 만든 뒤 그 범위로 다가간다
    }
    // 비출 레이어: 산소를 결정했으면 주거 + 산소, 산소 선지를 골랐으면 그 장치, 아니면 주거 모듈
    // 2주차부터는 방금 더한 장치만 비춘다
    const overlays = [...overlayLayers.values()].slice(week > 1 ? -1 : 0);
    const shown = whole ? [moduleLayer, ...overlayLayers.values()] : week > 1 && overlays.length ? overlays : decided.oxygen ? [moduleLayer, ...overlays] : selection.oxygen && overlays.length ? overlays : [moduleLayer];
    const [anchor, size] = FOCUS[currentSite], center = new THREE.Vector3(...anchor);
    let radius = size;
    const box = new THREE.Box3();
    for (const layer of shown) if (layer) box.union(new THREE.Box3().setFromBufferAttribute(layer.points.geometry.getAttribute('position')));
    if (!box.isEmpty()) {
      box.getCenter(center);
      radius = Math.max(shown === overlays ? 2.2 : 3, box.getSize(new THREE.Vector3()).length() * 0.75);
    }
    const target = localGroup.localToWorld(center);
    // 지금 보는 방위는 두고, 높이는 FOCUS_ELEVATION 만큼만 올려 비스듬히 내려다본다 (위에서 곧장 보면 모델이 납작해 보인다)
    const up = sites[currentSite].normal, flat = camera.position.clone().sub(controls.target);
    if (shown === overlays && moduleLayer) {
      // 산소 장치를 볼 때는 가까운 주거 모듈 점들의 반대편에서 본다: 모듈이 장치 뒤에 있어 가리지 않는다 (지역 좌표로 잰다)
      const device = localGroup.worldToLocal(target.clone()), p = moduleLayer.points.geometry.getAttribute('position').array;
      const near = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.hypot(p[i] - device.x, p[i + 2] - device.z) > 4) continue;
        near.x += p[i]; near.z += p[i + 2]; count++;
      }
      if (count) {
        const away = new THREE.Vector3(device.x - near.x / count, 0, device.z - near.z / count);
        // 동굴은 절개면 쪽(+z)에서만 안이 보인다
        if (currentSite === 'lavaTube') away.z = Math.max(away.z, Math.hypot(away.x, away.z) * 0.8);
        if (away.lengthSq() > 1e-6) flat.copy(localGroup.localToWorld(device.clone().add(away)).sub(target));
      }
    }
    flat.addScaledVector(up, -flat.dot(up)).normalize();
    const direction = flat.multiplyScalar(Math.cos(FOCUS_ELEVATION)).addScaledVector(up, Math.sin(FOCUS_ELEVATION));
    // 기지 전체 보기: 감싸는 구가 세로·가로 시야 중 좁은 쪽에 여유 15% 를 두고 꼭 들어오는 거리 (멀리 빠져 작아지지 않게)
    const half = Math.min(camera.fov / 2, THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect))) * Math.PI / 180;
    const distance = whole && !box.isEmpty() ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 2) * 1.15 / Math.sin(half) : radius * 2.3;
    const position = target.clone().addScaledVector(direction, distance * FOCUS_ZOOM[currentSite] * LOCAL_SCALE);
    focusTween = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), position, target, start: performance.now() };
    controls.autoRotate = false;
  }

  // 주차 브리핑: 다음 주로 넘어갈 때 뜨고, 왼쪽 주차 탭이나 브리핑의 탭으로 지난 주 것을 다시 본다
  const showBrief = number => {
    const shown = WEEKS[number - 1];
    openBriefing(shown, textsFor(shown.situation, selection), week, showBrief);
  };
  // 왼쪽 주차 탭: 그 주 브리핑을 다시 띄우고, LOG 도 그 주에 결정한 것으로 바꿔 보여 준다
  document.querySelectorAll('#hud .tab').forEach((tab, i) => tab.addEventListener('click', () => {
    logWeek = i + 1 === week ? null : i + 1; updateHud(mode === 'local' && !transition);
    showBrief(i + 1);
  }));
  $('#next-week').addEventListener('click', () => { week++; renderSteps(true); syncAssets(); showBrief(week); });

  // A와 B는 사용자 표시 위치, C는 기존 위치다. 실제 경위도 자료는 아니다.
  const sun = new THREE.Vector3(PLANET_SUN.x, PLANET_SUN.y, PLANET_SUN.z).normalize();
  const front = new THREE.Vector3(0, 0, 1).addScaledVector(sun, -sun.z).normalize();
  const around = new THREE.Vector3().crossVectors(sun, front).normalize();
  const sites = {};
  for (const name of Object.keys(COPY)) {
    sites[name] = { ...siteFrame(name, definitions[name]), pin: document.querySelector('.pin[data-site="' + name + '"]') };
  }
  // 항성은 시간과 무관하게 같은 세계 좌표에 머문다.
  const starData = { positions: new Float32Array(360 * 3), colors: new Float32Array(360 * 3) };
  const rng = mulberry32(8844), starCenter = sun.clone().multiplyScalar(65);
  for (let i = 0; i < 360; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.55;
    starCenter.clone().addScaledVector(front, Math.cos(a) * r).addScaledVector(around, Math.sin(a) * r).toArray(starData.positions, i * 3);
    starData.colors.set(orange(), i * 3);
  }
  const star = new THREE.Points(geometryFrom(starData), material); scene.add(star);
  const starfield = new THREE.Points(geometryFrom(buildStarfield()), material); scene.add(starfield);
  // 행성 뒤에 있는 배경 별은 가린다. 별빛이 행성 안에 비쳐 보이지 않게 한다.
  const starVector = new THREE.Vector3();
  function backgroundStars(amount) {
    starfield.visible = amount > 0;
    if (!starfield.visible) return;
    const p = starfield.geometry.getAttribute('position').array, c = starfield.geometry.getAttribute('color');
    const base = starfield.geometry.userData.baseColor, distanceSq = camera.position.lengthSq();
    for (let i = 0; i < p.length; i += 3) {
      starVector.set(p[i], p[i + 1], p[i + 2]).sub(camera.position).normalize();
      const towardCenter = -starVector.dot(camera.position);
      const hidden = towardCenter > 0 && distanceSq - towardCenter * towardCenter < 8.15 * 8.15;
      const light = hidden ? 0 : amount;
      c.array[i] = base[i] * light; c.array[i + 1] = base[i + 1] * light; c.array[i + 2] = base[i + 2] * light;
    }
    c.needsUpdate = true;
  }

  function overviewPose() {
    const mobile = host.clientWidth < 600;
    return {
      position: new THREE.Vector3(0, mobile ? 3 : 2, mobile ? 36 : 29),
      target: new THREE.Vector3(mobile ? 0 : -3.2, mobile ? 2.7 : 0, 0),
      up: new THREE.Vector3(0, 1, 0)
    };
  }
  function localPose(section = false) {
    return surfacePose(currentSite, sites[currentSite], camera.aspect, section, caveInterior);
  }
  function setPose(pose) {
    controls.dispose();
    camera.position.copy(pose.position); camera.up.copy(pose.up);
    // OrbitControls는 생성 시 위쪽 축을 기억하므로 지역 축이 바뀔 때 다시 연결한다.
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(pose.target);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    controls.autoRotate = false; controls.enablePan = mode === 'local';
    controls.minDistance = mode === 'local' ? LOCAL_MIN_DISTANCE * LOCAL_SCALE : 18;
    controls.maxDistance = mode === 'local' ? 65 * LOCAL_SCALE : 65;
    controls.update();
  }
  function uiMode(local) {
    document.body.classList.toggle('local', local);
    $('#local-nav').hidden = !local;
    $('#cave-view').hidden = !local || currentSite !== 'lavaTube';
    $('#cave-view').textContent = caveInterior ? '동굴 전체 보기' : '동굴 내부로';
    $('#planet-labels').hidden = local;
    $('#landmark').hidden = !local;
    if (local) {
      const text = COPY[currentSite];
      $('#landmark').replaceChildren(document.createTextNode(text.tag));
      if (text.sub) { const sub = document.createElement('small'); sub.textContent = text.sub; $('#landmark').appendChild(sub); }
      $('#interaction').textContent = '드래그 회전 · 휠 확대 · 우클릭 이동';
    } else {
      $('#interaction').textContent = '행성 위 A · B · C를 선택해 접근하세요';
      $('#build-time').textContent = '';
    }
    document.querySelectorAll('.site[data-site]').forEach(button => {
      const active = local && button.dataset.site === currentSite;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    renderSteps(local && !transition);
  }
  function blockButtons(blocked) {
    document.querySelectorAll('[data-site], #back, #section, #cave-view, .choice, .decide').forEach(button => button.disabled = blocked);
  }
  function beginFlight(destination, returning = false, extras = {}) {
    controls.enabled = false;
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    transition = prepareFlight({
      start: performance.now(), returning, destination, ...extras,
      fromPosition: camera.position.clone(), fromTarget: controls.target.clone(),
      fromQuaternion: camera.quaternion.clone(), toQuaternion: poseQuaternion(destination.position, destination.target, destination.up)
    });
    const incoming = returning ? planet : localPoints;
    incoming.visible = false;
    blockButtons(true); $('#travel-status').hidden = false;
    $('#travel-status').textContent = returning ? '궤도 시점으로 이동 중' : 'SITE ' + COPY[currentSite].letter + ' / 이동 중';
    $('#planet-labels').hidden = true; $('#landmark').hidden = true;
  }
  function buildLocal(name) {
    const start = performance.now();
    const inside = name === 'lavaTube' && caveInterior && !localSection;
    const key = name + (inside ? ':interior' : '');
    let data = cache.get(key), cached = Boolean(data);
    if (!data) {
      data = BUILDERS[name](POINT_COUNT, { ...definitions[name], view: inside ? 'interior' : 'section' });
      // 동굴 내부에서는 주변 지형이 보이지 않으므로 붙이지 않는다. 동굴 절개면 앞쪽은 비운다.
      if (!inside) data = joinPoints(data, buildSurroundings(name, definitions[name], name === 'lavaTube'));
      cache.set(key, data);
    }
    const total = data.positions.length / 3, elapsed = performance.now() - start;
    if (localPoints) { localGroup.remove(localPoints); localPoints.geometry.dispose(); }
    localPoints = new THREE.Points(geometryFrom(data), material); localGroup.add(localPoints);
    const site = sites[name]; localGroup.position.copy(site.position); localGroup.quaternion.copy(site.rotation);
    localGroup.visible = true; fadePoints(localPoints, 0);
    $('#build-time').textContent = '';
    window.terrainDiagnostics = { site: name, count: total, buildMs: elapsed, relief: definitions[name].relief, materialCount: 1, cached };
  }
  function selectSite(name) {
    if (transition) return;
    if (mode === 'local') {
      if (currentSite === name) return;
      return switchLocalSite(name);
    }
    clearAssets();
    currentSite = name; localSection = false; caveInterior = name === 'lavaTube'; $('#section').textContent = '단면 보기';
    buildLocal(name); beginFlight(localPose());
  }
  function switchLocalSite(name) {
    clearAssets(); renderSteps(false);
    const startTarget = controls.target.clone();
    const outgoing = new THREE.Group();
    outgoing.position.copy(localGroup.position); outgoing.quaternion.copy(localGroup.quaternion); outgoing.scale.copy(localGroup.scale);
    outgoing.add(localPoints); scene.add(outgoing); localPoints = null;
    // 출발 지형은 제자리에 남겨 둔다. 카메라가 실제로 이동하며 시야에서 멀어진다.
    currentSite = name; localSection = false; caveInterior = name === 'lavaTube';
    $('#section').textContent = '단면 보기'; buildLocal(name);
    const destination = localPose();
    const transit = new THREE.Points(geometryFrom(buildTransitSurface(startTarget, destination.target)), material);
    scene.add(transit); fadePoints(transit, 0);
    planet.visible = false;
    beginFlight(destination, false, { kind: 'site', outgoing, transit });
  }
  function returnToPlanet() {
    if (transition || mode === 'planet') return;
    clearAssets(); renderSteps(false);
    fadePoints(planet, 0);
    beginFlight(overviewPose(), true);
  }
  document.querySelectorAll('[data-site]').forEach(button => button.addEventListener('click', () => selectSite(button.dataset.site)));
  $('#back').addEventListener('click', () => returnToPlanet());
  $('#brand-home').addEventListener('click', event => { event.preventDefault(); returnToPlanet(); });
  $('#section').addEventListener('click', () => {
    if (transition) return;
    localSection = !localSection;
    if (currentSite === 'lavaTube') { buildLocal(currentSite); fadePoints(localPoints, 1); syncAssets(); }
    setPose(localPose(localSection));
    $('#section').textContent = localSection ? '투시 보기' : '단면 보기';
  });
  $('#cave-view').addEventListener('click', () => {
    if (transition) return;
    caveInterior = !caveInterior; localSection = false;
    $('#section').textContent = '단면 보기';
    $('#cave-view').textContent = caveInterior ? '동굴 전체 보기' : '동굴 내부로';
    buildLocal(currentSite); fadePoints(localPoints, 1); syncAssets();
    setPose(localPose());
  });
  // 키보드: 아래 줄 안내(선택 ◀ ▶ · 확정 OK)대로 ◀ ▶ 로 지금 보이는 카드를 고르고 Enter 로 결정 버튼을 누른다
  const visibleNow = element => element && !element.disabled && element.offsetParent !== null;
  document.addEventListener('keydown', event => {
    const blocked = !$('#intro').hidden || !$('#crew-modal').hidden || [...document.querySelectorAll('.data-modal')].some(modal => !modal.hidden);
    if (event.key === 'Escape') { if (!blocked) returnToPlanet(); return; }
    if (blocked || transition || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest?.('input, textarea, select')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // 육각 토큰판이면 지금 고를 수 있는 토큰, 아니면 보이는 글 카드 사이를 옮겨 다닌다
      const tokens = [...document.querySelectorAll('#hex-board .hb-node.can')];
      const cards = tokens.length ? tokens : [...document.querySelectorAll('#hud .cards .site')].filter(visibleNow);
      if (!cards.length) return;
      event.preventDefault();
      const now = cards.findIndex(card => card.classList.contains('active') || card.classList.contains('s-chosen'));
      const next = now < 0 ? (event.key === 'ArrowRight' ? 0 : cards.length - 1) : (now + (event.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length;
      const id = cards[next].dataset.id;
      cards[next].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      (id ? document.querySelector(`#hex-board .hb-node[data-id="${CSS.escape(id)}"]`) : cards[next])?.focus({ preventScroll: true });
    } else if (event.key === 'Enter') {
      const button = [...document.querySelectorAll('#hud .decide')].find(visibleNow);
      if (!button) return;
      event.preventDefault(); button.click();
    }
  });
  new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!transition) setPose(mode === 'planet' ? overviewPose() : localPose(localSection));
  }).observe(host);
  // 주소 뒤에 ?week=2&site=lavaTube 를 붙이면 그 주차부터 바로 본다. 앞 주차는 단계마다 첫 선지를 고른 것으로 친다
  const jump = new URLSearchParams(window.startParams ?? location.search);
  let startWeek = Number(jump.get('week')) || 1;
  function jumpToWeek() {
    for (const { steps } of WEEKS.slice(0, startWeek - 1)) for (const step of steps) {
      selection = choose(selection, step.id, step.id === 'location' ? siteLetter(currentSite) : availableChoices(step.id, selection)[0].id);
      decided[step.id] = true;
    }
    week = startWeek; startWeek = 1;
    renderSteps(true); syncAssets(); showBrief(week);
  }
  if (WEEKS[startWeek - 1] && startWeek > 1) selectSite(jump.get('site') ?? 'plain');
  const projected = new THREE.Vector3(), temporary = new THREE.Vector3();
  function labels() {
    if (!transition && mode === 'planet') {
      for (const info of Object.values(sites)) {
        projected.copy(info.position).project(camera);
        const facing = temporary.copy(camera.position).sub(info.position).dot(info.normal) > 0;
        const x = (projected.x + 1) * host.clientWidth / 2, y = (1 - projected.y) * host.clientHeight / 2;
        const visible = facing && projected.z < 1 && x > 20 && x < host.clientWidth - 45 && y > 25 && y < host.clientHeight - 40;
        info.pin.style.visibility = visible ? 'visible' : 'hidden';
        info.pin.style.left = x + 'px'; info.pin.style.top = y + 'px';
      }
    }
    if (!transition && mode === 'local') {
      temporary.set(...COPY[currentSite].position);
      localGroup.localToWorld(temporary); projected.copy(temporary).project(camera);
      const x = (projected.x + 1) * host.clientWidth / 2, y = (1 - projected.y) * host.clientHeight / 2;
      // 주거 모듈이 놓이면 지명 표지는 건물 위에 겹치므로 숨긴다. 왼쪽 위 제목·설명 글과 겹쳐도 숨긴다
      const head = $('.heading'), underHeading = !!head && x < head.offsetLeft + head.offsetWidth + 10 && y - 54 < head.offsetTop + head.offsetHeight;
      $('#landmark').style.display = !moduleLayer && !underHeading && projected.z < 1 && x > 30 && x < host.clientWidth - 150 && y > 160 ? 'block' : 'none';
      $('#landmark').style.left = x + 8 + 'px'; $('#landmark').style.top = y - 54 + 'px';
    }
  }
  controls.minDistance = 18; controls.maxDistance = 65;
  setPose(overviewPose()); uiMode(false);
  function prepareProjection() {
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }
  function frame(time) {
    requestAnimationFrame(frame);
    let backgroundAmount = mode === 'planet' ? 1 : 0;
    if (transition) {
      const flight = transition;
      const timing = transitionTiming(time - flight.start, flight.kind, reducedMotion);
      const sample = flightSample(flight, timing.travel);
      camera.position.copy(sample.position); camera.quaternion.copy(sample.quaternion);
      controls.target.copy(sample.target);
      const incoming = flight.returning ? planet : localPoints;
      const outgoing = flight.kind === 'site' ? flight.outgoing.children[0] : flight.returning ? localPoints : planet;
      const localAmount = flight.kind === 'site' ? 1 : flight.returning ? 1 - timing.travel : timing.travel;
      material.size = POINT_SIZE * Math.exp(Math.log(LOCAL_SCALE) * smooth(0.25, 0.98, localAmount));
      backgroundAmount = flight.kind === 'site' ? 0 : flight.returning ? timing.travel : 1 - timing.travel;
      if (timing.phase === 'travel' || timing.phase === 'settle') {
        incoming.visible = false;
        fadePoints(outgoing, 1 - smooth(0.45, 0.98, timing.travel));
        if (flight.transit) fadePoints(flight.transit, smooth(0, 0.12, timing.travel) * (1 - smooth(0.8, 1, timing.travel)));
      } else {
        if (!flight.arrived) {
          flight.arrived = true;
          outgoing.visible = false; if (flight.transit) flight.transit.visible = false;
          incoming.visible = true;
          uiMode(!flight.returning); $('#landmark').hidden = true;
          $('#travel-status').textContent = flight.returning ? '행성 홀로그램 구성 중' : 'SITE ' + COPY[currentSite].letter + ' / 홀로그램 구성 중';
        }
        prepareProjection();
        assemblePoints(incoming, timing.render, flight.returning ? 'out' : 'in');
      }
      stage.dataset.phase = timing.phase;
      stage.dataset.render = timing.render.toFixed(3);
      stage.dataset.camera = camera.position.toArray().map(v => v.toFixed(6)).join(',');
      if (timing.phase === 'done') {
        mode = flight.returning ? 'planet' : 'local';
        planet.visible = mode === 'planet'; localGroup.visible = mode === 'local';
        material.size = POINT_SIZE * (mode === 'local' ? LOCAL_SCALE : 1);
        fadePoints(incoming, 1);
        if (flight.outgoing) { flight.outgoing.children[0].geometry.dispose(); scene.remove(flight.outgoing); }
        if (flight.transit) { flight.transit.geometry.dispose(); scene.remove(flight.transit); }
        setPose(flight.destination); controls.enabled = true;
        transition = null; blockButtons(false); uiMode(mode === 'local'); $('#travel-status').hidden = true;
        if (mode === 'local' && startWeek > 1) jumpToWeek();
      }
    } else {
      if (focusTween) {
        const t = clamp((time - focusTween.start) / 1400), e = t * t * (3 - 2 * t);
        camera.position.lerpVectors(focusTween.fromPosition, focusTween.position, e);
        controls.target.lerpVectors(focusTween.fromTarget, focusTween.target, e);
        if (t >= 1) { focusTween = null; controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = ORBIT_SPEED; }
      }
      controls.update(); stage.dataset.phase = 'idle';
      if (pastFades.size && $('#intro').hidden) {
        for (const layer of pastFades) {
          layer.fade.start ??= time;
          if (layer.mesh) layer.mesh.visible = true;
          const progress = clamp((time - layer.fade.start) / PAST_FADE_MS);
          fadePoints(layer.points, 1 - smooth(0, 1, progress));
          if (progress >= 1) { pastFades.delete(layer); delete layer.fade; fadePoints(layer.points, 1); showPast(layer, true); }
        }
      }
      if (reveals.length) {
        prepareProjection();
        for (let i = reveals.length - 1; i >= 0; i--) {
          const progress = clamp((time - reveals[i].start) / REVEAL_MS);
          assemblePoints(reveals[i].points, progress, 'in');
          if (progress >= 1) reveals.splice(i, 1);
        }
      }
    }
    backgroundStars(backgroundAmount);
    stage.dataset.mode = transition ? transition.kind === 'site' ? 'travelling' : 'flying' : mode;
    stage.dataset.site = currentSite ?? '';
    renderer.render(scene, camera); labels(); pickPast();
  }
  requestAnimationFrame(frame);
} catch (error) {
  $('#error').hidden = false;
  $('#error').textContent = '3D 모델을 시작할 수 없습니다. WebGL 지원을 확인해 주세요. ' + error.message;
  console.error(error);
}
