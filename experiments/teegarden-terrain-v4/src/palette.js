// 지형 색은 이 파일에서만 만든다. 화면 배경색과는 별개다.
const BLUE = [0x42 / 255, 0x91 / 255, 0xdf / 255];
const CREAM = [0xf2 / 255, 0xeb / 255, 0xdb / 255];
const ORANGE = [1, 0x99 / 255, 0x3d / 255];
const clamp = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export const blue = (brightness = 1) => BLUE.map(v => v * brightness);
export const cream = (brightness = 1) => CREAM.map(v => v * brightness);
export const orange = (brightness = 1) => ORANGE.map(v => v * brightness);
// 무채색: 지난 주차 건물 면에만 쓴다 (존재감 없이 뒤로 물러나 보이게)
export const gray = (brightness = 1) => [brightness, brightness, brightness];
export function temperatureColor(value, range) {
  const t = clamp((value - range[0]) / (range[1] - range[0] || 1));
  return t < 0.68 ? mix(BLUE, CREAM, t / 0.68) : mix(CREAM, ORANGE, (t - 0.68) / 0.32);
}
export const shade = (color, brightness) => color.map(v => v * Math.max(0, Math.min(1, brightness)));

// 모델 점 색: 원래 모델 색은 밝기만 쓰고 파랑 단계로 바꾼다. 가장 밝은 약 4.5%는 크림, 모서리는 더 밝게,
// 평균 밝기는 원래 모델과 맞춘다. 메인 게임 src/engine/palette.js 의 toneColors 와 같은 규칙이다.
export function toneColors(positions, colors) {
  const n = positions.length / 3, lum = new Float32Array(n);
  let mean0 = 0;
  for (let i = 0; i < n; i++) { lum[i] = 0.299 * colors[i * 3] + 0.587 * colors[i * 3 + 1] + 0.114 * colors[i * 3 + 2]; mean0 += lum[i]; }
  mean0 /= n;
  const sample = [];
  for (let i = 0; i < n; i += Math.max(1, n >> 12)) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  const at = q => sample[Math.floor(sample.length * q)], lo = at(0.05), hi = at(0.97), top = at(0.955);
  const edges = edgeScore(positions);
  let mean1 = 0;
  for (let i = 0; i < n; i++) {
    const l = clamp((lum[i] - lo) / (hi - lo || 1));
    const col = lum[i] >= top && top > lo ? cream(0.8 + 0.4 * l) : blue(0.2 + 0.62 * l);
    const e = 1 + 0.75 * smoothstep(0.03, 0.12, edges[i]);
    for (let j = 0; j < 3; j++) colors[i * 3 + j] = col[j] * e;
    mean1 += 0.299 * colors[i * 3] + 0.587 * colors[i * 3 + 1] + 0.114 * colors[i * 3 + 2];
  }
  const gain = mean0 / (mean1 / n || 1);
  for (let i = 0; i < n * 3; i++) colors[i] = Math.min(1, colors[i] * gain);
  return colors;
}
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

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
    const phi = Math.acos(Math.max(-1, Math.min(1, det / 2))) / 3;
    const lmin = q + 2 * pp * Math.cos(phi + (2 * Math.PI) / 3);
    score.set(k, clamp(lmin / (tr || 1), 0, 1));
  });

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = score.get(key[i]);
  return out;
}
