import * as THREE from 'three';
import { createPointMaterial, addPointAttributes } from './pointMaterial.js';
import { CREAM } from './palette.js';

/**
 * 파티클 흐름 (카드 e06)
 *
 * 산소·공기·전기가 관이나 경로를 따라 흐르는 점이다. 공통 포인트 셰이더로 그린다.
 * setBroken(t) 로 경로의 t 지점(0 = 시작, 1 = 끝)에서 흐름을 끊을 수 있다.
 * 끊기면 그 지점에 닿은 점은 흩어지며 사라지고, 그 뒤쪽은 남은 점이 빠져나간 뒤 비어 버린다.
 *
 * 사용법:
 *   import { createFlow } from './engine/flow.js';
 *   import { CREAM, AMBER } from './engine/palette.js';
 *
 *   const flow = createFlow({
 *     path: [[1.6, 0.2, 0.9], [1.2, 0.8, 0.5], [0, 0.6, 0]],  // 점 배열 또는 THREE.CatmullRomCurve3
 *     color: CREAM,       // 산소 흐름은 크림, 내쉰 공기·끊긴 경고는 AMBER
 *     speed: 0.6,         // 초당 이동 거리 (월드 단위)
 *     count: 600,         // 점 개수
 *   });
 *   scene.add(flow.points);
 *
 *   flow.setBroken(0.5);  // 중간에서 끊기
 *   flow.setBroken(null); // 다시 이어짐
 *
 *   // 매 프레임
 *   flow.update(seconds);
 *
 * 옵션
 *   path    경로 (필수). 점 배열이면 CatmullRomCurve3 로 이어 준다
 *   color   [r, g, b] 0~1. palette.js 의 색을 쓴다 (기본 CREAM)
 *   speed   초당 이동 거리 (기본 0.6)
 *   count   점 개수 (기본 600)
 *   spread  관 굵기, 경로에서 벗어나는 정도 (기본 0.03)
 *   size    점 크기 (기본 7)
 */

export function createFlow(opts) {
  const curve = Array.isArray(opts.path)
    ? new THREE.CatmullRomCurve3(opts.path.map((p) => new THREE.Vector3().fromArray(p)))
    : opts.path;
  const color = opts.color ?? CREAM;
  const speed = opts.speed ?? 0.6;
  const count = opts.count ?? 600;
  const spread = opts.spread ?? 0.03;

  // 경로를 일정한 간격의 점으로 미리 나눠 두고 사이를 보간한다 (매 프레임 계산을 줄인다)
  const STEPS = 256;
  const table = curve.getSpacedPoints(STEPS);
  const length = curve.getLength();

  // 점마다 상태: 경로 위치 u(0~1), 관 안쪽 흔들림, 밝기, 흩어지는 중이면 그 속도와 남은 시간
  const u = new Float32Array(count);
  const offset = new Float32Array(count * 3);
  const shade = new Float32Array(count);
  const scatterVel = new Float32Array(count * 3);
  const scatterLife = new Float32Array(count); // 0 이면 경로 위, > 0 이면 흩어지는 중
  for (let i = 0; i < count; i++) {
    u[i] = i / count;
    for (let j = 0; j < 3; j++) offset[i * 3 + j] = (Math.random() - 0.5) * 2 * spread;
    shade[i] = 0.45 + 0.55 * Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  addPointAttributes(geometry, { color: colors });
  const position = geometry.getAttribute('position');
  const target = geometry.getAttribute('aTarget'); // 모프를 쓰지 않으므로 position 과 같게 둔다
  const colorAttr = geometry.getAttribute('aColor');
  const targetColor = geometry.getAttribute('aTargetColor');

  // 스캔라인 드러내기 범위를 경로 높이에 맞춘다 (기본 -1~1 밖의 점이 잘리지 않게)
  const bounds = new THREE.Box3().setFromPoints(table);
  const material = createPointMaterial({
    size: opts.size ?? 7,
    twinkle: 0.5,
    revealMin: bounds.min.y - 1,
    revealMax: bounds.max.y + 1,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  let broken = null;
  let last = null;
  const p = new THREE.Vector3();

  function pointAt(t, out) {
    const f = Math.min(Math.max(t, 0), 1) * STEPS;
    const i = Math.min(Math.floor(f), STEPS - 1);
    return out.lerpVectors(table[i], table[i + 1], f - i);
  }

  /** 경로의 t 지점에서 흐름을 끊는다. null 이면 다시 이어진다 */
  function setBroken(t) {
    broken = t == null ? null : Math.min(Math.max(t, 0), 1);
  }

  /** 매 프레임 부른다 */
  function update(seconds) {
    const dt = last === null ? 0 : Math.min(seconds - last, 0.1);
    last = seconds;
    material.uniforms.uTime.value = seconds;
    const du = (speed * dt) / length;

    for (let i = 0; i < count; i++) {
      const k = i * 3;
      let fade = 1;

      if (scatterLife[i] > 0) {
        // 흩어지는 중: 경로를 벗어나 퍼지며 어두워진다. 다 사라지면 시작점에서 다시 흐른다
        scatterLife[i] -= dt;
        for (let j = 0; j < 3; j++) positions[k + j] += scatterVel[k + j] * dt;
        fade = Math.max(scatterLife[i], 0) / 1.2;
        if (scatterLife[i] <= 0) {
          scatterLife[i] = 0;
          u[i] = 0;
        }
      } else {
        const before = u[i];
        u[i] += du;
        if (broken !== null && before < broken && u[i] >= broken) {
          // 끊긴 지점에 닿았다: 흩어지기 시작
          scatterLife[i] = 0.6 + Math.random() * 0.6;
          for (let j = 0; j < 3; j++) scatterVel[k + j] = (Math.random() - 0.5) * 0.8;
          scatterVel[k + 1] += 0.15;
        } else if (u[i] >= 1) {
          // 끝에 닿았다: 시작점으로. 끊겨 있으면 끊긴 곳 뒤쪽은 다시 채워지지 않는다
          u[i] = broken !== null && broken < 1 && before > broken ? 0 : u[i] - 1;
        }
        if (!scatterLife[i]) {
          pointAt(u[i], p);
          positions[k] = p.x + offset[k];
          positions[k + 1] = p.y + offset[k + 1];
          positions[k + 2] = p.z + offset[k + 2];
          // 시작과 끝은 부드럽게 나타나고 사라진다
          fade = Math.min(u[i] / 0.04, (1 - u[i]) / 0.04, 1);
        }
      }

      const b = shade[i] * Math.max(fade, 0);
      for (let j = 0; j < 3; j++) colors[k + j] = color[j] * b;
    }

    target.array.set(positions);
    targetColor.array.set(colors);
    position.needsUpdate = true;
    target.needsUpdate = true;
    colorAttr.needsUpdate = true;
    targetColor.needsUpdate = true;
  }

  function dispose() {
    points.removeFromParent();
    geometry.dispose();
    material.dispose();
  }

  return {
    points,
    update,
    setBroken,
    dispose,
    /** 끊긴 지점 (끊기지 않았으면 null) */
    get broken() {
      return broken;
    },
  };
}
