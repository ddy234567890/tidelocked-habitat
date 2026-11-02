import * as THREE from 'three';
import { createPointMaterial, addPointAttributes } from './pointMaterial.js';
import { sampleModel, sampleObject } from './sampleModel.js';
import { createMorph } from './morph.js';
import { toneColors, CREAM, AMBER, blue } from './palette.js';
import { createFlow } from './flow.js';
import { buildStage } from '../scenes/locations/index.js';
import modelSizes from '../data/modelSizes.json';

/**
 * 레이어 조합기 (카드 e05)
 *
 * 장면 = 위치 무대(location) + 주거 모듈(module) + 산소 오버레이(overlays) 의 조합이다 (CLAUDE.md).
 * 선지 JSON(src/data/choices/weekN.json)과 지금 선택 상태를 받아, 필요한 레이어만 불러와 그린다.
 * 선택이 바뀌면 바뀐 레이어만 움직인다: 무대·모듈은 모프 전환, 오버레이는 스캔라인으로 나타나고 사라진다.
 *
 * 사용법:
 *   import week1 from './data/choices/week1.json';
 *   import { createComposer } from './engine/composer.js';
 *
 *   const composer = createComposer({ scene, rig, data: week1 });
 *   const { stats } = await composer.apply({ location: 'A', module: 'A1', oxygen: 'O_algae' });
 *
 *   // 매 프레임
 *   composer.update(seconds);
 *
 * JSON 형식
 *   cameraShots  { 샷이름: { position, target, fov } }  rig 에 등록된다
 *   layers       { location|module|overlay: { 레이어id: { label, asset, position?, scale? } } }
 *                asset 이 .glb 경로면 그 모델을, null 이면 박스 자리표시를 그린다
 *                parts: [{ asset, position?, scale?, rotation? }] 를 주면 모델 여러 개를 한 레이어로 묶는다
 *                (rotation 은 세로축 기준 도). 점은 크기(scale², 또는 weight)에 비례해 나눈다
 *                asset 대신 box: [가로, 높이, 두께] 를 주면 바닥이 position 에 닿는 상자를 그린다 (세운 패널·벽 같은 단순한 모양)
 *                stage 가 있으면(위치 무대) src/scenes/locations 의 그 무대가 점과 색을 직접 만든다
 *                motion: "inflate" 면 공기를 넣은 것처럼 납작한 데서 부풀어 오르며 나타나고, 평소에는 천천히 숨 쉬듯 부푼다
 *                (점 위치는 그대로 두고 레이어 전체 크기만 움직인다. 셰이더는 그대로)
 *                flows: [{ path: [[x,y,z]…], color?: "cream"|"amber"|"blue", speed?, count?, size? }] 를 주면 그 레이어가 있는 동안
 *                경로를 따라 흐르는 점(flow.js)을 함께 그린다. 산소는 크림, 전기는 파랑, 내쉰 공기는 주황
 *                labelAt: [x,y,z] 이 레이어 이름표를 붙일 자리 (데모 화면이 쓴다)
 *                오버레이에 position 을 주면 그 자리에 그대로 놓는다 (주지 않으면 임시 자리에 줄지어 놓는다)
 *                pointSize 를 주면 그 레이어의 점 크기(uSize)를 바꾼다. 셰이더는 그대로고 값만 다르다
 *                src/data/modelSizes.json 에 있는 모델(Kenney 묶음)은 실제 크기 비율을 scale 에 자동으로 곱한다.
 *                그래서 scale: 1 이면 "원래 크기"이고, 막사와 산소 기계를 같은 scale 로 놓아도 크기 차이가 그대로 보인다
 *   steps[]      { id, label, choices[] }  선택 단계 (위치 → 주거 → 산소)
 *     choice     { id, label, location?, module?, overlays?, cameraShot?, stats, requires?, hidden? }
 *                requires: { 단계id: [선지id…] }  그 선지를 고른 경우에만 보인다
 *                hidden: true  정찰 등으로 열리는 히든 선지
 *
 * - 선택 상태는 { 단계id: 선지id } 이다. 고르지 않은 단계는 비워 둔다.
 * - stats 는 고른 선지들의 값을 차례로 덮어쓴 결과다. null 은 "아직 정하지 않음"이다.
 */

// 레이어 종류마다 점 개수는 고정 (같은 종류끼리 모프하려면 같아야 한다)
export const LAYER_POINTS = { location: 30000, module: 15000, overlay: 2500 };

/** JSON 의 scale 에 모델의 실제 크기 비율을 곱한 값 (목록에 없는 모델은 그대로) */
const sizeOf = (asset) => modelSizes.sizes[asset] ?? 1;
const realScale = (def) => (def.scale ?? 1) * (def.asset ? sizeOf(def.asset) : 1);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const starDir = new THREE.Vector3(1, 0.6, 0.3).normalize(); // 별은 고정

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data   선지 JSON
 * @param {object} [o.rig]  cameraRig. 있으면 cameraShots 를 등록하고 선지의 cameraShot 으로 이동한다
 */
export function createComposer({ scene, data, rig }) {
  if (rig) for (const [name, shot] of Object.entries(data.cameraShots ?? {})) rig.addShot(name, shot);

  const cache = new Map(); // "kind:id" → Promise<{ positions, colors }>
  const slots = { location: null, module: null }; // { id, points, morph }
  const overlays = new Map(); // id → points
  const flows = new Map(); // "kind:id:번호" → flow
  let applySeq = 0;

  function load(kind, id) {
    const key = `${kind}:${id}`;
    if (!cache.has(key)) cache.set(key, buildLayer(kind, id, data.layers[kind]?.[id]));
    return cache.get(key);
  }

  /** 지금 선택 상태에서 고를 수 있는 선지 목록 (requires 를 만족하는 것만) */
  function availableChoices(stepId, selection) {
    const step = data.steps.find((s) => s.id === stepId);
    return (step?.choices ?? []).filter((c) => isAvailable(c, selection));
  }

  /**
   * 선택 상태를 장면에 적용한다.
   * @param {Record<string, string>} selection  { location: 'A', module: 'A1', oxygen: 'O_algae' }
   * @returns {Promise<{ layers, stats, cameraShot }>}
   */
  async function apply(selection) {
    const seq = ++applySeq;
    const resolved = resolve(data, selection);
    const { layers } = resolved;

    // 필요한 레이어만 불러온다
    const [location, module, ...overlayShapes] = await Promise.all([
      layers.location ? load('location', layers.location) : null,
      layers.module ? load('module', layers.module) : null,
      ...layers.overlays.map((id) => load('overlay', id)),
    ]);
    if (seq !== applySeq) return resolved; // 그 사이에 다른 선택이 들어왔다

    if (rig && resolved.cameraShot) rig.goTo(resolved.cameraShot);

    const jobs = [
      setSlot('location', layers.location, location),
      setSlot('module', layers.module, module),
    ];

    // 오버레이: 빠진 것은 사라지고, 새로 생긴 것만 나타난다
    for (const [id, points] of overlays) {
      if (layers.overlays.includes(id)) continue;
      overlays.delete(id);
      jobs.push(reveal(points, 0).then(() => dispose(points)));
    }
    layers.overlays.forEach((id, i) => {
      if (overlays.has(id)) return;
      const points = makePoints(overlayShapes[i], 'overlay', overlayShapes[i].size);
      // JSON 에 자리가 없으면 임시 자리에 줄지어 놓는다 (연결점 anchor 는 w07 에서 정한다)
      if (!data.layers.overlay[id]?.position) points.position.set(1.6 + i * 0.7, 0, 0.9);
      overlays.set(id, points);
      jobs.push(reveal(points, 1));
    });

    jobs.push(...syncFlows(layers));

    await Promise.all(jobs);
    return resolved;
  }

  /** 지금 레이어들이 가진 flows 만 남기고, 빠진 것은 지우고 새로 생긴 것은 나타나게 한다 */
  function syncFlows(layers) {
    const wanted = new Map();
    const add = (kind, id) => {
      (data.layers[kind]?.[id]?.flows ?? []).forEach((f, i) => wanted.set(`${kind}:${id}:${i}`, f));
    };
    if (layers.location) add('location', layers.location);
    if (layers.module) add('module', layers.module);
    for (const id of layers.overlays) add('overlay', id);

    const jobs = [];
    for (const [key, flow] of flows) {
      if (wanted.has(key)) continue;
      flows.delete(key);
      jobs.push(reveal(flow.points, 0).then(() => flow.dispose()));
    }
    for (const [key, f] of wanted) {
      if (flows.has(key)) continue;
      const flow = createFlow({ path: f.path, color: FLOW_COLORS[f.color ?? 'cream'], speed: f.speed, count: f.count ?? 500, size: f.size ?? 11 });
      flow.points.material.uniforms.uReveal.value = 0;
      scene.add(flow.points);
      flows.set(key, flow);
      jobs.push(reveal(flow.points, 1));
    }
    return jobs;
  }

  async function setSlot(kind, id, shape) {
    const slot = slots[kind];
    if (slot?.id === id) return;
    if (!id) {
      if (!slot) return;
      slots[kind] = null;
      await reveal(slot.points, 0);
      dispose(slot.points);
      return;
    }
    if (!slot) {
      const points = makePoints(shape, kind, shape.size);
      slots[kind] = { id, points, morph: createMorph(points, { duration: 1.8 }) };
      startMotion(slots[kind], shape.motion, 0.08);
      await reveal(points, 1);
      return;
    }
    slot.id = id;
    startMotion(slot, shape.motion, 0.55);
    slot.points.material.uniforms.uSize.value = shape.size ?? (kind === 'overlay' ? 6 : 8); // 무대마다 점 크기가 다를 수 있다
    setShake(slot.points, null); // 모양이 바뀌는 동안은 떨림을 끈다
    await slot.morph.to(shape.positions, { color: shape.colors });
    if (slot.id === id) setShake(slot.points, shape.shake); // 그 사이 다른 선택이 들어오지 않았으면 새 모양의 떨림을 켠다
  }

  function makePoints(shape, kind, size) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions.slice(), 3));
    addPointAttributes(geometry, { color: shape.colors.slice(), shake: shape.shake?.slice() });
    const material = createPointMaterial({ size: size ?? (kind === 'overlay' ? 6 : 8), reveal: 0 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    return points;
  }

  /** 점마다 떨림 세기(aShake)를 바꾼다. null 이면 모두 가만히 */
  function setShake(points, values) {
    const attribute = points.geometry.getAttribute('aShake');
    if (values) attribute.array.set(values);
    else attribute.array.fill(0);
    attribute.needsUpdate = true;
  }

  function dispose(points) {
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
  }

  /** 레이어 움직임을 시작한다. from: 부풀기 시작할 때 높이 비율 (새로 나타나면 거의 납작하게) */
  function startMotion(slot, motion, from) {
    slot.motion = motion ?? null;
    slot.motionStart = performance.now();
    slot.motionFrom = from;
    if (!slot.motion) slot.points.scale.set(1, 1, 1);
  }

  /** 매 프레임 부른다 */
  function update(seconds) {
    const all = [slots.location?.points, slots.module?.points, ...overlays.values()];
    for (const p of all) if (p) p.material.uniforms.uTime.value = seconds;
    for (const flow of flows.values()) flow.update(seconds);

    for (const slot of [slots.location, slots.module]) {
      if (slot?.motion !== 'inflate') continue;
      if (reducedMotion.matches) {
        slot.points.scale.set(1, 1, 1);
        continue;
      }
      // 부풀어 오르기: 살짝 넘쳤다가 자리 잡는다. 납작할 때는 옆으로 퍼져 있다
      const t = Math.min((performance.now() - slot.motionStart) / 1400, 1);
      const grow = slot.motionFrom + (1 - slot.motionFrom) * easeOutBack(t);
      // 숨쉬기: 아주 천천히 부풀었다 줄어든다
      const breath = 0.018 * Math.sin(seconds * 1.3);
      const spread = 1 + (1 - grow) * 0.18;
      slot.points.scale.set(spread * (1 - breath * 0.4), grow * (1 + breath), spread * (1 - breath * 0.4));
    }
  }

  return { apply, update, availableChoices, resolve: (selection) => resolve(data, selection) };
}

/** 선택 상태 → 그릴 레이어, 카메라 샷, stats */
export function resolve(data, selection) {
  const layers = { location: null, module: null, overlays: [] };
  const stats = {};
  let cameraShot = null;
  for (const step of data.steps) {
    const choice = step.choices.find((c) => c.id === selection[step.id]);
    if (!choice || !isAvailable(choice, selection)) continue;
    if (choice.location) layers.location = choice.location;
    if (choice.module) layers.module = choice.module;
    if (choice.overlays) layers.overlays.push(...choice.overlays);
    if (choice.cameraShot) cameraShot = choice.cameraShot;
    Object.assign(stats, choice.stats);
  }
  return { layers, stats, cameraShot };
}

const FLOW_COLORS = { cream: CREAM, amber: AMBER, blue: blue(0.8) };

function easeOutBack(t) {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function isAvailable(choice, selection) {
  return Object.entries(choice.requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
}

function reveal(points, to) {
  const u = points.material.uniforms.uReveal;
  const from = u.value;
  const time = reducedMotion.matches ? 0 : 1.2;
  const token = (points.userData.revealToken = {}); // 같은 레이어에 새 reveal 이 오면 이전 것은 멈춘다
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      if (points.userData.revealToken !== token) return resolve();
      const t = time ? Math.min((now - start) / 1000 / time, 1) : 1;
      u.value = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function buildLayer(kind, id, def) {
  if (!def) throw new Error(`composer: JSON layers.${kind} 에 '${id}' 가 없어요`);
  const count = LAYER_POINTS[kind];
  let positions;
  let colors;
  let shake; // 점마다 떨림 세기 (있으면)
  if (def.stage) {
    ({ positions, colors, shake } = buildStage(def.stage, count, def));
  } else if (def.parts?.length) {
    ({ positions, colors } = await sampleParts(def.parts, count));
  } else if (def.asset) {
    colors = new Float32Array(count * 3);
    positions = await sampleModel(def.asset, count, { colors });
  } else {
    positions = sampleObject(placeholder(kind, id), count);
    colors = litColors(positions);
  }

  const scale = def.parts?.length ? (def.scale ?? 1) : realScale(def);
  const [x, y, z] = def.position ?? [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i] * scale + x;
    positions[i + 1] = positions[i + 1] * scale + y;
    positions[i + 2] = positions[i + 2] * scale + z;
  }

  if (!def.stage) toneColors(positions, colors); // 무대는 온도 색으로 이미 칠해서 온다
  return { positions, colors, shake, size: def.pointSize, motion: def.motion };
}

/** 모델 여러 개를 각자 자리에 놓고 점 count 개를 나눠 뽑는다 (합은 정확히 count) */
async function sampleParts(parts, count) {
  const weights = parts.map((p) => p.weight ?? realScale(p) ** 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / total) * count));
  counts[0] += count - counts.reduce((a, b) => a + b, 0);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let offset = 0;
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const n = counts[k];
    if (!n) continue;
    const c = new Float32Array(n * 3);
    const p = part.box ? sampleBox(part.box, n, c) : await sampleModel(part.asset, n, { colors: c });
    m.compose(
      new THREE.Vector3().fromArray(part.position ?? [0, 0, 0]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(part.rotation ?? 0)),
      new THREE.Vector3().setScalar(part.box ? (part.scale ?? 1) : realScale(part)),
    );
    for (let i = 0; i < n; i++) {
      v.fromArray(p, i * 3).applyMatrix4(m).toArray(positions, (offset + i) * 3);
    }
    colors.set(c, offset * 3);
    offset += n;
  }
  return { positions, colors };
}

/** 바닥 가운데가 원점인 상자 표면에서 점 n 개 */
function sampleBox([w, h, d], n, colors) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  mesh.position.y = h / 2;
  return sampleObject(mesh, n, { colors });
}

/** 에셋이 아직 없는 레이어의 박스 자리표시. id 마다 크기가 조금씩 달라 전환이 눈에 보인다 */
function placeholder(kind, id) {
  const r = seeded(id);
  let w, h, d, y;
  if (kind === 'location') {
    [w, h, d] = [4 + r() * 1.5, 0.2 + r() * 0.4, 3 + r() * 1];
    y = -h / 2;
  } else if (kind === 'module') {
    [w, h, d] = [0.8 + r() * 1.2, 0.5 + r() * 1.3, 0.8 + r() * 1.0];
    y = h / 2;
  } else {
    [w, h, d] = [0.25 + r() * 0.25, 0.3 + r() * 0.4, 0.25 + r() * 0.25];
    y = h / 2;
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  mesh.position.y = y;
  return mesh;
}

/** 자리표시용 원래 색: 별을 향한 면이 밝은 회색 */
function litColors(positions) {
  const colors = new Float32Array(positions.length);
  const box = new THREE.Box3().setFromArray(positions);
  const center = box.getCenter(new THREE.Vector3());
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    const l = 0.45 + 0.55 * Math.max(0, v.fromArray(positions, i).sub(center).normalize().dot(starDir));
    colors.fill(l, i, i + 3);
  }
  return colors;
}

function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
