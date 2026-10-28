import * as THREE from 'three';
import { easings } from './morph.js';

/**
 * 카메라 프리셋 + 제한된 드래그 (카드 e04)
 *
 * 이름 붙은 카메라 샷을 등록해 두고 goTo(name)으로 부드럽게 옮겨 간다.
 * 사용자는 드래그로 지금 샷 기준으로 자유롭게 둘러볼 수 있고, 손을 떼면 천천히 제자리로 돌아온다.
 * 선지 JSON 의 cameraShot 값이 여기 등록한 샷 이름이다.
 *
 * 사용법:
 *   import { createCameraRig } from './engine/cameraRig.js';
 *
 *   const rig = createCameraRig(camera, renderer.domElement);
 *   rig.addShot('A_overview', { position: [0, 3, 6], target: [0, 0, 0], fov: 45 });
 *   rig.addShot('B_section',  { position: [4, 1, 0], target: [0, -1, 0], fov: 35 });
 *   rig.goTo('A_overview', { instant: true });   // 첫 샷은 바로
 *   await rig.goTo('B_section');                 // 이동이 끝나면 resolve
 *
 *   // 매 프레임 (렌더 직전)
 *   rig.update();
 *
 * 옵션 (createCameraRig)
 *   duration   샷 이동 시간, 초 (기본 1.8)
 *   easing     morph.js 의 easings 이름 또는 함수 (기본 'inOutCubic')
 *   maxAngle   드래그 허용 각도, 도 (기본 없음 = 제한 없이 회전. 숫자를 주면 좌우·상하 ±그 각도까지만)
 *   returnTime 손을 뗀 뒤 제자리로 돌아오는 빠르기, 초 (기본 1.2, 클수록 천천히)
 *
 * - prefers-reduced-motion 이면 샷 이동과 되돌아오기를 바로 한다.
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const DEG = Math.PI / 180;

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} element  드래그를 받을 요소 (보통 renderer.domElement)
 * @param {object} [opts]
 */
export function createCameraRig(camera, element, opts = {}) {
  const duration = opts.duration ?? 1.8;
  const easing = typeof opts.easing === 'function' ? opts.easing : easings[opts.easing ?? 'inOutCubic'];
  const maxAngle = opts.maxAngle == null ? Infinity : opts.maxAngle * DEG;
  const returnTime = opts.returnTime ?? 1.2;

  const shots = new Map();
  // 지금 기준 자세 (샷 사이를 옮겨 가는 중이면 그 중간값)
  const pose = { position: camera.position.clone(), target: new THREE.Vector3(), fov: camera.fov };
  let move = null;
  let current = null;

  // 드래그로 더한 각도 (라디안)
  let yaw = 0;
  let pitch = 0;
  let dragging = null;
  let last = performance.now();

  element.style.touchAction = 'none';
  element.addEventListener('pointerdown', (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    element.setPointerCapture(e.pointerId);
  });
  element.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const speed = 0.3 * DEG; // 1픽셀당 각도
    yaw = THREE.MathUtils.clamp(yaw - (e.clientX - dragging.x) * speed, -maxAngle, maxAngle);
    // 마우스를 위로 끌면 카메라가 아래로 가서 장면을 올려다본다 (팀 요청으로 위아래 반대)
    pitch = THREE.MathUtils.clamp(pitch - (e.clientY - dragging.y) * speed, -maxAngle, maxAngle);
    dragging.x = e.clientX;
    dragging.y = e.clientY;
  });
  const release = (e) => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  /**
   * 샷을 등록한다. 같은 이름이면 덮어쓴다.
   * @param {string} name
   * @param {{ position: number[], target: number[], fov?: number }} shot
   */
  function addShot(name, shot) {
    shots.set(name, {
      position: new THREE.Vector3().fromArray(shot.position),
      target: new THREE.Vector3().fromArray(shot.target),
      fov: shot.fov ?? camera.fov,
    });
  }

  /**
   * 샷으로 이동한다.
   * @param {string} name
   * @param {{ duration?: number, instant?: boolean }} [o]
   * @returns {Promise<void>} 이동이 끝나면 resolve
   */
  function goTo(name, o = {}) {
    const shot = shots.get(name);
    if (!shot) throw new Error(`cameraRig: 등록되지 않은 샷 '${name}' (등록된 샷: ${[...shots.keys()].join(', ')})`);
    current = name;
    move?.resolve();

    const time = o.instant || reducedMotion.matches ? 0 : o.duration ?? duration;
    if (time <= 0) {
      pose.position.copy(shot.position);
      pose.target.copy(shot.target);
      pose.fov = shot.fov;
      move = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      move = {
        from: { position: pose.position.clone(), target: pose.target.clone(), fov: pose.fov },
        to: shot,
        start: performance.now(),
        time,
        resolve,
      };
    });
  }

  const offset = new THREE.Vector3();
  const spherical = new THREE.Spherical();

  /** 매 프레임 렌더 직전에 부른다 */
  function update() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (move) {
      const t = Math.min((now - move.start) / 1000 / move.time, 1);
      const k = easing(t);
      pose.position.lerpVectors(move.from.position, move.to.position, k);
      pose.target.lerpVectors(move.from.target, move.to.target, k);
      pose.fov = THREE.MathUtils.lerp(move.from.fov, move.to.fov, k);
      if (t >= 1) {
        move.resolve();
        move = null;
      }
    }

    // 손을 떼면 드래그 각도가 천천히 0으로 돌아온다 (여러 바퀴 돌렸어도 가까운 쪽으로)
    if (!dragging) {
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const keep = reducedMotion.matches ? 0 : Math.exp(-dt / (returnTime / 3));
      yaw *= keep;
      pitch *= keep;
    }

    // 기준 자세에서 target 을 중심으로 좌우(yaw)·상하(pitch)만큼 돌린 자리에 카메라를 둔다
    offset.subVectors(pose.position, pose.target);
    spherical.setFromVector3(offset);
    spherical.theta += yaw;
    // 상하는 바로 위·바로 아래를 넘지 않게 막고, 막힌 만큼은 쌓아 두지 않는다 (반대로 끌면 바로 돌아오게)
    const basePhi = spherical.phi;
    spherical.phi = THREE.MathUtils.clamp(basePhi + pitch, 0.05, Math.PI - 0.05);
    pitch = spherical.phi - basePhi;
    camera.position.setFromSpherical(spherical).add(pose.target);
    camera.lookAt(pose.target);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    addShot,
    goTo,
    update,
    /** 지금(또는 이동 중인 목적지) 샷 이름 */
    get current() {
      return current;
    },
    /** 등록된 샷 이름 목록 */
    get shotNames() {
      return [...shots.keys()];
    },
  };
}
