import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { choiceData, placeAt, overlaySpot, surfaceSpot, findSpot, occupancy, siteLetter } from './choices.js';
import { buildCaveSeal } from './lavaTube.js';
import { toneColors, cream, blue, orange } from './palette.js';
import definitions from './sites.json' with { type: 'json' };
import modelSizes from './modelSizes.json' with { type: 'json' };
import { mulberry32 } from './terrain.js';
// 1주차 건물·산소 장치는 가벼운 Kenney Space Kit 모델(CC0, 모두 삼각형 500개 이하)로 바꿨다.
// 메인 게임 public/models 에서 복사했다. 출처·라이선스는 저장소 루트 ASSETS.md "1주차 와이어프레임용" 표.
import hangarRound from './models/hangar-round.glb';
import hangarRoundGlass from './models/hangar-round-glass.glb';
import hangarSmall from './models/hangar-small.glb';
import hangarLarge from './models/hangar-large.glb';
import mound from './models/mound.glb';
import gateAirlock from './models/gate-airlock.glb';
import gateComplex from './models/gate-complex.glb';
import tunnelEntrance from './models/tunnel-entrance.glb';
import corridor from './models/corridor.glb';
import corridorCorner from './models/corridor-corner.glb';
import corridorSplit from './models/corridor-split.glb';
import corridorWindow from './models/corridor-window.glb';
import platformLow from './models/platform-low.glb';
import platformHigh from './models/platform-high.glb';
import stairs from './models/stairs.glb';
import structure from './models/structure.glb';
import structureClosed from './models/structure-closed.glb';
import structureDetailed from './models/structure-detailed.glb';
import supportsHigh from './models/supports-high.glb';
import generatorLarge from './models/generator-large.glb';
import tankLarge from './models/tank-large.glb';
import recycler from './models/recycler.glb';
import pipeStraight from './models/pipe-straight.glb';
import pipeSplit from './models/pipe-split.glb';
import pipeRing from './models/pipe-ring.glb';
import generatorSmall from './models/generator-small.glb';
import airUnitSmall from './models/air-unit-small.glb';
import rockLarge from './models/rock-large.glb';
import rocksSmall from './models/rocks-small.glb';
import solarPanel from './models/solar-panel.glb';
import battery from './models/battery.glb';
import machine from './models/machine.glb';
import waterTowerB from './models/water-tower-b.glb';
import barrelB from './models/barrel-b.glb';
import glassCylinder from './models/glass-cylinder.glb';
import landerB from './models/lander-b.glb';
import spaceTruck from './models/space-truck.glb';
import drill from './models/drill.glb';
import oven from './models/oven.glb';
import shelf from './models/shelf.glb';
import cabbage from './models/cabbage.glb';
import wheat from './models/wheat.glb';
import corn from './models/corn.glb';
import astronaut from './models/astronaut.glb';
import spaceship from './models/spaceship.glb';

const MODELS = {
  'hangar-round': hangarRound, 'hangar-round-glass': hangarRoundGlass, 'hangar-small': hangarSmall, 'hangar-large': hangarLarge,
  mound, 'gate-airlock': gateAirlock, 'gate-complex': gateComplex, 'tunnel-entrance': tunnelEntrance,
  corridor, 'corridor-corner': corridorCorner, 'corridor-split': corridorSplit, 'corridor-window': corridorWindow,
  'platform-low': platformLow, 'platform-high': platformHigh, stairs, structure, 'structure-closed': structureClosed,
  'structure-detailed': structureDetailed, 'supports-high': supportsHigh, 'generator-large': generatorLarge, 'tank-large': tankLarge,
  recycler, 'pipe-straight': pipeStraight, 'pipe-split': pipeSplit, 'pipe-ring': pipeRing, 'generator-small': generatorSmall,
  'air-unit-small': airUnitSmall, 'rock-large': rockLarge, 'rocks-small': rocksSmall,
  'solar-panel': solarPanel, battery,
  machine, 'water-tower-b': waterTowerB, 'barrel-b': barrelB, 'glass-cylinder': glassCylinder, 'lander-b': landerB, 'space-truck': spaceTruck, drill, oven, shelf, cabbage, wheat, corn, astronaut, spaceship
};
// 와이어프레임: 모델의 면을 채우지 않고 모서리 선을 따라 점을 촘촘히 늘어놓는다. 머티리얼은 지형과 같은 하나 그대로다.
// EDGE_ANGLE 보다 덜 꺾인 모서리(둥근 면을 이루는 잔 선)는 그리지 않아 선이 뭉치지 않는다
// 가까이 가면 선 점이 작아지므로(main.js LINE_MIN) 간격도 그만큼 촘촘해야 끊기지 않는다
export const EDGE_SPACING = 0.01; // 선 위 점 간격 (지역 단위). 흔들림(최대 1.5칸) 을 더해도 가장 작아진 점(0.019)보다 작아서 끊기지 않은 선으로 보인다
const EDGE_ANGLE = 14; // 이 각도(도) 이상 꺾인 모서리만 선으로 그린다 (둥근 지붕의 마디는 남는다)
const LINE_FLOOR = 0.45; // 재질 색을 흰색 쪽으로 이만큼 당긴다
const ROOF_REACH = 1.4; // 집마다 두는 장치가 집 벽에서 이보다 멀어지면 지붕 위에 올린다
const LINE_MIN = 0.55; // 선 점의 가장 어두운 밝기 (파랑 단계 기준)
const MAX_POINTS = 60000; // 한 레이어의 상한
const GAIN = { module: 0.95, overlay: 1 }; // 선은 가늘어서 면보다 밝게 둔다
// 지형은 파랑. 방금 더한 선지는 크림(선이 겹쳐 흰색으로 보인다), 그 전 선지는 주황.
// range 는 [가장 어두운 밝기, 밝기 폭]. 한 점 기준이라 겹쳐 그려지면 약 2배로 밝아진다.
// weight 는 main.js lineWeight: 작을수록 선이 굵고 밝다. 방금 더한 선지는 또렷하게, 그 전 선지는 가늘고 연하게 둔다
export const TINT = { new: { color: cream, range: [0.3, 0.25], weight: 0.75 }, old: { color: orange, range: [0.22, 0.1], weight: 0.9 } };
export const LAYER_POINTS = { seal: 9000, coat: 1800 };

/** 점마다의 밝기(levels)를 role('new' 방금 더한 선지, 'old' 그 전 선지) 색으로 칠한다 */
export function tintLayer(levels, role) {
  const { color, range: [low, span] } = TINT[role], out = new Float32Array(levels.length * 3);
  for (let i = 0; i < levels.length; i++) out.set(color(low + span * levels[i]), i * 3);
  return out;
}

const loader = new GLTFLoader();
const models = new Map();
// 한 파일로 묶으면 모델이 데이터 주소로 들어온다. 공유 링크에서는 fetch 가 막히므로 직접 풀어서 읽는다
const loadGlb = url => {
  if (!url.startsWith('data:')) return loader.loadAsync(url);
  return loader.parseAsync(Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0)).buffer, '');
};
const loadModel = name => {
  if (!MODELS[name]) throw new Error(`placement: 모델 '${name}' 이 없어요`);
  if (!models.has(name)) models.set(name, loadGlb(MODELS[name]).then(gltf => gltf.scene));
  return models.get(name);
};

// asset 대신 box: [가로, 높이, 두께] 를 주면 바닥이 자리에 닿는 상자를 그린다 (방열판처럼 모델 없이 되는 단순한 모양)
const boxOf = ([w, h, d]) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)), root = new THREE.Group();
  root.add(mesh);
  return root;
};
const partModel = part => (part.box ? boxOf(part.box) : loadModel(part.asset));

/** 모델의 실제 크기 배율: JSON scale × 원래 크기 비율 (modelSizes.json). 그래서 scale 1 이 원래 크기다. 상자는 box 값이 곧 크기다 */
export const realScale = part => (part.scale ?? 1) * (part.box ? 1 : (modelSizes.sizes[part.asset] ?? 1) * modelSizes.tile);

// 모델 모서리를 따라 점을 깐다. 색은 메시 재질 색(밝기만 쓰고 toneColors 가 파랑 단계로 바꾼다)
const va = new THREE.Vector3(), vb = new THREE.Vector3();
function sampleEdges(root, matrix, spacing, random) {
  const positions = [], colors = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
    // 어두운 재질(바위·흙 등)은 가는 선이 배경에 묻히므로 밝기 바닥을 올린다 (밝은 쪽 순서는 그대로)
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const base = (material?.color ?? new THREE.Color(1, 1, 1)).clone().lerp(new THREE.Color(1, 1, 1), LINE_FLOOR);
    const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE), line = edges.getAttribute('position');
    for (let s = 0; s < line.count; s += 2) {
      va.fromBufferAttribute(line, s).applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix);
      vb.fromBufferAttribute(line, s + 1).applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix);
      const n = Math.max(1, Math.ceil(va.distanceTo(vb) / spacing)), jitter = random() * 0.5;
      for (let k = 0; k <= n; k++) {
        const t = Math.min(1, (k + (k && k < n ? jitter : 0)) / n);
        positions.push(va.x + (vb.x - va.x) * t, va.y + (vb.y - va.y) * t, va.z + (vb.z - va.z) * t);
        colors.push(base.r, base.g, base.b);
      }
    }
    edges.dispose();
  });
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors) };
}
// 여러 모델이 같은 선을 겹쳐 그린 곳(맞닿은 벽 등)은 한 칸에 점 하나만 남긴다
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

// 지난 주차 건물은 선 대신 면(로우 폴리)으로 그린다: 모델 삼각형을 지역 좌표로 옮겨 그대로 모은다
const fa = new THREE.Vector3();
function collectFaces(root, matrix) {
  const out = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      fa.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(matrix);
      out.push(fa.x, fa.y, fa.z);
    }
    if (geometry !== mesh.geometry) geometry.dispose();
  });
  return out;
}
const FACE_LIGHT = new THREE.Vector3(0.45, 1, 0.3).normalize(); // 면 밝기를 정하는 고정 빛 방향 (지역 좌표)
export const FACE_RANGE = [0.16, 0.3]; // 지난 건물 면의 [가장 어두운 밝기, 밝기 폭]. 지금 주차의 흰 선이 늘 더 밝다
/** 삼각형 목록(faces)의 면마다 하나의 주황 밝기를 준다. 면이 빛을 향할수록 밝아 각진 로우 폴리로 보인다 */
export function faceColors(faces) {
  const out = new Float32Array(faces.length), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const [low, span] = FACE_RANGE;
  for (let i = 0; i < faces.length; i += 9) {
    a.fromArray(faces, i); b.fromArray(faces, i + 3); c.fromArray(faces, i + 6);
    const normal = c.sub(b).cross(a.sub(b)).normalize();
    const color = orange(low + span * Math.abs(normal.dot(FACE_LIGHT)));
    for (let k = 0; k < 9; k += 3) out.set(color, i + k);
  }
  return out;
}

// 와이어프레임은 속이 비어 있어서, 장치 자리를 찾을 때 쓰는 '차지한 자리'는 점 대신 모델 상자로 만든다:
// 상자 바닥 넓이를 칸(0.2)마다 덮는 기둥의 아래·위 두 점
function blockOf(root, matrix) {
  const box = new THREE.Box3().setFromObject(root).applyMatrix4(matrix), out = [];
  for (let x = box.min.x; x <= box.max.x + 0.1; x += 0.2) for (let z = box.min.z; z <= box.max.z + 0.1; z += 0.2)
    out.push(Math.min(x, box.max.x), box.min.y, Math.min(z, box.max.z), Math.min(x, box.max.x), box.max.y, Math.min(z, box.max.z));
  return out;
}

const empty = n => ({ positions: new Float32Array(n * 3), colors: new Float32Array(n * 3), shake: new Float32Array(n) });
/** 그 부품이 놓일 지대 좌표. spot 이 있으면 그 자리 기준 상대 위치(offset), lift 는 바닥에서 띄우는 높이 */
function partSpot(site, part, spot) {
  if (!spot) {
    const [x, y, z] = placeAt(site, part.position ?? [0, 0], part.crest);
    return [x, y + (part.lift ?? 0), z];
  }
  const [dx, dz] = part.offset ?? [0, 0];
  return [spot[0] + dx, spot[1] + (part.lift ?? 0), spot[2] + dz];
}
const placement = (site, part, spot) => new THREE.Matrix4().compose(
  new THREE.Vector3(...partSpot(site, part, spot)),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(part.rotation ?? 0)),
  new THREE.Vector3().setScalar(realScale(part)));

/** 모델 여러 개를 각자 자리에 놓고 모서리 선을 점으로 그린다. 색은 프로젝트 규칙으로 바꾼 뒤 kind 에 맞게 밝기를 맞춘다 */
async function sampleParts(site, parts, kind, spot, seed, { spacing = EDGE_SPACING, gain = GAIN[kind] } = {}) {
  const random = mulberry32(seed), chunks = [], blocks = [], faces = [];
  for (const part of parts) {
    const root = await partModel(part), matrix = placement(site, part, spot);
    root.updateWorldMatrix(true, true);
    chunks.push(sampleEdges(root, matrix, spacing, random));
    blocks.push(...blockOf(root, matrix));
    for (const v of collectFaces(root, matrix)) faces.push(v);
  }
  const total = chunks.reduce((sum, c) => sum + c.positions.length, 0);
  const positions = new Float32Array(total), colors = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { positions.set(c.positions, offset); colors.set(c.colors, offset); offset += c.positions.length; }
  const out = thin(positions, colors, spacing * 0.7);
  toneColors(out.positions, out.colors);
  // 가는 선은 어두우면 배경에 묻힌다: 파랑 단계 LINE_MIN 보다 어두운 점은 그 밝기까지 올린다
  const floor = blue(LINE_MIN), lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], min = lum(floor);
  out.levels = new Float32Array(out.shake.length);
  for (let i = 0; i < out.colors.length; i += 3) {
    const c = out.colors.subarray(i, i + 3), l = lum(c);
    if (l < min) for (let j = 0; j < 3; j++) c[j] = Math.max(c[j] * (min / (l || 1)), floor[j] * (1 - l / min));
    for (let j = 0; j < 3; j++) c[j] = Math.min(1, c[j] * gain);
    // 색은 선택 순서에 따라 바뀌므로(tintLayer) 밝기 차이만 남긴다.
    // 선 점은 촘촘해서 더하기 블렌딩으로 겹쳐 밝아지므로, 한 점은 어둡게 둬야 주황이 흰색으로 날아가지 않는다
    out.levels[i / 3] = Math.min(1, lum(c) / (lum(blue(1)) || 1));
  }
  out.colors.set(tintLayer(out.levels, 'new'));
  out.blocks = Float32Array.from(blocks);
  out.faces = Float32Array.from(faces);
  return out;
}

/** 주거 모듈 레이어 (지대 좌표). view 는 용암동굴 보기('interior' 면 봉쇄막 양쪽 반).
 * home: true 인 부품 자리는 homes 로 돌려준다 (O-3 처럼 집마다 장치를 두는 산소 선지가 쓴다) */
export async function buildModule(site, id, view) {
  const def = choiceData.layers.module[id];
  if (def.parts[0].special === 'caveSeal') return buildCaveSeal(LAYER_POINTS.seal, definitions.lavaTube, view !== 'interior');
  const out = await sampleParts(site, def.parts, 'module', null, 7001, def);
  out.homes = [];
  for (const part of def.parts.filter(p => p.home)) {
    const box = new THREE.Box3().setFromObject(await loadModel(part.asset)).applyMatrix4(placement(site, part));
    const at = partSpot(site, { ...part, lift: 0 });
    out.homes.push({ at, top: box.max.y, r: Math.max(at[0] - box.min.x, box.max.x - at[0], at[2] - box.min.z, box.max.z - at[2]) });
  }
  return out;
}

// 장치(부품 묶음)의 바닥 반지름·높이: 부품마다 실제 크기 상자를 offset 자리에 놓고 합친다
async function footprintOf(parts) {
  const all = new THREE.Box3();
  for (const part of parts) {
    const box = new THREE.Box3().setFromObject(await partModel(part)), s = realScale(part), [dx, dz] = part.offset ?? [0, 0];
    const shift = new THREE.Vector3(dx, part.lift ?? 0, dz);
    all.union(new THREE.Box3(box.min.clone().multiplyScalar(s).add(shift), box.max.clone().multiplyScalar(s).add(shift)));
  }
  return { r: Math.max(Math.abs(all.min.x), all.max.x, Math.abs(all.min.z), all.max.z) * 1.05, h: all.max.y };
}

/** 산소 오버레이 레이어. moduleData 는 지금 주거 모듈 레이어({ positions, homes, blocks }).
 * parts 는 찾은 자리를 기준으로 offset 만큼 떨어져 놓이는 장치 묶음.
 * perHome 이면 주거 모듈의 집(homes)마다 그 옆 빈자리에 같은 장치를 하나씩 둔다.
 * wallCoat 는 지금 주거 모듈 겉면을 덮는 크림 점이라 모듈 점이 필요하다.
 * placed 는 앞서 놓은 오버레이 레이어들이다. 주차가 쌓여도 장치가 서로 겹치지 않게 그 자리를 비워 둔다 */
export async function buildOverlay(site, id, moduleData = {}, placed = []) {
  const def = choiceData.layers.overlay[id], { positions: modulePoints, homes = [], blocks } = moduleData;
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
  // scaleAt: 지대마다 장치 묶음 크기 배율 (좁은 동굴에서는 작게 둬야 바닥에 들어간다)
  const k0 = def.scaleAt?.[siteLetter(site)] ?? 1;
  const parts = (def.partsAt?.[siteLetter(site)] ?? def.parts ?? [def]).map(p => ({ ...p, scale: (p.scale ?? 1) * k0, offset: (p.offset ?? [0, 0]).map(v => v * k0) }));
  const footprint = await footprintOf(parts), cells = occupancy(blocks ?? modulePoints);
  // 장치 자리는 바닥 원 전체를 막는다 (큰 장치도 틈으로 다른 장치가 들어오지 않게)
  const reserve = (spot, { r, h }) => {
    const disc = [];
    for (let x = -r; x <= r; x += 0.2) for (let z = -r; z <= r; z += 0.2)
      if (Math.hypot(x, z) <= r) disc.push(spot[0] + x, spot[1], spot[2] + z, spot[0] + x, spot[1] + h, spot[2] + z);
    for (const [key, range] of occupancy(Float32Array.from(disc))) cells.set(key, range);
  };
  for (const layer of placed) for (const spot of layer.spots ?? []) reserve(spot, layer.footprint);
  // 집마다 하나씩: 집 자리에서 가장 가까운 빈자리. 앞서 놓은 장치 자리도 막아서 서로 겹치지 않게 한다.
  // 집 벽에서 ROOF_REACH 안에 평평한 빈자리가 없으면(동굴 비탈 등) 그 집 지붕 위에 올린다
  // 한 대만 두는 장치는 집들의 한가운데에서 가장 가까운 빈자리를 찾는다 (집이 없으면 지대 기본 자리)
  const middle = homes.length && [0, 1, 2].map(j => homes.reduce((sum, h) => sum + h.at[j], 0) / homes.length);
  const wanted = def.perHome && homes.length ? homes : [{ at: middle || overlaySpot(site, id) }];
  // outside: 그 지대에서는 집 근처 대신 정해진 땅 위 자리에 둔다 (태양광은 동굴 안에 둘 수 없다)
  const outside = def.outside?.[siteLetter(site)];
  const spots = [], chunks = [];
  for (const [k, home] of wanted.entries()) {
    let spot = outside ? surfaceSpot(site, outside) : findSpot(site, home.at, footprint, cells);
    if (home.top != null && Math.hypot(spot[0] - home.at[0], spot[2] - home.at[2]) > home.r + ROOF_REACH) {
      // 지붕에 앞서 올린 장치가 있으면 옆으로 비켜 놓는다
      const onRoof = placed.flatMap(layer => layer.spots ?? []).filter(s => Math.abs(s[1] - home.top) < 0.01 && Math.hypot(s[0] - home.at[0], s[2] - home.at[2]) < home.r).length;
      spot = [home.at[0] + onRoof * Math.min(0.5, home.r * 0.6), home.top, home.at[2]];
    }
    spots.push(spot);
    reserve(spot, footprint);
    chunks.push(await sampleParts(site, parts, 'overlay', spot, 7002 + k, def));
  }
  const n = chunks.reduce((sum, c) => sum + c.shake.length, 0), out = empty(n);
  let offset = 0;
  out.levels = new Float32Array(n);
  out.faces = new Float32Array(chunks.reduce((sum, c) => sum + c.faces.length, 0));
  chunks.reduce((at, c) => (out.faces.set(c.faces, at), at + c.faces.length), 0);
  for (const c of chunks) { out.positions.set(c.positions, offset * 3); out.colors.set(c.colors, offset * 3); out.levels.set(c.levels, offset); offset += c.shake.length; }
  out.spot = spots[0]; out.spots = spots; out.footprint = footprint;
  return out;
}
