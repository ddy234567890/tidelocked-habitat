import { temperatureColor } from '../../engine/palette.js';
import { mulberry32, sunlight } from './terrain.js';
import { starDirection, fillStar } from './sky.js';

/**
 * 위치 무대 A: 평지
 *
 * 넓고 낮은 기복의 지형을 점으로 만든다. 새 셰이더는 만들지 않고, 점 위치와 색(aColor)만 계산해서
 * 공통 포인트 셰이더에 넘긴다 (CLAUDE.md "렌더링" 규칙). 선지 JSON 의 layers.location.plain 이 이 함수를 부른다.
 *
 *   "plain": { "label": "평지", "asset": null, "stage": "plain", "pointSize": 12,
 *              "temperature": [55, 66], "star": { "azimuth": 40, "elevation": 6 } }
 *
 * - 별은 지평선 위 한 곳에 고정이다 (조석 고정 행성이라 하늘은 돌지 않는다). 위치는 JSON 의 star 값으로만 바뀐다.
 * - 빛은 그 별에서 온다. 별을 향한 비탈은 밝고 뜨겁고, 반대쪽 비탈과 언덕 뒤는 그림자가 져서 어둡고 덜 뜨겁다.
 * - 점 색은 온도(temperature 범위)를 palette.js 의 temperatureColor 로 바꿔서 쓴다: 밝은 곳 66°C 쪽 주황, 그림자 55°C 쪽.
 * - 같은 값이면 늘 같은 지형이다 (난수 씨앗 고정). 팀원 화면이 모두 같게 보인다.
 * - 땅 모양과 빛 계산은 terrain.js, 별은 sky.js 를 다른 위치 무대(용암동굴 등)와 함께 쓴다.
 *
 * 좌표: 카메라가 보는 쪽이 -z, 오른쪽이 +x, 위가 +y. 가운데(0,0) 둘레는 주거 모듈이 놓일 자리라 편평하게 둔다.
 */

// 지형이 깔리는 범위 (월드 단위)
const X0 = -6;
const X1 = 6;
const Z0 = -8;
const Z1 = 3;

/**
 * @param {number} count  만들 점 개수 (location 레이어는 30000)
 * @param {object} [def]  JSON 의 layers.location.plain
 * @returns {{ positions: Float32Array, colors: Float32Array }}
 */
export function buildPlain(count, def = {}) {
  const [tMin, tMax] = def.temperature ?? [55, 66];
  const starDef = def.star ?? {};
  const L = starDirection(starDef);
  const starCount = Math.min(starDef.points ?? 2200, count >> 3);
  const terrainCount = count - starCount;

  const rand = mulberry32(20261028);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  // 가까운 곳에 점을 더 촘촘히: 카메라 앞쪽(-2, 4 근처)에서 멀수록 드물게 뽑는다.
  // 먼 땅은 화면에서 좁게 눌려 저절로 빽빽해 보이므로, 그대로 두면 가까운 땅만 성겨 보인다
  let n = 0;
  while (n < terrainCount) {
    const x = X0 + (X1 - X0) * rand();
    const z = Z0 + (Z1 - Z0) * rand();
    const dx = x + 2;
    const dz = z - 4;
    if (rand() > 1 / (1 + (dx * dx + dz * dz) / 49)) continue;

    const { y, lit } = sunlight(x, z, L);
    const c = temperatureColor(tMin + (tMax - tMin) * lit);
    const b = 0.4 + 0.6 * lit;
    positions.set([x, y, z], n * 3);
    colors.set([c[0] * b, c[1] * b, c[2] * b], n * 3);
    n++;
  }

  fillStar(positions, colors, terrainCount, starCount, starDef, rand);
  return { positions, colors };
}
