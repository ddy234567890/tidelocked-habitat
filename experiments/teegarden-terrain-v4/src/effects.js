import { mulberry32, smooth, clamp } from './terrain.js';
import { blue, cream } from './palette.js';
import * as THREE from 'three';
import { planetRadius } from './planet.js';

export const BACKGROUND_STAR_COUNT = 720;
export const ORBIT_TRAVEL_MS = 2300;
export const SITE_TRAVEL_MS = 1900;
export const ARRIVAL_HOLD_MS = 100;
export const ASSEMBLE_MS = 1050;

// 카메라가 도착하기 전에는 렌더 진행률이 반드시 0이다.
export function transitionTiming(elapsed, kind, reducedMotion = false) {
  const moveMs = reducedMotion ? 80 : kind === 'site' ? SITE_TRAVEL_MS : ORBIT_TRAVEL_MS;
  const holdMs = reducedMotion ? 0 : ARRIVAL_HOLD_MS, renderMs = reducedMotion ? 80 : ASSEMBLE_MS;
  const travel = clamp(elapsed / moveMs), render = clamp((elapsed - moveMs - holdMs) / renderMs);
  return { travel, render, phase: travel < 1 ? 'travel' : elapsed < moveMs + holdMs ? 'settle' : render < 1 ? 'assemble' : 'done' };
}
// 이동 경로 주변에만 희미한 표면 점을 두어 지역 간 이동 방향을 읽을 수 있게 한다.
export function buildTransitSurface(start, end, count = 3600) {
  const random = mulberry32(91032), a = start.clone().normalize(), b = end.clone().normalize();
  const side = new THREE.Vector3().crossVectors(a, b).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(a, b);
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = random(), offset = (random() - 0.5) * 0.09;
    const q = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), turn, t);
    const normal = a.clone().applyQuaternion(q).addScaledVector(side, offset).normalize();
    normal.multiplyScalar(planetRadius(normal.x, normal.y, normal.z)).toArray(positions, i * 3);
    colors.set(blue(0.3 + random() * 0.25), i * 3);
  }
  return { positions, colors };
}

// 큰 화면 선 대신 모델의 점 자체가 아래에서 위로, 또는 위에서 아래로 채워진다.
export function assemblyBrightness(screenY, progress, direction, seed) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const rank = direction === 'out' ? screenY : 1 - screenY;
  const threshold = clamp(rank * 0.88 + seed * 0.12);
  const reveal = smooth(threshold - 0.035, threshold + 0.035, progress);
  const fringe = Math.max(0, 1 - Math.abs(progress - threshold) / 0.06);
  return reveal * (1 + fringe * 0.45);
}

// 별은 고정된 먼 구면에 둔다. 프레임마다 위치나 난수를 바꾸지 않는다.
export function buildStarfield(count = BACKGROUND_STAR_COUNT) {
  const random = mulberry32(882041), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1, angle = random() * Math.PI * 2;
    const r = 92 + random() * 20, ring = Math.sqrt(1 - y * y);
    positions.set([Math.cos(angle) * ring * r, y * r, Math.sin(angle) * ring * r], i * 3);
    colors.set(random() < 0.3 ? blue(0.5 + random() * 0.35) : cream(0.4 + random() * 0.5), i * 3);
  }
  return { positions, colors };
}
