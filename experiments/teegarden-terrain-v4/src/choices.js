import week1 from './weeks/week1.json' with { type: 'json' };
import week2 from './weeks/week2.json' with { type: 'json' };
import week3 from './weeks/week3.json' with { type: 'json' };
import week4 from './weeks/week4.json' with { type: 'json' };
import week5 from './weeks/week5.json' with { type: 'json' };
import definitions from './sites.json' with { type: 'json' };
import { plainSurface } from './plain.js';
import { ridgeSurface, ridgeCrest, ridgeFrame, TOP_HALF_WIDTH } from './ridge.js';
import { caveSection, tubeFrame, tubeSurface, PILLAR_SPOTS } from './lavaTube.js';

// 단계별 선지 (플레이테스트 1주차 갈래): 위치(A·B·C) → 짓는 방식(위치마다 2개) → 숨 쉴 공기(3개). 앞 단계를 고르면 다음 단계 선지가 열린다.
// 선택 상태는 { location, module, oxygen } 이다. 메인 게임 composer.js 의 resolve·requires 규칙과 같다.
export { week1 as choiceData };
export const STEP_IDS = week1.steps.map(step => step.id);
// 주차 파일은 따로 두고 선택 상태 하나에 쌓는다: { location, module, oxygen, power, … }. 그래서 뒤 주차가 앞 주차 선택을 그대로 읽는다.
// 주차마다 src/weeks/weekN.json 하나. 새 주차는 여기에 추가한다
export const WEEKS = [week1, week2, week3, week4, week5];
export const ALL_STEPS = WEEKS.flatMap(week => week.steps);
for (const { layers } of WEEKS.slice(1)) Object.assign(week1.layers.overlay, layers.overlay);
export const siteLetter = site => week1.sites[site];

const meets = (requires, selection) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
const isAvailable = (choice, selection) => !choice.hidden && meets(choice.requires, selection);

/** [{ requires?, text }] 에서 지금 선택에 맞는 문장만 고른다 (현재 상황 문구, 선지 설명 뒤에 붙는 문장) */
export const textsFor = (items, selection) => (items ?? []).filter(item => meets(item.requires, selection)).map(item => item.text);

/** 그 단계에서 지금 고를 수 있는 선지 */
export function availableChoices(stepId, selection) {
  return (ALL_STEPS.find(step => step.id === stepId)?.choices ?? []).filter(choice => isAvailable(choice, selection));
}

/** 앞 단계를 바꾸면 그 뒤 단계 선택은 지운다 */
export function choose(selection, stepId, choiceId) {
  const next = { ...selection, [stepId]: choiceId };
  const ids = ALL_STEPS.map(step => step.id);
  for (const id of ids.slice(ids.indexOf(stepId) + 1)) delete next[id];
  return next;
}

/** 선택 상태 → 그릴 레이어 */
export function resolve(selection) {
  // weeks: 레이어마다 몇 주차 선지로 생겼는지 ('module' 또는 오버레이 id → 주차 번호)
  const layers = { module: null, overlays: [], weeks: {} };
  WEEKS.forEach(({ steps }, w) => {
    for (const step of steps) {
      const choice = step.choices.find(c => c.id === selection[step.id]);
      if (!choice || !isAvailable(choice, selection)) continue;
      if (choice.module) { layers.module = choice.module; layers.weeks.module = w + 1; }
      for (const id of choice.overlays ?? []) { layers.overlays.push(id); layers.weeks[id] ??= w + 1; }
    }
  });
  return layers;
}

/** 선택 상태 → 그릴 자원 흐름 (weekN.json 의 flows).
 * path 는 단계 id 와 'homes'(집) · 'out'(기지 밖으로 버림)의 차례다. 아직 고르지 않은 단계는 건너뛰고 다음 칸으로 바로 잇는다.
 * 첫 칸이 없으면 흐름도 없다. amount(흐르는 양)는 path 의 첫 선지 칸의 flowAmount (없으면 FLOW_AMOUNT),
 * vary(양이 오르내리는 정도, 0~1)는 그 칸의 flowVary (없으면 0: 늘 같은 양).
 * below 는 그 칸으로 들어가는 구간을 땅 밑으로 그린다 (남는 전기를 배터리에 저장하러 가는 길) */
export const FLOW_AMOUNT = 0.75;
export function flowsFor(selection) {
  const out = [];
  WEEKS.forEach(({ flows }, w) => {
    for (const flow of flows ?? []) {
      if (!meets(flow.requires, selection)) continue;
      let amount = null, vary = null, started = false;
      const nodes = flow.path.map(id => {
        if (id === 'homes' || id === 'out') return { id };
        const step = ALL_STEPS.find(s => s.id === id), choice = step?.choices.find(c => c.id === selection[id]);
        if (!choice || !isAvailable(choice, selection) || !choice.overlays?.length) return null;
        // 양·오르내림은 path 의 첫 선지(흐름을 내보내는 쪽)가 정한다
        if (!started) { amount = choice.flowAmount ?? null; vary = choice.flowVary ?? null; started = true; }
        return { id, overlay: choice.overlays[0] };
      });
      if (!nodes[0]) continue;
      const kept = nodes.filter(Boolean);
      if (kept.length > 1) out.push({ kind: flow.kind, week: w + 1, amount: amount ?? FLOW_AMOUNT, vary: vary ?? 0, below: flow.below ?? null, nodes: kept });
    }
  });
  return out;
}

/** 지금 주차의 집 안 공기 (weekN.json 의 roomAir): requires 가 맞는 첫 항목의 air ('hot' | 'cool'), 없으면 null.
 * 열을 빼는 방법을 고르기 전에는 덥고, 고르면 시원해지는 것을 그 주 동안만 보여 준다 */
export function roomAirFor(selection, week) {
  return (WEEKS[week - 1]?.roomAir ?? []).find(item => meets(item.requires, selection))?.air ?? null;
}

// 그 지대에서 (x, z) 자리의 바닥 높이. A·C 는 지표, B 는 동굴 바닥(절개면에서 잰 아랫선)
const plain = plainSurface(definitions.plain);
export function floorAt(site, x, z) {
  if (site === 'plain') return Math.hypot(x, z) <= 1.65 ? 0 : plain(x, z);
  if (site === 'ridge') return Math.abs(ridgeFrame(x, z).u) <= TOP_HALF_WIDTH ? 0 : ridgeSurface(x, z, definitions.ridge);
  return caveSection(x, definitions.lavaTube)?.bottom ?? 0;
}

/** JSON 의 자리 → 지대 좌표 [x, y, z]. crest 면 x 를 능선 마루에서 잰다 */
/** 땅 위 자리. 동굴(B) 지대에서 굴 밖 지표에 놓는 장치가 쓴다 */
export function surfaceSpot(site, [x, z]) {
  return [x, site === 'lavaTube' ? tubeSurface(x, z, definitions.lavaTube) : floorAt(site, x, z), z];
}
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
const CELL = 0.25, CLEARANCE = 0.5, SEARCH = 8, CAVE_SEARCH = 16, STEP = 0.4, SLOPES = [0.3, 0.6, 1.0];
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
export function fitsAt(site, x, z, footprint, cells, slope = SLOPES[0]) {
  const { r, h } = footprint, y = floorAt(site, x, z);
  if (!Number.isFinite(y)) return false;
  let low = y, high = y;
  for (let a = 0; a < 8; a++) {
    const f = floorAt(site, x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r);
    low = Math.min(low, f); high = Math.max(high, f);
  }
  if (high - low > slope) return false;
  if (site === 'lavaTube') {
    const s = caveSection(x, definitions.lavaTube), f = tubeFrame(x);
    if (!s || z > -(r + 0.1) || Math.abs(z) + r > f.width * 0.9) return false;
    const ceiling = f.center + f.height * Math.sqrt(Math.max(0, 1 - ((Math.abs(z) + r) / f.width) ** 2));
    if (y + h > ceiling - 0.1) return false;
    if (PILLAR_SPOTS.some(([px, pz]) => Math.hypot(x - px, z - pz) < r + 0.6)) return false;
  } else if (Math.hypot(x / 14, z / 11) > 0.8) return false; // 촘촘한 지정 지형 안에 둔다
  return clearOf(cells, x, y, z, footprint);
}
/** 원하는 자리에서 가장 가까운 빈 자리 [x, y, z]. 못 찾으면 원하는 자리 (strict 면 null) */
export function findSpot(site, preferred, footprint, cells = new Map(), strict = false) {
  // 동굴은 바닥이 좁고 길어서 굴을 따라 안쪽 방까지 더 멀리 찾는다 (장치가 겹치지 않게)
  const [px, , pz] = preferred, candidates = [], reach = site === 'lavaTube' ? CAVE_SEARCH : SEARCH;
  for (let dx = -reach; dx <= reach; dx += STEP) for (let dz = -reach; dz <= reach; dz += STEP) candidates.push([px + dx, pz + dz]);
  candidates.sort((a, b) => Math.hypot(a[0] - px, a[1] - pz) - Math.hypot(b[0] - px, b[1] - pz));
  // 평평한 자리부터 찾고, 주차가 쌓여 자리가 모자라면 조금 비탈진 곳까지 넓힌다
  for (const slope of SLOPES) for (const [x, z] of candidates) if (fitsAt(site, x, z, footprint, cells, slope)) return [x, floorAt(site, x, z), z];
  if (strict) return null;
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
  return placeAt(site, week1.layers.overlay[id]?.at?.[letter] ?? week1.slots[letter]);
}
