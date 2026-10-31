import { blue, cream, orange } from './palette.js';
import { mulberry32, height, noise, clamp, surfaceGrid, starDirection, sampleGround, output, put, groundColor } from './terrain.js';

// 단면 위치와 위험 영역은 유지한다. 폭과 높이는 기준값 주변에서 완만하게 변한다.
export const TUBE_Y = -3;
export const TUBE_HEIGHT = 1.65;
export const TUBE_WIDTH = 2.45;
export const RISK_U = [-2.2, 1.2];
export const RISK_THETA = [0.12, 0.65];
const RELIEF = 0.38;
const WALL_DETAIL = 0.09;
const BACK_WALL_SHIFT = 0.85;
const BACK_WALL_WIDTH = 0.13;
const CHAMBER = { x: -3.8, length: 2.5, width: 0.85, height: 0.42 };
const NECK = { x: 1.0, length: 1.05, width: 0.52, height: 0.28 };
const BACK_CHAMBER = { x: 6.2, length: 2.1, width: 0.55, height: 0.3 };
export const CAVE_PARTS = { surface: 0.16, cut: 0.26, shaft: 0.30, rocks: 0.12 };
const SKYLIGHT = { x: 4.7, z: -1.1, rx: 1.05, rz: 0.72 };
const bulge = (x, region) => Math.exp(-(((x - region.x) / region.length) ** 2));
export const tubeSurface = (x, z, def) => height(x, z) * RELIEF * (def.relief ?? 2);
export function tubeFrame(x) {
  const hall = bulge(x, CHAMBER), neck = bulge(x, NECK), back = bulge(x, BACK_CHAMBER);
  return {
    center: TUBE_Y + noise(x * 0.16, 31) * 0.28,
    height: TUBE_HEIGHT + hall * CHAMBER.height - neck * NECK.height + back * BACK_CHAMBER.height,
    width: TUBE_WIDTH + hall * CHAMBER.width - neck * NECK.width + back * BACK_CHAMBER.width + noise(x * 0.23, 17) * 0.16
  };
}
function skylightRim(angle) {
  return 1 + noise(Math.cos(angle) * 2.2 + 7, Math.sin(angle) * 2.2) * 0.18
    + noise(Math.cos(angle) * 5.7, Math.sin(angle) * 5.7 + 8) * 0.08;
}
function inSkylight(x, z) {
  const u = (x - SKYLIGHT.x) / SKYLIGHT.rx, v = (z - SKYLIGHT.z) / SKYLIGHT.rz;
  return Math.hypot(u, v) < skylightRim(Math.atan2(v, u));
}
export function tubeWall(x, theta, def) {
  const f = tubeFrame(x), sin = Math.sin(theta), cos = Math.cos(theta);
  // 공동, 좁은 목, 붕괴 구간은 큰 형태로 구분한다. 잔주름을 모든 벽에 똑같이 넣지 않는다.
  const fracture = Math.exp(-(((x - 2.3) / 1.1) ** 2)) + bulge(x, BACK_CHAMBER) * 0.4;
  const smoothWall = 0.22 + fracture * 1.7;
  const ripple = (noise(x * 0.65, theta * 1.7) + noise(x * 3.4 + 13, theta * 5.1) * fracture * 0.35)
    * WALL_DETAIL * (def.relief ?? 2) * smoothWall;
  const edge = sin * sin;
  let y = f.center + cos * f.height + ripple * edge;
  if (cos < -0.65) y += (Math.abs(cos) - 0.65) * (0.55 + bulge(x, BACK_CHAMBER) * 0.3);
  // 선반은 일부 구간에만 이어진다. 넓게 파인 측벽 홈과 붕괴 쐐기가 표면의 규모를 달리한다.
  const shelfRun = Math.exp(-(((x + 4.4) / 3.1) ** 4));
  const shelf = Math.exp(-(((theta - 1.92 - noise(x * 0.2, 4) * 0.12) / 0.16) ** 2)) * shelfRun;
  const alcove = Math.exp(-(((x + 3) / 1.8) ** 2) - (((theta - 1.24) / 0.4) ** 2));
  const wedge = Math.exp(-(((x - 2.6) / 0.5) ** 2) - (((theta - 0.9) / 0.3) ** 2));
  y -= wedge * 0.36 * edge;
  const z = -Math.max(0, sin * f.width + (-shelf * 0.42 + alcove * 0.48 - wedge * 0.32 + ripple * 0.7) * edge);
  return { x, y, z, shelf };
}
export function tubeBackWall(x, theta, def) {
  // 반대편 벽은 복사하지 않는다. 공동의 시작 위치와 폭을 조금씩 달리하되 절개선에서는 이어진다.
  const edge = Math.sin(theta) ** 2;
  const shift = BACK_WALL_SHIFT * (0.65 + noise(x * 0.16, 63)) * edge;
  const p = tubeWall(x + shift, theta, def);
  const pocket = 0.38 * Math.exp(-(((x + 1.5) / 1.7) ** 2));
  const ledge = 0.25 * Math.exp(-(((x - 5.4) / 1.2) ** 2));
  return { x, y: p.y + noise(x * 0.38 + 19, theta * 1.9) * 0.18 * edge,
    z: Math.max(0, -p.z * (1 + BACK_WALL_WIDTH * noise(x * 0.21 + 8, theta)) + (pocket - ledge) * edge),
    shelf: p.shelf };
}
export function buildLavaTube(count, def) {
  const random = mulberry32(def.seed), out = output(count);
  const interior = def.view === 'interior';
  const grid = surfaceGrid((x, z) => tubeSurface(x, z, def), starDirection(def.star));
  // 내부에서는 절개면 대신 양쪽 벽에 점을 배분한다. 전체·단면 보기는 원래 반쪽 모델이다.
  const topEnd = Math.floor(count * (interior ? 0.03 : CAVE_PARTS.surface));
  const cutEnd = interior ? topEnd : Math.floor(count * CAVE_PARTS.cut);
  const shaftEnd = cutEnd + Math.floor(count * (CAVE_PARTS.shaft - CAVE_PARTS.cut));
  const rockTotal = Math.floor(count * CAVE_PARTS.rocks * clamp(def.rocks ?? 1, 0, 2));
  const wallEnd = count - rockTotal;
  for (let i = 0; i < topEnd; i++) {
    let x, z;
    do { [x, z] = sampleGround(random, true); } while (inSkylight(x, z));
    put(out, i, x, grid.ground(x, z), z, groundColor(def, grid.light(x, z)));
  }
  for (let i = topEnd; i < cutEnd; i++) {
    const [x] = sampleGround(random, true), f = tubeFrame(x), top = grid.ground(x, 0);
    const floor = tubeWall(x, Math.PI, def).y;
    const y = random() < 0.43 ? -6 + random() * (floor + 6) : f.center + f.height + random() * (top - f.center - f.height);
    // 절개면에서 똑같은 가로 줄무늬를 반복하지 않는다.
    const seam = Math.abs(noise(x * 0.33 + noise(y, 4), y * 2.1));
    put(out, i, x, y, 0, blue(0.2 + seam * 0.26));
  }
  for (let i = cutEnd; i < shaftEnd; i++) {
    const angle = random() * Math.PI * 2, t = random();
    const irregular = skylightRim(angle) + Math.sin(t * Math.PI) * noise(angle * 3, t * 4) * 0.08;
    const x = SKYLIGHT.x + Math.cos(angle) * SKYLIGHT.rx * irregular;
    const z = SKYLIGHT.z + Math.sin(angle) * SKYLIGHT.rz * irregular;
    const f = tubeFrame(x), roof = f.center + f.height * Math.sqrt(clamp(1 - (z / f.width) ** 2));
    const y = roof + t * (grid.ground(x, z) - roof);
    put(out, i, x, y, z, t > 0.87 ? cream(0.55) : blue(0.25 + t * 0.2));
  }
  for (let i = shaftEnd; i < wallEnd; i++) {
    let x, theta, p;
    do {
      [x] = sampleGround(random, true); theta = random() * Math.PI;
      p = interior && random() < 0.5 ? tubeBackWall(x, theta, def) : tubeWall(x, theta, def);
    } while (theta < Math.PI / 2 && inSkylight(x, p.z));
    const risk = x > RISK_U[0] && x < RISK_U[1] && theta > RISK_THETA[0] && theta < RISK_THETA[1];
    const flow = Math.abs(noise(x * 0.17 + 40, p.y * 1.2 + noise(x * 0.12, 3)));
    const depth = clamp((x + 10) / 23);
    const color = risk ? orange(0.9) : p.shelf > 0.6 ? cream(0.65) : blue(0.72 - depth * 0.25 + flow * 0.18);
    put(out, i, x, p.y, p.z, color, risk ? 0.025 : 0);
  }
  let rock;
  for (let i = wallEnd; i < count; i++) {
    if (!rock || (i - wallEnd) % 28 === 0) {
      const collapse = random() < 0.6;
      const x = collapse ? SKYLIGHT.x + (random() - 0.5) * 3.2 : (random() - 0.5) * 20;
      const theta = Math.PI * (0.73 + random() * 0.2), side = interior && random() < 0.5 ? -1 : 1;
      const base = side < 0 ? tubeBackWall(x, theta, def) : tubeWall(x, theta, def);
      const r = 0.055 / (1 - random() * 0.86) * (collapse ? 1.25 : 1);
      rock = { x, z: base.z, y: base.y, r, side };
    }
    const a = random() * Math.PI * 2, v = random(), radial = Math.sqrt(1 - v * v);
    put(out, i, rock.x + Math.cos(a) * rock.r * radial, rock.y + v * rock.r * 0.8,
      Math.min(-0.025, rock.z * rock.side + Math.sin(a) * rock.r * radial) * rock.side, cream(0.48 + v * 0.3));
  }
  return out;
}
