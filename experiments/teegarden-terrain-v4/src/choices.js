import data from './choices.json' with { type: 'json' };
import definitions from './sites.json' with { type: 'json' };
import { plainSurface } from './plain.js';
import { ridgeSurface, ridgeCrest, ridgeFrame, TOP_HALF_WIDTH } from './ridge.js';
import { caveSection, tubeFrame, PILLAR_SPOTS } from './lavaTube.js';

// 단계별 선지 (플레이테스트 1주차 갈래): 위치(A·B·C) → 짓는 방식(위치마다 2개) → 숨 쉴 공기(3개). 앞 단계를 고르면 다음 단계 선지가 열린다.
// 선택 상태는 { location, module, oxygen } 이다. 메인 게임 composer.js 의 resolve·requires 규칙과 같다.
export { data as choiceData };
export const STEP_IDS = data.steps.map(step => step.id);
export const siteLetter = site => data.sites[site];

const isAvailable = (choice, selection) =>
  !choice.hidden && Object.entries(choice.requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));

/** 그 단계에서 지금 고를 수 있는 선지 */
export function availableChoices(stepId, selection) {
  return (data.steps.find(step => step.id === stepId)?.choices ?? []).filter(choice => isAvailable(choice, selection));
}

/** 앞 단계를 바꾸면 그 뒤 단계 선택은 지운다 */
export function choose(selection, stepId, choiceId) {
  const next = { ...selection, [stepId]: choiceId };
  for (const id of STEP_IDS.slice(STEP_IDS.indexOf(stepId) + 1)) delete next[id];
  return next;
}

/** 선택 상태 → 그릴 레이어 */
export function resolve(selection) {
  const layers = { module: null, overlays: [] };
  for (const step of data.steps) {
    const choice = step.choices.find(c => c.id === selection[step.id]);
    if (!choice || !isAvailable(choice, selection)) continue;
    if (choice.module) layers.module = choice.module;
    if (choice.overlays) layers.overlays.push(...choice.overlays);
  }
  return layers;
}

// 그 지대에서 (x, z) 자리의 바닥 높이. A·C 는 지표, B 는 동굴 바닥(절개면에서 잰 아랫선)
const plain = plainSurface(definitions.plain);
export function floorAt(site, x, z) {
  if (site === 'plain') return Math.hypot(x, z) <= 1.65 ? 0 : plain(x, z);
  if (site === 'ridge') return Math.abs(ridgeFrame(x, z).u) <= TOP_HALF_WIDTH ? 0 : ridgeSurface(x, z, definitions.ridge);
  return caveSection(x, definitions.lavaTube)?.bottom ?? 0;
}

/** JSON 의 자리 → 지대 좌표 [x, y, z]. crest 면 x 를 능선 마루에서 잰다 */
export function placeAt(site, position, crest = false) {
  const [a, b, c] = position;
  const z = position.length === 3 && typeof c === 'number' ? c : b;
  const onCrest = crest || c === 'crest';
  const x = a + (onCrest ? ridgeCrest(z) : 0);
  const y = position.length === 3 && typeof c === 'number' ? b : floorAt(site, x, z);
  return [x, y, z];
}

// 산소 장치 자리 찾기: 원하는 자리에서 가까운 순으로 살펴, 주거 모듈 점·지형과 겹치지 않는 첫 자리를 쓴다.
// footprint 는 장치의 바닥 반지름 r 과 높이 h (지역 단위)
const CELL = 0.25, CLEARANCE = 0.3, SEARCH = 8, STEP = 0.4;
/** 모듈 점들이 차지한 칸: (x, z) 칸마다 높이 범위 */
export function occupancy(positions) {
  const cells = new Map();
  for (let i = 0; i < (positions?.length ?? 0); i += 3) {
    const key = Math.floor(positions[i] / CELL) + ',' + Math.floor(positions[i + 2] / CELL), y = positions[i + 1];
    const c = cells.get(key);
    if (c) { c[0] = Math.min(c[0], y); c[1] = Math.max(c[1], y); } else cells.set(key, [y, y]);
  }
  return cells;
}
function clearOf(cells, x, y, z, { r, h }) {
  const reach = r + CLEARANCE, n = Math.ceil(reach / CELL);
  for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) {
    const cx = Math.floor(x / CELL) + i, cz = Math.floor(z / CELL) + k;
    if (Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z) > reach + CELL) continue;
    const c = cells.get(cx + ',' + cz);
    if (c && c[0] < y + h && c[1] > y - 0.1) return false;
  }
  return true;
}
/** 장치를 (x, z) 에 둘 수 있는지: 지형이 장치를 뚫지 않고(바닥 높이 차), B 는 동굴 안 바닥·천장·기둥·절개면 뒤 */
export function fitsAt(site, x, z, footprint, cells) {
  const { r, h } = footprint, y = floorAt(site, x, z);
  if (!Number.isFinite(y)) return false;
  let low = y, high = y;
  for (let a = 0; a < 8; a++) {
    const f = floorAt(site, x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r);
    low = Math.min(low, f); high = Math.max(high, f);
  }
  if (high - low > 0.3) return false;
  if (site === 'lavaTube') {
    const s = caveSection(x, definitions.lavaTube), f = tubeFrame(x);
    if (!s || z > -(r + 0.1) || Math.abs(z) + r > f.width * 0.9) return false;
    const ceiling = f.center + f.height * Math.sqrt(Math.max(0, 1 - ((Math.abs(z) + r) / f.width) ** 2));
    if (y + h > ceiling - 0.1) return false;
    if (PILLAR_SPOTS.some(([px, pz]) => Math.hypot(x - px, z - pz) < r + 0.6)) return false;
  } else if (Math.hypot(x / 14, z / 11) > 0.8) return false; // 촘촘한 지정 지형 안에 둔다
  return clearOf(cells, x, y, z, footprint);
}
/** 원하는 자리에서 가장 가까운 빈 자리 [x, y, z]. 못 찾으면 원하는 자리 */
export function findSpot(site, preferred, footprint, cells = new Map()) {
  const [px, , pz] = preferred, candidates = [];
  for (let dx = -SEARCH; dx <= SEARCH; dx += STEP) for (let dz = -SEARCH; dz <= SEARCH; dz += STEP) candidates.push([px + dx, pz + dz]);
  candidates.sort((a, b) => Math.hypot(a[0] - px, a[1] - pz) - Math.hypot(b[0] - px, b[1] - pz));
  for (const [x, z] of candidates) if (fitsAt(site, x, z, footprint, cells)) return [x, floorAt(site, x, z), z];
  // 모듈과 겹치지 않는 자리가 없으면, 지형 조건만 맞는 자리 중 모듈 점에서 가장 먼 곳
  let best = null, far = -1;
  for (const [x, z] of candidates) {
    if (!fitsAt(site, x, z, footprint, new Map())) continue;
    let near = Infinity;
    for (const key of cells.keys()) {
      const [i, k] = key.split(',').map(Number);
      near = Math.min(near, Math.hypot((i + 0.5) * CELL - x, (k + 0.5) * CELL - z));
    }
    if (near > far) { far = near; best = [x, floorAt(site, x, z), z]; }
  }
  return best ?? preferred;
}

/** 오버레이를 놓을 자리: 레이어의 at[지대] → 없으면 지대 기본 자리 */
export function overlaySpot(site, id) {
  const letter = siteLetter(site);
  return placeAt(site, data.layers.overlay[id]?.at?.[letter] ?? data.slots[letter]);
}
