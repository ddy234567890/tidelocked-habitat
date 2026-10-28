import * as THREE from 'three';

/**
 * 공통 포인트 머티리얼 (카드 e01)
 *
 * 프로젝트의 모든 점은 이 머티리얼 하나만 쓴다 (CLAUDE.md "렌더링" 규칙).
 * 장면·모델별 차이는 새 셰이더를 만들지 말고 아래 attribute/uniform 으로 표현한다.
 * 점 색은 palette.js 의 규칙으로 정해서 aColor 로 넘긴다.
 *
 * 사용법:
 *   import { createPointMaterial, addPointAttributes } from './engine/pointMaterial.js';
 *   import { temperatureColor } from './engine/palette.js';
 *
 *   const geometry = new THREE.BufferGeometry();
 *   geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
 *   addPointAttributes(geometry, { color: colors });   // colors: 점마다 r,g,b (0~1)
 *   const material = createPointMaterial({ size: 3 });
 *   const points = new THREE.Points(geometry, material);
 *
 *   // 매 프레임
 *   material.uniforms.uTime.value = seconds;
 *   material.uniforms.uReveal.value = 0~1;           // 아래→위로 드러나기
 *
 * Attributes (점마다)
 *   position     vec3   위치
 *   aColor       vec3   색 r,g,b 0~1 (palette.js 로 만든다)
 *   aRandom      float  0~1 난수. 반짝임 위상 등에 쓰는 점별 시드
 *   aTarget, aTargetColor  모프 전환 목표 위치·색 (morph.js가 관리)
 *   aShake       float  0~1 떨림 세기. 0(기본)이면 가만히, 1이면 미세하게 떤다 (예: 용암동굴 '무너질 위험' 천장)
 *
 * Uniforms
 *   uTime          초 단위 시간 (반짝임)
 *   uMorph         0 = position, 1 = aTarget. 모프 진행도 (morph.js가 관리)
 *   uScatter       모프 중간에 흩어지는 거리 (월드 단위)
 *   uSize          기본 점 크기 (카메라 거리 1 기준 픽셀)
 *   uPixelRatio    renderer.getPixelRatio()
 *   uReveal        0 = 모두 숨김, 1 = 모두 보임. 아래→위 스캔라인
 *   uRevealMin/Max 스캔라인이 지나가는 월드 y 범위. 기본은 자동: 점 구름의 실제 높이에 맞춘다
 *   uRevealEdge    스캔라인 띠 두께 (월드 단위)
 *   uRevealColor   스캔라인 색 (#8FC1FF)
 *   uTwinkle       반짝임 세기 0~1
 *   uShake         떨림 전체 배율 (기본 1, prefers-reduced-motion 이면 0). aShake 가 있는 점만 움직인다
 *   uOpacity       전체 밝기
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aRandom;
  attribute vec3 aTarget;
  attribute vec3 aTargetColor;
  attribute float aShake;

  uniform float uMorph;
  uniform float uScatter;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTwinkle;
  uniform float uShake;

  varying vec3 vColor;
  varying float vTwinkle;
  varying float vWorldY;

  vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.7, n + 3.1) * vec3(43758.5453, 22578.1459, 19642.3490))) * 2.0 - 1.0;
  }

  void main() {
    // 모프 전환: position → aTarget 보간, 중간에 점마다 다른 방향으로 살짝 흩어졌다 모인다
    vec3 p = mix(position, aTarget, uMorph);
    p += hash3(aRandom * 97.0) * uScatter * sin(uMorph * 3.1415926);

    // 떨림: aShake 가 있는 점만 점마다 다른 위상으로 아주 조금 흔들린다
    p += aShake * uShake * 0.018 * vec3(
      sin(uTime * 47.0 + aRandom * 40.0),
      sin(uTime * 53.0 + aRandom * 71.0),
      sin(uTime * 43.0 + aRandom * 23.0)
    );

    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    // 은은한 반짝임: 점마다 다른 위상과 속도
    float phase = aRandom * 6.2831853;
    float speed = 1.5 + aRandom * 2.0;
    vTwinkle = 1.0 - uTwinkle * 0.5 * (1.0 + sin(uTime * speed + phase));

    // 카메라 거리에 따른 크기 감쇠
    gl_PointSize = uSize * uPixelRatio * (0.85 + 0.3 * vTwinkle) / max(-mvPosition.z, 0.001);

    vColor = mix(aColor, aTargetColor, uMorph);
    vWorldY = worldPos.y;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uReveal;
  uniform float uRevealMin;
  uniform float uRevealMax;
  uniform float uRevealEdge;
  uniform vec3 uRevealColor;
  uniform float uOpacity;

  varying vec3 vColor;
  varying float vTwinkle;
  varying float vWorldY;

  void main() {
    // 둥근 점, 가장자리 부드럽게
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, d);

    // 아래→위 스캔라인 드러내기
    float scanY = mix(uRevealMin - uRevealEdge, uRevealMax + uRevealEdge, uReveal);
    if (vWorldY > scanY) discard;
    float edge = 1.0 - smoothstep(0.0, uRevealEdge, scanY - vWorldY);

    vec3 color = mix(vColor, uRevealColor, edge * 0.7);
    gl_FragColor = vec4(color * (0.6 + 0.4 * vTwinkle), alpha * uOpacity);
  }
`;

/**
 * 공통 포인트 머티리얼을 만든다. 옵션은 모두 생략 가능.
 * @param {object} [opts]
 * @param {number} [opts.size=3]          기본 점 크기
 * @param {number} [opts.pixelRatio]      기본값 window.devicePixelRatio (최대 2)
 * @param {number} [opts.reveal=1]        시작 uReveal 값
 * @param {number} [opts.revealMin]      스캔라인 시작 y. 생략하면 자동 (점 구름 맨 아래)
 * @param {number} [opts.revealMax]       스캔라인 끝 y. 생략하면 자동 (점 구름 맨 위)
 * @param {number} [opts.revealEdge=0.08] 스캔라인 띠 두께
 * @param {number} [opts.twinkle=0.35]    반짝임 세기
 * @param {number} [opts.opacity=1]
 * @returns {THREE.ShaderMaterial}
 */
export function createPointMaterial(opts = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uScatter: { value: 0 },
      uSize: { value: opts.size ?? 3 },
      uPixelRatio: { value: opts.pixelRatio ?? Math.min(window.devicePixelRatio, 2) },
      uReveal: { value: opts.reveal ?? 1 },
      uRevealMin: { value: opts.revealMin ?? -1 },
      uRevealMax: { value: opts.revealMax ?? 1 },
      uRevealEdge: { value: opts.revealEdge ?? 0.08 },
      uRevealColor: { value: new THREE.Color(0x8fc1ff) },
      uTwinkle: { value: opts.twinkle ?? 0.35 },
      uShake: { value: reducedMotion.matches ? 0 : 1 },
      uOpacity: { value: opts.opacity ?? 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // 스캔라인 범위 자동 맞춤: 그리기 직전에 점 구름의 월드 높이를 잰다.
  // 위치가 크게 바뀌면 geometry.boundingBox = null 로 두면 다시 잰다 (morph.js 가 그렇게 한다)
  const autoMin = opts.revealMin === undefined;
  const autoMax = opts.revealMax === undefined;
  if (autoMin || autoMax) {
    const box = new THREE.Box3();
    material.onBeforeRender = (renderer, scene, camera, geometry, object) => {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      box.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
      if (autoMin) material.uniforms.uRevealMin.value = box.min.y;
      if (autoMax) material.uniforms.uRevealMax.value = box.max.y;
    };
  }
  return material;
}

/**
 * 머티리얼이 쓰는 점별 attribute를 geometry에 붙인다.
 * position 은 미리 넣어 두어야 한다. 넘기지 않은 값은 기본값으로 채운다.
 * @param {THREE.BufferGeometry} geometry
 * @param {object} [data]
 * @param {Float32Array} [data.color]   점마다 r,g,b (0~1). 기본은 중간 파랑
 * @param {Float32Array} [data.random]  점마다 0~1. 기본은 Math.random()
 * @param {Float32Array} [data.shake]   점마다 0~1 떨림 세기. 기본은 모두 0 (떨리지 않음)
 */
export function addPointAttributes(geometry, data = {}) {
  const count = geometry.getAttribute('position').count;

  const color = data.color ?? new Float32Array(count * 3).map((_, i) => [0.18, 0.3, 0.74][i % 3]);
  const random = data.random ?? Float32Array.from({ length: count }, Math.random);
  const shake = data.shake ?? new Float32Array(count);

  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(random, 1));
  geometry.setAttribute('aShake', new THREE.BufferAttribute(shake, 1));
  // 모프 목표: 평소엔 지금 모양과 같게 둔다 (morph.js가 전환할 때 바꾼다)
  geometry.setAttribute('aTarget', geometry.getAttribute('position').clone());
  geometry.setAttribute('aTargetColor', new THREE.BufferAttribute(color.slice(), 3));
  return geometry;
}
