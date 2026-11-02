import { mulberry32, height, noise, smooth, clamp, surfaceGrid, starDirection, sampleGround, output, put, groundColor, rockCount, addRocks } from './terrain.js';

export const TOP_HALF_WIDTH = 0.45;
export const ICE_U = 4.8;
const RELIEF = 0.48;
const GULLY_DEPTH = 0.52;
const REAR_RIDGE_1 = 7.4;
const REAR_RIDGE_2 = 10.3;
const CREST_BEND = 1.6; // 능선 마루가 길이 방향으로 휘는 정도. 단면(높이·폭·얼음 골짜기 거리)은 그대로 따라 휜다
// 완사면 쪽으로 갈라져 내려가는 곁가지 능선. 출발점·방향은 마루 좌표(u, v).
// lift 는 사면에서 원래 마루(높이 0)까지 중 곁가지 마루가 올라가는 비율이다. 그래서 늘 원래 마루보다 낮다
export const SPUR = { u: -0.9, v: -5.2, dir: [-0.72, -0.69], length: 18, width: 1.0, lift: 0.72, sway: 1.1 };

// 원본이 없는 별도 모델의 기준 단면. 기존 프로젝트 좌표와 일치한다고 가정하지 않는다.
export function ridgeProfile(u) {
  if (u < -TOP_HALF_WIDTH) return -2.7 * smooth(0, 12, -u - TOP_HALF_WIDTH);
  if (u <= TOP_HALF_WIDTH) return 0;
  if (u < ICE_U) return -4.8 * smooth(TOP_HALF_WIDTH, ICE_U, u);
  return -4.8 + 1.65 * Math.exp(-(((u - REAR_RIDGE_1) / 1.15) ** 2))
    + 1.05 * Math.exp(-(((u - REAR_RIDGE_2) / 0.95) ** 2));
}
// 능선 마루의 x 위치. 원점(주거 띠 가운데)에서는 0 이고, 멀어질수록 굽이친다
export const ridgeCrest = z => CREST_BEND * (Math.sin(z * 0.21 + 0.6) - Math.sin(0.6)) + 2.2 * (noise(z * 0.11 + 1.3, 11) - noise(1.3, 11));
export function ridgeFrame(x, z) { return { u: x - ridgeCrest(z), v: z }; }
// 곁가지 능선이 사면을 끌어올리는 비율 (0 ~ lift). 출발점에서 서서히 솟고, 끝에서 사면으로 잦아든다
function spurLift(u, v) {
  const [du, dv] = SPUR.dir, pu = u - SPUR.u, pv = v - SPUR.v;
  const s = pu * du + pv * dv;
  if (s < 0 || s > SPUR.length + 4) return 0;
  const lateral = pu * -dv + pv * du - SPUR.sway * Math.sin(s * 0.27) * smooth(0, 4, s);
  const width = SPUR.width + 0.06 * s;
  const gate = smooth(0, 2.5, s) * (1 - smooth(SPUR.length - 4, SPUR.length + 4, s));
  return SPUR.lift * gate * Math.exp(-((lateral / width) ** 2)) * (0.85 + 0.3 * noise(s * 0.4, 21));
}
export function ridgeSurface(x, z, def) {
  const { u, v } = ridgeFrame(x, z);
  const protection = smooth(TOP_HALF_WIDTH, 1.2, Math.abs(u));
  const iceProtection = smooth(0.45, 1, Math.abs(u - ICE_U));
  const slopeMask = smooth(0.6, 1.5, u) * (1 - smooth(3.5, ICE_U, u));
  // 홈은 사면을 따라 내려가며 갈라진다. 간격·폭·깊이를 서로 다르게 한다.
  let erosion = 0, fans = 0;
  for (let k = 0; k < 7; k++) {
    const axis = -8.2 + k * 2.65 + noise(k * 3.7, 9) * 0.7;
    const bend = noise(u * 0.36 + k * 5, k * 2.1) * 0.9;
    const width = 0.13 + smooth(0.6, 4, u) * (0.18 + k % 3 * 0.06);
    const gap = (v - axis - bend) / width;
    const cut = Math.exp(-gap * gap);
    erosion += cut * (0.5 + noise(k, 4) * 0.3);
    fans += Math.exp(-(((v - axis - bend) / (width * 2.8)) ** 2)) * Math.exp(-(((u - 3.65) / 0.65) ** 2));
  }
  // 뒤쪽 등줄기는 같은 단면을 복사하지 않고 끊어지는 지맥과 안부를 만든다.
  const rear = smooth(5.4, 6.4, u);
  const warpedU = u + rear * noise(v * 0.23, u * 0.07 + 50) * 0.85;
  const rearBase = ridgeProfile(warpedU);
  const notch = rear * (0.3 + 0.38 * noise(v * 0.35 + 6, u * 0.15)) * (rearBase + 4.8);
  let base = ridgeProfile(u) * (1 - rear) + (rearBase - notch) * rear;
  // 곁가지 능선: 완사면 쪽(u < 0)에서만. 주거 띠(|u| ≤ 0.45)는 높이가 0 이라 바뀌지 않는다
  if (u < -TOP_HALF_WIDTH) base *= 1 - spurLift(u, v);
  const folds = (1 - Math.abs(noise(u * 0.9 + noise(v * 0.2, 3), v * 0.34))) * 0.18;
  const detail = height(x, z) * RELIEF + folds - erosion * GULLY_DEPTH * slopeMask + fans * 0.18;
  return base + protection * iceProtection * detail * (def.relief ?? 2);
}
export function buildRidge(count, def) {
  const random = mulberry32(def.seed), out = output(count);
  const grid = surfaceGrid((x, z) => ridgeSurface(x, z, def), starDirection(def.star));
  const rocks = rockCount(count, def);
  for (let i = 0; i < count - rocks; i++) {
    const [x, z] = sampleGround(random);
    const { u } = ridgeFrame(x, z);
    const y = Math.abs(u) <= TOP_HALF_WIDTH ? 0 : grid.ground(x, z);
    const ice = Math.abs(u - ICE_U) < 0.4 + noise(z * 0.5, 3) * 0.1;
    put(out, i, x, y, z, groundColor(def, grid.light(x, z), ice));
  }
  addRocks(out, count - rocks, rocks, def, grid, random, (x, z) => {
    const { u } = ridgeFrame(x, z);
    if (Math.abs(u) < 1 || Math.abs(u - ICE_U) < 0.8) return 0;
    return 0.12 + 0.8 * Math.exp(-(((u - 3.65) / 0.8) ** 2));
  });
  return out;
}
