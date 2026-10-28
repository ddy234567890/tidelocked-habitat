/**
 * 점 색 규칙 (CLAUDE.md "색" 규칙을 코드로 옮긴 것)
 *
 * "거주 지역 관측" 화면과 같은 색을 쓴다. 빨강·초록·보라는 쓰지 않는다.
 *   파랑 단계  #121F5C → #2E4DBD → #73A8FF → #D1E6FF   blue(0~1)
 *   크림      #F2EBDB   창문, 출입구 같은 밝은 부분, 산소 흐름
 *   주황      #FF993D   땅속 공간, 빈 산소통, 내쉰 공기, 깜빡이는 등
 *
 * 점은 더하기 섞기로 그려지므로, 겹치면 밝아진다. 점 하나하나는 어둡게 둔다.
 * 색 배열은 모두 점마다 r, g, b 3칸인 Float32Array (0~1) 이다.
 *
 * 사용법:
 *   모델 점      sampleModel(url, N, { colors }) → toneColors(positions, colors)
 *   직접 만든 점  색을 정한 뒤 scanify(positions, colors) 로 질감을 맞춘다
 *   온도 표시     temperatureColor(°C) → 밤 쪽 파랑 ↔ 낮 쪽 주황
 */

export const BLUE_STEPS = [[0.07, 0.12, 0.36], [0.18, 0.3, 0.74], [0.45, 0.66, 1], [0.82, 0.9, 1]];
export const CREAM = [0.95, 0.92, 0.86];
export const AMBER = [1, 0.6, 0.24];

export const TEMP_MIN = 12;
export const TEMP_MAX = 66;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 파랑 단계에서 t(0~1) 위치의 색 [r, g, b] */
export function blue(t) {
  t = clamp(t, 0, 0.999) * (BLUE_STEPS.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = BLUE_STEPS[i];
  const b = BLUE_STEPS[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

/** 온도(°C) → 색. 12°C 밤 쪽 파랑, 66°C 낮 쪽 주황 */
export function temperatureColor(celsius) {
  const t = clamp((celsius - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
  if (t < 0.6) return blue(0.25 + 0.5 * (t / 0.6));
  const c = blue(0.75);
  const k = smoothstep(0.6, 1, t);
  return [lerp(c[0], AMBER[0], k), lerp(c[1], AMBER[1], k), lerp(c[2], AMBER[2], k)];
}

/**
 * 모델 점에 색을 입힌다 (모든 모델 공통 규칙). colors 를 그 자리에서 바꾼다.
 *  1. 원래 색은 밝기만 쓴다  2. 밝기 → blue(0.2 + 0.62 × 밝기)  3. 가장 밝은 약 4.5%는 크림
 *  4. 땅속 점은 주황으로 섞고 깊을수록 어둡게  5. 모서리·윤곽은 약 1.75배 밝게
 *  6. 전체 평균 밝기를 원래 모델과 같게 맞춘다
 * @param {Float32Array} positions
 * @param {Float32Array} colors  원래 모델 색 (sampleModel 의 colors 옵션으로 받는다)
 * @param {object} [opts]
 * @param {(y:number)=>number} [opts.under]  높이 y → 땅속 깊이 0~1 (0 = 땅 위)
 */
export function toneColors(positions, colors, opts = {}) {
  const n = positions.length / 3;
  const lum = new Float32Array(n);
  let mean0 = 0;
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * colors[i * 3] + 0.587 * colors[i * 3 + 1] + 0.114 * colors[i * 3 + 2];
    mean0 += lum[i];
  }
  mean0 /= n;

  const sample = [];
  for (let i = 0; i < n; i += Math.max(1, n >> 12)) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  const at = (q) => sample[Math.floor(sample.length * q)];
  const lo = at(0.05);
  const hi = at(0.97);
  const top = at(0.955);

  const edges = edgeScore(positions);
  let mean1 = 0;
  for (let i = 0; i < n; i++) {
    const l = clamp((lum[i] - lo) / (hi - lo || 1), 0, 1);
    const u = opts.under ? opts.under(positions[i * 3 + 1]) : 0;
    let col = blue(0.2 + 0.62 * l);
    // 색이 한 가지뿐인 모델은 전부 크림이 되지 않게 밝기 차이가 있을 때만
    if (lum[i] >= top && top > lo) {
      const k = 0.8 + 0.4 * l;
      col = [CREAM[0] * k, CREAM[1] * k, CREAM[2] * k];
    } else if (u > 0) {
      const k = (0.35 + 0.65 * l) * (1 - 0.3 * u);
      col = col.map((c, j) => lerp(c, AMBER[j] * k, 0.85));
    }
    const e = 1 + 0.75 * smoothstep(0.03, 0.12, edges[i]);
    for (let j = 0; j < 3; j++) colors[i * 3 + j] = col[j] * e;
    mean1 += 0.299 * colors[i * 3] + 0.587 * colors[i * 3 + 1] + 0.114 * colors[i * 3 + 2];
  }

  const gain = mean0 / (mean1 / n || 1);
  for (let i = 0; i < n * 3; i++) colors[i] = Math.min(1, colors[i] * gain);
  return colors;
}

/**
 * 직접 만든 점(기계, 파이프, 차, 통로 등)의 질감을 모델 점과 맞춘다.
 * 위치를 ±jitter 흐트러뜨리고, 점을 (copies)배로 늘리고, 밝기를 dim × (0.45~1.55)로 낮춘다.
 * 점 개수가 copies 배가 되므로, 모프할 모양끼리는 같은 copies 를 쓴다.
 * @returns {{ positions: Float32Array, colors: Float32Array }}
 */
export function scanify(positions, colors, { jitter = 0.07, copies = 3, dim = 0.42, random = Math.random } = {}) {
  const n = positions.length / 3;
  const outP = new Float32Array(n * copies * 3);
  const outC = new Float32Array(n * copies * 3);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < copies; k++, o += 3) {
      const g = dim * (0.45 + 1.1 * random());
      for (let j = 0; j < 3; j++) {
        outP[o + j] = positions[i * 3 + j] + (random() - 0.5) * 2 * jitter;
        outC[o + j] = colors[i * 3 + j] * g;
      }
    }
  }
  return { positions: outP, colors: outC };
}

/** 점마다 주변 점들이 얼마나 면이 아닌 모서리·윤곽에 가까운지 (0 = 평평한 면) */
function edgeScore(p) {
  const n = p.length / 3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const vs = Math.max(x1 - x0, y1 - y0, z1 - z0) / 70 || 1;
  const ny = Math.ceil((y1 - y0) / vs) + 1;
  const nz = Math.ceil((z1 - z0) / vs) + 1;
  const key = new Int32Array(n);
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    const k = (Math.floor((x - x0) / vs) * ny + Math.floor((y - y0) / vs)) * nz + Math.floor((z - z0) / vs);
    key[i] = k;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = new Float64Array(10)));
    a[0]++; a[1] += x; a[2] += y; a[3] += z;
    a[4] += x * x; a[5] += y * y; a[6] += z * z; a[7] += x * y; a[8] += x * z; a[9] += y * z;
  }

  const score = new Map();
  const s = new Float64Array(10);
  acc.forEach((_, k) => {
    const iz = k % nz, iy = Math.floor(k / nz) % ny, ix = Math.floor(k / nz / ny);
    s.fill(0);
    for (let a = -1; a < 2; a++) for (let b = -1; b < 2; b++) for (let c = -1; c < 2; c++) {
      if (ix + a < 0 || iy + b < 0 || iz + c < 0 || iy + b >= ny || iz + c >= nz) continue;
      const q = acc.get(((ix + a) * ny + iy + b) * nz + iz + c);
      if (q) for (let j = 0; j < 10; j++) s[j] += q[j];
    }
    const N = s[0];
    if (N < 8) return score.set(k, 1);
    const mx = s[1] / N, my = s[2] / N, mz = s[3] / N;
    const a = s[4] / N - mx * mx, d = s[5] / N - my * my, f = s[6] / N - mz * mz;
    const b = s[7] / N - mx * my, c = s[8] / N - mx * mz, e = s[9] / N - my * mz;
    // 공분산 행렬의 가장 작은 고유값 비율: 면이면 0에 가깝고 모서리일수록 커진다
    const tr = a + d + f, q = tr / 3, p1 = b * b + c * c + e * e;
    const pp = Math.sqrt(((a - q) ** 2 + (d - q) ** 2 + (f - q) ** 2 + 2 * p1) / 6) || 1e-9;
    const B = [(a - q) / pp, b / pp, c / pp, b / pp, (d - q) / pp, e / pp, c / pp, e / pp, (f - q) / pp];
    const det = B[0] * (B[4] * B[8] - B[5] * B[7]) - B[1] * (B[3] * B[8] - B[5] * B[6]) + B[2] * (B[3] * B[7] - B[4] * B[6]);
    const phi = Math.acos(clamp(det / 2, -1, 1)) / 3;
    const lmin = q + 2 * pp * Math.cos(phi + (2 * Math.PI) / 3);
    score.set(k, clamp(lmin / (tr || 1), 0, 1));
  });

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = score.get(key[i]);
  return out;
}
