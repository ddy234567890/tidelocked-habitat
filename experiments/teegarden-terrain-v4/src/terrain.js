import { blue, temperatureColor, shade } from './palette.js';

// 성능과 모양을 조절하는 공통 값. 길이는 아직 실제 m가 아닌 모델 단위다.
export const EXTENT = { x: 14, z: 11 };
const OCTAVES = 5;
const GRID = 96;
const EDGE_START = 0.70;
const ROCK_FRACTION = 0.17;
const ROCK_MIN = 0.045;
const ROCK_MAX = 0.48;
const SHADOW_STEPS = 6;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 고정 난수로 순열을 한 번만 만든다. 격자 꼭짓점의 기울기를 보간한다.
const permutation = new Uint16Array(512);
const order = Array.from({ length: 256 }, (_, i) => i);
const seedRandom = mulberry32(90210);
for (let i = 255; i > 0; i--) {
  const j = Math.floor(seedRandom() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}
for (let i = 0; i < 512; i++) permutation[i] = order[i & 255];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y) {
  switch (h & 7) {
    case 0: return x; case 1: return -x; case 2: return y; case 3: return -y;
    case 4: return (x + y) * 0.7071; case 5: return (x - y) * 0.7071;
    case 6: return (-x + y) * 0.7071; default: return (-x - y) * 0.7071;
  }
}
export function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), X = ix & 255, Y = iy & 255;
  x -= ix; y -= iy;
  const a = permutation[X] + Y, b = permutation[X + 1] + Y;
  return 1.42 * lerp(lerp(grad(permutation[a], x, y), grad(permutation[b], x - 1, y), fade(x)),
    lerp(grad(permutation[a + 1], x, y - 1), grad(permutation[b + 1], x - 1, y - 1), fade(x)), fade(y));
}
export function fbm(x, z, octaves = OCTAVES) {
  let value = 0, amplitude = 0.55, total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(x, z) * amplitude; total += amplitude;
    // 옥타브마다 축을 돌려 같은 방향의 무늬가 쌓이지 않게 한다.
    const nextX = (x * 0.8 - z * 0.6) * 2.03 + 13.1;
    z = (x * 0.6 + z * 0.8) * 2.03 + 7.7; x = nextX; amplitude *= 0.48;
  }
  return value / total;
}
export function height(x, z) {
  const wx = noise(x * 0.13 + 34, z * 0.13) * 1.5;
  const wz = noise(x * 0.13, z * 0.13 + 71) * 1.5;
  return fbm((x + wx) * 0.26, (z + wz) * 0.26);
}
export function starDirection(star) {
  const az = star.azimuth * Math.PI / 180, el = star.elevation * Math.PI / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
}
export function lightOn(x, y, z, surface, star) {
  for (let i = 1; i <= SHADOW_STEPS; i++) {
    const distance = i * i * 0.32;
    if (surface(x + star.x * distance, z + star.z * distance) > y + star.y * distance + 0.06) return 0.22;
  }
  return 1;
}
export function sunlight(x, y, z, surface, star) {
  const e = 0.12;
  const dx = (surface(x + e, z) - surface(x - e, z)) / (2 * e);
  const dz = (surface(x, z + e) - surface(x, z - e)) / (2 * e);
  const diffuse = Math.max(0, (-dx * star.x + star.y - dz * star.z) / Math.hypot(dx, 1, dz));
  return clamp(0.24 + (0.25 + diffuse * 0.7) * lightOn(x, y, z, surface, star));
}

// 30,000개의 점마다 그림자를 추적하지 않고 작은 격자에서 한 번만 계산한다.
export function surfaceGrid(surface, star, extent = EXTENT, size = GRID) {
  const data = new Float32Array((size + 1) ** 2);
  const lighting = new Float32Array(data.length);
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
    data[z * (size + 1) + x] = surface((x / size * 2 - 1) * extent.x, (z / size * 2 - 1) * extent.z);
  const sample = (array, x, z) => {
    const u = clamp((x / extent.x + 1) * size / 2, 0, size - 0.00001);
    const v = clamp((z / extent.z + 1) * size / 2, 0, size - 0.00001);
    const i = Math.floor(u), j = Math.floor(v), k = j * (size + 1) + i;
    return lerp(lerp(array[k], array[k + 1], u - i), lerp(array[k + size + 1], array[k + size + 2], u - i), v - j);
  };
  const ground = (x, z) => sample(data, x, z);
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) {
    const px = (x / size * 2 - 1) * extent.x, pz = (z / size * 2 - 1) * extent.z;
    lighting[z * (size + 1) + x] = sunlight(px, ground(px, pz), pz, ground, star);
  }
  return { ground, light: (x, z) => sample(lighting, x, z) };
}
export function sampleGround(random, half = false) {
  // 타원 외곽의 확률을 낮추고, 기본 관찰 위치인 +z 쪽을 조금 촘촘하게 한다.
  for (let attempt = 0; attempt < 100; attempt++) {
    const angle = random() * Math.PI * 2, r = Math.sqrt(random());
    const x = Math.cos(angle) * r * EXTENT.x;
    const z = (half ? -Math.abs(Math.sin(angle)) : Math.sin(angle)) * r * EXTENT.z;
    const probability = (1 - smooth(EDGE_START, 1, r)) * (0.64 + 0.28 * (z / EXTENT.z + 1) / 2);
    if (random() < probability) return [x, z];
  }
  return [0, 0];
}
export function output(count) {
  return { positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), shake: new Float32Array(count) };
}
export function put(out, i, x, y, z, color, shake = 0) {
  out.positions.set([x, y, z], i * 3); out.colors.set(color, i * 3); out.shake[i] = shake;
}
export function groundColor(def, light, ice = false) {
  if (ice) return blue(0.85);
  const temperature = def.temperature[0] + (def.temperature[1] - def.temperature[0]) * clamp(light);
  return shade(temperatureColor(temperature, def.temperature), 0.5 + light * 0.5);
}
export function rockCount(count, def) { return Math.floor(count * ROCK_FRACTION * clamp(def.rocks ?? 1, 0, 2)); }
export function addRocks(out, start, count, def, grid, random, allowed, half = false) {
  let anchor = null;
  for (let i = 0; i < count; i++) {
    if (i % 38 === 0 || !anchor) {
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 100; t++) {
        [x, z] = sampleGround(random, half);
        if (random() < allowed(x, z)) { ok = true; break; }
      }
      if (!ok) { put(out, start + i, x, grid.ground(x, z), z, groundColor(def, grid.light(x, z))); continue; }
      // 잘린 멱법칙 분포: 작은 돌은 많고 큰 바위는 드물다.
      const radius = 1 / (1 / ROCK_MIN - random() * (1 / ROCK_MIN - 1 / ROCK_MAX));
      anchor = { x, z, radius, y: grid.ground(x, z) };
    }
    const angle = random() * Math.PI * 2, v = random(), ring = Math.sqrt(1 - v * v);
    const x = anchor.x + Math.cos(angle) * ring * anchor.radius;
    const z = anchor.z + Math.sin(angle) * ring * anchor.radius * 0.8;
    const y = Math.max(grid.ground(x, z), anchor.y + v * anchor.radius * 0.85 - 0.015);
    put(out, start + i, x, y, z, groundColor(def, clamp(grid.light(x, z) + v * 0.22)));
  }
}
