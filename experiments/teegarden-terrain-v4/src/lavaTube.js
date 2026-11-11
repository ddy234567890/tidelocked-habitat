import { blue, cream } from './palette.js';
import { mulberry32, height, noise, clamp, smooth, surfaceGrid, starDirection, sampleGround, output, put, groundColor, EXTENT } from './terrain.js';

// 동굴 형태는 메인 게임의 용암동굴(src/scenes/locations/lavaTube.js, 2026-10-31)에서 시작해,
// 동굴 사진 참고(벌어진 아치 입구, 바위가 쌓인 큰 방, 좁은 통로, 판처럼 떨어진 천장, 옆으로 갈라진 굴)로 다듬었다.
// 형태 함수는 원본 단위로 계산하고 SCALE 배로 키워 이 시안의 지형 크기에 맞춘다.
// 무너질 위험 표시(주황 + 떨림)는 쓰지 않는다. shake 는 모두 0 이다.
const SCALE = 3;
const RELIEF = 0.38;
const PX0 = -2.3; // 입구 (원본 단위)
const PX1 = EXTENT.x / SCALE; // 지형 끝까지 이어진다
const SPAN = 5.5; // 입구에서 내려가는 구간의 모양은 이 길이를 기준으로 한다
const FLAT = 0.42; // 단면 아래쪽 이 비율보다 낮은 부분은 평평한 바닥이 된다
const ENTRANCE_LIGHT = [PX0 + 0.3, 0.25, -0.25];
// 입구 → 내려가는 통로 → 큰 방 → 좁은 목 → 작은 방 → 좁은 목. 방은 넓고 깊으며, 목은 좁고 높다.
const ROOMS = [
  { x: 0.9, len: 0.85, size: 0.42, wide: 1.5, drop: -0.28 },
  { x: 2.25, len: 0.32, size: -0.24, wide: 0.72, drop: 0.1 },
  { x: 3.3, len: 0.55, size: 0.22, wide: 1.25, drop: -0.1 },
  { x: 4.25, len: 0.3, size: -0.15, wide: 0.85, drop: 0.05 }
];
const PILLARS = [[0.2, -1.05], [3.8, -0.45]]; // 큰 방 기둥은 뒷벽 쪽 (주거 모듈 자리를 비운다)
export const PILLAR_SPOTS = PILLARS.map(([x, z]) => [x * SCALE, z * SCALE]); // 시안 단위 (x, z)
const HALL = [0.1, 1.7]; // 천장에서 떨어진 바위가 많이 쌓인 큰 방
// 옆 굴: 큰 방 뒤쪽 벽에서 갈라져 좁은 목 뒤를 돌아 작은 방으로 다시 이어지는 우회 통로
const BRANCH = { from: 1.35, to: 3.45, back: -2.7, rise: 0.12, radius: 0.34, steps: 96 };
const STEPS = 600;
// 점 배분: 지표 → 절개면 → 동굴 벽(나머지) → 옆 굴 → 바위 더미 → 기둥. surface·cut 은 누적 경계다.
export const CAVE_PARTS = { surface: 0.12, cut: 0.32, branch: 0.06, boulders: 0.07, pillars: 0.03 };
export const tubeSurface = (x, z, def) => height(x, z) * RELIEF * (def.relief ?? 2);

// 거친 정도를 만드는 노이즈 (-1 ~ 1). seed 마다 다른 자리를 읽는다.
const n2 = (a, b, seed) => clamp(noise(a + seed * 19.19, b - seed * 7.31), -1, 1);
const rough = (a, b, seed) => 0.6 * n2(a, b, seed) + 0.3 * n2(a * 2.1 + 5, b * 2.1 + 3, seed + 1) + 0.1 * n2(a * 4.3, b * 4.3, seed + 2);
const ridged = (a, b, seed) => 1 - Math.abs(n2(a, b, seed)); // 0~1, 능선처럼 이어지는 밝은 모서리
const room = (x, r) => Math.exp(-(((x - r.x) / r.len) ** 2));

// 동굴 중심선의 높이: 입구에서 내려가 수평이 되고, 방에서는 더 깊어진다. 그래서 위쪽 암반 두께가 곳마다 다르다
function center(x) {
  const u = clamp((x - PX0) / SPAN);
  let c = -1.0 + 1.05 * (1 - smooth(0, 0.38, u)) - 0.06 * Math.sin(Math.PI * u) + 0.1 * n2(x * 0.8, 1.7, 11);
  for (const r of ROOMS) c += r.drop * room(x, r);
  return c;
}
function pathNormal(x) {
  const dy = (center(x + 0.01) - center(x - 0.01)) / 0.02, l = Math.hypot(1, dy);
  return [-dy / l, 1 / l];
}
// 위아래·앞뒤 반지름. 입구는 아치처럼 크게 벌어진다
function radii(x) {
  let size = 0.55 + 0.08 * n2(x * 0.9, 4.2, 12), wide = 1.1 + 0.1 * n2(x * 0.7, 8.8, 13);
  for (const r of ROOMS) { const g = room(x, r); size += r.size * g; wide += (r.wide - 1.1) * g; }
  const mouth = 1 - smooth(PX0, PX0 + 1.1, x);
  return { ry: size * (1 + 0.75 * mouth), rz: size * wide * (1 + 0.45 * mouth) };
}
const ryAt = x => radii(x).ry;
const rzAt = x => radii(x).rz;
const flatten = u => (u >= -FLAT ? u : -FLAT + 0.08 * (u + FLAT));
const ceilAt = (x, z) => center(x) + ryAt(x) * Math.sqrt(Math.max(0, 1 - (z / rzAt(x)) ** 2));

// 동굴 벽 위의 한 점 (원본 단위). theta 는 0(천장, 절개면) → π/2(옆벽) → π(바닥, 절개면).
// back 이면 절개면 앞쪽(z > 0)의 반대편 벽이다. 천장·바닥의 절개선에서는 앞 벽과 이어지고, 그 사이는 따로 들쭉날쭉하다.
function wallPoint(x, theta, relief, back = false) {
  const cu = Math.cos(theta), side = Math.sin(theta), edge = side * side;
  const ceiling = Math.max(0, cu), floor = cu < -FLAT;
  // 큰 굴곡(벽이 불룩 나오고 깊게 파임) + 중간 요철 + 잔 요철
  let f = 1 + relief * (0.17 * rough(x * 1.1, theta * 1.3, 21) + 0.055 * rough(x * 3.3, theta * 3.1, 27) + 0.022 * n2(x * 9, theta * 6, 24));
  // 천장은 판처럼 떨어져 나간 자리가 계단처럼 끊긴다
  const slab = Math.floor(2.5 + 2.5 * n2(x * 1.7, theta * 2.2, 28)) / 5 - 0.5;
  f += relief * (0.07 * slab + 0.03 * Math.sin(theta * 7 + 3 * n2(x * 1.3, theta, 25) + x * 3.2)) * ceiling;
  const { ry: r0, rz: z0 } = radii(x);
  const ry = r0 * f;
  let rz = z0 * f * (1 + relief * 0.08 * n2(x * 3.1, flatten(cu) * 2.2, 26));
  if (back) rz *= 1 + edge * (0.3 * n2(x * 0.7, theta * 1.1, 61) + relief * 0.08 * n2(x * 4, theta * 3, 62));
  const [nx, ny] = pathNormal(x), yy = flatten(cu), cy = center(x);
  let y = cy + ny * ry * yy;
  const z = (back ? 1 : -1) * rz * side;
  if (floor) y += relief * 0.025 * rough(x * 2.2, z * 3, 29); // 울퉁불퉁한 바닥
  let inward = [0, 1, 0];
  if (!floor) {
    const gy = (y - cy) / (ry * ry), gz = z / (rz * rz), l = Math.hypot(gy, gz) || 1;
    inward = [0, -gy / l, -gz / l];
  }
  return { x: x + nx * ry * yy, y, z, inward };
}
const reliefOf = def => (def.relief ?? 2) / 2;

// 옆 굴의 축: 두 방 사이를 뒤(-z)로 휘어 도는 2차 곡선에, 양 끝은 고정한 채 좌우·위아래로 굽이를 더한다.
// 촘촘히 나눈 점과 접선을 미리 만든다
const branchPath = (() => {
  const y0 = center(BRANCH.from) - 0.2 * ryAt(BRANCH.from), y2 = center(BRANCH.to) - 0.2 * ryAt(BRANCH.to);
  const p0 = [BRANCH.from, y0, 0], p1 = [(BRANCH.from + BRANCH.to) / 2, (y0 + y2) / 2 + BRANCH.rise, BRANCH.back], p2 = [BRANCH.to, y2, 0];
  const at = t => {
    const bend = Math.sin(Math.PI * t), wobble = [0.16 * n2(t * 4.1, 1, 81), 0.08 * n2(t * 5.3, 3, 83), 0.22 * n2(t * 3.3, 2, 82)];
    return [0, 1, 2].map(k => (1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k] + wobble[k] * bend);
  };
  const points = [], tangents = [], arc = [0];
  for (let i = 0; i <= BRANCH.steps; i++) {
    const t = i / BRANCH.steps, a = at(Math.max(0, t - 0.005)), b = at(Math.min(1, t + 0.005));
    const d = b.map((v, k) => v - a[k]), l = Math.hypot(...d);
    points.push(at(t)); tangents.push(d.map(v => v / l));
    if (i) arc.push(arc[i - 1] + Math.hypot(...points[i].map((v, k) => v - points[i - 1][k])));
  }
  return { points, tangents, arc, length: arc[arc.length - 1] };
})();
// 옆 굴 반지름: 길이를 따라 넓어졌다 좁아지고, 본 동굴과 만나는 두 입구는 나팔처럼 벌어진다. 벽은 본 동굴과 같은 정도로 거칠다
function branchRadius(s, phi) {
  const L = branchPath.length, flare = 0.65 * (Math.exp(-((s / 0.4) ** 2)) + Math.exp(-(((L - s) / 0.4) ** 2)));
  const along = 1 + 0.32 * n2(s * 1.4, 5, 84) + flare;
  const ceiling = Math.max(0, Math.sin(phi)), slab = Math.floor(2.5 + 2.5 * n2(s * 2.2, phi * 2, 75)) / 5 - 0.5;
  return BRANCH.radius * along * (1 + 0.17 * rough(s * 2.4, phi * 1.3, 71) + 0.06 * rough(s * 6, phi * 3, 73) + 0.06 * slab * ceiling);
}
const BRANCH_WIDE = 1.25, BRANCH_LOW = 0.85; // 옆 굴 단면은 높이보다 폭이 넓다
// 옆 굴 축에서 가장 가까운 자리: 축까지의 거리 r 과 축을 따라간 길이 s. 본 동굴 벽에 옆 굴 입구를 뚫을 때 쓴다
function branchDistance(x, y, z) {
  let best = Infinity, s = 0;
  for (let i = 0; i <= BRANCH.steps; i++) {
    const p = branchPath.points[i], d = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
    if (d < best) { best = d; s = branchPath.arc[i]; }
  }
  return { s, r: Math.sqrt(best) };
}
// 본 동굴 안(대략)인지: 옆 굴의 본 동굴 안쪽 부분은 그리지 않는다
const insideMain = (x, y, z) => ((y - center(x)) / ryAt(x)) ** 2 + (z / rzAt(x)) ** 2 < 0.92;

// 절개면(z = 0)에서 동굴의 윗선·아랫선과 입구에서 잰 길이. relief 마다 한 번만 만든다.
const lineCache = new Map();
function caveLines(relief) {
  if (lineCache.has(relief)) return lineCache.get(relief);
  const top = new Float32Array(STEPS + 1), bottom = new Float32Array(STEPS + 1);
  const arc = new Float32Array(STEPS + 1), slope = new Float32Array(STEPS + 1), dx = (PX1 - PX0) / STEPS;
  let slopeMax = 1;
  for (let i = 0; i <= STEPS; i++) {
    const x = PX0 + dx * i;
    top[i] = wallPoint(x, 0, relief).y;
    bottom[i] = wallPoint(x, Math.PI, relief).y;
    // 굵은 구간에 벽 점을 더 준다: 둘레 길이에 비례해 뽑도록 크기를 곱한다
    slope[i] = (i === 0 ? 1 : Math.hypot(dx, center(x) - center(x - dx)) / dx) * (ryAt(x) + rzAt(x));
    arc[i] = i === 0 ? 0 : arc[i - 1] + Math.hypot(dx, center(x) - center(x - dx));
    slopeMax = Math.max(slopeMax, slope[i]);
  }
  const lines = { top, bottom, arc, slope, slopeMax, index: x => Math.round(clamp((x - PX0) / (PX1 - PX0)) * STEPS) };
  lineCache.set(relief, lines);
  return lines;
}

// 시안 단위의 동굴 크기. 절개면의 빈 구간은 caveSection 으로 확인한다.
export function tubeFrame(x) {
  const m = x / SCALE;
  return { center: center(m) * SCALE, height: ryAt(m) * SCALE, width: rzAt(m) * SCALE };
}
export function caveSection(x, def) {
  const m = x / SCALE, lines = caveLines(reliefOf(def)), i = lines.index(m);
  if (m < PX0 || m > PX1) return null;
  return { top: lines.top[i] * SCALE, bottom: lines.bottom[i] * SCALE };
}
const scaled = p => ({ ...p, x: p.x * SCALE, y: p.y * SCALE, z: p.z * SCALE });
export const tubeWall = (x, theta, def) => scaled(wallPoint(x / SCALE, theta, reliefOf(def)));
export const tubeBackWall = (x, theta, def) => scaled(wallPoint(x / SCALE, theta, reliefOf(def), true));

// 암벽 밝기를 색으로: 대부분 파랑 단계, 가장 밝은 모서리만 크림
const rockColor = k => (k > 1.18 ? cream(clamp(0.5 + (k - 1.18) * 0.5, 0, 0.95)) : blue(clamp(0.12 + k * 0.72)));

const FRONT_SURFACE = 0.4, FRONT_CLEAR = 5; // 앞쪽 땅 표면 비율, 동굴 앞에서 비워 두는 너비 (시안 단위)
export function buildLavaTube(count, def) {
  const random = mulberry32(def.seed), out = output(count);
  const interior = def.view === 'interior', relief = reliefOf(def), lines = caveLines(relief);
  const grid = surfaceGrid((x, z) => tubeSurface(x, z, def), starDirection(def.star));
  const ground = (x, z) => grid.ground(x * SCALE, z * SCALE) / SCALE; // 원본 단위
  const point = (i, x, y, z, color) => put(out, i, x * SCALE, y * SCALE, z * SCALE, color);
  // 입구의 빛: 입구에 가깝고 입구를 마주 볼수록 밝다. extra 는 옆 굴처럼 더 들어간 길이
  const caveLight = (x, y, z, inward, extra = 0) => {
    const e = [ENTRANCE_LIGHT[0] - x, ENTRANCE_LIGHT[1] - y, ENTRANCE_LIGHT[2] - z], el = Math.hypot(...e) || 1;
    const facing = Math.max(0, (inward[0] * e[0] + inward[1] * e[1] + inward[2] * e[2]) / el);
    const reach = Math.exp(-(lines.arc[lines.index(x)] + extra) / 1.4);
    return 0.3 + 0.78 * reach * (0.35 + 0.65 * facing) + 0.2 * facing;
  };
  const inCave = (x, y) => x >= PX0 && x <= PX1 && y > lines.bottom[lines.index(x)] && y < lines.top[lines.index(x)];

  // 내부에서는 절개면 대신 양쪽 벽에 점을 배분한다. 전체·단면 보기는 반쪽 모델이다.
  const surfaceEnd = Math.floor(count * (interior ? 0.03 : CAVE_PARTS.surface));
  const cutEnd = interior ? surfaceEnd : Math.floor(count * CAVE_PARTS.cut);
  const branchTotal = Math.floor(count * CAVE_PARTS.branch);
  const boulderTotal = Math.floor(count * CAVE_PARTS.boulders * clamp(def.rocks ?? 1, 0, 2));
  const pillarTotal = Math.floor(count * CAVE_PARTS.pillars);
  const boulderEnd = count - pillarTotal, branchEnd = boulderEnd - boulderTotal, wallEnd = branchEnd - branchTotal;

  // 1. 지표: 동굴이 지표를 뚫고 나온 곳(입구)은 비운다.
  // 전체·단면 보기에서도 절개면 앞쪽(z > 0) 땅 표면은 그린다 (앞 반이 통째로 비어 보이지 않게, 2026-11-11 사용자 요청).
  // 동굴 속은 그대로 절개면으로 들여다보인다. 앞쪽은 FRONT_SURFACE 비율만큼만 둔다
  for (let i = 0; i < surfaceEnd; i++) {
    let x, z;
    do { [x, z] = sampleGround(random, true); if (!interior && random() < FRONT_SURFACE) z = -z; }
    // 동굴 바로 앞 땅(FRONT_CLEAR 안)은 비워 절개면을 들여다보는 시야를 가리지 않게 한다
    while ((z > 0 && x / SCALE > PX0 - 1 && z < FRONT_CLEAR)
      || (x / SCALE > PX0 - 0.6 && x / SCALE < PX1 && ceilAt(x / SCALE, z / SCALE) > ground(x / SCALE, z / SCALE) - 0.02));
    put(out, i, x, grid.ground(x, z), z, groundColor(def, grid.light(x, z)));
  }

  // 2. 절개면 (z = 0): 암반 + 동굴 둘레의 밝은 윤곽. 동굴 안은 비운다
  for (let i = surfaceEnd; i < cutEnd; i++) {
    for (;;) {
      const [x] = sampleGround(random, true), m = x / SCALE, top = grid.ground(x, 0) / SCALE;
      if (random() < 0.16) {
        if (m < PX0 || m > PX1) continue;
        const j = lines.index(m), above = random() < 0.5;
        const y = above ? lines.top[j] + random() * 0.025 : lines.bottom[j] - random() * 0.025;
        if (y > top) continue;
        point(i, m, y, 0, blue(0.7 + random() * 0.2));
        break;
      }
      const y = -2 + random() * (top + 2);
      if (inCave(m, y)) continue;
      // 절개면에서 똑같은 가로 줄무늬를 반복하지 않는다.
      const seam = Math.abs(noise(x * 0.33 + noise(y * SCALE, 4), y * SCALE * 2.1));
      point(i, m, y, 0, blue(0.2 + seam * 0.26));
      break;
    }
  }

  // 3. 동굴 벽: 거칠고 들쭉날쭉한 암벽. 재질은 빛을 받은 정도 × 밝은 모서리 × 얼룩. 옆 굴 입구는 뚫어 둔다
  for (let i = cutEnd; i < wallEnd; i++) {
    for (;;) {
      const x = PX0 + (PX1 - PX0) * random();
      if (random() > lines.slope[lines.index(x)] / lines.slopeMax) continue; // 둘레 길이에 비례해 뽑는다
      const theta = random() * Math.PI, back = interior && random() < 0.5;
      const p = wallPoint(x, theta, relief, back);
      if (p.x > PX1 || p.y > ground(p.x, p.z) + 0.01) continue; // 지표 위로 솟은 부분은 자른다
      if (!back && p.z < -0.05) { const b = branchDistance(p.x, p.y, p.z); if (b.r < branchRadius(b.s, 0) * BRANCH_WIDE * 0.9) continue; }
      const vein = ridged(p.x * 3.2, theta * 2.6, 31), patch = 0.85 + 0.3 * n2(p.x * 1.7, theta * 1.4, 32);
      point(i, p.x, p.y, p.z, rockColor(caveLight(p.x, p.y, p.z, p.inward) * (0.62 + 0.9 * vein * vein) * patch));
      break;
    }
  }

  // 4. 옆 굴: 큰 방에서 갈라져 좁은 목 뒤를 돌아 작은 방으로 이어진다. 바닥은 평평하게 눌러 둔다
  for (let i = wallEnd; i < branchEnd; i++) {
    for (;;) {
      const k = Math.floor(random() * BRANCH.steps), t = random();
      const a = branchPath.points[k], b = branchPath.points[k + 1], tan = branchPath.tangents[k];
      const o = a.map((v, j) => v + (b[j] - v) * t), s = branchPath.arc[k] + (branchPath.arc[k + 1] - branchPath.arc[k]) * t;
      // 축에 수직인 두 방향: 위쪽과 옆쪽
      const upRaw = [0, 1, 0].map((v, j) => v - tan[j] * tan[1]), ul = Math.hypot(...upRaw), up = upRaw.map(v => v / ul);
      const side = [tan[1] * up[2] - tan[2] * up[1], tan[2] * up[0] - tan[0] * up[2], tan[0] * up[1] - tan[1] * up[0]];
      const phi = random() * Math.PI * 2, r = branchRadius(s, phi);
      const v = Math.max(Math.sin(phi), -0.5 + 0.1 * (Math.sin(phi) + 0.5)), h = Math.cos(phi);
      const p = [0, 1, 2].map(j => o[j] + r * (BRANCH_WIDE * h * side[j] + BRANCH_LOW * v * up[j]));
      if (p[2] > -0.01 || insideMain(...p) || p[1] > ground(p[0], p[2]) + 0.01) continue;
      const inward = [0, 1, 2].map(j => -(h * side[j] + v * up[j]));
      const vein = ridged(s * 3, phi * 2, 72), patch = 0.85 + 0.3 * n2(s * 1.7, phi * 1.4, 74);
      const deep = Math.min(s, branchPath.length - s); // 두 입구에서 멀수록 어둡다
      point(i, p[0], p[1], p[2], rockColor(caveLight(p[0], p[1], p[2], inward, deep * 0.9) * (0.62 + 0.9 * vein * vein) * patch));
      break;
    }
  }

  // 5. 바닥의 바위 더미: 천장에서 떨어진 바위가 큰 방에 많이 쌓여 있다. 내부 보기에서는 양쪽 바닥에 놓는다
  const boulders = [];
  const addBoulder = (x, depth, r) => boulders.push({ x, z: depth * rzAt(x), r, side: interior && random() < 0.5 ? 1 : -1 });
  for (let i = 0; i < 40; i++) addBoulder(PX0 + 0.5 + (PX1 - PX0 - 0.7) * random() ** 1.5, 0.1 + 0.75 * random(), 0.035 + 0.1 * random() ** 2);
  for (let i = 0; i < 26; i++) addBoulder(HALL[0] + (HALL[1] - HALL[0]) * random(), 0.08 + 0.78 * random(), 0.05 + 0.14 * random() ** 1.5);
  const weights = boulders.map(b => b.r * b.r), weightSum = weights.reduce((a, b) => a + b, 0);
  for (let i = branchEnd; i < boulderEnd; i++) {
    for (;;) {
      let pick = random() * weightSum, b = boulders[0];
      for (let k = 0; k < boulders.length; k++) { pick -= weights[k]; if (pick <= 0) { b = boulders[k]; break; } }
      // 바위 표면의 한 점: 구 위의 방향에 거친 요철을 얹는다. 땅에 반쯤 묻혀 있다
      const dir = [random() - 0.5, random() - 0.5 + 0.12, random() - 0.5], dl = Math.hypot(...dir) || 1;
      const d = dir.map(v => v / dl);
      if (d[1] < -0.25) continue;
      const bump = 1 + 0.35 * n2(d[0] * 2.3 + b.x * 5, d[2] * 2.3 + d[1] * 1.9, 41) + 0.12 * n2(d[0] * 7, d[2] * 7, 42);
      const z = b.z + d[2] * b.r * bump; // 절개면에서 잰 깊이
      if (z < 0.01) continue;
      const x = b.x + d[0] * b.r * bump * 1.2;
      const y = lines.bottom[lines.index(b.x)] + 0.01 + b.r * 0.5 + d[1] * b.r * bump * 0.9;
      const light = caveLight(x, y, b.side * z, [d[0], d[1], b.side * d[2]]);
      point(i, x, y, b.side * z, rockColor((0.7 + 0.9 * ridged(d[0] * 3 + b.r * 9, d[2] * 3, 43)) * light * (0.55 + 0.7 * Math.max(0, d[1])) * 1.6));
      break;
    }
  }

  // 6. 바닥에서 천장까지 이어진 기둥 두 개: 가운데가 잘록하고 위아래가 퍼진다
  const half = boulderEnd + Math.floor(pillarTotal / 2);
  for (let i = boulderEnd; i < count; i++) {
    const [px, pz] = PILLARS[i < half ? 0 : 1];
    const floorY = lines.bottom[lines.index(px)] + 0.01, roofY = ceilAt(px, pz) - 0.02;
    const t = random(), y = floorY + (roofY - floorY) * t, ang = random() * Math.PI * 2;
    const waist = 0.07 + 0.09 * (1 - Math.sin(Math.PI * t) ** 0.8);
    const r = waist * (1 + 0.3 * n2(ang * 1.3 + px, t * 5, 44) + 0.1 * n2(ang * 5, t * 14, 45));
    const x = px + Math.cos(ang) * r, z = Math.min(-0.005, pz + Math.sin(ang) * r);
    const light = caveLight(x, y, z, [Math.cos(ang), 0, Math.sin(ang)]);
    point(i, x, y, z, rockColor((0.8 + 0.9 * ridged(ang * 2 + px, t * 6, 46)) * light * 1.5));
  }
  return out;
}

// 동굴 봉쇄막 (주거 선지 "동굴 통째 밀폐"). 상자로 막지 않고, 그 자리 동굴 벽의 실제 테두리를 따라 막는다:
// 입구 쪽으로 볼록한 막 + 테두리를 따라가는 굵은 테 + 바닥에 붙은 아치형 기밀문.
// stations 는 막을 세울 자리(원본 단위 x): 입구 아래 통로와 안쪽 좁은 목. half 면 절개면 앞쪽(z > 0)은 비운다.
export const SEAL_STATIONS = [-1.0, 2.25];
export function buildCaveSeal(count, def, half = true) {
  const random = mulberry32(def.seed + 404), out = output(count), relief = reliefOf(def);
  const per = Math.ceil(count / SEAL_STATIONS.length);
  for (let i = 0; i < count; i++) {
    const x0 = SEAL_STATIONS[Math.floor(i / per)];
    const [nx, ny] = pathNormal(x0), along = [ny, -nx, 0], cy = center(x0); // along: 동굴 안쪽 방향
    const { ry, rz } = radii(x0), size = Math.min(ry, rz);
    const front = half || random() < 0.5; // 앞쪽(절개면 뒤, z ≤ 0) 반쪽인지
    const theta = random() * Math.PI, rim = wallPoint(x0, theta, relief, !front);
    const c = [x0, cy, 0], toward = [rim.x - c[0], rim.y - c[1], rim.z - c[2]];
    const r = random();
    let t, color;
    if (r < 0.3) { t = 0.9 + 0.1 * random(); color = random() < 0.3 ? cream(0.7) : blue(0.85); } // 테
    else { t = Math.sqrt(random()) * 0.9; color = blue(0.32 + 0.2 * (0.5 + 0.5 * Math.cos(theta * 14))); } // 막 (세로 골)
    let p = [0, 1, 2].map(k => c[k] + toward[k] * t);
    // 아치형 기밀문: 막 가운데 아래쪽, 바닥에서 솟은 문틀
    if (r > 0.86) {
      const w = 0.24 * size, h = 0.62 * ry, floorY = cy + ny * ry * flatten(-1);
      const s = random() * (2 * h + Math.PI * w), side = front ? -1 : 1;
      let a, b;
      if (s < h) { a = -w; b = s; } else if (s < h + Math.PI * w) { const q = (s - h) / w; a = -w * Math.cos(q); b = h + w * Math.sin(q); } else { a = w; b = s - h - Math.PI * w; }
      const y = floorY + b;
      p = [x0 + nx * (y - cy), y, side * a];
      t = Math.hypot(a / rz, (p[1] - cy) / ry);
      color = cream(0.85);
    }
    const bulge = -0.16 * size * (1 - Math.min(1, t) ** 2); // 입구 쪽으로 볼록
    p = p.map((v, k) => v + along[k] * bulge);
    if (half && p[2] > 0) p[2] = -p[2];
    put(out, i, p[0] * SCALE, p[1] * SCALE, p[2] * SCALE, color);
  }
  return out;
}
