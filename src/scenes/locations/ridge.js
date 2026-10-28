import { temperatureColor, blue } from '../../engine/palette.js';
import { clamp, smoothstep, mulberry32, height, noise, lightOn } from './terrain.js';
import { starDirection, fillStar } from './sky.js';

/**
 * 위치 무대 C: 능선 (고지대)
 *
 * 낮과 밤의 경계에 솟은 좁은 능선과 양쪽 골짜기를 점으로 만든다. 선지 JSON 의 layers.location.ridge 가 부른다.
 *
 *   "ridge": { "label": "능선 (고지대)", "asset": null, "stage": "ridge", "pointSize": 11,
 *              "temperature": [12, 66], "star": { "azimuth": 40, "elevation": 6 } }
 *
 * 무엇이 보이나
 * - 능선은 별과 수직으로 뻗어 있다. 그래서 한쪽 비탈은 별을 마주 보고(낮, 주황), 반대쪽은 능선 그림자에 잠긴다(밤, 파랑).
 *   온도는 능선을 가로지르며 temperature 범위(12~66°C)로 이어지는 그라데이션이고, 빛을 받는 곳은 더 뜨겁다.
 * - 별은 평지·용암동굴과 같은 자리에 낮게 떠 있다 (sky.js). 별이 낮아서 높은 곳(능선 마루)만 빛을 받고 골짜기는 그늘이 진다.
 * - 그늘진 골짜기에는 하얀 얼음 점 무리가 몇 군데 모여 있다.
 * - 자리가 좁다: 능선 마루는 폭이 2 남짓이다. 가운데(0,0)의 마루는 높이 0 으로 맞춰 주거 모듈이 올라설 수 있다.
 *
 * 좌표: across = 별 쪽(+) ↔ 밤 쪽(-) 으로 능선을 가로지르는 방향, along = 능선을 따라가는 방향. 월드 x, z 로 돌려서 쓴다.
 */

const A0 = -3.6; // across 범위 (밤 쪽은 카메라 코앞의 큰 점을 피하려고 짧게)
const A1 = 5.5;
const L0 = -6; // along 범위
const L1 = 6;

// 얼음 무리가 모이는 자리 [across, along, 퍼짐]. 모두 별 반대쪽, 능선 그림자가 드리운 비탈 아래다 (C_ridge 샷에서 보이는 쪽)
const ICE = [
  [-0.7, -1.8, 0.35],
  [-0.8, -0.4, 0.4],
  [-0.65, 0.9, 0.35],
  [-0.85, 2.0, 0.35],
];
const ICE_COLOR = blue(1).map((v) => Math.min(1, v * 1.08)); // 파랑 단계의 맨 끝(가장 옅은 파랑)에서 하양 쪽으로

/**
 * @param {number} count  만들 점 개수 (location 레이어는 30000)
 * @param {object} [def]  JSON 의 layers.location.ridge
 * @returns {{ positions: Float32Array, colors: Float32Array }}
 */
export function buildRidge(count, def = {}) {
  const [tMin, tMax] = def.temperature ?? [12, 66];
  const starDef = def.star ?? {};
  const L = starDirection(starDef);

  const starCount = Math.min(starDef.points ?? 1800, count >> 3);
  const iceCount = Math.round(count * 0.1);
  const terrainCount = count - starCount - iceCount;

  // 별 방향(d)과 그에 수직인 능선 방향(a)
  const lh = Math.hypot(L[0], L[2]);
  const d = [L[0] / lh, L[2] / lh];
  const a = [-d[1], d[0]];
  const toWorld = (across, along) => [across * d[0] + along * a[0], across * d[1] + along * a[1]];

  /** 능선 높이: 골짜기 바닥(가장자리로 갈수록 천천히 올라감) 위에 좁은 능선, 위에 잔 기복 */
  const ridgeHeight = (x, z) => {
    const across = x * d[0] + z * d[1];
    const along = x * a[0] + z * a[1];
    const edge = Math.min(Math.abs(across), A1); // 점이 깔린 범위 밖으로 바닥이 계속 오르면 가상의 벽이 별빛을 가리므로 거기서 멈춘다
    const floor = -1.5 + 0.006 * edge * edge; // 별 쪽으로 가파르게 오르면 자기 둔덕 그림자에 잠기므로 완만하게
    const wobble = 1 + 0.3 * (noise(along * 0.35 + 3, 0.5, 5) * 2 - 1) * smoothstep(1.5, 4, Math.abs(along)); // 가운데는 일정, 멀수록 마루 높이가 물결침
    const crest = 1.5 * Math.exp(-((across / 0.85) ** 2)) * wobble;
    const rough = height(x, z, 0.35, false) * smoothstep(0.3, 1.5, Math.abs(across)); // 마루는 매끈하게
    return floor + crest + rough;
  };

  const rand = mulberry32(20261030);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let n = 0;

  // 1. 능선과 골짜기: 카메라 쪽(-1.6, 3.8 근처)에 점을 더 촘촘히
  while (n < terrainCount) {
    const across = A0 + (A1 - A0) * rand();
    const along = L0 + (L1 - L0) * rand();
    const [x, z] = toWorld(across, along);
    const dx = x + 1.6;
    const dz = z - 3.8;
    if (rand() > 1 / (1 + (dx * dx + dz * dz) / 110)) continue;

    // 별이 낮아서 능선 그림자가 멀리까지 간다: 좁은 능선을 건너뛰지 않게 촘촘히 걸어 본다
    const { y, lit } = lightOn(ridgeHeight, x, z, L, { reach: 18, grow: 1.04, add: 0.05 });
    // 온도: 능선을 가로지르는 낮↔밤 그라데이션 + 빛을 받으면 더 뜨겁다
    const g = clamp(0.75 * smoothstep(-3.5, 2.5, across) + 0.35 * lit, 0, 1);
    const c = temperatureColor(tMin + (tMax - tMin) * g);
    const b = 0.55 + 0.45 * lit; // 밤 쪽도 파랗게 보일 만큼은 밝게
    positions.set([x, y, z], n * 3);
    colors.set([c[0] * b, c[1] * b, c[2] * b], n * 3);
    n++;
  }

  // 2. 그늘진 골짜기의 얼음: 몇 군데에 하얀 점이 모여 있다
  for (let i = 0; i < iceCount; i++) {
    const [ca, cl, spread] = ICE[Math.floor(rand() * ICE.length)];
    const across = ca + (rand() + rand() + rand() + rand() - 2) * spread * 1.4;
    const along = cl + (rand() + rand() + rand() + rand() - 2) * spread * 1.4;
    const [x, z] = toWorld(across, along);
    const k = 0.85 + 0.15 * rand();
    positions.set([x, ridgeHeight(x, z) + 0.02 + 0.07 * rand(), z], n * 3);
    colors.set([ICE_COLOR[0] * k, ICE_COLOR[1] * k, ICE_COLOR[2] * k], n * 3);
    n++;
  }

  fillStar(positions, colors, n, starCount, starDef, rand);
  return { positions, colors };
}
