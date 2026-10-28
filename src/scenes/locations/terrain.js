/**
 * 위치 무대들이 함께 쓰는 지형 도구: 난수, 노이즈, 지표 높이, 별빛(그림자 포함).
 * 평지(plain.js)와 용암동굴(lavaTube.js)이 같은 땅 모양과 같은 빛 계산을 쓰므로 하늘과 땅이 어긋나지 않는다.
 */

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 씨앗이 같으면 늘 같은 수열을 주는 난수. 팀원 화면이 모두 같게 보이도록 Math.random 대신 쓴다 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 지표 높이: 큰 물결 위에 작은 물결을 겹친다.
 * @param {number} amp   기복의 크기 (평지 1.6, 단면 무대는 더 작게)
 * @param {boolean} flat true 면 가운데(0,0) 둘레를 편평하게 눌러 둔다 (주거 모듈 자리)
 */
export function height(x, z, amp = 1.6, flat = true) {
  const n = 0.62 * noise(x * 0.22, z * 0.22, 1) + 0.28 * noise(x * 0.55 + 7, z * 0.55 + 3, 2) + 0.1 * noise(x * 1.4, z * 1.4, 3);
  return (n - 0.5) * amp * (flat ? smoothstep(1, 3, Math.hypot(x, z)) : 1);
}

/**
 * 별빛을 받은 지표의 밝기. 별을 향한 비탈은 밝고, 반대쪽 비탈과 언덕 뒤는 그림자가 진다.
 * @param {number[]} L  starDirection() 으로 얻은 별 방향 단위벡터
 * @returns {{ y: number, lit: number }}  y = 그 자리 지표 높이, lit = 0(그림자) ~ 1(환함)
 */
export function sunlight(x, z, L, amp = 1.6, flat = true) {
  const h = (px, pz) => height(px, pz, amp, flat);
  const y = h(x, z);

  // 비탈 기울기 → 법선. 별을 향한 비탈일수록 밝다 (편평한 땅이 기준)
  const e = 0.05;
  const gx = (h(x + e, z) - h(x - e, z)) / (2 * e);
  const gz = (h(x, z + e) - h(x, z - e)) / (2 * e);
  const facing = (-gx * L[0] + L[1] - gz * L[2]) / Math.hypot(gx, 1, gz);
  let lit = clamp(0.5 + 4.5 * (facing - L[1]), 0, 1);

  // 그림자: 점에서 별 쪽으로 걸어가며 더 높은 땅이 빛을 가리는지 본다
  const lh = Math.hypot(L[0], L[2]);
  const dx = L[0] / lh;
  const dz = L[2] / lh;
  const slope = L[1] / lh;
  let shadow = 0;
  for (let t = 0.1; t < 3.5; t *= 1.12) {
    const gap = h(x + dx * t, z + dz * t) - (y + t * slope);
    if (gap > 0) shadow = Math.max(shadow, Math.min(1, gap / 0.04));
    if (shadow >= 1) break;
  }
  lit *= 1 - 0.92 * shadow;
  return { y, lit };
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

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
