/**
 * 모프 전환 (카드 e03)
 *
 * 점 구름 하나를 다른 모양으로 바꾼다. 점들이 살짝 흩어졌다가 새 모양으로 모인다.
 * 계산은 공통 포인트 셰이더(pointMaterial.js) 안에서 하고, 여기서는 목표와 진행도만 바꾼다.
 * 두 모양의 점 개수는 같아야 한다 (sampleModel / sampleObject 로 같은 N을 뽑으면 된다).
 *
 * 사용법:
 *   import { createMorph } from './engine/morph.js';
 *
 *   const morph = createMorph(points);                 // points: 공통 머티리얼을 쓰는 THREE.Points
 *   await morph.to(boxPositions);                      // 끝나면 resolve
 *   await morph.to(habitatPositions, { duration: 2.5, scatter: 0.6, temperature: temps });
 *
 * 옵션 (createMorph 기본값, to()마다 바꿀 수 있음)
 *   duration     초 단위 길이 (기본 1.6)
 *   easing       (t) => t 함수 또는 easings 의 이름 (기본 'inOutCubic')
 *   scatter      중간에 흩어지는 거리, 월드 단위 (기본 0.35)
 *   temperature  새 모양의 점별 온도 (생략하면 지금 온도 유지)
 *
 * - 전환 중에 to()를 다시 부르면 지금 보이는 중간 모양에서 새 목표로 이어서 간다.
 * - prefers-reduced-motion 이면 흩어짐 없이 바로 바뀐다.
 */

export const easings = {
  linear: (t) => t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * @param {THREE.Points} points  addPointAttributes 로 attribute 를 붙인 점 구름
 * @param {object} [defaults]    duration, easing, scatter 기본값
 */
export function createMorph(points, defaults = {}) {
  const geometry = points.geometry;
  const uniforms = points.material.uniforms;
  const position = geometry.getAttribute('position');
  const temperature = geometry.getAttribute('temperature');
  const target = geometry.getAttribute('aTarget');
  const targetTemp = geometry.getAttribute('aTargetTemperature');
  const count = position.count;

  // 모양이 바뀌면 원래 경계가 맞지 않으므로 화면 밖 판정을 끈다
  points.frustumCulled = false;

  let frame = 0;
  let finish = null;

  // 지금 보이는 모양(흩어짐 제외)을 새 출발점으로 굳힌다
  function settle() {
    const m = uniforms.uMorph.value;
    if (m === 0) return;
    for (let i = 0; i < count * 3; i++) position.array[i] += (target.array[i] - position.array[i]) * m;
    for (let i = 0; i < count; i++) temperature.array[i] += (targetTemp.array[i] - temperature.array[i]) * m;
    position.needsUpdate = true;
    temperature.needsUpdate = true;
    uniforms.uMorph.value = 0;
  }

  /**
   * @param {Float32Array} positions  길이 N*3 의 새 위치
   * @param {object} [opts]
   * @returns {Promise<void>}
   */
  function to(positions, opts = {}) {
    if (positions.length !== count * 3) {
      throw new Error(`morph.to: 점 개수가 달라요 (지금 ${count}개, 새 모양 ${positions.length / 3}개)`);
    }
    const duration = opts.duration ?? defaults.duration ?? 1.6;
    const scatter = opts.scatter ?? defaults.scatter ?? 0.35;
    const easing = resolveEasing(opts.easing ?? defaults.easing ?? 'inOutCubic');

    cancelAnimationFrame(frame);
    settle();
    finish?.();

    target.array.set(positions);
    target.needsUpdate = true;
    targetTemp.array.set(opts.temperature ?? temperature.array);
    targetTemp.needsUpdate = true;

    return new Promise((resolve) => {
      const done = () => {
        settle();
        uniforms.uScatter.value = 0;
        finish = null;
        resolve();
      };
      finish = resolve;

      if (reducedMotion.matches || duration <= 0) {
        uniforms.uMorph.value = 1;
        done();
        return;
      }

      uniforms.uScatter.value = scatter;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / 1000 / duration, 1);
        uniforms.uMorph.value = easing(t);
        if (t < 1) frame = requestAnimationFrame(step);
        else done();
      };
      frame = requestAnimationFrame(step);
    });
  }

  return {
    to,
    /** 전환 중인지 */
    get running() {
      return finish !== null;
    },
  };
}

function resolveEasing(easing) {
  if (typeof easing === 'function') return easing;
  if (easings[easing]) return easings[easing];
  throw new Error(`morph: 모르는 easing '${easing}' (쓸 수 있는 것: ${Object.keys(easings).join(', ')})`);
}
