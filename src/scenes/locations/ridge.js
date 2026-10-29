import { temperatureColor, blue } from '../../engine/palette.js';
import { clamp, smoothstep, mulberry32, height, noise, lightOn } from './terrain.js';
import { starDirection, fillStar } from './sky.js';

/**
 * 위치 무대 C: 능선 (고지대)
 *
 * 낮과 밤의 경계에 길게 뻗은 산등성이를 점으로 만든다. 선지 JSON 의 layers.location.ridge 가 부른다.
 * 모양 기준은 데이터 담당의 「능선 단면 스케치」다 (실제 지형 자료가 아니라 게임 설정).
 *
 *   "ridge": { "label": "능선 (고지대)", "asset": null, "stage": "ridge", "pointSize": 11,
 *              "temperature": [12, 66], "star": { "azimuth": 40, "elevation": 6 } }
 *
 * 단면 (별 쪽 → 밤 쪽)
 *   ② 빛 받는 비탈: 완만하게 내려간다. 비탈 마을이 층층이 놓이는 곳
 *   ① 꼭대기: 뾰족하지 않고 좁고 평평한 띠 (높이 0). 탑형 집·발전 장치 자리
 *   ③ 그늘 비탈: 가파르게 떨어진다. 늘 그늘
 *   ④ 그늘 골짜기: 움푹한 바닥에 얼음이 모여 있다. 히든 "얼음 옆 기지" 자리
 *   그 뒤로 낮은 등줄기 두 개가 흐리게 겹쳐 능선 지대가 길게 이어지는 느낌을 준다.
 *
 * - 능선은 별 방향과 수직으로 뻗는다. 별이 지평선에 낮게 떠 있어서 빛이 거의 옆(수평)에서 들어오고,
 *   빛 받는 비탈과 꼭대기만 밝고(주황), 그늘 비탈과 골짜기는 파란 그늘이다.
 * - 별은 평지·용암동굴과 같은 자리다 (sky.js). 하늘은 돌지 않는다.
 * - 온도 색은 JSON 의 temperature 범위 안에서만 정한다 (새 숫자를 만들지 않는다).
 *
 * 좌표: across = 별 쪽(+) ↔ 밤 쪽(-) 으로 능선을 가로지르는 방향, along = 능선을 따라가는 방향.
 * ridgeFrame() 으로 월드 x, z 와 바꾼다. 주거·산소 장치 자리는 ridgeProfile() 높이에 맞춰 JSON 에 적어 둔다.
 */

const A0 = -6.8; // across 범위 (밤 쪽 끝: 뒤쪽 등줄기까지)
const A1 = 5.2;
const L0 = -5;
const L1 = 7;

const TOP = 0.45; // 꼭대기 평평한 띠의 반폭

// 뒤쪽 낮은 등줄기 [across, 마루 높이, 폭]
const BACK_RIDGES = [
  [-4.6, -0.75, 0.9],
  [-6.2, -1.05, 1.1],
];

// 얼음이 모이는 골짜기 바닥 [across, along, 퍼짐]
const ICE = [
  [-2.15, -2.2, 0.3],
  [-2.2, -0.9, 0.35],
  [-2.1, 0.4, 0.3],
  [-2.25, 1.8, 0.35],
];
const ICE_COLOR = blue(1).map((v) => Math.min(1, v * 1.08)); // 파랑 단계의 맨 끝(가장 옅은 파랑)에서 하양 쪽으로

/**
 * 능선 단면 높이 (across 만의 함수). 꼭대기 띠는 0, 아래로 내려갈수록 음수.
 * @param {number} across  별 쪽(+) ↔ 밤 쪽(-)
 */
export function ridgeProfile(across) {
  if (across >= -TOP && across <= TOP) return 0;
  if (across > TOP) {
    // ② 빛 받는 비탈: 꼭대기 근처는 조금 가파르고 아래로 갈수록 완만해진다
    const u = clamp((across - TOP) / (A1 - TOP), 0, 1);
    return -1.9 * Math.pow(u, 0.7);
  }
  // ③ 그늘 비탈(가파름) → ④ 골짜기 바닥 → 뒤쪽으로 다시 오름
  const v = -TOP - across;
  const cliff = -2.05 * smoothstep(0, 1.25, v);
  const rise = 0.75 * smoothstep(2.0, 3.4, v);
  let y = cliff + rise;
  for (const [c, h, w] of BACK_RIDGES) y = Math.max(y, h - 2.2 * ((across - c) / w) ** 2);
  return y;
}

/** across/along ↔ 월드 x, z. 별 방향(d)과 그에 수직인 능선 방향(a) */
export function ridgeFrame(starDef = {}) {
  const L = starDirection(starDef);
  const lh = Math.hypot(L[0], L[2]);
  const d = [L[0] / lh, L[2] / lh];
  const a = [-d[1], d[0]];
  return {
    L,
    toWorld: (across, along) => [across * d[0] + along * a[0], across * d[1] + along * a[1]],
    toLocal: (x, z) => [x * d[0] + z * d[1], x * a[0] + z * a[1]],
  };
}

/**
 * @param {number} count  만들 점 개수 (location 레이어는 30000)
 * @param {object} [def]  JSON 의 layers.location.ridge
 * @returns {{ positions: Float32Array, colors: Float32Array }}
 */
export function buildRidge(count, def = {}) {
  const [tMin, tMax] = def.temperature ?? [12, 66];
  const starDef = def.star ?? {};
  const { L, toWorld, toLocal } = ridgeFrame(starDef);

  const starCount = Math.min(starDef.points ?? 1500, count >> 3);
  const iceCount = Math.round(count * 0.08);
  const terrainCount = count - starCount - iceCount;

  /** 땅 높이: 단면 모양 + 능선을 따라 멀리 갈수록 아주 약한 물결 + 비탈의 잔 기복 (꼭대기 띠는 매끈하게) */
  const ridgeHeight = (x, z) => {
    const [across, along] = toLocal(x, z);
    const wave = 0.18 * (noise(along * 0.3 + 3, 0.5, 5) * 2 - 1) * smoothstep(2, 6, Math.abs(along - 1));
    const rough = height(x, z, 0.22, false) * smoothstep(TOP, TOP + 0.8, Math.abs(across));
    return ridgeProfile(across) + wave + rough;
  };

  const rand = mulberry32(20261030);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let n = 0;

  // 1. 능선·골짜기·뒤쪽 등줄기. 카메라는 능선 한쪽 끝(along -) 너머에서 능선을 따라 바라본다
  while (n < terrainCount) {
    const across = A0 + (A1 - A0) * rand();
    const along = L0 + (L1 - L0) * rand();
    // 가까운 쪽은 덜 뽑아서 화면 앞 큰 점을 줄인다, 뒤쪽 등줄기는 흐리게 적게
    const back = across < -3.6;
    if (rand() > (back ? 0.45 : 1) * smoothstep(-6, -1, along) + 0.15) continue;

    const [x, z] = toWorld(across, along);
    // 별이 낮아서 능선 그림자가 멀리까지 간다: 좁은 능선을 건너뛰지 않게 촘촘히 걸어 본다
    const { y, lit } = lightOn(ridgeHeight, x, z, L, { reach: 18, grow: 1.04, add: 0.05 });
    // 온도: 능선을 가로지르는 낮↔밤 그라데이션 + 빛을 받으면 더 뜨겁다
    const g = clamp(0.55 * smoothstep(-2.6, 2.5, across) + 0.45 * lit, 0, 1);
    const c = temperatureColor(tMin + (tMax - tMin) * g);
    const b = (0.5 + 0.5 * lit) * (back ? 0.55 : 1); // 밤 쪽도 파랗게 보일 만큼은 밝게, 뒤쪽 등줄기는 흐리게
    positions.set([x, y, z], n * 3);
    colors.set([c[0] * b, c[1] * b, c[2] * b], n * 3);
    n++;
  }

  // 2. 그늘 골짜기 바닥의 얼음: 하얀 점이 몇 군데 모여 있다
  for (let i = 0; i < iceCount; i++) {
    const [ca, cl, spread] = ICE[Math.floor(rand() * ICE.length)];
    const across = ca + (rand() + rand() + rand() + rand() - 2) * spread;
    const along = cl + (rand() + rand() + rand() + rand() - 2) * spread * 1.8;
    const [x, z] = toWorld(across, along);
    const k = 0.85 + 0.15 * rand();
    positions.set([x, ridgeHeight(x, z) + 0.02 + 0.08 * rand(), z], n * 3);
    colors.set([ICE_COLOR[0] * k, ICE_COLOR[1] * k, ICE_COLOR[2] * k], n * 3);
    n++;
  }

  fillStar(positions, colors, n, starCount, starDef, rand);
  return { positions, colors };
}
