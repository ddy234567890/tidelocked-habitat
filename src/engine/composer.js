import * as THREE from 'three';
import { createPointMaterial, addPointAttributes } from './pointMaterial.js';
import { sampleModel, sampleObject } from './sampleModel.js';
import { createMorph } from './morph.js';
import { toneColors } from './palette.js';

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
      const points = makePoints(overlayShapes[i], 'overlay');
      points.position.set(1.6 + i * 0.7, 0, 0.9); // 연결점(anchor)은 e06/w07 에서 정한다
      overlays.set(id, points);
      jobs.push(reveal(points, 1));
    });

    await Promise.all(jobs);
    return resolved;
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
      const points = makePoints(shape, kind);
      slots[kind] = { id, points, morph: createMorph(points, { duration: 1.8 }) };
      await reveal(points, 1);
      return;
    }
    slot.id = id;
    await slot.morph.to(shape.positions, { color: shape.colors });
  }

  function makePoints(shape, kind) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions.slice(), 3));
    addPointAttributes(geometry, { color: shape.colors.slice() });
    const box = new THREE.Box3().setFromArray(shape.positions);
    const material = createPointMaterial({
      size: kind === 'overlay' ? 6 : 8,
      reveal: 0,
      revealMin: box.min.y - 0.05,
      revealMax: box.max.y + 0.05,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    return points;
  }

  function dispose(points) {
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
  }

  /** 매 프레임 부른다 */
  function update(seconds) {
    const all = [slots.location?.points, slots.module?.points, ...overlays.values()];
    for (const p of all) if (p) p.material.uniforms.uTime.value = seconds;
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
  if (def.asset) {
    colors = new Float32Array(count * 3);
    positions = await sampleModel(def.asset, count, { colors });
  } else {
    positions = sampleObject(placeholder(kind, id), count);
    colors = litColors(positions);
  }

  const scale = def.scale ?? 1;
  const [x, y, z] = def.position ?? [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i] * scale + x;
    positions[i + 1] = positions[i + 1] * scale + y;
    positions[i + 2] = positions[i + 2] * scale + z;
  }

  toneColors(positions, colors);
  return { positions, colors };
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
