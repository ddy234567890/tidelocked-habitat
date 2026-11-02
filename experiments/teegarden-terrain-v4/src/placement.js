import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { choiceData, placeAt, overlaySpot, findSpot, occupancy } from './choices.js';
import { buildCaveSeal } from './lavaTube.js';
import { toneColors, cream } from './palette.js';
import definitions from './sites.json' with { type: 'json' };
import { mulberry32 } from './terrain.js';
// 모델은 메인 게임 public/models 에서 복사했다. 출처·라이선스는 저장소 루트 ASSETS.md (모두 CC0, inflatable 은 팀 자체 제작).
import inflatable from './models/inflatable.glb';
import houseCylinder from './models/house-cylinder.glb';
import houseLong from './models/house-long.glb';
import landerBase from './models/lander-base.glb';
import siloHouse from './models/silo-house.glb';
import silo from './models/silo.glb';
import solarPanelStand from './models/solar-panel-stand.glb';
import vent from './models/vent.glb';
import waterTank from './models/water-tank.glb';
import waterTankFloor from './models/water-tank-floor.glb';
import glassBox from './models/glass-box.glb';
import pickupTank from './models/pickup-tank.glb';
import gasTank from './models/gas-tank.glb';
import waterTowerB from './models/water-tower-b.glb';
import machine from './models/machine.glb';
import baseLarge from './models/base-large.glb';
import tubeConnector from './models/tube-connector.glb';
import spaceBaseModules from './models/space-base-modules.glb';

const MODELS = {
  inflatable, 'house-cylinder': houseCylinder, 'house-long': houseLong, 'lander-base': landerBase, 'silo-house': siloHouse,
  silo, 'solar-panel-stand': solarPanelStand, vent, 'water-tank': waterTank, 'water-tank-floor': waterTankFloor,
  'glass-box': glassBox, 'pickup-tank': pickupTank, 'gas-tank': gasTank, 'water-tower-b': waterTowerB, machine,
  'base-large': baseLarge, 'tube-connector': tubeConnector, 'space-base-modules': spaceBaseModules
};
// 에셋 점은 개수를 정해 두지 않고 겉넓이에 맞춰 고르게 깐다. 점 크기(지역 단위 0.075)보다 조금 촘촘히 깔아
// 해상도를 올리되, 밝기를 낮춰 겹친 곳이 하얗게 뭉치지 않게(AdditiveBlending) 한다.
// 레이어마다 JSON 의 spacing·gain 으로 바꿀 수 있다 (높은 탑처럼 불투명해 보이는 모델은 성기고 어둡게)
export const POINT_SPACING = 0.062;
const CANDIDATES = 2.6; // 간격 칸마다 미리 뽑는 후보 수. 많을수록 빈 칸이 줄고 고르다
const MAX_POINTS = 24000; // 한 레이어의 상한
const GAIN = { module: 0.74, overlay: 0.92 }; // 겹친 곳이 하얗게 넘치지 않을 밝기. 산소 장치는 작아서 더 밝고 촘촘하게 둔다
const OVERLAY_SPACING = 0.05;
export const LAYER_POINTS = { seal: 9000, coat: 1800 };

const loader = new GLTFLoader();
const models = new Map();
const loadModel = name => {
  if (!MODELS[name]) throw new Error(`placement: 모델 '${name}' 이 없어요`);
  if (!models.has(name)) models.set(name, loader.loadAsync(MODELS[name]).then(gltf => gltf.scene));
  return models.get(name);
};

// 모델 표면에서 점 n 개: 메시 겉넓이 비율대로 나누고, 원래 색(정점 색 × 재질 색)을 함께 읽는다
const triangle = new THREE.Triangle(), ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3();
function surfaceArea(geometry, matrix) {
  const pos = geometry.getAttribute('position'), index = geometry.index, faces = (index ? index.count : pos.count) / 3;
  let area = 0;
  for (let f = 0; f < faces; f++) {
    const at = k => (index ? index.getX(f * 3 + k) : f * 3 + k);
    ta.fromBufferAttribute(pos, at(0)).applyMatrix4(matrix); tb.fromBufferAttribute(pos, at(1)).applyMatrix4(matrix); tc.fromBufferAttribute(pos, at(2)).applyMatrix4(matrix);
    area += triangle.set(ta, tb, tc).getArea();
  }
  return area;
}
function sampleObject(root, n, matrix, random) {
  const parts = [];
  root.traverse(obj => { if (obj.isMesh && obj.geometry.getAttribute('position')) parts.push({ mesh: obj, area: surfaceArea(obj.geometry, obj.matrixWorld) }); });
  const total = parts.reduce((sum, p) => sum + p.area, 0) || 1;
  let left = n;
  parts.forEach((p, k) => { p.count = k === parts.length - 1 ? left : Math.round(p.area / total * n); left -= p.count; });
  const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  const v = new THREE.Vector3(), normal = new THREE.Vector3(), c = new THREE.Color();
  let i = 0;
  for (const { mesh, count } of parts) {
    if (count <= 0) continue;
    const sampler = new MeshSurfaceSampler(mesh).setRandomGenerator(random).build(), vertexColor = !!mesh.geometry.getAttribute('color');
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, base = material?.color ?? new THREE.Color(1, 1, 1);
    for (let k = 0; k < count; k++, i++) {
      c.setRGB(1, 1, 1);
      sampler.sample(v, normal, vertexColor ? c : undefined);
      v.applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix).toArray(positions, i * 3);
      colors.set([c.r * base.r, c.g * base.g, c.b * base.b], i * 3);
    }
  }
  return { positions, colors, area: total };
}
// 같은 칸(한 변 = 간격)에 든 점은 하나만 남겨 고르게 편다
function thin(positions, colors, spacing) {
  const seen = new Set(), keep = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const key = [0, 1, 2].map(k => Math.floor(positions[i * 3 + k] / spacing)).join(',');
    if (!seen.has(key)) { seen.add(key); keep.push(i); }
  }
  const step = Math.max(1, keep.length / MAX_POINTS), out = empty(Math.min(keep.length, MAX_POINTS));
  for (let j = 0; j < out.shake.length; j++) {
    const i = keep[Math.floor(j * step)];
    out.positions.set(positions.subarray(i * 3, i * 3 + 3), j * 3); out.colors.set(colors.subarray(i * 3, i * 3 + 3), j * 3);
  }
  return out;
}

const empty = n => ({ positions: new Float32Array(n * 3), colors: new Float32Array(n * 3), shake: new Float32Array(n) });
const placement = (site, part, spot) => new THREE.Matrix4().compose(
  new THREE.Vector3(...(spot ?? placeAt(site, part.position ?? [0, 0], part.crest))),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(part.rotation ?? 0)),
  new THREE.Vector3().setScalar(part.scale ?? 1));

/** 모델 여러 개를 각자 자리에 놓고 겉넓이에 맞춰 고르게 점을 깐다. 색은 프로젝트 규칙으로 바꾼 뒤 kind 에 맞게 어둡게 */
async function sampleParts(site, parts, kind, spot, seed, { spacing = POINT_SPACING, gain = GAIN[kind] } = {}) {
  const random = mulberry32(seed), chunks = [];
  for (const part of parts) {
    const root = await loadModel(part.asset);
    root.updateWorldMatrix(true, true);
    let area = 0;
    root.traverse(obj => { if (obj.isMesh && obj.geometry.getAttribute('position')) area += surfaceArea(obj.geometry, obj.matrixWorld); });
    const n = Math.min(60000, Math.ceil(area * (part.scale ?? 1) ** 2 / spacing ** 2 * CANDIDATES));
    chunks.push(sampleObject(root, n, placement(site, part, spot), random));
  }
  const total = chunks.reduce((sum, c) => sum + c.positions.length, 0);
  const positions = new Float32Array(total), colors = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { positions.set(c.positions, offset); colors.set(c.colors, offset); offset += c.positions.length; }
  const out = thin(positions, colors, spacing);
  toneColors(out.positions, out.colors);
  for (let i = 0; i < out.colors.length; i++) out.colors[i] *= gain;
  return out;
}

/** 주거 모듈 레이어 (지대 좌표). view 는 용암동굴 보기('interior' 면 봉쇄막 양쪽 반) */
export async function buildModule(site, id, view) {
  const def = choiceData.layers.module[id];
  if (def.parts[0].special === 'caveSeal') return buildCaveSeal(LAYER_POINTS.seal, definitions.lavaTube, view !== 'interior');
  return sampleParts(site, def.parts, 'module', null, 7001, def);
}

/** 산소 오버레이 레이어. wallCoat 는 지금 주거 모듈 겉면을 덮는 크림 점이라 모듈 점이 필요하다 */
export async function buildOverlay(site, id, modulePoints) {
  const def = choiceData.layers.overlay[id];
  if (def.special === 'wallCoat') {
    if (!modulePoints) return empty(0);
    const m = modulePoints.length / 3, random = mulberry32(5150), n = Math.min(LAYER_POINTS.coat, Math.round(m * 0.3)), out = empty(n);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(random() * m) * 3;
      out.positions.set([0, 1, 2].map(j => modulePoints[k + j] + (random() - 0.5) * 0.06), i * 3);
      out.colors.set(cream(0.4 + random() * 0.35), i * 3);
    }
    return out;
  }
  // 장치 크기(바닥 반지름·높이)로 주거 모듈·지형과 겹치지 않는 가장 가까운 자리를 찾는다
  const box = new THREE.Box3().setFromObject(await loadModel(def.asset)), size = box.getSize(new THREE.Vector3()).multiplyScalar(def.scale ?? 1);
  const footprint = { r: Math.hypot(size.x, size.z) / 2, h: size.y };
  const spot = findSpot(site, overlaySpot(site, id), footprint, occupancy(modulePoints));
  const out = await sampleParts(site, [def], 'overlay', spot, 7002, { spacing: OVERLAY_SPACING, ...def });
  out.spot = spot; out.footprint = footprint;
  return out;
}
