import { temperatureColor, AMBER } from '../../engine/palette.js';
import { clamp, smoothstep, mulberry32, height, sunlight, noise } from './terrain.js';
import { starDirection, fillStar } from './sky.js';

/**
 * 위치 무대 B: 용암동굴
 *
 * 땅을 세로로 자른 단면 + 지표에서 아래로 이어지는 동굴을 점으로 만든다. 선지 JSON 의 layers.location.lava_tube 가 부른다.
 *
 *   "lava_tube": { "label": "용암동굴", "asset": null, "stage": "lava_tube", "pointSize": 10,
 *                  "temperature": [25, 30], "star": { "azimuth": 40, "elevation": 6 } }
 *
 * 무엇이 보이나
 * - 지표: 평지와 같은 땅 모양(낮은 기복)을 별빛으로 비춘다. 동굴 입구는 지표에 불규칙하게 뚫려 있다.
 * - 단면(z = 0 면): 잘라 낸 암반. 깊이마다 줄무늬가 있고 지표에서 멀수록 어둡고 시원하다. 동굴 둘레의 윤곽선은 밝게.
 * - 동굴: 반듯한 원통이 아니다. 위치마다 폭과 높이가 달라서 넓은 방과 좁은 목이 번갈아 나오고, 중심선도 구불거린다.
 *   바닥은 평평하고 천장은 둥글게 솟았으며, 벽과 천장은 울퉁불퉁한 암벽이다(거친 요철 + 용암이 흐른 결 + 능선처럼 밝은 모서리).
 *   반쪽(z ≤ 0)만 있어서 단면으로 들여다보면 안쪽 벽이 보인다.
 * - 안쪽 온도는 temperature 범위 안에서 거의 일정하고, 빛은 입구로만 들어온다: 입구 쪽과 입구를 마주 보는 면이 밝고 안쪽은 어둡다.
 * - 바닥의 바위 더미와, 바닥에서 천장까지 이어진 기둥 두 개.
 * - 무너질 위험: 천장 한 부분의 점이 미세하게 떨리고 주황으로 물든다 (aShake 로 표현, 셰이더는 그대로). 그 아래 바닥에는 무너진 바위가 쌓여 있다.
 * - 별: 평지와 같은 자리(sky.js). 단면 샷에서는 화면 밖이지만, 카메라를 돌리면 같은 곳에 있다.
 *
 * 좌표: 카메라는 +z 쪽에서 단면(z = 0 면)을 바라본다. x 는 오른쪽, y 는 위. 지표는 y ≈ 0.
 * 점 개수 분배: 별 4% · 지표 12% · 암반 단면 20% · 바위 더미와 기둥 8% · 동굴 벽 나머지.
 */

// 단면 암반의 범위
const X0 = -3.2;
const X1 = 3.2;
const Z0 = -1.6; // 지표가 뒤로 깔리는 깊이
const FLOOR = -2.4; // 단면 아래 끝
const AMP = 0.45; // 지표 기복 (평지보다 훨씬 낮게)

// 동굴: 입구(x = PX0)에서 아래로 내려가 수평으로 이어진다
const PX0 = -2.3;
const PX1 = X1;
const FLAT = 0.42; // 단면 아래쪽 이 비율보다 낮은 부분은 평평한 바닥이 된다
const ENTRANCE_LIGHT = [PX0 + 0.3, 0.25, -0.25]; // 빛이 들어오는 입구 쪽 한 점

// 무너질 위험 표시: 동굴을 따라간 위치(0~1)와 천장 쪽 각도 범위
const RISK_U = [0.58, 0.72];
const RISK_THETA = [1.55 * Math.PI, 1.95 * Math.PI];

// 거친 정도를 만드는 노이즈 (-1 ~ 1)
const n2 = (a, b, seed) => noise(a, b, seed) * 2 - 1;
const fbm = (a, b, seed) => 0.6 * n2(a, b, seed) + 0.3 * n2(a * 2.1 + 5, b * 2.1 + 3, seed + 1) + 0.1 * n2(a * 4.3, b * 4.3, seed + 2);
const ridged = (a, b, seed) => 1 - Math.abs(n2(a, b, seed)); // 0~1, 능선처럼 이어지는 밝은 모서리

/** 동굴 중심선의 높이: 입구에서 내려가 수평이 되고, 군데군데 구불거린다 */
function center(x) {
  const u = clamp((x - PX0) / (PX1 - PX0), 0, 1);
  return -1.0 + 1.05 * (1 - smoothstep(0, 0.38, u)) - 0.06 * Math.sin(Math.PI * u) + 0.08 * n2(x * 0.8, 1.7, 11);
}

/** 중심선의 위쪽 법선 [nx, ny] */
function pathNormal(x) {
  const dy = (center(x + 0.01) - center(x - 0.01)) / 0.02;
  const l = Math.hypot(1, dy);
  return [-dy / l, 1 / l];
}

/** 위치 x 에서 동굴의 위아래 반지름: 넓은 방과 좁은 목이 번갈아 나오고, 입구는 크게 벌어진다 */
function ryAt(x) {
  return (0.5 + 0.28 * (0.5 + 0.5 * n2(x * 0.75, 4.2, 12))) * (1 + 0.5 * (1 - smoothstep(PX0, PX0 + 1.2, x)));
}

/** 위치 x 에서 동굴의 앞뒤(깊이) 반지름 */
function rzAt(x) {
  return (0.55 + 0.3 * (0.5 + 0.5 * n2(x * 0.6, 8.8, 13))) * (1 + 0.3 * (1 - smoothstep(PX0, PX0 + 1.2, x)));
}

/** 단면 위아래 좌표: 아래쪽(-FLAT 이하)은 평평한 바닥으로 눌러 둔다 */
const flatten = (u) => (u >= -FLAT ? u : -FLAT + 0.08 * (u + FLAT));

/**
 * 동굴 벽 위의 한 점. theta 는 π(바닥, 잘린 면) → 3π/2(뒷벽) → 2π(천장, 잘린 면).
 * 벽은 위치와 각도에 따라 들쭉날쭉하다: 큰 굴곡 + 잔 요철 + 천장의 용암 흐름결.
 * @returns {{ x, y, z, inward: number[] }} inward 는 동굴 안쪽을 향한 단위 법선
 */
function wallPoint(x, theta) {
  const cu = Math.cos(theta);
  const sv = Math.sin(theta); // ≤ 0
  const ceiling = Math.max(0, cu);
  let f = 1 + 0.2 * fbm(x * 2.4, theta * 1.6, 21) + 0.07 * n2(x * 8, theta * 5, 24);
  f += 0.05 * Math.sin(theta * 7 + 3 * n2(x * 1.3, theta, 25) + x * 3.2) * ceiling; // 천장의 용암 흐름결
  const ry = ryAt(x) * f;
  const rz = rzAt(x) * f * (1 + 0.12 * n2(x * 3.1, flatten(cu) * 2.2, 26)); // 옆벽이 불룩 나오고 들어감

  const [nx, ny] = pathNormal(x);
  const yy = flatten(cu);
  const cy = center(x);
  const y = cy + ny * ry * yy;
  const px = x + nx * ry * yy;
  const z = rz * sv;

  // 안쪽 법선: 바닥은 위, 그 밖은 타원 단면의 안쪽
  let inward;
  if (cu < -FLAT) inward = [0, 1, 0];
  else {
    const gy = (y - cy) / (ry * ry);
    const gz = z / (rz * rz);
    const l = Math.hypot(gy, gz) || 1;
    inward = [0, -gy / l, -gz / l];
  }
  return { x: px, y, z, inward };
}

/**
 * @param {number} count  만들 점 개수 (location 레이어는 30000)
 * @param {object} [def]  JSON 의 layers.location.lava_tube
 * @returns {{ positions: Float32Array, colors: Float32Array, shake: Float32Array }}
 */
export function buildLavaTube(count, def = {}) {
  const [caveMin, caveMax] = def.temperature ?? [25, 30];
  const starDef = def.star ?? {};
  const L = starDirection(starDef);

  const starCount = Math.min(starDef.points ?? 1200, count >> 3);
  const surfaceCount = Math.round(count * 0.12);
  const rockCount = Math.round(count * 0.2);
  const pillarCount = Math.round(count * 0.016); // 기둥 하나당
  const boulderCount = Math.round(count * 0.048);
  const wallCount = count - starCount - surfaceCount - rockCount - pillarCount * 2 - boulderCount;

  const rand = mulberry32(20261031);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const shake = new Float32Array(count);
  let n = 0;
  const put = (x, y, z, rgb, k = 1) => {
    positions[n * 3] = x;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = z;
    colors[n * 3] = Math.min(1, rgb[0] * k);
    colors[n * 3 + 1] = Math.min(1, rgb[1] * k);
    colors[n * 3 + 2] = Math.min(1, rgb[2] * k);
    n++;
  };
  const surfaceY = (x, z) => height(x, z, AMP, false);
  const caveColor = () => temperatureColor(caveMin + (caveMax - caveMin) * rand()); // 안쪽 온도는 거의 일정

  // 단면(z = 0)에서 동굴의 윗선·아랫선, 입구에서 잰 길이: 촘촘한 표로 만들어 둔다
  const STEPS = 600;
  const topTab = new Float32Array(STEPS + 1);
  const botTab = new Float32Array(STEPS + 1);
  const arcTab = new Float32Array(STEPS + 1);
  const slopeTab = new Float32Array(STEPS + 1);
  let slopeMax = 1;
  for (let i = 0; i <= STEPS; i++) {
    const x = PX0 + ((PX1 - PX0) * i) / STEPS;
    topTab[i] = wallPoint(x, 2 * Math.PI).y;
    botTab[i] = wallPoint(x, Math.PI).y;
    slopeTab[i] = i === 0 ? 1 : Math.hypot(PX1 - PX0, (center(x) - center(x - (PX1 - PX0) / STEPS)) * STEPS) / (PX1 - PX0);
    arcTab[i] = i === 0 ? 0 : arcTab[i - 1] + slopeTab[i] * ((PX1 - PX0) / STEPS);
    slopeMax = Math.max(slopeMax, slopeTab[i]);
  }
  const idx = (x) => Math.round(clamp((x - PX0) / (PX1 - PX0), 0, 1) * STEPS);
  const inCave = (x, y) => x >= PX0 && x <= PX1 && y > botTab[idx(x)] - 0.004 && y < topTab[idx(x)];
  const ceilAt = (x, z) => center(x) + ryAt(x) * Math.sqrt(Math.max(0, 1 - (z / rzAt(x)) ** 2)); // 동굴 천장(대략)

  // 입구의 빛: 입구에 가깝고 입구를 마주 볼수록 밝다
  const caveLight = (x, py, pz, inward) => {
    const e = [ENTRANCE_LIGHT[0] - x, ENTRANCE_LIGHT[1] - py, ENTRANCE_LIGHT[2] - pz];
    const el = Math.hypot(...e) || 1;
    const facing = Math.max(0, (inward[0] * e[0] + inward[1] * e[1] + inward[2] * e[2]) / el);
    const reach = Math.exp(-arcTab[idx(x)] / 1.1);
    return 0.3 + 0.78 * reach * (0.35 + 0.65 * facing) + 0.2 * facing;
  };

  // 1. 지표: 별빛을 받은 땅. 동굴 입구가 뚫린 곳은 비운다
  while (n < surfaceCount) {
    const x = X0 + (X1 - X0) * rand();
    const z = Z0 * rand();
    const { y, lit } = sunlight(x, z, L, AMP, false);
    if (x > PX0 - 0.6 && x < PX0 + 2.4 && ceilAt(x, z) > y - 0.02) continue;
    put(x, y, z, temperatureColor(55 + 11 * lit), 0.4 + 0.6 * lit);
  }

  // 2. 암반 단면 (z = 0 면): 바탕 + 깊이 줄무늬 + 동굴 둘레 윤곽 + 바깥 테두리
  const rockEnd = n + rockCount;
  while (n < rockEnd) {
    const r = rand();
    let x = X0 + (X1 - X0) * rand();
    let y;
    let k = 1;
    let T = null;
    const top = () => surfaceY(x, 0);

    if (r < 0.5) {
      y = FLOOR + (top() - FLOOR) * rand();
    } else if (r < 0.76) {
      const level = [0.35, 0.8, 1.3, 1.85][Math.floor(rand() * 4)];
      y = top() - level + 0.05 * Math.sin(x * 1.3 + level * 5) + (rand() - 0.5) * 0.03;
      k = 1.6;
    } else if (r < 0.92) {
      if (x < PX0 || x > PX1) continue; // 동굴 둘레 윤곽: 들쭉날쭉한 윗선·아랫선을 따라
      const i = idx(x);
      y = (rand() < 0.5 ? topTab[i] : botTab[i]) + (rand() - 0.5) * 0.03;
      if (y > top() + 0.005) continue;
      k = 2.2;
      T = (caveMin + caveMax) / 2;
    } else {
      const edge = Math.floor(rand() * 3);
      if (edge === 0) x = X0;
      else if (edge === 1) x = X1;
      y = edge === 2 ? FLOOR : FLOOR + (top() - FLOOR) * rand();
      k = 1.8;
    }

    if (y > top() || y < FLOOR || (T === null && inCave(x, y))) continue;
    const d = top() - y;
    put(x, y, 0, temperatureColor(T ?? 62 - 32 * smoothstep(0, 1.8, d)), (0.14 + 0.36 * (1 - clamp(d / 2.4, 0, 1))) * k);
  }

  // 3. 바닥의 바위 더미: 입구 가까이와 무너질 천장 아래에 많이 쌓여 있다
  const boulderEnd = n + boulderCount;
  const boulders = [];
  for (let i = 0; i < 38; i++) {
    const x = PX0 + 0.5 + (PX1 - PX0 - 0.7) * rand() ** 1.5;
    boulders.push({ x, z: -(0.1 + 0.75 * rand()) * rzAt(x), r: 0.035 + 0.1 * rand() ** 2 });
  }
  for (let i = 0; i < 9; i++) {
    const x = PX0 + (PX1 - PX0) * (RISK_U[0] + (RISK_U[1] - RISK_U[0]) * rand()); // 무너진 천장 아래
    boulders.push({ x, z: -(0.08 + 0.7 * rand()) * rzAt(x), r: 0.07 + 0.11 * rand() });
  }
  const weights = boulders.map((b) => b.r * b.r);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  while (n < boulderEnd) {
    let pick = rand() * weightSum;
    let b = boulders[0];
    for (let i = 0; i < boulders.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        b = boulders[i];
        break;
      }
    }
    // 바위 표면의 한 점: 구 위의 방향에 거친 요철을 얹는다. 땅에 반쯤 묻혀 있다
    const dir = [rand() - 0.5, rand() - 0.5 + 0.12, rand() - 0.5];
    const dl = Math.hypot(...dir) || 1;
    const d = dir.map((v) => v / dl);
    if (d[1] < -0.25) continue;
    const bump = 1 + 0.35 * n2(d[0] * 2.3 + b.x * 5, d[2] * 2.3 + d[1] * 1.9, 41) + 0.12 * n2(d[0] * 7, d[2] * 7, 42);
    const gy = botTab[idx(b.x)] + 0.01;
    const px = b.x + d[0] * b.r * bump * 1.2;
    const py = gy + b.r * 0.5 + d[1] * b.r * bump * 0.9;
    const pz = b.z + d[2] * b.r * bump;
    if (pz > -0.01) continue;
    const light = caveLight(px, py, pz, d);
    put(px, py, pz, caveColor(), (0.7 + 0.9 * ridged(d[0] * 3 + b.r * 9, d[2] * 3, 43)) * light * (0.55 + 0.7 * Math.max(0, d[1])) * 1.6);
  }

  // 4. 바닥에서 천장까지 이어진 기둥 두 개: 가운데가 잘록하고 위아래가 퍼진다
  for (const [px0, pz0] of [[-0.35, -0.42], [2.2, -0.55]]) {
    const pillarEnd = n + pillarCount;
    const floorY = botTab[idx(px0)] + 0.01;
    const roofY = ceilAt(px0, pz0) - 0.02;
    while (n < pillarEnd) {
      const t = rand();
      const y = floorY + (roofY - floorY) * t;
      const waist = 0.065 + 0.075 * (1 - Math.sin(Math.PI * t) ** 0.8);
      const ang = rand() * Math.PI * 2;
      const rough = 1 + 0.3 * n2(ang * 1.3 + px0, t * 5, 44) + 0.1 * n2(ang * 5, t * 14, 45);
      const x = px0 + Math.cos(ang) * waist * rough;
      const z = pz0 + Math.sin(ang) * waist * rough;
      if (z > -0.005) continue;
      const inward = [Math.cos(ang), 0, Math.sin(ang)]; // 기둥 바깥으로 향한 면
      const light = caveLight(x, y, z, inward);
      put(x, y, z, caveColor(), (0.8 + 0.9 * ridged(ang * 2 + px0, t * 6, 46)) * light * 1.5);
    }
  }

  // 5. 동굴 벽: 단면에서 잘린 반쪽(z ≤ 0)의 안쪽 면. 거칠고 들쭉날쭉한 암벽이다
  const wallEnd = n + wallCount;
  while (n < wallEnd) {
    const x = PX0 + (PX1 - PX0) * rand();
    if (rand() > slopeTab[idx(x)] / slopeMax) continue; // 길이에 비례해 뽑는다
    const theta = Math.PI + Math.PI * rand();
    const p = wallPoint(x, theta);
    if (p.x > X1 || p.y > surfaceY(p.x, p.z) + 0.01) continue; // 지표 위로 솟은 부분은 자른다

    // 재질: 빛을 받은 정도 × 능선처럼 이어지는 밝은 모서리 × 얼룩
    const light = caveLight(p.x, p.y, p.z, p.inward);
    const vein = ridged(p.x * 3.2, theta * 2.6, 31);
    const patch = 0.85 + 0.3 * n2(p.x * 1.7, theta * 1.4, 32);
    let k = light * (0.62 + 0.9 * vein * vein) * patch;
    let rgb = caveColor();

    // 무너질 위험: 천장 한 부분이 떨리고 주황으로 물든다. 가장자리는 반듯하지 않게 울퉁불퉁 번진다
    const u = (x - PX0) / (PX1 - PX0) + 0.035 * n2(theta * 3, x * 2.1, 33);
    const t = theta + 0.18 * n2(x * 3.3, theta * 2, 34);
    const risk =
      smoothstep(RISK_U[0] - 0.02, RISK_U[0] + 0.03, u) * (1 - smoothstep(RISK_U[1] - 0.03, RISK_U[1] + 0.02, u)) *
      smoothstep(RISK_THETA[0] - 0.1, RISK_THETA[0] + 0.15, t) * (1 - smoothstep(RISK_THETA[1] - 0.15, RISK_THETA[1] + 0.1, t));
    if (risk > 0.05) {
      shake[n] = risk;
      rgb = rgb.map((v, j) => v + (AMBER[j] * 0.9 - v) * 0.85 * risk);
      k = k + (Math.max(k, 0.55) * 1.2 - k) * risk;
    }
    put(p.x, p.y, p.z, rgb, k * 2);
  }

  fillStar(positions, colors, n, starCount, starDef, rand);
  return { positions, colors, shake };
}
