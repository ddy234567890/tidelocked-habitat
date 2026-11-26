// Teegarden c 의 지형 3곳: 별 바로 아래 분지 · 지열 열곡 · 얼음 해안.
// 세 곳 모두 가운데(원점)에 집과 장치를 놓을 평평한 자리가 있다. 점·머티리얼은 b 지형과 같은 것을 쓴다.
import { mulberry32, height, noise, smooth, surfaceGrid, starDirection, sampleGround, output, put, groundColor, rockCount, addRocks } from './terrain.js';
import { blueStep, cream, orange, shade } from './palette.js';

const PAD = 4.6, PAD_BLEND = 6.6;      // 평평한 자리 반지름, 거친 땅과 섞이는 바깥 반지름
const pad = (x, z) => smooth(PAD, PAD_BLEND, Math.hypot(x, z));

// 분지: 둘레가 높고 가운데가 낮은 그릇. 둘레 높이는 방향마다 다르다
const RIM = 3.4;
export function basinSurface(def) {
  return (x, z) => {
    const r = Math.hypot(x, z * 1.12), a = Math.atan2(z, x);
    const rim = RIM * (0.8 + 0.35 * noise(Math.cos(a) * 1.7 + 5, Math.sin(a) * 1.7 + 9));
    const wall = rim * smooth(6, 13, r) * (1 - 0.55 * smooth(13, 24, r));
    // 벽을 따라 내려온 먼지 물결
    const dunes = 0.1 * Math.sin(r * 2.6 + noise(x * 0.3, z * 0.3) * 4) * smooth(6, 9, r);
    return pad(x, z) * (wall + dunes + height(x, z) * 0.45 * (def.relief ?? 1));
  };
}

// 열곡: 집 자리 동쪽으로 길게 갈라진 틈. 바닥은 땅의 열로 주황빛이다
const RIFT_X = 8.0, RIFT_HALF = 1.9, RIFT_DEPTH = 5.2;
export const riftAxis = z => RIFT_X + 1.1 * Math.sin(z * 0.23 + 0.4) + noise(z * 0.16, 31) * 0.9;
const riftCut = (x, z) => 1 - smooth(RIFT_HALF * 0.45, RIFT_HALF * 1.5 + 0.25 * noise(z * 0.5, 12), Math.abs(x - riftAxis(z)));
export function riftSurface(def) {
  return (x, z) => {
    const d = x - riftAxis(z), shoulder = 0.55 * Math.exp(-(((Math.abs(d) - RIFT_HALF * 1.9) / 0.9) ** 2));
    const steps = 0.16 * Math.round(noise(x * 0.22 + 3, z * 0.22) * 4) * smooth(1.2, 3, Math.abs(d)); // 계단처럼 주저앉은 땅
    return pad(x, z) * (shoulder + steps + height(x, z) * 0.6 * (def.relief ?? 1)) - RIFT_DEPTH * riftCut(x, z);
  };
}

// 해안: 기지는 바다로 튀어나온 얼음 곶 위에 있다. 동쪽(+x)과 뒤쪽(-z)이 바다다.
// 땅 → 얼음 절벽 → 검은 물길 → 깨진 유빙 판(판 사이 금) → 각진 빙산 순으로 나뉘어, 멀리서도 바다로 읽힌다
const CAPE_X = 5.3, CAPE_Z = 5.0, CLIFF = 1.9, SEA = -CLIFF; // 곶 끝, 절벽 높이, 바다 높이
const LEAD = [0.35, 1.5];   // 절벽 아래 물길: 해안에서 이만큼 떨어진 구간
const FLOE = 2.1;           // 유빙 판 크기
const coastX = z => CAPE_X + 0.9 * noise(z * 0.3 + 2, 7) + 0.28 * noise(z * 1.1, 19);
const coastZ = x => -(CAPE_Z + 0.9 * noise(x * 0.3 + 8, 3) + 0.28 * noise(x * 1.1, 27));
// 해안선에서 바다 쪽으로 나간 거리 (땅은 음수)
export const offshore = (x, z) => {
  return Math.max(x - coastX(z), coastZ(x) - z);
};
const rnd = (i, j, k) => { // 같은 값이면 늘 같은 난수 (0~1)
  let h = Math.imul(Math.round(i * 10), 374761393) ^ Math.imul(Math.round(j * 10), 668265263) ^ Math.imul(Math.round(k * 10), 1274126177);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};
// 유빙 판 하나: 가장 가까운 판 중심(칸마다 하나)과 두 번째로 가까운 중심까지의 차이 → 판 가장자리(금)까지의 거리
function floeAt(x, z) {
  const gi = Math.floor(x / FLOE), gj = Math.floor(z / FLOE);
  let d1 = 1e9, d2 = 1e9, best = null;
  for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) {
    const cx = (i + 0.15 + 0.7 * rnd(i, j, 1)) * FLOE, cz = (j + 0.15 + 0.7 * rnd(i, j, 2)) * FLOE, d = Math.hypot(x - cx, z - cz);
    if (d < d1) { d2 = d1; d1 = d; best = [i, j, cx, cz]; } else if (d < d2) d2 = d;
  }
  return { edge: d2 - d1, i: best[0], j: best[1], dx: x - best[2], dz: z - best[3] };
}
// 빙산: [x, z, 반지름, 높이, 돌린 각]. 앞바다의 큰 것 몇 개와 먼바다의 작은 것들
const BERGS = [[9.6, -6.6, 2.5, 4.4, 0.3], [2.4, -9.4, 1.9, 3.0, 1.1], [-6.2, -9.0, 1.6, 2.3, 2.0], [11.2, 1.4, 1.3, 2.0, 0.8], [8.4, 6.2, 1.0, 1.4, 1.7],
  [17, -14, 4.2, 6.2, 0.6], [4, -19, 3.4, 4.6, 1.4], [-12, -17, 3.0, 4.0, 2.4], [22, 3, 3.2, 4.2, 0.2], [30, -20, 5.0, 6.5, 1.0], [-2, -31, 4.6, 5.6, 0.5], [19, 13, 2.4, 3.0, 2.1], [-24, -26, 4.0, 4.6, 1.2], [36, 8, 4.2, 5.0, 0.9]];
const STEEP = 1.55, CAP = 0.98; // 옆면 기울기, 꼭대기를 자르는 높이 (가까울수록 뾰족하다)
// 면이 몇 개뿐인 각진 봉우리: 다섯 방향 평면 중 가장 먼 것으로 깎고, 꼭대기는 비스듬히 잘린다
function bergAt(x, z) {
  let top = 0;
  for (const [bx, bz, r, h, turn] of BERGS) {
    const dx = x - bx, dz = z - bz;
    if (Math.abs(dx) > r * 1.5 || Math.abs(dz) > r * 1.5) continue;
    let k = 0;
    for (let n = 0; n < 5; n++) { const a = turn + n * 1.2566 + 0.35 * rnd(bx, bz, n); k = Math.max(k, (dx * Math.cos(a) + dz * Math.sin(a)) / (r * (0.75 + 0.35 * rnd(bz, bx, n)))); }
    const y = Math.min(h * STEEP * (1 - k), h * (CAP + 0.34 * (dx * Math.cos(turn) + dz * Math.sin(turn)) / r));
    top = Math.max(top, y);
  }
  return top;
}
export function shoreSurface(def) {
  return (x, z) => {
    const d = offshore(x, z);
    if (d < 0) { // 땅: 눈이 바람에 쌓여 생긴 낮은 물결, 절벽 끝은 살짝 들린 눈 처마
      const drift = 0.16 * Math.sin((x * 0.5 + z) * 1.5 + noise(x * 0.3, z * 0.3) * 3);
      return pad(x, z) * (height(x, z) * 0.5 * (def.relief ?? 1) + drift) + 0.22 * smooth(-0.9, -0.1, d);
    }
    const berg = bergAt(x, z);
    if (berg > 0) return SEA + berg;
    if (d < LEAD[0]) return -CLIFF * smooth(0, LEAD[0], d);       // 절벽
    if (d < LEAD[1] + 0.3 * noise(x * 0.8, z * 0.8)) return SEA;    // 물길
    const f = floeAt(x, z);
    if (f.edge < 0.2) return SEA - 0.06;                            // 판 사이 금 (물)
    const tilt = (rnd(f.i, f.j, 3) - 0.5) * 0.34 * f.dx + (rnd(f.i, f.j, 4) - 0.5) * 0.34 * f.dz;
    return SEA + 0.16 + 0.26 * rnd(f.i, f.j, 5) + tilt + (f.edge < 0.42 ? 0.1 : 0); // 판마다 높이·기울기가 다르고 가장자리가 살짝 들린다
  };
}
// 그 자리가 무엇인지: 땅 · 절벽 · 물 · 유빙 · 유빙 가장자리 · 빙산
export function shoreKind(x, z) {
  const d = offshore(x, z);
  if (d < -0.12) return 'land';
  if (bergAt(x, z) > 0 && d > 0) return 'berg';
  if (d < LEAD[0]) return 'cliff';
  if (d < LEAD[1] + 0.3 * noise(x * 0.8, z * 0.8)) return 'water';
  const e = floeAt(x, z).edge;
  return e < 0.2 ? 'water' : e < 0.42 ? 'rim' : 'floe';
}
// 빙산 하나를 이루는 선: 물 위 둘레, 모서리, 비스듬히 잘린 꼭대기 둘레 (bergAt 과 같은 모양)
function bergLines([bx, bz, r, h, turn]) {
  const planes = [0, 1, 2, 3, 4].map(n => { const a = turn + n * 1.2566 + 0.35 * rnd(bx, bz, n); return [Math.cos(a), Math.sin(a), r * (0.75 + 0.35 * rnd(bz, bx, n))]; });
  const corners = planes.map((p, n) => { // 이웃한 두 면이 만나는 물 위 모퉁이
    const q = planes[(n + 1) % 5], det = p[0] * q[1] - p[1] * q[0];
    return [(p[2] * q[1] - q[2] * p[1]) / det, (p[0] * q[2] - q[0] * p[2]) / det];
  });
  const base = corners.map(([x, z]) => [bx + x, SEA, bz + z]);
  const top = corners.map(([x, z]) => {
    const c = (x * Math.cos(turn) + z * Math.sin(turn)) / r, s = Math.min(0.92, (STEEP - CAP) / (STEEP + 0.34 * c));
    return [bx + x * s, SEA + Math.min(h * STEEP * (1 - s), h * (CAP + 0.34 * c * s)), bz + z * s];
  });
  const lines = [];
  for (let n = 0; n < 5; n++) lines.push([base[n], base[(n + 1) % 5]], [base[n], top[n]], [top[n], top[(n + 1) % 5]]);
  return lines;
}
// 해안을 읽히게 하는 선 점: 빙산 모서리 · 절벽 위아래 선과 세로 골 · 유빙 판 둘레
const LINE_STEP = 0.035, FLOE_LINES = 24000, FLOE_REACH = 21;
export function shoreLines(def) {
  const random = mulberry32(def.seed + 77), pts = [];
  const line = (a, b, color, step = LINE_STEP) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step);
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, color]); }
  };
  for (const berg of BERGS) { // 먼 빙산일수록 선 점을 성기고 어둡게
    const far = Math.hypot(berg[0], berg[1]), k = 1 - 0.65 * smooth(12, 38, far);
    for (const [a, b] of bergLines(berg)) line(a, b, shade(cream(1), 0.9 * k), LINE_STEP * (1 + far / 14));
  }
  // 빙산 면: 면마다 한 밝기로 칠해 각진 덩어리로 보이게 한다
  for (const [bx, bz, r, h, turn] of BERGS) {
    const far = Math.hypot(bx, bz), n = Math.round(620 * r * h * (far < 14 ? 1 : 0.3));
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2, q = Math.sqrt(random()) * r * 1.3, x = bx + Math.cos(a) * q, z = bz + Math.sin(a) * q, y = bergAt(x, z);
      if (y <= 0) continue;
      const face = Math.floor(((a - turn) / 1.2566 + 10) % 5), tone = 0.35 + 0.65 * rnd(bx, face, bz);
      pts.push([x, SEA + y, z, shade(blueStep(0.7 + 0.3 * tone), (0.35 + 0.65 * tone) * (1 - 0.5 * smooth(12, 38, far)))]);
    }
  }
  // 절벽: 해안선을 따라가며 위 선, 물가 선, 군데군데 세로 골
  const cliffAt = (x, z, nx, nz) => {
    pts.push([x, 0.22, z, shade(cream(1), 0.8)], [x + nx * LEAD[0], SEA + 0.04, z + nz * LEAD[0], blueStep(0.9)]);
    if (random() < 0.07) line([x, 0.18, z], [x + nx * LEAD[0], SEA, z + nz * LEAD[0]], shade(blueStep(0.9), 0.75), 0.05);
  };
  for (let t = -14; t < 14; t += 0.03) {
    const cx = coastX(t); if (t > coastZ(cx)) cliffAt(cx, t, 1, 0);
    const cz = coastZ(t); if (t < coastX(cz)) cliffAt(t, cz, 0, -1);
  }
  // 유빙 판 둘레: 금 바로 옆에 놓인 후보만 남긴다
  for (let i = 0, kept = 0; i < FLOE_LINES * 16 && kept < FLOE_LINES; i++) {
    const r = random() ** 0.62 * FLOE_REACH, a = random() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (offshore(x, z) < LEAD[1] || bergAt(x, z) > 0) continue;
    const f = floeAt(x, z);
    if (f.edge < 0.2 || f.edge > 0.27) continue;
    kept++;
    pts.push([x, shoreSurface(def)(x, z), z, shade(blueStep(1), 1 - 0.55 * smooth(9, FLOE_REACH, r))]);
  }
  const out = output(pts.length);
  pts.forEach(([x, y, z, color], i) => put(out, i, x, y, z, color));
  return out;
}
// 종류마다 점을 얼마나 촘촘히 남길지 (물은 거의 비우고, 절벽·빙산·판 가장자리는 촘촘하게)
const KEEP = { land: 0.5, cliff: 1, water: 0.03, floe: 0.5, rim: 1, berg: 1 };
const shoreColor = (def, light, x, z) => {
  const kind = shoreKind(x, z), l = 0.45 + 0.55 * light;
  if (kind === 'land') return shade(groundColor(def, light), 0.8);
  if (kind === 'water') return blueStep(0.16);
  if (kind === 'cliff') return shade(blueStep(0.82), 0.6 + 0.4 * light);
  if (kind === 'berg') return shade(light > 0.5 ? cream(1) : blueStep(0.9), 0.5 + 0.5 * light);
  return shade(blueStep(kind === 'rim' ? 0.95 : 0.66), kind === 'rim' ? 0.75 + 0.25 * light : l);
};

const warm = (x, z) => riftCut(x, z) > 0.72;
export const COLD = {
  basin: { surface: basinSurface, color: (def, light) => groundColor(def, light), rocks: () => 0.7 },
  rift: { surface: riftSurface, color: (def, light, x, z) => (warm(x, z) ? shade(orange(1), 0.65 + 0.35 * light) : groundColor(def, light)), rocks: (x, z) => (Math.abs(x - riftAxis(z)) < 3.4 ? 0.9 : 0.35) },
  // exact: 금·절벽이 격자에서 뭉개지지 않게 높이를 지표 함수에서 바로 잰다. keep: 그 자리의 점을 남길 확률
  shore: { surface: shoreSurface, color: shoreColor, rocks: (x, z) => (offshore(x, z) < -0.5 ? 0.35 : 0), exact: true, keep: (x, z) => KEEP[shoreKind(x, z)] },
};

const build = name => (count, def) => {
  const random = mulberry32(def.seed), out = output(count), kind = COLD[name], surface = kind.surface(def);
  const grid = surfaceGrid(surface, starDirection(def.star)), rocks = rockCount(count, def);
  for (let i = 0; i < count - rocks; i++) {
    let [x, z] = sampleGround(random);
    for (let t = 0; kind.keep && t < 10 && random() > kind.keep(x, z); t++) [x, z] = sampleGround(random);
    put(out, i, x, kind.exact ? surface(x, z) : grid.ground(x, z), z, kind.color(def, grid.light(x, z), x, z));
  }
  addRocks(out, count - rocks, rocks, def, grid, random, (x, z) => (Math.hypot(x, z) > PAD_BLEND ? kind.rocks(x, z) : 0));
  return out;
};
const join = (a, b) => { const all = new Float32Array(a.length + b.length); all.set(a); all.set(b, a.length); return all; };
export const buildBasin = build('basin'), buildRift = build('rift');
export const buildShore = (count, def) => {
  const ground = build('shore')(count, def), lines = shoreLines(def);
  return Object.fromEntries(['positions', 'colors', 'shake'].map(key => [key, join(ground[key], lines[key])]));
};
