import { temperatureColor, AMBER } from '../../engine/palette.js';
import { clamp, smoothstep, mulberry32, height, sunlight } from './terrain.js';
import { starDirection, fillStar } from './sky.js';

/**
 * 위치 무대 B: 용암동굴
 *
 * 땅을 세로로 자른 단면 + 지표에서 아래로 이어지는 동굴 튜브를 점으로 만든다. 선지 JSON 의 layers.location.lava_tube 가 부른다.
 *
 *   "lava_tube": { "label": "용암동굴", "asset": null, "stage": "lava_tube", "pointSize": 10,
 *                  "temperature": [25, 30], "star": { "azimuth": 40, "elevation": 6 } }
 *
 * 무엇이 보이나
 * - 지표: 평지와 같은 땅 모양(낮은 기복)을 별빛으로 비춘다. 튜브 입구는 지표에 뚫려 있다.
 * - 단면(z = 0 면): 잘라 낸 암반. 깊이마다 줄무늬가 있고 지표에서 멀수록 어둡고 시원하다. 튜브 둘레는 윤곽선으로 밝게.
 * - 튜브: 입구에서 비스듬히 내려가 수평으로 이어진다. 반쪽(z ≤ 0)만 있어서 단면으로 들여다보면 안쪽 벽이 보인다.
 *   안쪽 온도는 temperature 범위 안에서 거의 일정하고, 입구만 밝고 안쪽은 어둡다 (빛은 입구로만 들어온다).
 * - 무너질 위험: 튜브 천장 한 부분의 점이 미세하게 떨리고 주황으로 물든다 (aShake 로 표현, 셰이더는 그대로).
 * - 별: 평지와 같은 자리(sky.js). 단면 샷에서는 화면 밖이지만, 카메라를 돌리면 같은 곳에 있다.
 *
 * 좌표: 카메라는 +z 쪽에서 단면(z = 0 면)을 바라본다. x 는 오른쪽, y 는 위. 지표는 y ≈ 0.
 * 위치 무대에서 쓰는 점 개수 분배: 별 4% · 지표 15% · 암반 단면 24% · 튜브 벽 나머지.
 */

// 단면 암반의 범위
const X0 = -3.2;
const X1 = 3.2;
const Z0 = -1.6; // 지표가 뒤로 깔리는 깊이
const FLOOR = -2.4; // 단면 아래 끝
const AMP = 0.45; // 지표 기복 (평지보다 훨씬 낮게)

// 튜브: 중심선은 입구(x = PX0)에서 아래로 내려가 수평이 된다. 단면 모양은 타원
const PX0 = -2.3;
const PX1 = X1;
const RY = 0.42; // 위아래 반지름
const RZ = 0.55; // 앞뒤(깊이) 반지름

// 무너질 위험 표시: 튜브를 따라간 위치(0~1)와 천장 쪽 각도 범위
const RISK_U = [0.58, 0.72];
const RISK_THETA = [1.55 * Math.PI, 1.95 * Math.PI];

/** 튜브 중심선의 높이 */
function pathY(x) {
  const u = clamp((x - PX0) / (PX1 - PX0), 0, 1);
  return -1.0 + 1.05 * (1 - smoothstep(0, 0.38, u)) - 0.06 * Math.sin(Math.PI * u);
}

/** 중심선의 법선(위쪽 방향) 벡터 [nx, ny] */
function pathNormal(x) {
  const dy = (pathY(x + 0.01) - pathY(x - 0.01)) / 0.02;
  const l = Math.hypot(1, dy);
  return [-dy / l, 1 / l];
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
  const surfaceCount = Math.round(count * 0.15);
  const rockCount = Math.round(count * 0.24);
  const wallCount = count - starCount - surfaceCount - rockCount;

  const rand = mulberry32(20261029);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const shake = new Float32Array(count);
  let n = 0;
  const put = (x, y, z, rgb, k = 1) => {
    positions[n * 3] = x;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = z;
    colors[n * 3] = rgb[0] * k;
    colors[n * 3 + 1] = rgb[1] * k;
    colors[n * 3 + 2] = rgb[2] * k;
    n++;
  };
  const surfaceY = (x, z) => height(x, z, AMP, false);

  // 입구에서 튜브를 따라간 길이: 안쪽이 얼마나 어두운지 정한다
  const arc = [0];
  const STEPS = 400;
  for (let i = 1; i <= STEPS; i++) {
    const xa = PX0 + ((PX1 - PX0) * (i - 1)) / STEPS;
    const xb = PX0 + ((PX1 - PX0) * i) / STEPS;
    arc.push(arc[i - 1] + Math.hypot(xb - xa, pathY(xb) - pathY(xa)));
  }
  const arcAt = (x) => arc[Math.round(clamp((x - PX0) / (PX1 - PX0), 0, 1) * STEPS)];
  const slopeMax = 1.3; // 경사 구간에서 길이가 늘어나는 비율의 최댓값 (점을 길이에 비례해 뿌리려고)

  // 1. 지표: 별빛을 받은 땅. 튜브 입구가 뚫린 곳은 비운다
  while (n < surfaceCount) {
    const x = X0 + (X1 - X0) * rand();
    const z = Z0 * rand();
    const { y, lit } = sunlight(x, z, L, AMP, false);
    if (x > PX0 - RY && pathY(x) + RY * Math.sqrt(Math.max(0, 1 - (z / RZ) ** 2)) > y - 0.02) continue;
    const c = temperatureColor(55 + 11 * lit);
    put(x, y, z, c, 0.4 + 0.6 * lit);
  }

  // 2. 암반 단면 (z = 0 면): 바탕 + 깊이 줄무늬 + 튜브 둘레 윤곽 + 바깥 테두리
  const inTube = (x, y) => x >= PX0 && x <= PX1 && Math.abs(y - pathY(x)) < RY * 0.98;
  const rockEnd = n + rockCount;
  while (n < rockEnd) {
    const r = rand();
    let x = X0 + (X1 - X0) * rand();
    let y;
    let k = 1; // 밝기 배율
    let T = null; // null 이면 깊이로 정한다 (지표 62°C → 깊을수록 시원)
    const top = () => surfaceY(x, 0);

    if (r < 0.5) {
      y = FLOOR + (top() - FLOOR) * rand(); // 바탕 암반
    } else if (r < 0.78) {
      const level = [0.35, 0.8, 1.3, 1.85][Math.floor(rand() * 4)]; // 깊이마다 줄무늬
      y = top() - level + 0.05 * Math.sin(x * 1.3 + level * 5) + (rand() - 0.5) * 0.03;
      k = 1.6;
    } else if (r < 0.92) {
      if (x < PX0 || x > PX1) continue; // 튜브 둘레 윤곽: 동굴 온도
      y = pathY(x) + (rand() < 0.5 ? 1 : -1) * (RY + 0.01 + rand() * 0.04);
      k = 2.2;
      T = (caveMin + caveMax) / 2;
    } else {
      const edge = Math.floor(rand() * 3); // 바깥 테두리: 왼쪽 · 오른쪽 · 아래
      if (edge === 0) x = X0;
      else if (edge === 1) x = X1;
      y = edge === 2 ? FLOOR : FLOOR + (top() - FLOOR) * rand();
      k = 1.8;
    }

    if (y > top() || y < FLOOR || (T === null && inTube(x, y))) continue;
    const d = top() - y;
    put(x, y, 0, temperatureColor(T ?? 62 - 32 * smoothstep(0, 1.8, d)), (0.14 + 0.36 * (1 - clamp(d / 2.4, 0, 1))) * k);
  }

  // 3. 튜브 벽: 단면에서 잘린 반쪽(z ≤ 0)의 안쪽 면. 입구는 밝고 안쪽으로 갈수록 어둡다
  const wallEnd = n + wallCount;
  while (n < wallEnd) {
    const x = PX0 + (PX1 - PX0) * rand();
    const slope = (pathY(x + 0.01) - pathY(x - 0.01)) / 0.02;
    if (rand() > Math.hypot(1, slope) / slopeMax) continue; // 길이에 비례해 뽑는다
    const theta = Math.PI + Math.PI * rand(); // z ≤ 0 쪽 반원
    const [nx, ny] = pathNormal(x);
    const px = x + nx * RY * Math.cos(theta);
    const py = pathY(x) + ny * RY * Math.cos(theta);
    const pz = RZ * Math.sin(theta);
    if (px > X1 || py > surfaceY(px, pz) + 0.01) continue; // 지표 위로 솟은 부분은 자른다

    const T = caveMin + (caveMax - caveMin) * rand(); // 안쪽 온도는 거의 일정
    const light = 0.3 + 0.65 * Math.exp(-arcAt(x) / 0.9); // 빛은 입구로만 들어온다
    let rgb = temperatureColor(T).map((v) => v * light);

    // 무너질 위험: 천장 한 부분이 떨리고 주황으로 물든다
    const u = (x - PX0) / (PX1 - PX0);
    if (u > RISK_U[0] && u < RISK_U[1] && theta > RISK_THETA[0] && theta < RISK_THETA[1]) {
      shake[n] = 1;
      rgb = rgb.map((v, j) => v + (AMBER[j] * 0.9 - v) * 0.85);
    }
    put(px, py, pz, rgb);
  }

  fillStar(positions, colors, n, starCount, starDef, rand);
  return { positions, colors, shake };
}
