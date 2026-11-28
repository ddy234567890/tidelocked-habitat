// 돌발상황 연출 (견본 페이지 src/lab 와 게임 eventStage.js 가 함께 쓴다). 새 셰이더·머티리얼 없이 점 위치와 색만 움직인다.
// FX[종류](ctx) → { positions, colors, weights, frame(pos, col, base, t, broken) } 덧붙이는 점 묶음과 매 장면 움직임.
// t: 사건이 시작된 뒤 초, broken: 고장 정도 (0 멀쩡 ~ 1 고장). 좋은 소식 연출(drop·spring·surge·bloom)에서는 연출 세기
import { blueStep, cream, orange, mint } from './palette.js';
import { arcPath } from './flows.js';
import { mulberry32, clamp, smooth } from './terrain.js';

export const hash = x => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };

function cloud(list) {
  const n = list.length, positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), weights = new Float32Array(n);
  list.forEach((q, i) => { positions.set(q.p, i * 3); colors.set(q.c, i * 3); weights[i] = q.w ?? 0; });
  return {
    positions, colors, weights,
    frame(pos, col, base, t, broken) {
      list.forEach((q, i) => {
        const s = q.move(t, broken), k = i * 3;
        if (s.p) { pos[k] = s.p[0]; pos[k + 1] = s.p[1]; pos[k + 2] = s.p[2]; }
        for (let c = 0; c < 3; c++) col[k + c] = base[k + c] * s.light;
      });
    }
  };
}

export const FX = {
  /** 꺼짐: 장치에서 불꽃이 튀고 연기가 오른다. 장치 불빛은 eventLab 이 깜빡이다 끈다 */
  powerdown({ center, radius, top }) {
    const rand = mulberry32(6101), list = [], tall = top - center[1];
    for (let i = 0; i < 420; i++) { // 불꽃 세 자리
      const burst = i % 3, a = rand() * 6.28, v = 0.6 + rand() * 1.5, up = 1 + rand() * 1.8, late = rand() * 0.12;
      const from = [center[0] + (hash(burst + 3) - 0.5) * radius, center[1] + tall * (0.55 + 0.3 * hash(burst + 8)), center[2] + (hash(burst + 5) - 0.5) * radius];
      list.push({ p: from, c: i % 4 ? orange(1) : cream(1.2), w: 0, move: (t, b) => {
        const u = ((t + burst * 0.43) % 1.3) - late;
        return { p: [from[0] + Math.cos(a) * v * u, from[1] + up * u - 2.6 * u * u, from[2] + Math.sin(a) * v * u], light: u > 0 ? b * clamp(1 - u / 0.8) : 0 };
      } });
    }
    for (let i = 0; i < 700; i++) { // 연기
      const a = rand() * 6.28, r = Math.sqrt(rand()), ph = rand(), sp = 0.16 + rand() * 0.1;
      list.push({ p: center, c: orange(0.62), w: 0, move: (t, b) => {
        const u = (ph + t * sp) % 1, w = radius * (0.2 + 0.7 * u) * r;
        return { p: [center[0] + Math.cos(a + u) * w + u * 0.7, top - 0.2 + u * 2.6, center[2] + Math.sin(a + u) * w], light: b * smooth(0.6, 2.4, t) * Math.sin(Math.PI * u) };
      } });
    }
    return cloud(list);
  },

  /** 물 끊김: 물관을 따라 얼음 결정이 번지고, 터진 자리에서 물이 뿜어 나와 바닥에 언다 */
  pipeBurst({ segments, ground, burst }) {
    const rand = mulberry32(6202), list = [];
    for (const [a, b] of segments) {
      const path = arcPath(a, b, ground), n = Math.ceil(path.length / 0.07);
      for (let i = 0; i <= n; i++) {
        const p = path.at(i / n), ang = rand() * 6.28, up = rand() * 2 - 1, len = 0.08 + 0.2 * rand() ** 2, dist = Math.hypot(p[0] - burst[0], p[2] - burst[2]);
        for (let j = 1; j <= 5; j++) {
          const r = len * j / 5, at = dist * 0.28 + j * 0.06;
          list.push({ p: [p[0] + Math.cos(ang) * r, p[1] + up * r, p[2] + Math.sin(ang) * r], c: blueStep(1), w: 0.6, move: (t, k) => ({ light: k * smooth(at, at + 0.4, t) * (0.6 + 0.2 * Math.sin(t * 2 + i)) }) });
        }
      }
    }
    const floor = ground(burst[0], burst[2]), G = 4.2, h = burst[1] - floor;
    for (let i = 0; i < 900; i++) { // 물줄기
      const a = rand() * 6.28, v = 0.35 + rand() * 1.15, up = 1.3 + rand() * 1.9, ph = rand(), life = (up + Math.sqrt(up * up + 4 * G * h)) / (2 * G);
      list.push({ p: burst, c: blueStep(0.62), w: 0, move: (t, k) => {
        const s = (t + ph * life) % life;
        return { p: [burst[0] + Math.cos(a) * v * s, burst[1] + up * s - G * s * s, burst[2] + Math.sin(a) * v * s], light: smooth(0.9, 1.4, t) * smooth(0.15, 0.6, k) };
      } });
    }
    for (let i = 0; i < 1000; i++) { // 바닥에 번지는 얼음
      const a = rand() * 6.28, r = 1.7 * Math.sqrt(rand()) * (0.75 + 0.25 * Math.sin(a * 5)), x = burst[0] + Math.cos(a) * r, z = burst[2] + Math.sin(a) * r;
      list.push({ p: [x, ground(x, z) + 0.03, z], c: blueStep(0.85), w: 0, move: (t, k) => ({ light: 0.8 * smooth(1.2 + r * 2.4, 2 + r * 2.4, t) * k }) });
    }
    return cloud(list);
  },

  /** 덮침: 먼지 벽이 한쪽에서 밀려와 기지를 덮고, 대상 장치 위에 먼지가 쌓인다.
   *  style 'flare' = 별 입자 폭풍 (하늘에서 빗금처럼 쏟아지는 빛 알갱이), 'dim' = 별빛 약해짐 (먼지 없이 옅은 티끌만 가라앉는다) */
  storm({ center, targetPoints, top, style }) {
    const rand = mulberry32(6303), list = [], W = 22, D = 13;
    if (style === 'flare') {
      for (let i = 0; i < 2400; i++) { // 빗금 하나 = 점 5개 꼬리
        const x0 = (rand() - 0.5) * W, z0 = (rand() - 0.5) * D, ph = rand(), sp = 0.55 + rand() * 0.4, tail = i % 5;
        list.push({ p: center, c: tail ? orange(1 - tail * 0.15) : cream(1.2), w: 0.3, move: (t, k) => {
          const u = (ph + t * sp - tail * 0.012) % 1, h = 7 * (1 - u);
          return { p: [center[0] + x0 + h * 0.55, center[1] + h, center[2] + z0 - h * 0.2], light: k * smooth(0, 0.8, t) * (1 - tail * 0.18) * (hash(i + Math.floor(t * 6)) > 0.2 ? 1 : 0.3) };
        } });
      }
      return cloud(list);
    }
    if (style === 'dim') {
      for (let i = 0; i < 1600; i++) {
        const x0 = (rand() - 0.5) * W * 0.7, z0 = (rand() - 0.5) * D, y = rand() * 4, sp = 0.08 + rand() * 0.1;
        list.push({ p: center, c: rand() < 0.5 ? blueStep(0.5) : cream(0.4), w: 0, move: (t, k) => ({ p: [center[0] + x0 + 0.2 * Math.sin(t * 0.5 + i), center[1] + (((y - t * sp) % 4) + 4) % 4, center[2] + z0], light: k * smooth(0.5, 2.5, t) * 0.6 }) });
      }
      return cloud(list);
    }
    for (let i = 0; i < 18000; i++) {
      const x0 = rand() * W, z0 = (rand() - 0.5) * D, y0 = 0.1 + 5 * rand() ** 1.4, sp = 2.2 + rand() * 2.2, wob = rand() * 6.28;
      list.push({ p: center, c: rand() < 0.75 ? orange(0.8) : cream(0.62), w: 0, move: (t, k) => {
        const x = (x0 + t * sp) % W - W / 2, z = z0 + 0.35 * Math.sin(t * 1.3 + wob + x * 0.5);
        const front = -W / 2 + t * 8.5 - 0.5 * y0; // 앞면: 아래가 먼저 온다
        return { p: [center[0] + x, center[1] + y0 + 0.25 * Math.sin(t * 2 + wob), center[2] + z], light: x < front ? k * clamp(Math.min((x + W / 2) / 2, (W / 2 - x) / 3)) : 0 };
      } });
    }
    const n = targetPoints.length / 3, floor = center[1]; // 쌓이는 먼지
    for (let i = 0; i < Math.min(3600, n); i++) {
      const q = Math.floor(rand() * n) * 3, p = [targetPoints[q] + (rand() - 0.5) * 0.12, targetPoints[q + 1] + 0.03 + rand() * 0.06, targetPoints[q + 2] + (rand() - 0.5) * 0.12];
      const at = 1.8 + rand() * 4, high = clamp((p[1] - floor) / (top - floor));
      list.push({ p, c: orange(0.6 + 0.4 * high), w: 0.1, move: (t, k) => { const u = clamp((t - at) / 0.7); return { p: [p[0] - (1 - u), p[1] + (1 - u) * 1.2, p[2]], light: u * k }; } });
    }
    return cloud(list);
  },

  /** 흔들림: 건물 밑을 가로질러 땅이 갈라지고, 돌 조각이 비탈로 굴러 내린다. 건물이 떨리고 기우는 것은 eventLab 이 한다 */
  quake({ center, radius, ground, dir }) {
    const rand = mulberry32(6404), list = [], long = radius + 2.2, side = [dir[1], -dir[0]];
    // 갈라진 금: 큰 줄기 하나와 곁가지. 줄기를 따라 가운데에서 바깥으로 벌어진다
    const bend = u => 0.5 * Math.sin(u * 2.1 + 1) + 0.22 * Math.sin(u * 6.3) + 0.14 * (hash(Math.floor(u * 4)) - 0.5);
    for (let i = 0; i < 2600; i++) {
      const u = (rand() * 2 - 1) * long, gap = 0.13 * (1 - Math.abs(u) / long) + 0.03, w = (rand() < 0.5 ? -1 : 1) * rand() ** 0.4 * gap, branch = i % 9 === 0 ? (hash(Math.floor(u * 1.5) + 9) - 0.5) * 3 * rand() : 0;
      const off = bend(u) + w + branch, x = center[0] + dir[0] * u + side[0] * off, z = center[2] + dir[1] * u + side[1] * off, at = Math.abs(u) * 0.28 + Math.abs(branch) * 0.8;
      const edge = Math.abs(w) / gap;
      list.push({ p: [x, ground(x, z) + 0.02 - (1 - edge) * 0.35, z], c: orange(0.5 + 0.6 * edge), w: 0.5, move: (t, k) => ({ light: k * smooth(at, at + 0.25, t) * (0.8 + 0.2 * Math.sin(t * 3 + u)) }) });
    }
    for (let i = 0; i < 520; i++) { // 튀었다 굴러 내리는 돌 조각
      const u = (rand() * 2 - 1) * long, x0 = center[0] + dir[0] * u + side[0] * bend(u), z0 = center[2] + dir[1] * u + side[1] * bend(u), ph = rand() * 2.2, v = 0.4 + rand() * 1.4, a = rand() * 6.28, up = 1 + rand() * 1.4;
      list.push({ p: [x0, 0, z0], c: i % 3 ? cream(0.8) : orange(0.9), w: 0, move: (t, k) => {
        const s = (t + ph) % 2.2, x = x0 + Math.cos(a) * v * s, z = z0 + Math.sin(a) * v * s;
        return { p: [x, ground(x, z) + Math.max(0.03, up * s - 2.2 * s * s), z], light: k * smooth(0.5, 1, t) * clamp((2.2 - s) / 0.8) };
      } });
    }
    for (let i = 0; i < 1500; i++) { // 흙먼지
      const u = (rand() * 2 - 1) * long, a = rand() * 6.28, ph = rand(), x0 = center[0] + dir[0] * u + side[0] * bend(u), z0 = center[2] + dir[1] * u + side[1] * bend(u), g = ground(x0, z0);
      list.push({ p: [x0, g, z0], c: cream(0.4), w: 0, move: (t, k) => { const q = (ph + t * 0.3) % 1, r = 0.15 + q * 0.7; return { p: [x0 + Math.cos(a) * r, g + q * 1.1, z0 + Math.sin(a) * r], light: k * smooth(0.3, 1.2, t) * Math.sin(Math.PI * q) }; } });
    }
    return cloud(list);
  },

  /** 번짐: 오염된 점에서 포자가 피어나고 바닥으로 기어 나온다. 장치 안에서 주황이 번지는 것은 eventLab 이 한다 (spreadAt 거리까지) */
  spread({ center, radius, ground, targetPoints, seedAt, reach, wide, wideFar }) {
    const rand = mulberry32(6505), list = [], n = targetPoints.length / 3;
    for (let i = 0; i < 2600; i++) { // 장치에 엉긴 덩어리
      const q = Math.floor(rand() * n) * 3, base = [targetPoints[q], targetPoints[q + 1], targetPoints[q + 2]], d = Math.hypot(base[0] - seedAt[0], base[1] - seedAt[1], base[2] - seedAt[2]);
      const a = rand() * 6.28, e = Math.asin(rand() * 2 - 1), r = 0.05 + 0.13 * rand(), v = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      list.push({ p: base, c: orange(0.55 + 0.45 * rand()), w: 0, move: (t, k) => {
        const g = smooth(d - 0.25, d + 0.35, reach(t) * k) * (0.8 + 0.2 * Math.sin(t * 2.4 + a));
        return { p: [base[0] + v[0] * r * g, base[1] + v[1] * r * g, base[2] + v[2] * r * g], light: g };
      } });
    }
    for (let i = 0; i < 600; i++) { // 날아오르는 포자
      const a = rand() * 6.28, r0 = Math.sqrt(rand()) * (radius + wideFar * 0.7), ph = rand(), sp = 0.1 + rand() * 0.12, wob = rand() * 6.28, x0 = center[0] + Math.cos(a) * r0, z0 = center[2] + Math.sin(a) * r0;
      list.push({ p: [x0, center[1], z0], c: i % 4 ? orange(1) : cream(0.9), w: 0.2, move: (t, k) => { const u = (ph + t * sp) % 1; return { p: [x0 + 0.3 * Math.sin(t + wob), center[1] + 0.3 + u * 2.4, z0 + 0.3 * Math.cos(t * 0.8 + wob)], light: k * smooth(0.5, 2, t) * Math.sin(Math.PI * u) }; } });
    }
    const far = radius + wideFar; // 바닥으로 뻗는 가닥: 바깥으로 갈수록 갈라진다
    for (let i = 0; i < 3000; i++) {
      const s = i % 13, u = Math.sqrt(rand()), r = radius * 0.5 + u * (far - radius * 0.5) * (0.6 + 0.4 * hash(s + 2)), fork = u > 0.3 ? (Math.floor(rand() * 3) - 1) * (u - 0.3) * 0.32 : 0;
      const a = s / 13 * 6.28 + hash(s) * 0.4 + 0.2 * Math.sin(r * 1.7 + s) + fork, x = center[0] + Math.cos(a) * r + (rand() - 0.5) * 0.12, z = center[2] + Math.sin(a) * r + (rand() - 0.5) * 0.12;
      list.push({ p: [x, ground(x, z) + 0.03, z], c: orange(0.95 - 0.35 * u), w: 0, move: (t, k) => ({ light: smooth(r - 0.3, r + 0.2, wide(t) * k) }) });
    }
    for (let i = 0; i < 1100; i++) { // 가닥 사이 바닥에 얇게 깔리는 막
      const a = rand() * 6.28, r = far * Math.sqrt(rand()) * (0.85 + 0.15 * Math.sin(a * 7)), x = center[0] + Math.cos(a) * r, z = center[2] + Math.sin(a) * r;
      list.push({ p: [x, ground(x, z) + 0.02, z], c: orange(0.5), w: 0.2, move: (t, k) => ({ light: smooth(r - 0.2, r + 0.5, wide(t) * k) }) });
    }
    return cloud(list);
  },

  /** 사람: 지친 대원 머리 위로 땀방울이 튄다. 대원은 eventCrew.js. style 'dizzy' = 배탈 (머리 위로 어지러운 고리가 돈다) */
  crew({ spots, ground, style }) {
    const rand = mulberry32(6606), list = [];
    if (style === 'dizzy') {
      for (const [x, z] of spots) for (let i = 0; i < 36; i++) {
        const a0 = i / 36 * 6.28, y = ground(x, z) + 0.5, wob = rand() * 6.28;
        list.push({ p: [x, y, z], c: i % 4 ? orange(1) : cream(1), w: 0.5, move: (t, k) => { const a = a0 + t * 3.2; return { p: [x + Math.cos(a) * 0.14, y + 0.03 * Math.sin(a * 2 + wob), z + Math.sin(a) * 0.14], light: k * smooth(0.5, 1.2, t) * (0.5 + 0.5 * Math.sin(a0 * 3 + t * 4)) }; } });
      }
      return cloud(list);
    }
    for (const [x, z] of spots) for (let i = 0; i < 46; i++) {
      const a = rand() * 6.28, ph = rand(), v = 0.14 + rand() * 0.14, y = ground(x, z) + 0.42;
      list.push({ p: [x, y, z], c: i % 3 ? blueStep(0.85) : orange(1), w: 0.5, move: (t, k) => { const s = ((t * 0.8 + ph) % 1); return { p: [x + Math.cos(a) * v * s, y + 0.5 * s - 0.7 * s * s, z + Math.sin(a) * v * s], light: k * smooth(0.6, 1.4, t) * (1 - s) }; } });
    }
    return cloud(list);
  },

  // ---- 사건별 전용 연출 (2026-11-28): 공용 연출과 어울리지 않던 사건에 붙인다 ----

  /** 과열: 장치가 달아올라 주황으로 숨 쉬고, 위로 아지랑이와 옅은 연기가 오른다 */
  heat({ center, top, targetPoints }) {
    const rand = mulberry32(8101), list = [], n = targetPoints.length / 3;
    for (let i = 0; i < 1300; i++) { // 아지랑이: 흔들리며 오르는 세로 결
      const q = Math.floor(rand() * n) * 3, from = [targetPoints[q], Math.max(targetPoints[q + 1], top - 0.3), targetPoints[q + 2]], ph = rand(), sp = 0.35 + rand() * 0.25, wob = rand() * 6.28;
      list.push({ p: from, c: i % 3 ? orange(0.85) : cream(0.8), w: 0, move: (t, k) => {
        const u = (ph + t * sp) % 1;
        return { p: [from[0] + 0.07 * Math.sin(t * 7 + wob + u * 9), from[1] + u * 1.7, from[2] + 0.07 * Math.cos(t * 6 + wob + u * 8)], light: k * smooth(0.3, 1.2, t) * 0.75 * Math.sin(Math.PI * u) };
      } });
    }
    for (let i = 0; i < Math.min(900, n); i++) { // 겉면의 달아오른 점
      const q = Math.floor(rand() * n) * 3, p = [targetPoints[q], targetPoints[q + 1], targetPoints[q + 2]], ph = rand() * 6.28;
      list.push({ p, c: orange(1.1), w: 0.4, move: (t, k) => ({ light: k * smooth(0.2, 1.5, t) * (0.55 + 0.45 * Math.sin(t * 4 + ph)) }) });
    }
    for (let i = 0; i < 380; i++) { // 옅은 연기
      const a = rand() * 6.28, r = rand() * 0.4, ph = rand();
      list.push({ p: center, c: cream(0.45), w: 0, move: (t, k) => { const u = (ph + t * 0.18) % 1; return { p: [center[0] + Math.cos(a) * (r + u * 0.5) + u * 0.6, top + 0.2 + u * 2.2, center[2] + Math.sin(a) * (r + u * 0.5)], light: k * smooth(1, 2.5, t) * Math.sin(Math.PI * u) }; } });
    }
    return cloud(list);
  },

  /** 낙석: 입구 앞으로 돌덩이가 차례로 떨어져 튀고 쌓이며, 떨어질 때마다 흙먼지가 인다 */
  rockfall({ center, radius, top, ground, dir }) {
    const rand = mulberry32(8202), list = [], front = [center[0] + dir[0] * radius * 0.9, center[2] + dir[1] * radius * 0.9];
    for (let b = 0; b < 16; b++) {
      const land = [front[0] + (rand() - 0.5) * 1.4, front[1] + (rand() - 0.5) * 1.2], size = 0.16 + rand() * 0.2, drop = 0.2 + b * 0.22 + rand() * 0.15, from = top + 2.5 + rand() * 2;
      const g = ground(land[0], land[1]) + size, fall = Math.sqrt((from - g) / 4.9);
      for (let i = 0; i < 110; i++) { // 돌덩이 하나 (껍질 점)
        const th = rand() * 6.28, ph = Math.acos(rand() * 2 - 1), off = [Math.sin(ph) * Math.cos(th) * size, Math.cos(ph) * size * 0.8, Math.sin(ph) * Math.sin(th) * size];
        list.push({ p: [land[0], g, land[1]], c: i % 4 ? orange(0.75) : cream(0.85), w: 0.5, move: (t, k) => {
          const s = t - drop, bounce = clamp((s - fall) / 0.3), y = s < fall ? from - 4.9 * s * s : g + 0.25 * Math.sin(Math.PI * bounce) * (1 - bounce);
          return { p: [land[0] + off[0], Math.max(g, y) + off[1], land[1] + off[2]], light: s > 0 && k > 0.02 ? 1 : 0 };
        } });
      }
      for (let i = 0; i < 60; i++) { // 떨어진 자리의 흙먼지
        const a = rand() * 6.28, v = 0.3 + rand() * 0.6, up = rand() * 0.8;
        list.push({ p: [land[0], g, land[1]], c: cream(0.5), w: 0, move: (t, k) => {
          const s = t - drop - fall, d = v * Math.sqrt(Math.max(0, s));
          return { p: [land[0] + Math.cos(a) * d, g + up * clamp(s * 2), land[1] + Math.sin(a) * d], light: s > 0 ? k * clamp(1 - s / 1.6) : 0 };
        } });
      }
    }
    for (let i = 0; i < 400; i++) { // 위에서 흘러내리는 잔돌
      const x = front[0] + (rand() - 0.5) * 1.2, z = front[1] + (rand() - 0.5) * 0.8, ph = rand(), g = ground(x, z);
      list.push({ p: [x, g, z], c: orange(0.6), w: 0, move: (t, k) => { const u = (ph + t * 0.6) % 1; return { p: [x, top + 2 - u * (top + 2 - g), z], light: k * smooth(0, 1, t) * (1 - smooth(3, 5, t)) * 0.8 }; } });
    }
    return cloud(list);
  },

  /** 통신 두절: 장치 위에서 퍼지던 신호 고리가 끊겨 흩어지고, 둘레에 잡음이 깜빡인다 */
  signal({ center, radius, top }) {
    const rand = mulberry32(8303), list = [], at = [center[0], top + 0.25, center[2]];
    for (let i = 0; i < 4 * 200; i++) { // 끊어지는 신호 고리
      const ring = Math.floor(i / 200), a = (i % 200) / 200 * 6.28, seg = Math.floor(a / 6.28 * 18);
      list.push({ p: at, c: i % 5 ? cream(0.95) : orange(1), w: 0.5, move: (t, k) => {
        const u = (t * 0.5 + ring / 4) % 1, r = 0.2 + u * (radius + 2.5), cut = hash(seg * 7 + ring * 31 + Math.floor(t * 0.5 + ring / 4)) < 0.15 + 0.7 * k * smooth(0.5, 2, t);
        return { p: [at[0] + Math.cos(a) * r, at[1] + 0.25 * Math.sin(u * 3.14), at[2] + Math.sin(a) * r], light: cut ? 0 : (1 - u) * 1.1 + 0.2 };
      } });
    }
    for (let i = 0; i < 1100; i++) { // 잡음
      const p = [center[0] + (rand() - 0.5) * (radius * 2 + 1), center[1] + rand() * (top - center[1] + 1), center[2] + (rand() - 0.5) * (radius * 2 + 1)];
      list.push({ p, c: rand() < 0.6 ? orange(0.9) : cream(0.9), w: 0, move: (t, k) => ({ light: k * smooth(0.4, 1.2, t) * (hash(i * 3.7 + Math.floor(t * 11)) > 0.86 ? 1 : 0) }) });
    }
    return cloud(list);
  },

  /** 땅 갈라짐: 바닥에 그물처럼 금이 번지고 마른 흙먼지가 날린다. style 'ring' 이면 건물 둘레를 감싸는 금 (지반 침하) */
  cracks({ center, radius, ground, style }) {
    const rand = mulberry32(8404), list = [], R = radius + (style === 'ring' ? 1.2 : 2.2), lines = [];
    if (style === 'ring') for (let j = 0; j < 3; j++) lines.push({ ring: radius * 0.75 + j * 0.45, wob: rand() * 6.28 });
    else {
      for (let j = 0; j < 11; j++) lines.push({ ang: j / 11 * 6.28 + rand() * 0.4, wob: rand() * 6.28 });
      for (let j = 0; j < 3; j++) lines.push({ ring: R * (0.35 + j * 0.25), wob: rand() * 6.28 });
    }
    for (let i = 0; i < 4200; i++) {
      const L = lines[i % lines.length], u = rand();
      let x, z, d;
      if (L.ring) { const a = u * 6.28, r = L.ring * (1 + 0.12 * Math.sin(a * 5 + L.wob) + 0.05 * Math.sin(a * 13)); x = center[0] + Math.cos(a) * r; z = center[2] + Math.sin(a) * r; d = r; }
      else { const r = u * R, a = L.ang + 0.25 * Math.sin(r * 2 + L.wob) + 0.1 * Math.sin(r * 7); x = center[0] + Math.cos(a) * r; z = center[2] + Math.sin(a) * r; d = r; }
      const at = d * 0.45 + rand() * 0.2, deep = rand();
      list.push({ p: [x, ground(x, z) + 0.02 - deep * 0.12, z], c: orange(0.45 + 0.5 * (1 - deep)), w: 0.5, move: (t, k) => ({ light: k * smooth(at, at + 0.3, t) }) });
    }
    for (let i = 0; i < 700; i++) { // 마른 흙먼지
      const a = rand() * 6.28, r = R * Math.sqrt(rand()), x = center[0] + Math.cos(a) * r, z = center[2] + Math.sin(a) * r, g = ground(x, z), ph = rand();
      list.push({ p: [x, g, z], c: cream(0.4), w: 0, move: (t, k) => { const u = (ph + t * 0.25) % 1; return { p: [x + u * 0.9, g + u * 0.6, z + 0.2 * Math.sin(u * 6 + a)], light: k * smooth(0.8, 2, t) * Math.sin(Math.PI * u) }; } });
    }
    return cloud(list);
  },

  /** 한파·난방 정지: 장치에 아래부터 성에가 기어오르고, 눈발이 날리며, 대원들 입김이 하얗게 보인다 */
  frost({ center, radius, top, targetPoints, ground, spots = [] }) {
    const rand = mulberry32(8505), list = [], n = targetPoints.length / 3, y0 = center[1], tall = Math.max(0.3, top - y0);
    for (let i = 0; i < Math.min(2600, n); i++) { // 성에
      const q = Math.floor(rand() * n) * 3, p = [targetPoints[q] + (rand() - 0.5) * 0.05, targetPoints[q + 1] + 0.02, targetPoints[q + 2] + (rand() - 0.5) * 0.05], at = 0.4 + (p[1] - y0) / tall * 3 + rand() * 0.5;
      list.push({ p, c: i % 3 ? blueStep(0.95) : cream(1), w: 0.4, move: (t, k) => ({ light: k * smooth(at, at + 0.5, t) * (0.75 + 0.25 * Math.sin(t * 2 + i)) }) });
    }
    const W = 14, H = 5;
    for (let i = 0; i < 2600; i++) { // 눈발: 옆으로 밀리며 천천히 내린다
      const x0 = (rand() - 0.5) * W, z0 = (rand() - 0.5) * W, y = rand() * H, sp = 0.4 + rand() * 0.5, wob = rand() * 6.28;
      list.push({ p: center, c: rand() < 0.7 ? cream(0.8) : blueStep(0.9), w: 0, move: (t, k) => {
        const yy = (((y - t * sp) % H) + H) % H, x = (((x0 + t * 0.9 + W / 2) % W) + W) % W - W / 2;
        return { p: [center[0] + x + 0.2 * Math.sin(t + wob), y0 + yy, center[2] + z0 + 0.2 * Math.cos(t * 0.8 + wob)], light: k * smooth(0, 1.5, t) * 0.8 };
      } });
    }
    for (let i = 0; i < 1300; i++) { // 바닥에 번지는 서리
      const a = rand() * 6.28, r = (radius + 2) * Math.sqrt(rand()), x = center[0] + Math.cos(a) * r, z = center[2] + Math.sin(a) * r;
      list.push({ p: [x, ground(x, z) + 0.03, z], c: blueStep(0.8), w: 0.3, move: (t, k) => ({ light: k * 0.7 * smooth(0.5 + r * 0.8, 1 + r * 0.8, t) }) });
    }
    for (const [x, z] of spots) for (let i = 0; i < 40; i++) { // 입김
      const ph = rand(), a = rand() * 6.28, head = ground(x, z) + 0.36;
      list.push({ p: [x, head, z], c: cream(0.9), w: 0, move: (t, k) => { const u = (t * 0.7 + ph) % 1; return { p: [x + 0.12 + u * 0.25 + Math.cos(a) * u * 0.06, head + u * 0.2, z + Math.sin(a) * u * 0.06], light: k * smooth(0.5, 1.2, t) * (1 - u) * (u < 0.6 ? 1 : 0.4) }; } });
    }
    return cloud(list);
  },

  /** 화산 가스: 기지 바깥 틈에서 뿜어 나온 가스가 땅을 타고 기지 쪽으로 밀려온다 */
  vent({ center, radius, ground, dir }) {
    const rand = mulberry32(8606), list = [], vents = [];
    for (let j = 0; j < 4; j++) {
      const a = Math.atan2(-dir[1], -dir[0]) + (j - 1.5) * 0.45, r = radius + 2.6 + rand() * 1.2, x = center[0] + Math.cos(a) * r, z = center[2] + Math.sin(a) * r;
      vents.push([x, ground(x, z), z]);
    }
    for (let i = 0; i < 2800; i++) { // 솟았다가 땅을 타고 기지로 흐르는 가스
      const v = vents[i % 4], ph = rand(), sp = 0.12 + rand() * 0.1, spread = (rand() - 0.5) * 1.2, up = 0.6 + rand() * 0.9;
      list.push({ p: v, c: rand() < 0.65 ? orange(0.55) : cream(0.45), w: 0, move: (t, k) => {
        const u = (ph + t * sp) % 1, x = v[0] + (center[0] - v[0]) * u + spread * Math.sin(u * 3) * 0.6, z = v[2] + (center[2] - v[2]) * u + spread * Math.cos(u * 3) * 0.6;
        return { p: [x, ground(x, z) + up * Math.sin(Math.PI * Math.min(1, u * 2.5)) * (1 - u * 0.6) + 0.08, z], light: k * smooth(0.2, 1.5, t) * smooth(0, 0.1, u) * (1 - smooth(0.8, 1, u)) * 0.85 };
      } });
    }
    for (const v of vents) for (let i = 0; i < 70; i++) { // 틈 둘레
      const a = rand() * 6.28, r = 0.15 + rand() * 0.2, x = v[0] + Math.cos(a) * r, z = v[2] + Math.sin(a) * r;
      list.push({ p: [x, ground(x, z) + 0.03, z], c: orange(1), w: 0.4, move: (t, k) => ({ light: k * smooth(0, 0.8, t) * (0.6 + 0.4 * Math.sin(t * 5 + a)) }) });
    }
    return cloud(list);
  },

  // ---- 좋은 소식 (2026-11-27): 나쁜 사건과 같은 흐름, 색은 민트. k 는 연출 세기 (대응을 고르면 잔잔해진다) ----

  /** 보급: 하늘에서 캡슐이 민트 꼬리를 끌며 내려와 앉고, 바닥에 고리가 번진다 */
  drop({ center, ground }) {
    const rand = mulberry32(7101), list = [], [cx, cy, cz] = center, sky = 9, land = 1.7;
    const fall = t => { const u = clamp(t / land); return cy + 0.28 + sky * (1 - u) * (1 - u); }; // 처음엔 빠르게, 땅에 닿을 때는 천천히
    for (let i = 0; i < 360; i++) { // 캡슐 (모서리 상자)
      const e = i % 12, s = rand() - 0.5, ax = [[s, -1, -1], [s, 1, -1], [s, -1, 1], [s, 1, 1], [-1, s, -1], [1, s, -1], [-1, s, 1], [1, s, 1], [-1, -1, s], [1, -1, s], [-1, 1, s], [1, 1, s]][e];
      const off = [ax[0] * 0.22, ax[1] * 0.28, ax[2] * 0.22];
      list.push({ p: center, c: i % 5 ? mint(1) : cream(1.1), w: 0.6, move: (t, k) => ({ p: [cx + off[0], fall(t) + off[1], cz + off[2]], light: k > 0.01 ? 1 : 0 }) });
    }
    for (let i = 0; i < 420; i++) { // 내려오며 남는 꼬리
      const lag = rand() * 0.5, j = [(rand() - 0.5) * 0.18, (rand() - 0.5) * 0.18];
      list.push({ p: center, c: mint(0.8), w: 0, move: (t, k) => { const tt = Math.max(0, t - lag); return { p: [cx + j[0], fall(tt) + 0.3, cz + j[1]], light: k * (t < land + 0.4 ? clamp(1 - lag / 0.5) * clamp((land + 0.4 - t) / 0.4) : 0) }; } });
    }
    for (let i = 0; i < 480; i++) { // 앉을 때 바닥으로 번지는 고리 (되풀이)
      const a = rand() * 6.28, ph = rand() * 0.3;
      list.push({ p: center, c: i % 3 ? mint(0.9) : cream(0.9), w: 0.3, move: (t, k) => {
        const u = ((t - land - ph) % 2.2 + 2.2) % 2.2 / 2.2, r = 0.3 + u * 1.6, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        return { p: [x, ground(x, z) + 0.04, z], light: t > land ? k * (1 - u) : 0 };
      } });
    }
    for (let i = 0; i < 260; i++) { // 앉은 뒤 위로 오르는 빛
      const a = rand() * 6.28, r = 0.15 + rand() * 0.35, ph = rand(), sp = 0.3 + rand() * 0.3;
      list.push({ p: center, c: mint(1), w: 0, move: (t, k) => { const u = (ph + t * sp) % 1; return { p: [cx + Math.cos(a + u) * r, cy + 0.3 + u * 2.2, cz + Math.sin(a + u) * r], light: k * smooth(land, land + 0.8, t) * Math.sin(Math.PI * u) }; } });
    }
    return cloud(list);
  },

  /** 물: 바닥에서 민트빛 물줄기가 솟아 흩어지고, 둘레에 물결이 퍼진다 */
  spring({ center, radius, ground }) {
    const rand = mulberry32(7202), list = [], [cx, cy, cz] = center;
    for (let i = 0; i < 1100; i++) { // 솟는 물방울
      const a = rand() * 6.28, v = 0.15 + rand() * 0.55, up = 2.4 + rand() * 1.4, ph = rand(), life = 1.1 + rand() * 0.5;
      list.push({ p: center, c: i % 4 ? mint(1) : cream(1.1), w: 0, move: (t, k) => {
        const u = ((t + ph * life) % life), y = cy + 0.05 + up * u - 2.9 * u * u;
        const x = cx + Math.cos(a) * v * u, z = cz + Math.sin(a) * v * u, g = ground(x, z);
        return { p: [x, Math.max(g + 0.03, y), z], light: k * smooth(0, 0.6, t) * (y > g ? 1 : 0.3) };
      } });
    }
    const R = Math.max(1.2, radius * 0.9);
    for (let i = 0; i < 900; i++) { // 퍼지는 물결
      const a = rand() * 6.28, ring = i % 3;
      list.push({ p: center, c: mint(0.75), w: 0.3, move: (t, k) => {
        const u = ((t * 0.45 + ring / 3) % 1), r = 0.2 + u * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        return { p: [x, ground(x, z) + 0.03, z], light: k * smooth(0.3, 1, t) * (1 - u) };
      } });
    }
    return cloud(list);
  },

  /** 전기·빛: 하늘에서 민트 빛기둥이 내려오고, 장치를 따라 빛 고리가 오르며, 위로 불티가 흩어진다 */
  surge({ center, radius, top }) {
    const rand = mulberry32(7303), list = [], [cx, cy, cz] = center, R = Math.max(0.6, radius * 1.05), tall = Math.max(0.6, top - cy);
    for (let i = 0; i < 6 * 140; i++) { // 오르는 고리 6개
      const ring = Math.floor(i / 140), a = (i % 140) / 140 * 6.28;
      list.push({ p: center, c: mint(1), w: 0.4, move: (t, k) => {
        const u = ((t * 0.55 + ring / 6) % 1), r = R * (1 + 0.12 * Math.sin(u * 3.14));
        return { p: [cx + Math.cos(a) * r, cy + 0.05 + u * (tall + 0.4), cz + Math.sin(a) * r], light: k * smooth(0.2, 0.8, t) * Math.sin(Math.PI * u) };
      } });
    }
    for (let i = 0; i < 520; i++) { // 내려오는 빛기둥
      const a = rand() * 6.28, r = Math.sqrt(rand()) * R * 0.8, ph = rand(), sp = 0.35 + rand() * 0.35;
      list.push({ p: center, c: i % 3 ? mint(0.7) : cream(0.8), w: 0.5, move: (t, k) => {
        const u = (ph + t * sp) % 1;
        return { p: [cx + Math.cos(a) * r, top + 7 * (1 - u), cz + Math.sin(a) * r], light: k * smooth(0, 1, t) * 0.8 * Math.sin(Math.PI * u) };
      } });
    }
    for (let i = 0; i < 360; i++) { // 위로 흩어지는 불티
      const a = rand() * 6.28, v = 0.2 + rand() * 0.6, ph = rand();
      list.push({ p: center, c: cream(1.1), w: 0, move: (t, k) => {
        const u = (ph + t * 0.5) % 1;
        return { p: [cx + Math.cos(a) * v * u * 2, top + 0.1 + u * 1.4, cz + Math.sin(a) * v * u * 2], light: k * smooth(0.6, 1.4, t) * (1 - u) };
      } });
    }
    return cloud(list);
  },

  /** 발견·수확: 장치 점들 사이에서 민트 반딧불이 피어올라 감돌고, 바닥이 은은히 밝아진다 */
  bloom({ center, radius, targetPoints, ground }) {
    const rand = mulberry32(7404), list = [], [cx, , cz] = center, n = targetPoints.length / 3;
    for (let i = 0; i < 900; i++) {
      const j = Math.floor(rand() * n) * 3, from = [targetPoints[j], targetPoints[j + 1], targetPoints[j + 2]], a = rand() * 6.28, ph = rand(), sp = 0.25 + rand() * 0.25, sw = 0.15 + rand() * 0.3;
      list.push({ p: from, c: i % 4 ? mint(1) : cream(1.1), w: 0, move: (t, k) => {
        const u = (ph + t * sp) % 1;
        return { p: [from[0] + Math.cos(a + u * 4) * sw * u, from[1] + u * 1.3, from[2] + Math.sin(a + u * 4) * sw * u], light: k * smooth(i / 900 * 1.2, i / 900 * 1.2 + 0.5, t) * Math.sin(Math.PI * u) };
      } });
    }
    const R = Math.max(1, radius + 0.6);
    for (let i = 0; i < 700; i++) { // 바닥 빛
      const a = rand() * 6.28, r = R * Math.sqrt(rand()), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      list.push({ p: [x, ground(x, z) + 0.03, z], c: mint(0.55), w: 0.3, move: (t, k) => ({ light: k * smooth(r * 0.6, r * 0.6 + 0.8, t * 1.2) * (0.75 + 0.25 * Math.sin(t * 2 + a * 3)) }) });
    }
    return cloud(list);
  }
};

