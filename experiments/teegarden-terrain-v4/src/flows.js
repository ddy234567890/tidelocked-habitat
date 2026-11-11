// 자원 흐름: 장치와 집 사이를 잇는 관(점 줄) 위로 밝은 점 묶음이 흘러간다.
// 물이 나는 곳도 여기서 점으로 그린다: 물웅덩이(잔물결) · 얼음 덩어리 · 흙에서 올라오는 물기(seep).
// 새 머티리얼 없이 지형과 같은 점 머티리얼을 쓴다. 관 점은 선 점(lineWeight)이라 가늘고, 흐르는 점은 지형 점 크기다.
// 어떤 흐름을 그릴지는 weekN.json 의 flows (choices.js flowsFor), 물이 나는 곳은 오버레이의 water 가 정한다.
import { blue, blueStep, cream, orange, shade } from './palette.js';
import { mulberry32 } from './terrain.js';

// 종류별 모양. 색은 palette 함수로만 정한다. speed 는 초당 지역 단위, gap 은 흐르는 점 묶음 사이 간격(양 1 기준)
// style: 'stream'(물: 꼬리 달린 점 묶음이 관을 따라 흐름) · 'puff'(공기: 작은 점이 흩어져 퍼지며 떠감)
//        · 'bolt'(전기: 지그재그 번개 줄이 번쩍이고, 밝은 전류가 빠르게 지나감)
// 색: 물은 진한 파랑, 산소는 크림, 내쉰 공기는 주황, 전기는 흰빛에 가까운 가장 옅은 파랑 단계 (CLAUDE.md 색 규칙)
export const FLOW_KINDS = {
  water: { style: 'stream', pipe: blue(0.9), packet: blue(1.7), speed: 0.9, gap: 0.45 },
  usedWater: { style: 'stream', pipe: blue(0.45), packet: blue(0.9), speed: 0.65, gap: 0.6 },
  oxygen: { style: 'puff', pipe: cream(0.22), packet: cream(1.4), speed: 0.5, gap: 0.5 },
  exhaled: { style: 'puff', pipe: orange(0.18), packet: orange(1.1), speed: 0.4, gap: 0.6 },
  power: { style: 'bolt', pipe: shade(blueStep(1), 0.35), packet: blueStep(1), speed: 3, gap: 0.3 },
  // 열: 집 안의 더운 공기(주황)가 방열판으로 모여 하늘로 흩어진다. 냉방기는 찬 공기(파랑)를 집에 넣고 더운 공기를 옆으로 내뿜는다
  heat: { style: 'puff', pipe: orange(0.15), packet: orange(1.6), speed: 0.45, gap: 0.6, weight: 0.6 },
  cool: { style: 'puff', pipe: shade(blueStep(0.6), 0.4), packet: blueStep(0.6).map(v => v * 1.15), speed: 0.45, gap: 0.6, weight: 0.25, dense: 3 }
};
const PIPE_STEP = 0.025; // 관 점 간격 (촘촘해야 지형 점 사이에서 선으로 보인다)
const LIFT = 0.3; // 장치·집 바닥에서 띄우는 높이
const BURY = 0.45; // 땅속 전선이 땅 밑으로 내려가는 깊이
const ARC = 0.15, ARC_MAX = 0.9; // 길이에 비례해 가운데를 들어 올린다 (건물 뒤에 묻히지 않게)
const STREAK = 8, STREAK_STEP = 0.03; // 흐르는 점 하나는 꼬리 8칸
const PUFF_DENSITY = 70, PUFF_SPREAD = 0.22; // 공기 점: 길이 1 당 개수(양 1 기준), 끝으로 갈수록 퍼지는 폭
const BOLT_STEP = 0.015, BOLT_KICK = 0.04, BOLT_RATE = 16;
const FORKS = 7, FORK_STEPS = 7, FORK_LEN = 0.16; // 길이 1 당 옆으로 튀는 갈래 수, 갈래 하나의 점 수·길이 // 번개 줄: 점 간격, 옆으로 꺾이는 폭, 초당 모양이 바뀌는 횟수
const hash = x => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };
// 양(amount)에 따라 굵기가 달라진다: 칸마다 겹치는 점 수와 퍼짐. 많으면 굵은 물줄기, 적으면 가는 실줄기
const cluster = amount => Math.max(1, Math.round(1 + amount * 5));
const spread = amount => 0.012 + 0.05 * amount;
const OUT_REACH = 2.4; // 'out'(버림) 흐름이 기지 밖으로 뻗는 길이
const PAST_DIM = 0.4; // 지난 주차 흐름 밝기
// 물이 나는 곳
const POOL_STEP = 0.045, POOL_DIP = 0.12; // 물웅덩이 물 표면 점 간격, 둘레보다 낮은 깊이
const ICE_STEP = 0.04;
const SEEP_DENSITY = 60, SEEP_CYCLE = 6, PATCH_R = 0.7; // 흙 물기 점: 넓이 1 당 개수, 한 번 올라와 모이는 데 걸리는 초, 뽑는 땅 한 곳의 반지름

const lerp = (a, b, t) => a + (b - a) * t;

/** a → b 를 잇는 둥근 길. ground(x, z) 가 있으면 그 높이 아래로 내려가지 않는다.
 * below 면 거꾸로 땅 밑으로 내려갔다 올라오는 길이다 (땅속 전선: 배터리에 전기를 저장하러 가는 길) */
export function arcPath(a, b, ground, below = false) {
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]), rise = Math.min(ARC_MAX, flat * ARC);
  const at = below
    ? t => {
      const x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t);
      const base = Math.min(lerp(a[1], b[1], t), ground ? ground(x, z) : Infinity);
      return [x, base - Math.sin(Math.PI * t) * (BURY + rise * 0.5), z];
    }
    : t => {
      const x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t);
      const base = Math.max(lerp(a[1], b[1], t), ground ? ground(x, z) : -Infinity);
      return [x, base + LIFT + Math.sin(Math.PI * t) * rise, z];
    };
  let length = 0, prev = at(0);
  for (let i = 1; i <= 24; i++) { const p = at(i / 24); length += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]); prev = p; }
  return { at, length: Math.max(length, 1e-3) };
}

/** 두 칸의 자리 목록을 잇는 구간들: 개수가 같으면 짝지어(구역 물탱크 → 그 구역 집), 아니면 모두 잇는다 */
export function pairSpots(from, to) {
  if (from.length === to.length) return from.map((a, i) => [a, to[i]]);
  return from.flatMap(a => to.map(b => [a, b]));
}

/** 'out' 칸 자리: 출발 자리에서 기지 한가운데의 반대쪽으로 OUT_REACH 만큼 */
export function outSpots(from, center) {
  return from.map(a => {
    const dx = a[0] - center[0], dz = a[2] - center[2], d = Math.hypot(dx, dz) || 1;
    return [a[0] + dx / d * OUT_REACH, a[1], a[2] + dz / d * OUT_REACH];
  });
}

/** 오버레이 정의 → 장치 둘레에 그리는 것들과 흐름이 시작할 자리.
 * water: 물이 나는 곳. 지대 글자별({ A: {…} }) 또는 하나({ type, r, offset }). 크기·offset 은 장치 묶음 배율 k 를 따른다
 * heatOut: 더운 공기를 하늘로 내보내는 크기 (방열판·냉방기 실외기)
 * zone: 집마다 두는 장치(perHome)면 그 집 둘레에 구역 고리를 그린다 (분산형: 구역마다 따로 공급) */
export function waterSources(def, letter, spots, homes = [], shrink = 1) {
  const k = (def?.scaleAt?.[letter] ?? 1) * shrink, sources = [];
  const water = def?.water?.type ? def.water : def?.water?.[letter];
  let anchors = spots;
  if (water) {
    const [dx, dz] = (water.offset ?? [0, 0]).map(v => v * k);
    anchors = spots.map(s => [s[0] + dx, s[1], s[2] + dz]);
    sources.push(...anchors.map(center => ({ type: water.type, r: water.r * k, patches: water.patches, center })));
  }
  if (def?.heatOut) sources.push(...spots.map(center => ({ type: 'radiate', r: def.heatOut * k, center })));
  if (def?.zone && homes.length === spots.length) sources.push(...homes.map((home, i) => ({ type: 'zone', r: home.r + 0.25, center: home.at, unit: spots[i] })));
  return { anchors, sources };
}

/** flows: [{ kind, amount, past, fadeEnd, segments: [[a, b], …] }], sources: [{ type, r, center, past }]
 * → 점 데이터와 매 프레임 움직이는 함수
 * 반환: { positions, colors(sRGB), weights, animate(positions, colors, base, seconds, appear) } */
export function buildFlowPoints(flows, ground, sources = []) {
  const items = []; // { p, c, w, move? } 점 하나씩. move(seconds) → { p?, light }
  const add = (p, c, w, move) => items.push({ p, c, w, move });
  for (const flow of flows) {
    const kind = FLOW_KINDS[flow.kind], dim = flow.past ? PAST_DIM : 1, amount = Math.max(0.1, flow.amount), vary = flow.vary ?? 0;
    for (const [segIndex, [a, b, opt]] of flow.segments.entries()) {
      const path = arcPath(a, b, ground, opt?.below), n = Math.max(2, Math.ceil(path.length / PIPE_STEP));
      for (let i = 0; i <= n; i++) add(path.at(i / n), kind.pipe.map(v => v * dim * (0.55 + 0.45 * Math.min(1, amount))), 0.6);
      // 지난 주차 흐름은 움직이지 않고 흐린 줄만 남긴다. 그 주에 고르는 것만 움직여 지금 보는 것이 헷갈리지 않게 한다
      if (flow.past) continue;
      // vary: 양이 가끔 크게 줄었다가 돌아온다 (별 폭풍에 흔들리는 태양광)
      const swell = seconds => (vary ? 1 - vary * Math.max(0, Math.sin(seconds * 0.6)) ** 3 : 1);
      const ctx = { path, amount, kind, swell, fadeEnd: flow.fadeEnd, seed: segIndex * 17.31 + flow.kind.length * 3.1, random: mulberry32(4200 + segIndex) };
      ({ stream: addStream, puff: addPuff, bolt: addBolt })[kind.style](ctx, add);
    }
  }
  for (const [index, source] of sources.entries()) addSource(source, source.ground ?? ground, add, mulberry32(9100 + index));
  const total = items.length;
  const positions = new Float32Array(total * 3), colors = new Float32Array(total * 3), weights = new Float32Array(total);
  items.forEach((q, i) => { positions.set(q.p, i * 3); colors.set(q.c, i * 3); weights[i] = q.w; });
  /** 움직이는 점만 옮기고 밝기를 맞춘다. base 는 처음 색(선형), appear 는 전체 밝기(0~1) */
  function animate(pos, col, base, seconds, appear = 1) {
    items.forEach((q, i) => {
      const k = i * 3;
      let light = 1;
      if (q.move) {
        const state = q.move(seconds);
        light = state.light;
        if (state.p) { pos[k] = state.p[0]; pos[k + 1] = state.p[1]; pos[k + 2] = state.p[2]; }
      }
      for (let c = 0; c < 3; c++) col[k + c] = base[k + c] * light * appear;
    });
  }
  return { positions, colors, weights, animate };
}

const groundAt = (ground, x, z, fallback) => (ground ? ground(x, z) : fallback);
// 길 양 끝에서 부드럽게 나타나고 사라진다. 버리는 흐름(fadeEnd)은 갈수록 흐려진다
const ends = (u, fadeEnd) => Math.min(1, u / 0.06, (1 - u) / 0.06) * (fadeEnd ? 1 - u : 1);

// 물: 꼬리 달린 점 묶음이 관을 따라 흐른다. 양이 많을수록 촘촘하고 빠르고 굵다
function addStream({ path, amount, kind, swell, fadeEnd }, add) {
  const thick = cluster(amount), width = spread(amount);
  const count = Math.max(1, Math.round(path.length * amount / kind.gap));
  const speed = kind.speed * (0.6 + 0.4 * amount) / path.length;
  for (let k = 0; k < count; k++) for (let j = 0; j < STREAK; j++) for (let m = 0; m < thick; m++) {
    const angle = (m / thick) * Math.PI * 2, r = m ? width : 0;
    const jitter = [Math.cos(angle) * r, Math.sin(angle) * r * 0.7, Math.sin(angle + 1.3) * r];
    const phase = k / count, lag = j * STREAK_STEP / path.length, tail = 1 - j / STREAK;
    add(path.at(phase), kind.packet, 0, seconds => {
      const t = ((phase + seconds * speed) % 1) - lag, u = Math.max(0, t), p = path.at(u);
      return { p: [p[0] + jitter[0], p[1] + jitter[1], p[2] + jitter[2]], light: t < 0 ? 0 : ends(u, fadeEnd) * tail * swell(seconds) };
    });
  }
}

// 공기: 꼬리 없는 작은 점이 제각각 흩어져, 갈수록 넓게 퍼지며 천천히 떠간다 (기체가 퍼지는 느낌)
function addPuff({ path, amount, kind, swell, fadeEnd, random }, add) {
  const count = Math.max(4, Math.round(path.length * amount * PUFF_DENSITY * (kind.dense ?? 1)));
  const speed = kind.speed * (0.7 + 0.3 * amount) / path.length;
  for (let k = 0; k < count; k++) {
    const phase = random(), angle = random() * Math.PI * 2, reach = Math.sqrt(random()), wobble = random() * 6.28, rate = 0.8 + random() * 0.4;
    add(path.at(phase), kind.packet, kind.weight ?? 0, seconds => {
      const u = (phase + seconds * speed * rate) % 1, p = path.at(u), r = PUFF_SPREAD * reach * (0.25 + u);
      const a = angle + Math.sin(seconds * 0.9 + wobble) * 0.6;
      return { p: [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.6 + 0.03 * Math.sin(seconds * 1.3 + wobble), p[2] + Math.sin(a + 0.7) * r],
        light: Math.sin(Math.PI * u) * ends(u, fadeEnd) * swell(seconds) };
    });
  }
}

// 전기: 장치 사이에 지그재그 번개 줄이 걸려 1/BOLT_RATE 초마다 모양이 바뀌며 번쩍이고,
// 그 위로 밝은 전류 덩어리가 빠르게 지나간다. 양 끝 장치에는 작은 불꽃이 튄다
function addBolt({ path, amount, kind, swell, seed }, add) {
  const n = Math.max(8, Math.ceil(path.length / BOLT_STEP)), a = path.at(0), b = path.at(1);
  const dx = b[0] - a[0], dz = b[2] - a[2], d = Math.hypot(dx, dz) || 1, side = [-dz / d, 0, dx / d];
  const pulses = Math.max(2, Math.round(path.length * amount / kind.gap / 1.5)), speed = kind.speed / path.length;
  const shape = (tick, u) => {
    const h1 = hash(seed + tick * 1.37), h2 = hash(seed + tick * 2.11 + 5), h3 = hash(seed + tick * 0.73 + 9);
    const wave = Math.sin(u * (3 + h1 * 3) * 6.28 + h2 * 6.28) * 0.6 + Math.sin(u * (9 + h3 * 6) * 6.28 + h1 * 6.28) * 0.4;
    // 꺾인 선이 되도록 잘게 끊어 계단처럼 만든다
    const step = Math.round(wave * 4) / 4;
    return BOLT_KICK * Math.sin(Math.PI * u) * step;
  };
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    add(path.at(u), kind.packet, 0.6, seconds => {
      const tick = Math.floor(seconds * BOLT_RATE), off = shape(tick, u), lift = shape(tick + 101, u) * 0.25, p = path.at(u);
      // 번개는 켜졌다 꺼졌다 한다. 전류 덩어리가 지나가는 자리는 가장 밝다
      const on = hash(seed + tick * 3.3) > 0.3 ? 1 : 0.2;
      let pulse = 0;
      for (let k = 0; k < pulses; k++) {
        const at = (seconds * speed + k / pulses) % 1, gap = Math.min(Math.abs(u - at), 1 - Math.abs(u - at));
        pulse = Math.max(pulse, Math.max(0, 1 - gap / 0.05));
      }
      return { p: [p[0] + side[0] * off, p[1] + lift, p[2] + side[2] * off], light: Math.min(1, on + pulse) * swell(seconds) };
    });
  }
  // 찌릿찌릿: 줄 여기저기에서 짧은 갈래가 순간적으로 옆으로 튀었다 사라진다 (매 순간 다른 자리)
  const forks = Math.max(3, Math.round(path.length * FORKS));
  for (let k = 0; k < forks; k++) for (let j = 1; j <= FORK_STEPS; j++) {
    add(path.at(0.5), kind.packet, 0.6, seconds => {
      const tick = Math.floor(seconds * BOLT_RATE), h = hash(seed + k * 13.7 + tick * 2.9);
      if (h < 0.35) return { light: 0 };
      const u = 0.05 + 0.9 * hash(h * 17.3), base = path.at(u), ang = hash(h * 29.1) * 6.28, up = hash(h * 41.9) - 0.3;
      const reach = FORK_LEN * (0.5 + hash(h * 53.3)) * j / FORK_STEPS, zig = (j % 2 ? 1 : -1) * 0.012;
      return { p: [base[0] + Math.cos(ang) * reach + side[0] * zig, base[1] + up * reach, base[2] + Math.sin(ang) * reach + side[2] * zig],
        light: (1 - j / (FORK_STEPS + 1)) * swell(seconds) };
    });
  }
  // 양 끝 불꽃: 장치에서 짧게 튀는 점
  for (const end of [0, 1]) for (let k = 0; k < 10; k++) {
    const base = path.at(end);
    add(base, kind.packet, 0, seconds => {
      const tick = Math.floor(seconds * BOLT_RATE * 1.5), h = hash(seed + end * 50 + k * 7.7 + tick * 1.9);
      const r = 0.05 + 0.12 * hash(h * 13.1), ang = h * 6.28, up = hash(h * 31.7);
      return { p: [base[0] + Math.cos(ang) * r, base[1] + up * 0.12, base[2] + Math.sin(ang) * r], light: h > 0.45 ? 0.9 * swell(seconds) : 0 };
    });
  }
}

// 물이 나는 곳 하나를 점으로 더한다
function addSource({ type, r, center, past, patches, unit, air, top }, ground, addPoint, random) {
  const dim = past ? PAST_DIM : 1, [cx, cy, cz] = center;
  // 지난 주차의 물이 나는 곳은 움직이지 않는다 (흙 물기 방울은 그리지 않고 고리만 남긴다)
  const add = (p, c, w, move) => (past && move ? !['seep', 'radiate', 'zone'].includes(type) && addPoint(p, c, w) : addPoint(p, c, w, move));
  if (type === 'pool') {
    // 물웅덩이: 땅을 따라 가운데가 오목하게 파인 물 표면 (비탈에서도 땅에 붙어 있다).
    // 가운데에서 잔물결 고리가 바깥으로 퍼진다. 둘레는 밝은 테두리
    for (let x = -r; x <= r; x += POOL_STEP) for (let z = -r; z <= r; z += POOL_STEP) {
      const jx = x + (random() - 0.5) * POOL_STEP, jz = z + (random() - 0.5) * POOL_STEP, d = Math.hypot(jx, jz * 1.25);
      if (d > r) continue;
      const y = groundAt(ground, cx + jx, cz + jz, cy) + 0.015 - POOL_DIP * (1 - (d / r) ** 2);
      add([cx + jx, y, cz + jz], blue(0.75 * dim), 0, seconds => ({ light: 0.35 + 0.65 * Math.max(0, Math.sin(d / r * 14 - seconds * 2.4)) ** 2 }));
    }
    const rim = Math.ceil(Math.PI * 2 * r / 0.02);
    for (let i = 0; i < rim; i++) {
      const a = i / rim * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r / 1.25;
      add([cx + x, groundAt(ground, cx + x, cz + z, cy) + 0.01, cz + z], blue(1.1 * dim), 0.6);
    }
  } else if (type === 'ice') {
    // 얼음 덩어리: 크기가 다른 각진 덩어리 몇 개. 표면 점이 천천히 반짝인다
    const blocks = [[0, 0, 1], [0.55, 0.15, 0.6], [-0.5, -0.3, 0.55], [0.1, 0.55, 0.45]];
    for (const [bx, bz, s] of blocks) {
      const half = r * 0.45 * s, height = r * 0.7 * s, x0 = cx + bx * r, z0 = cz + bz * r;
      const y0 = groundAt(ground, x0, z0, cy);
      for (let x = -half; x <= half; x += ICE_STEP) for (let y = 0; y <= height; y += ICE_STEP) for (let z = -half; z <= half; z += ICE_STEP) {
        const edge = [Math.abs(x) > half - ICE_STEP, y > height - ICE_STEP, Math.abs(z) > half - ICE_STEP].filter(Boolean).length;
        if (!edge && y > 0) continue; // 속은 비우고 겉면만
        const seed = random();
        add([x0 + x, y0 + y, z0 + z], blue((edge >= 2 ? 1.6 : 1.1) * dim), edge >= 2 ? 0.6 : 0,
          seconds => ({ light: 0.75 + 0.25 * Math.sin(seconds * 1.7 + seed * 40) }));
      }
    }
  } else if (type === 'seep') {
    // 흙 물기: 기지 둘레 넓은 땅(반지름 r) 여기저기의 작은 땅(patches 곳)에서 물방울이 흙 위로 솟아올라,
    // 낮게 떠서 장치 쪽으로 모여든다. 한 곳에서 많이가 아니라 여러 곳에서 조금씩이 보이게 한다
    const n = patches ?? 6;
    for (let k = 0; k < n; k++) {
      const a = (k + 0.2 + random() * 0.6) / n * Math.PI * 2, d = r * (0.35 + 0.65 * random()), pr = PATCH_R * (0.75 + 0.5 * random());
      const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d;
      // 그 땅의 범위: 바닥에 끊긴 고리(점선)
      const ring = Math.ceil(Math.PI * 2 * pr / 0.02);
      for (let i = 0; i < ring; i++) {
        if (Math.floor(i / 5) % 2) continue;
        const b = i / ring * Math.PI * 2, x = px + Math.cos(b) * pr, z = pz + Math.sin(b) * pr;
        add([x, groundAt(ground, x, z, cy) + 0.02, z], blue(0.8 * dim), 0.6);
      }
      // 물방울 하나는 세로로 선 점 3개 (지형 점과 달리 솟아오르는 모양으로 보인다)
      const count = Math.round(SEEP_DENSITY * Math.PI * pr * pr);
      for (let i = 0; i < count; i++) {
        const b = random() * Math.PI * 2, e = pr * Math.sqrt(random()), phase = random();
        const sx = px + Math.cos(b) * e, sz = pz + Math.sin(b) * e, sy = groundAt(ground, sx, sz, cy);
        const path = arcPath([sx, sy, sz], [cx, cy, cz], ground);
        for (let j = 0; j < 3; j++) add([sx, sy, sz], blue((1.7 - j * 0.45) * dim), 0, seconds => {
          const t = (phase + seconds / SEEP_CYCLE) % 1;
          // 0~0.3: 흙에서 솟아오름, 0.3~1: 낮게 떠서 장치 쪽으로 감
          if (t < 0.3) {
            const rise = t / 0.3;
            return { p: [sx, sy + LIFT * rise - j * 0.035, sz], light: Math.min(1, t / 0.08) };
          }
          const u = (t - 0.3) / 0.7, p = path.at(u);
          return { p: [p[0], p[1] - j * 0.035 * (1 - u), p[2]], light: 0.75 * (1 - u ** 4) };
        });
      }
    }
  } else if (type === 'radiate') {
    // 더운 공기 내보내기: 장치 위로 주황 점이 아지랑이처럼 흔들리며 솟아올라 흩어진다
    const count = Math.round(320 * r);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, d = r * Math.sqrt(random()), phase = random(), wobble = random() * 6.28;
      const sx = cx + Math.cos(a) * d * 0.6, sz = cz + Math.sin(a) * d * 0.6, sy = cy + 0.25 * r;
      add([sx, sy, sz], orange(1.6 * dim), 0.6, seconds => {
        const t = (phase + seconds / 3.2) % 1, sway = Math.sin(seconds * 2.2 + wobble + t * 6) * 0.08 * (0.3 + t);
        return { p: [sx + sway + Math.cos(a) * t * r * 0.5, sy + t * (0.6 + 1.4 * r), sz + Math.sin(a) * t * r * 0.5], light: Math.min(1, t / 0.1) * (1 - t) };
      });
    }
  } else if (type === 'zone') {
    // 구역 고리: 집 둘레에 크림 점선 고리. 그 집의 작은 산소 장치에서 고리 안쪽으로 산소 점이 퍼진다
    const ring = Math.ceil(Math.PI * 2 * r / 0.02);
    for (let i = 0; i < ring; i++) {
      if (Math.floor(i / 6) % 2) continue;
      const a = i / ring * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      add([x, groundAt(ground, x, z, cy) + 0.03, z], cream(1.2 * dim), 0);
    }
    const [ux, uy, uz] = unit, count = Math.round(40 * r * r);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, d = r * (0.3 + 0.65 * Math.sqrt(random())), phase = random(), h = 0.15 + random() * 0.5;
      const tx = cx + Math.cos(a) * d, tz = cz + Math.sin(a) * d;
      add([ux, uy, uz], cream(1.3 * dim), 0, seconds => {
        const t = (phase + seconds / 4) % 1, e = 1 - (1 - t) ** 2;
        return { p: [lerp(ux, tx, e), lerp(uy + 0.2, groundAt(ground, tx, tz, cy) + h, e), lerp(uz, tz, e)], light: Math.min(1, t / 0.1) * (1 - t) };
      });
    }
  } else if (type === 'room') {
    // 집 안 공기: 집 안을 채운 점. 더우면(hot) 주황 점이 빠르게 솟구치며 아른거리고, 시원하면(cool) 파랑 점이 천천히 가라앉는다
    const hot = air === 'hot', height = Math.max(0.3, (top ?? cy + 1) - cy) * 0.85, count = Math.round(70 * r * r);
    const color = hot ? orange(1.2) : blueStep(0.6).map(v => v * 1.15);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, d = r * 0.7 * Math.sqrt(random()), phase = random(), wobble = random() * 6.28;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      add([x, cy, z], color, hot ? 0.6 : 0.25, seconds => {
        const t = (phase + seconds / (hot ? 2.2 : 6)) % 1, h = hot ? t : 1 - t;
        const sway = (hot ? 0.06 : 0.02) * Math.sin(seconds * (hot ? 4 : 1) + wobble);
        return { p: [x + sway, cy + 0.05 + h * height, z + sway * 0.7], light: Math.sin(Math.PI * t) * (hot ? 0.9 + 0.1 * Math.sin(seconds * 9 + wobble) : 0.8) };
      });
    }
  }
}
