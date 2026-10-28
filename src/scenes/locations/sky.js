import { CREAM, AMBER } from '../../engine/palette.js';

/**
 * 고정된 별. 조석 고정 행성이라 하늘은 돌지 않고, 별은 모든 위치 무대에서 같은 방향에 있다 (CLAUDE.md "색과 하늘").
 * 위치 무대를 새로 만들 때는 이 두 함수로 별 방향과 별 점을 그대로 가져다 쓴다.
 */

/**
 * 별 방향 단위벡터. azimuth: 정면(-z)에서 오른쪽(+x)으로 잰 각도(도), elevation: 지평선 위 높이(도).
 * JSON 의 star 값이 없으면 기본값(40°, 7°)이지만, 평지·용암동굴 모두 week1.json 에 같은 값을 적어 둔다.
 */
export function starDirection({ azimuth = 40, elevation = 7 } = {}) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * 별을 이루는 점 무리를 positions/colors 의 start 번째 점부터 count 개 채운다.
 * 가운데는 크림색, 가장자리는 주황으로 번지고, 가운데로 갈수록 점이 촘촘하다.
 * @param {Float32Array} positions
 * @param {Float32Array} colors
 * @param {number} start  채우기 시작할 점 번호 (배열 칸 번호가 아니다)
 * @param {number} count
 * @param {object} starDef  JSON 의 star: { azimuth, elevation, distance?, radius? }
 * @param {() => number} rand  씨앗 난수
 */
export function fillStar(positions, colors, start, count, starDef, rand) {
  const L = starDirection(starDef);
  const dist = starDef.distance ?? 11;
  const radius = starDef.radius ?? 0.9;
  const a = normalize(cross(L, [0, 1, 0]));
  const b = cross(a, L);
  for (let i = 0; i < count; i++) {
    const r = radius * rand() ** 2.4;
    const ang = rand() * Math.PI * 2;
    const u = Math.cos(ang) * r;
    const v = Math.sin(ang) * r;
    const k = r / radius;
    const o = (start + i) * 3;
    for (let j = 0; j < 3; j++) {
      positions[o + j] = L[j] * dist + a[j] * u + b[j] * v;
      colors[o + j] = (CREAM[j] + (AMBER[j] - CREAM[j]) * k * 0.8) * (1 - 0.35 * k);
    }
  }
}

const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const normalize = (p) => {
  const l = Math.hypot(...p) || 1;
  return p.map((c) => c / l);
};
