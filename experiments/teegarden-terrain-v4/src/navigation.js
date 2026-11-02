import * as THREE from 'three';
import { PLANET_SUN, planetRadius } from './planet.js';
import { starDirection } from './terrain.js';

// 첨부 이미지의 행성 원판 중심과 반지름을 기준으로 읽은 목표 위치다.
export const PIN_DISK = { plain: [-0.43, 0.52], lavaTube: [-0.30, -0.19] };
export const LOCAL_SCALE = 0.025;
export const LOCAL_VIEWS = {
  plain: [10.8, 12.8, 19.2], ridge: [10.8, 12.8, 19.2], lavaTube: [8.5, 3.6, 18.5],
  // 동굴 안쪽 수평 구간에서 입구 쪽(빛이 드는 쪽)을 바라본다.
  inside: [9.6, -2.6, 0.15], insideTarget: [0.5, -2.9, -0.45]
};
export function siteFrame(name, def) {
  const sun = new THREE.Vector3(PLANET_SUN.x, PLANET_SUN.y, PLANET_SUN.z).normalize();
  const front = new THREE.Vector3(0, 0, 1).addScaledVector(sun, -sun.z).normalize();
  const around = new THREE.Vector3().crossVectors(sun, front).normalize();
  const angle = { plain: 0.58, lavaTube: -0.04, ridge: -0.64 }[name], elevation = Math.sin(9 * Math.PI / 180);
  const normal = PIN_DISK[name] ? pinNormalFromImage(...PIN_DISK[name]) :
    front.multiplyScalar(Math.cos(angle)).addScaledVector(around, Math.sin(angle))
      .multiplyScalar(Math.sqrt(1 - elevation * elevation)).addScaledVector(sun, elevation).normalize();
  const position = normal.clone().multiplyScalar(planetRadius(normal.x, normal.y, normal.z));
  const tangent = sun.clone().addScaledVector(normal, -sun.dot(normal)).normalize();
  const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const localSun = starDirection(def.star), horizontal = Math.hypot(localSun.x, localSun.z);
  const xAxis = tangent.multiplyScalar(localSun.x / horizontal).addScaledVector(side, localSun.z / horizontal);
  const zAxis = new THREE.Vector3().crossVectors(xAxis, normal).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, normal, zAxis));
  return { normal, position, rotation };
}
export function surfacePose(name, info, aspect, section = false, caveInterior = false) {
  const y = name === 'plain' ? 0 : -1.5, inside = name === 'lavaTube' && caveInterior && !section;
  const target = inside ? new THREE.Vector3(...LOCAL_VIEWS.insideTarget) : new THREE.Vector3(0, y, 0);
  const view = section ? new THREE.Vector3(0, y + 1.5, 25) : new THREE.Vector3(...LOCAL_VIEWS[inside ? 'inside' : name]);
  view.sub(target).multiplyScalar(inside ? 1 : Math.max(1, 1.12 / aspect)).add(target);
  const transform = p => p.multiplyScalar(LOCAL_SCALE).applyQuaternion(info.rotation).add(info.position);
  return { position: transform(view), target: transform(target), up: info.normal.clone() };
}
export function pinNormalFromImage(x, y, radius = 8) {
  const reference = new THREE.PerspectiveCamera(43, 820 / 540, 0.01, 200);
  reference.position.set(0, 2, 29); reference.lookAt(-3.2, 0, 0); reference.updateMatrixWorld();
  const center = new THREE.Vector3().project(reference);
  const screenRadius = radius / Math.sqrt(reference.position.lengthSq() - radius * radius) / Math.tan(43 * Math.PI / 360);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(center.x + x * screenRadius / reference.aspect, center.y + y * screenRadius), reference);
  const hit = raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), radius), new THREE.Vector3());
  if (!hit) throw new Error('탐사 지점은 행성 원판 안에 있어야 합니다.');
  return hit.normalize();
}
export function poseQuaternion(position, target, up) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, up));
}
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const FLIGHT_STEPS = 360;
function flightPosition(flight, t) {
  const e = ease(t);
  const arc = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), flight.viewArc, e);
  const distance = Math.exp(Math.log(flight.startDistance) * (1 - e) + Math.log(flight.endDistance) * e);
  // 시선 목표를 중심으로 접근해 동굴 내부 목적점을 지나쳐 역회전하지 않는다.
  const target = flightTarget(flight, t);
  const lift = flight.kind === 'site' ? target.clone().normalize().multiplyScalar(0.18 * Math.sin(Math.PI * e) ** 2) : new THREE.Vector3();
  return target.add(flight.startOffset.clone().applyQuaternion(arc).multiplyScalar(distance)).add(lift);
}
function flightTarget(flight, t) {
  if (flight.kind === 'site') {
    const e = ease(t), arc = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), flight.surfaceArc, e);
    return flight.surfaceStart.clone().applyQuaternion(arc).multiplyScalar(flight.fromTarget.length() * (1 - e) + flight.destination.target.length() * e);
  }
  // 확대가 본격화되기 전에 목표 지점을 화면 중앙에 붙잡는다.
  const progress = flight.returning ? ease(t) : ease(Math.min(1, t / 0.55));
  return flight.fromTarget.clone().lerp(flight.destination.target, progress);
}
export function prepareFlight(flight) {
  if (flight.kind === 'site') {
    flight.surfaceStart = flight.fromTarget.clone().normalize();
    flight.surfaceArc = new THREE.Quaternion().setFromUnitVectors(flight.surfaceStart, flight.destination.target.clone().normalize());
  }
  const startOffset = flight.fromPosition.clone().sub(flight.fromTarget);
  const endOffset = flight.destination.position.clone().sub(flight.destination.target);
  flight.startDistance = startOffset.length(); flight.endDistance = endOffset.length();
  flight.startOffset = startOffset.normalize();
  flight.viewArc = new THREE.Quaternion().setFromUnitVectors(flight.startOffset, endOffset.normalize());
  let orientation = flight.fromQuaternion.clone();
  let forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
  const frames = [orientation.clone()];
  // 시선 변화만큼 축을 조금씩 옮겨 극점에서 카메라가 뒤집히지 않게 한다.
  for (let i = 1; i <= FLIGHT_STEPS; i++) {
    const t = i / FLIGHT_STEPS;
    const next = flightTarget(flight, t).sub(flightPosition(flight, t)).normalize();
    orientation.premultiply(new THREE.Quaternion().setFromUnitVectors(forward, next)).normalize();
    frames.push(orientation.clone()); forward = next;
  }
  const roll = frames[FLIGHT_STEPS].clone().invert().multiply(flight.toQuaternion);
  frames.forEach((q, i) => q.multiply(new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), roll, ease(i / FLIGHT_STEPS))));
  flight.frames = frames;
  return flight;
}
export function flightSample(flight, t) {
  const frame = Math.min(FLIGHT_STEPS - 1, Math.floor(t * FLIGHT_STEPS));
  return {
    position: flightPosition(flight, t), target: flightTarget(flight, t),
    quaternion: new THREE.Quaternion().slerpQuaternions(flight.frames[frame], flight.frames[frame + 1], t * FLIGHT_STEPS - frame)
  };
}
