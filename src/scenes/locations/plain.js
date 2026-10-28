import { temperatureColor, CREAM, AMBER } from '../../engine/palette.js';

/**
 * 위치 무대 A: 평지
 *
 * 넓고 낮은 기복의 지형을 점으로 만든다. 새 셰이더는 만들지 않고, 점 위치와 색(aColor)만 계산해서
 * 공통 포인트 셰이더에 넘긴다 (CLAUDE.md "렌더링" 규칙). 선지 JSON 의 layers.location.plain 이 이 함수를 부른다.
 *
 *   "plain": { "label": "평지", "asset": null, "stage": "plain",
 *              "temperature": [55, 66], "star": { "azimuth": 40, "elevation": 7 } }
 *
 * - 별은 지평선 위 한 곳에 고정이다 (조석 고정 행성이라 하늘은 돌지 않는다). 위치는 JSON 의 star 값으로만 바뀐다.
 * - 빛은 그 별에서 온다. 별을 향한 비탈은 밝고 뜨겁고, 반대쪽 비탈과 언덕 뒤는 그림자가 져서 어둡고 덜 뜨겁다.
 * - 점 색은 온도(temperature 범위)를 palette.js 의 temperatureColor 로 바꿔서 쓴다: 밝은 곳 66°C 쪽 주황, 그림자 55°C 쪽.
 * - 같은 값이면 늘 같은 지형이다 (난수 씨앗 고정). 팀원 화면이 모두 같게 보인다.
 * - 다른 위치 무대(B, C)를 만들 때도 starDirection 으로 같은 별 방향을 쓴다.
 *
 * 좌표: 카메라가 보는 쪽이 -z, 오른쪽이 +x, 위가 +y. 가운데(0,0) 둘레는 주거 모듈이 놓일 자리라 편평하게 둔다.
 */

const DEG = Math.PI / 180;

// 지형이 깔리는 범위 (월드 단위)
const X0 = -6;
const X1 = 6;
const Z0 = -8;
const Z1 = 3;

/**
 * 별 방향 단위벡터. azimuth: 정면(-z)에서 오른쪽(+x)으로 잰 각도(도), elevation: 지평선 위 높이(도).
 */
export function starDirection({ azimuth = 40, elevation = 7 } = {}) {
  const az = azimuth * DEG;
  const el = elevation * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * @param {number} count  만들 점 개수 (location 레이어는 30000)
 * @param {object} [def]  JSON 의 layers.location.plain
 * @returns {{ positions: Float32Array, colors: Float32Array }}
 */
export function buildPlain(count, def = {}) {
  const [tMin, tMax] = def.temperature ?? [55, 66];
  const starDef = def.star ?? {};
  const L = starDirection(starDef);
  const starCount = Math.min(starDef.points ?? 2200, count >> 3);
  const terrainCount = count - starCount;

  const rand = mulberry32(20261028);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  // 지평선 쪽으로 가는 방향과 별의 기울기: 그림자 계산에 쓴다
  const lh = Math.hypot(L[0], L[2]);
  const dir = [L[0] / lh, L[2] / lh];
  const slope = L[1] / lh;

  // 그림자: 점에서 별 쪽으로 걸어가며 더 높은 땅이 빛을 가리는지 본다. 0 = 환함, 1 = 완전히 그림자
  function shadow(x, y, z) {
    let s = 0;
    for (let t = 0.1; t < 3.5; t *= 1.12) {
      const gap = height(x + dir[0] * t, z + dir[1] * t) - (y + t * slope);
      if (gap > 0) s = Math.max(s, Math.min(1, gap / 0.04));
      if (s >= 1) break;
    }
    return s;
  }

  // 가까운 곳에 점을 더 촘촘히: 카메라 앞쪽(-2, 4 근처)에서 멀수록 드물게 뽑는다.
  // 먼 땅은 화면에서 좁게 눌려 저절로 빽빽해 보이므로, 그대로 두면 가까운 땅만 성겨 보인다
  let n = 0;
  while (n < terrainCount) {
    const x = X0 + (X1 - X0) * rand();
    const z = Z0 + (Z1 - Z0) * rand();
    const dx = x + 2;
    const dz = z - 4;
    if (rand() > 1 / (1 + (dx * dx + dz * dz) / 49)) continue;

    const y = height(x, z);
    // 비탈 기울기 → 법선. 별을 향한 비탈일수록 밝다 (편평한 땅이 기준)
    const e = 0.05;
    const gx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    const inv = 1 / Math.hypot(gx, 1, gz);
    const facing = (-gx * L[0] + L[1] - gz * L[2]) * inv;
    let lit = clamp(0.5 + 4.5 * (facing - L[1]), 0, 1);
    lit *= 1 - 0.92 * shadow(x, y, z);

    const c = temperatureColor(tMin + (tMax - tMin) * lit);
    const b = 0.4 + 0.6 * lit;
    positions.set([x, y, z], n * 3);
    colors.set([c[0] * b, c[1] * b, c[2] * b], n * 3);
    n++;
  }

  // 별: 지평선 위 한 곳에 고정된 빛나는 점 무리. 가운데는 크림색, 가장자리는 주황으로 번진다
  const dist = starDef.distance ?? 11;
  const radius = starDef.radius ?? 0.9;
  const a = normalize(cross(L, [0, 1, 0]));
  const b = cross(a, L);
  for (let i = 0; i < starCount; i++) {
    const r = radius * rand() ** 2.4;
    const ang = rand() * Math.PI * 2;
    const u = Math.cos(ang) * r;
    const v = Math.sin(ang) * r;
    const k = r / radius;
    const o = (terrainCount + i) * 3;
    for (let j = 0; j < 3; j++) {
      positions[o + j] = L[j] * dist + a[j] * u + b[j] * v;
      colors[o + j] = (CREAM[j] + (AMBER[j] - CREAM[j]) * k * 0.8) * (1 - 0.35 * k);
    }
  }

  return { positions, colors };
}

/** 지형 높이: 큰 물결 위에 작은 물결을 겹친다. 가운데는 편평하게 눌러 둔다 */
function height(x, z) {
  const n = 0.62 * noise(x * 0.22, z * 0.22, 1) + 0.28 * noise(x * 0.55 + 7, z * 0.55 + 3, 2) + 0.1 * noise(x * 1.4, z * 1.4, 3);
  return (n - 0.5) * 1.6 * smoothstep(1, 3, Math.hypot(x, z));
}

/** 0~1 값 노이즈 (격자 난수를 부드럽게 이은 것) */
function noise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const normalize = (p) => {
  const l = Math.hypot(...p) || 1;
  return p.map((c) => c / l);
};
