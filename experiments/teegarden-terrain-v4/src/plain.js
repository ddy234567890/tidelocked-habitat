import { mulberry32, height, noise, smooth, surfaceGrid, starDirection, sampleGround, output, put, groundColor, rockCount, addRocks } from './terrain.js';

const RELIEF = 0.95;
const PAD_RADIUS = 1.65;
const PAD_BLEND = 3.2;
const CRATER_COUNT = 5;
const CRATER_DEPTH = 0.24;
export function plainSurface(def) {
  const random = mulberry32(def.seed + 101);
  const craters = Array.from({ length: CRATER_COUNT }, () => {
    const angle = random() * Math.PI * 2, distance = 4 + random() * 5;
    return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance * 0.8, r: 0.55 + random() * 0.9 };
  });
  return (x, z) => {
    const mask = smooth(PAD_RADIUS, PAD_BLEND, Math.hypot(x, z));
    if (mask === 0) return 0;
    let h = height(x, z) * RELIEF;
    // 서로 휘어진 흐름의 결. 날카로운 격자 균열보다 낮은 용암 주름으로 표현한다.
    h += 0.075 * Math.sin(z * 4 + noise(x * 0.4, z * 0.4) * 3) * noise(x * 0.6 + 7, z * 0.3);
    for (const c of craters) {
      const r = Math.hypot(x - c.x, z - c.z) / c.r;
      if (r < 1.6) h += CRATER_DEPTH * (-Math.exp(-r * r * 3) + 0.32 * Math.exp(-(((r - 1) / 0.24) ** 2)));
    }
    return h * mask * (def.relief ?? 1);
  };
}
export function buildPlain(count, def) {
  const random = mulberry32(def.seed), out = output(count), surface = plainSurface(def);
  const grid = surfaceGrid(surface, starDirection(def.star)), rocks = rockCount(count, def);
  for (let i = 0; i < count - rocks; i++) {
    const [x, z] = sampleGround(random);
    const y = Math.hypot(x, z) <= PAD_RADIUS ? 0 : grid.ground(x, z);
    put(out, i, x, y, z, groundColor(def, grid.light(x, z)));
  }
  addRocks(out, count - rocks, rocks, def, grid, random, (x, z) => Math.hypot(x, z) > PAD_BLEND ? 0.7 : 0);
  return out;
}
