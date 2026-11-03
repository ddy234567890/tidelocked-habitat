import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import definitions from './sites.json' with { type: 'json' };
import { buildPlain } from './plain.js';
import { buildLavaTube } from './lavaTube.js';
import { buildRidge } from './ridge.js';
import { buildSurroundings, joinPoints } from './surroundings.js';
import { availableChoices, choose, resolve, siteLetter } from './choices.js';
import { buildModule, buildOverlay } from './placement.js';
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
  ridge: { letter: 'C', title: '황혼 능선', text: '굽이치는 마루에서 마른 완사면과 곁가지 능선이 갈라져 내려가고, 반대편은 침식 홈과 퇴적 부채, 얼음 골짜기와 낮은 지맥으로 이어집니다.', tag: '거주 가능한 정상 띠', sub: '높이 0 · 반폭 0.45', position: [0, 0, 0] }
};
const $ = selector => document.querySelector(selector);
const host = $('#canvas-host'), stage = $('#stage');
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
  let selection = {}, decided = {}, moduleLayer = null, assetToken = 0, focusTween = null;
  const overlayLayers = new Map(), reveals = [];
  function dropLayer(layer) { if (!layer) return; assetGroup.remove(layer.points); layer.points.geometry.dispose(); }
  function clearAssets() {
    assetToken++; selection = {}; decided = {}; focusTween = null;
    dropLayer(moduleLayer); moduleLayer = null;
    overlayLayers.forEach(dropLayer); overlayLayers.clear(); reveals.length = 0;
    $('#legend').hidden = true;
  }
  function addLayer(data) {
    const points = new THREE.Points(geometryFrom(data, 1), material);
    assetGroup.add(points); fadePoints(points, 0);
    reveals.push({ points, start: performance.now() });
    return points;
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
        moduleLayer = { key: moduleKey, data, points: addLayer(data) }; added = true;
      }
    }
    for (const [id, layer] of overlayLayers) if (!layers.overlays.includes(id)) { dropLayer(layer); overlayLayers.delete(id); }
    for (const id of layers.overlays) {
      if (overlayLayers.has(id)) continue;
      const data = await buildOverlay(site, id, moduleLayer?.data);
      if (token !== assetToken) return;
      if (data.positions.length) { overlayLayers.set(id, { points: addLayer(data) }); added = true; }
      if (window.terrainDiagnostics) window.terrainDiagnostics.overlaySpots = { ...window.terrainDiagnostics.overlaySpots, [id]: data.spots ?? data.spot };
    }
    $('#legend').hidden = !moduleLayer;
    $('#legend-oxygen').hidden = !overlayLayers.size;
    if (added) focusAssets();
  }
  // 단계별 선지: 1단계 위치(아래 A·B·C 카드) → 2단계 짓는 방식 → 3단계 숨 쉴 공기
  function renderStep(stepId, element, visible) {
    element.hidden = !visible;
    const nav = element.querySelector('nav');
    if (!visible) return nav.replaceChildren();
    nav.replaceChildren(...availableChoices(stepId, selection).map(choice => {
      const button = document.createElement('button');
      button.className = 'site choice'; button.dataset.step = stepId; button.dataset.choice = choice.id;
      const active = selection[stepId] === choice.id;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      const letter = document.createElement('b'); letter.textContent = choice.id;
      const label = document.createElement('span'), small = document.createElement('small'), line = document.createElement('em');
      small.textContent = stepId === 'module' ? 'HOUSING' : 'OXYGEN'; line.textContent = choice.line ?? '';
      label.append(small, choice.label, line);
      const arrow = document.createElement('i'); arrow.textContent = '↗';
      button.append(letter, label, arrow);
      button.addEventListener('click', () => {
        if (transition || selection[stepId] === choice.id) return;
        selection = choose(selection, stepId, choice.id); renderSteps(true); syncAssets();
      });
      return button;
    }));
  }
  // 결정 버튼: 결정한 단계의 카드 줄은 접고 다음 단계를 연다. 화면이 복잡해지지 않게 결정한 항목은 한 줄 요약으로만 남긴다
  function decideButton(stepId) {
    const button = document.createElement('button');
    button.className = 'decide'; button.disabled = !selection[stepId];
    button.textContent = { location: '위치', module: '짓는 방식', oxygen: '공기 방식' }[stepId] + ' 결정';
    button.addEventListener('click', () => {
      if (transition || !selection[stepId]) return;
      decided[stepId] = true; renderSteps(true);
      if (stepId === 'oxygen') focusAssets(); // 최종 결정: 주거와 산소 장치를 함께 담는다
    });
    return button;
  }
  const choiceLabel = stepId => availableChoices(stepId, selection).find(c => c.id === selection[stepId])?.label;
  // 1단계 지대 카드는 누르면 그 지역으로 날아가 둘러볼 수 있고, '지대 결정'을 눌러야 다음 단계가 열린다
  function renderSteps(local) {
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
    const summary = $('#decided');
    summary.hidden = !(local && decided.location);
    if (!summary.hidden) summary.textContent = '결정 · ' + COPY[currentSite].title
      + (decided.module ? ' / ' + choiceLabel('module') : '') + (decided.oxygen ? ' / ' + choiceLabel('oxygen') : '');
  }
  // 짓는 방식 선지를 누르는 순간부터 고른 에셋이 놓인 곳으로 다가가 천천히 오른쪽으로 돈다.
  // 공기 선지를 누르면 그 장치로, 공기 방식을 결정하면 주거와 산소 장치를 함께 담도록 다시 맞춘다.
  // FOCUS 는 모듈 점을 아직 못 만든 경우의 지대별 자리다 (지역 단위)
  const FOCUS = { plain: [[0, 0.6, 0], 4.2], lavaTube: [[3.6, -3.4, -1.1], 6.5], ridge: [[-1.6, -0.6, 0], 5.5] };
  const FOCUS_ELEVATION = 28 * Math.PI / 180;
  const FOCUS_ZOOM = { plain: 1, lavaTube: 0.6, ridge: 1 }; // 동굴 속은 더 가까이 (벽에 가리지 않게 거리만 줄인다)
  const ORBIT_SPEED = 0.25; // OrbitControls 기준. 2.0 이면 30초에 한 바퀴, 0.25 면 약 4분
  function focusAssets() {
    if (mode !== 'local' || transition) return;
    if (currentSite === 'lavaTube' && (caveInterior || localSection)) {
      // 동굴 안에서는 돌 수 없으므로 전체 보기로 나와서 다가간다
      caveInterior = false; localSection = false;
      $('#cave-view').textContent = '동굴 내부로'; $('#section').textContent = '단면 보기';
      buildLocal(currentSite); fadePoints(localPoints, 1); setPose(localPose());
      if (moduleLayer) return syncAssets(); // 봉쇄막은 보기마다 모양이 달라 다시 만든 뒤 그 범위로 다가간다
    }
    // 비출 레이어: 산소를 결정했으면 주거 + 산소, 산소 선지를 골랐으면 그 장치, 아니면 주거 모듈
    const overlays = [...overlayLayers.values()];
    const shown = decided.oxygen ? [moduleLayer, ...overlays] : selection.oxygen && overlays.length ? overlays : [moduleLayer];
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
    const position = target.clone().addScaledVector(direction, radius * 2.3 * FOCUS_ZOOM[currentSite] * LOCAL_SCALE);
    focusTween = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), position, target, start: performance.now() };
    controls.autoRotate = false;
  }

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
    controls.minDistance = mode === 'local' ? 6 * LOCAL_SCALE : 18;
    controls.maxDistance = mode === 'local' ? 65 * LOCAL_SCALE : 65;
    controls.update();
  }
  function uiMode(local) {
    document.body.classList.toggle('local', local);
    $('#local-nav').hidden = !local;
    $('#cave-view').hidden = !local || currentSite !== 'lavaTube';
    $('#cave-view').textContent = caveInterior ? '동굴 전체 보기' : '동굴 내부로';
    $('#orbit-note').hidden = local;
    $('#planet-facts').hidden = local;
    $('#planet-labels').hidden = local;
    $('#landmark').hidden = !local;
    if (local) {
      const text = COPY[currentSite];
      $('#eyebrow').textContent = 'SURFACE EXPEDITION / SITE ' + text.letter;
      $('#title').textContent = text.title; $('#description').textContent = text.text;
      $('#landmark').replaceChildren(document.createTextNode(text.tag));
      const sub = document.createElement('small'); sub.textContent = text.sub; $('#landmark').appendChild(sub);
      $('#interaction').textContent = '드래그 회전 · 휠 확대 · 우클릭 이동';
    } else {
      $('#eyebrow').textContent = 'ORBITAL SURVEY / 지표 탐사';
      $('#title').innerHTML = "Teegarden's<br>Star <em>b.</em>";
      $('#description').innerHTML = '별이 지지 않는 세계.<br>황혼의 경계에서 우리의 거주지를 찾습니다.';
      $('#interaction').textContent = '행성 위 A · B · C를 선택해 접근하세요';
      $('#build-time').textContent = 'TEEGARDEN b / ORBITAL VIEW';
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
    $('#build-time').textContent = total.toLocaleString('en-US') + ' POINTS / ' + (cached ? 'CACHED' : elapsed.toFixed(1) + ' ms');
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
  document.addEventListener('keydown', event => { if (event.key === 'Escape') returnToPlanet(); });
  $('#notes-toggle').addEventListener('click', () => {
    $('#notes').hidden = !$('#notes').hidden;
    $('#notes-toggle').setAttribute('aria-expanded', String(!$('#notes').hidden));
    $('#notes-toggle').textContent = '자료와 모델 기준 ' + ($('#notes').hidden ? '＋' : '−');
  });
  new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!transition) setPose(mode === 'planet' ? overviewPose() : localPose(localSection));
  }).observe(host);
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
      const head = $('.heading'), underHeading = x < head.offsetLeft + head.offsetWidth + 10 && y - 54 < head.offsetTop + head.offsetHeight;
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
      }
    } else {
      if (focusTween) {
        const t = clamp((time - focusTween.start) / 1400), e = t * t * (3 - 2 * t);
        camera.position.lerpVectors(focusTween.fromPosition, focusTween.position, e);
        controls.target.lerpVectors(focusTween.fromTarget, focusTween.target, e);
        if (t >= 1) { focusTween = null; controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = ORBIT_SPEED; }
      }
      controls.update(); stage.dataset.phase = 'idle';
      if (reveals.length) {
        prepareProjection();
        for (let i = reveals.length - 1; i >= 0; i--) {
          const progress = clamp((time - reveals[i].start) / 900);
          assemblePoints(reveals[i].points, progress, 'in');
          if (progress >= 1) reveals.splice(i, 1);
        }
      }
    }
    backgroundStars(backgroundAmount);
    stage.dataset.mode = transition ? transition.kind === 'site' ? 'travelling' : 'flying' : mode;
    stage.dataset.site = currentSite ?? '';
    renderer.render(scene, camera); labels();
  }
  requestAnimationFrame(frame);
} catch (error) {
  $('#error').hidden = false;
  $('#error').textContent = '3D 모델을 시작할 수 없습니다. WebGL 지원을 확인해 주세요. ' + error.message;
  console.error(error);
}
