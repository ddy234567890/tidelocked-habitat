import { noise, mulberry32, output, put, clamp, smooth } from './terrain.js';
import { blue, cream, orange, shade } from './palette.js';

export const PLANET_RADIUS = 8;
export const PLANET_SEED = 20261029;
export const PLANET_SUN = { x: -0.939347432, y: 0.156434465, z: 0.305212482 };
// 실제 지표 지도가 아니다. 건조한 낮 / 습윤한 밤 시나리오를 조형으로 옮긴다.
export function planetNoise(x, y, z) {
  let sum = 0, amp = 0.55;
  for (let k = 0; k < 5; k++) {
    sum += (noise(x + 13, y - 8) + noise(y + 31, z + 17) + noise(z - 5, x + 43)) * amp / 3;
    const a = x * 1.6 + y * 1.2, b = -x * 1.2 + y * 1.6;
    x = a + 7.3; y = b + z * 0.4 + 11; z = z * 1.96 - b * 0.25 + 23; amp *= 0.48;
  }
  return sum;
}
export function planetRadius(x, y, z) {
  const regional = planetNoise(x * 3.1, y * 3.1, z * 3.1);
  const volcanic = Math.max(0, planetNoise(x * 8 + 11, y * 8, z * 8) - 0.1);
  return PLANET_RADIUS + regional * 0.5 + volcanic * 0.55;
}
export function buildPlanet(count = 30000) {
  const out = output(count), random = mulberry32(PLANET_SEED);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + random()) / count, angle = i * golden + (random() - 0.5) * 1.1;
    const q = Math.sqrt(1 - y * y), x = Math.cos(angle) * q, z = Math.sin(angle) * q;
    const radius = planetRadius(x, y, z), geology = planetNoise(x * 6, y * 6, z * 6);
    const exposure = x * PLANET_SUN.x + y * PLANET_SUN.y + z * PLANET_SUN.z;
    const day = smooth(-0.13, 0.25, exposure);
    const bands = planetNoise(x * 2 + 5, y * 13, z * 2) * (1 - smooth(0.1, 0.6, exposure));
    const base = exposure < -0.05 ? blue(0.43 + clamp(geology + bands + 0.3) * 0.55)
      : geology > 0.09 ? orange(0.65 + day * 0.35) : cream(0.5 + day * 0.5);
    put(out, i, x * radius, y * radius, z * radius, shade(base, 0.62 + clamp(geology + 0.25) * 0.65));
  }
  return out;
}
