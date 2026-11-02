import { mulberry32, noise, smooth, surfaceGrid, starDirection, groundColor, output, put, EXTENT } from './terrain.js';
import { shade } from './palette.js';
import { plainSurface } from './plain.js';
import { ridgeSurface, ridgeFrame, ICE_U } from './ridge.js';
import { tubeSurface } from './lavaTube.js';

// 지정 지형 바깥의 주변 지형. 같은 지표 함수를 이어 쓰되 점 간격을 넓히고, 멀수록 어둡게 사라진다.
// 반지름은 지정 지형 타원(EXTENT)을 1로 잰 값이다. 지정 지형의 가장자리(0.70~1)와 겹치며 들어온다.
export const SURROUND_COUNT = 30000;
const INNER = 0.78;
const OUTER = 3.2;
const DENSITY_FALLOFF = 0.9; // 면적당 밀도 ∝ r^-이 값. 클수록 바깥이 성기다
const GRID_SIZE = 72;
const PLANET_RADIUS = 320; // 행성 반지름(약 8)을 지역 축척(0.025)으로 나눈 값. 멀수록 지평선 아래로 휜다

const SURFACES = {
  plain: def => plainSurface(def),
  ridge: def => (x, z) => ridgeSurface(x, z, def),
  lavaTube: def => (x, z) => tubeSurface(x, z, def)
};

/**
 * @param {string} name  plain | ridge | lavaTube
 * @param {object} def   sites.json 의 지역 정의
 * @param {boolean} half 절개면 앞쪽(z > 0)을 비운다 (용암동굴 전체·단면 보기)
 */
export function buildSurroundings(name, def, half = false, count = SURROUND_COUNT) {
  const random = mulberry32(def.seed + 7001), out = output(count), surface = SURFACES[name](def);
  const extent = { x: EXTENT.x * OUTER, z: EXTENT.z * OUTER };
  const grid = surfaceGrid(surface, starDirection(def.star), extent, GRID_SIZE);
  const b = 2 - DENSITY_FALLOFF, lo = INNER ** b, hi = OUTER ** b;
  for (let i = 0; i < count; i++) {
    let r, angle;
    do {
      r = (lo + random() * (hi - lo)) ** (1 / b);
      angle = random() * Math.PI * 2;
    } while (random() > smooth(INNER, 1.05, r)); // 지정 지형 가장자리에서 서서히 들어온다
    const x = Math.cos(angle) * r * EXTENT.x;
    const z = (half ? -Math.abs(Math.sin(angle)) : Math.sin(angle)) * r * EXTENT.z;
    const d2 = x * x + z * z;
    const y = grid.ground(x, z) - d2 / (2 * PLANET_RADIUS) * smooth(0.8, 1.6, r);
    const ice = name === 'ridge' && Math.abs(ridgeFrame(x, z).u - ICE_U) < 0.4 + noise(z * 0.5, 3) * 0.1;
    const fade = 1 - smooth(OUTER * 0.5, OUTER, r);
    put(out, i, x, y, z, shade(groundColor(def, grid.light(x, z), ice), 0.12 + 0.78 * fade));
  }
  return out;
}

// 지정 지형과 주변 지형을 한 점 묶음으로 합친다. 같은 머티리얼·같은 구성 효과를 쓴다.
export function joinPoints(a, b) {
  const join = (p, q) => { const all = new Float32Array(p.length + q.length); all.set(p); all.set(q, p.length); return all; };
  return { positions: join(a.positions, b.positions), colors: join(a.colors, b.colors), shake: join(a.shake, b.shake) };
}
