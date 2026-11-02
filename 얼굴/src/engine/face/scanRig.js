// 블렌드셰이프가 없는 얼굴 스캔에 표정(ARKit 기준 이름)을 자동으로 만들어 넣어요.
// 얼굴 기준점(눈·입·턱 위치)을 받아서, 그 주변 정점을 옮기는 방식이에요. 표정 배합값은 모두 연출값 [GAME].
// 좌표 가정: 정면 +Z, 위 +Y, 얼굴 주인의 왼쪽 +X (화면에서는 오른쪽)
import * as THREE from 'three';
import { CANONICAL } from './blendshapeMap.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const g2 = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)));
const AMP = 2.0; // 작은 패널(점 구름)에서도 표정이 읽히게 폭을 키움

/**
 * 얼굴 기준점. 값은 모델 좌표(불러온 뒤 장면 기준) 그대로예요.
 * @typedef {{nose:number[], eyeL:number[], eyeR:number[], eyeHalf:number[], browY:number,
 *            mouth:number[], mouthHalfW:number, chinY:number, estimated?:boolean}} Landmarks
 */

/** 기준점 파일이 없을 때: 코끝과 머리 폭으로 대략 추정해요 (평균적인 얼굴 비율) */
export function estimateLandmarks(geo) {
  const p = geo.getAttribute('position'), n = p.count;
  geo.computeBoundingBox(); const bb = geo.boundingBox, H = bb.max.y - bb.min.y;
  let ni = 0; for (let i = 1; i < n; i++) if (p.getZ(i) > p.getZ(ni)) ni = i;
  const nose = [p.getX(ni), p.getY(ni), p.getZ(ni)];
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < n; i++) if (Math.abs(p.getY(i) - nose[1]) < 0.03 * H) { x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i)); }
  const E = 0.34 * (x1 - x0), cx = nose[0], eyeY = nose[1] + 0.69 * E;
  return {
    nose, eyeL: [cx + 0.5 * E, eyeY], eyeR: [cx - 0.5 * E, eyeY], eyeHalf: [0.178 * E, 0.068 * E],
    browY: eyeY + 0.22 * E, mouth: [cx, nose[1] - 0.38 * E], mouthHalfW: 0.39 * E, chinY: nose[1] - 1.0 * E, estimated: true,
  };
}

/** 얼굴 좌표: 두 눈 사이 거리 E를 1로, 눈 높이를 0으로 */
function faceFrame(lm) {
  const E = lm.eyeL[0] - lm.eyeR[0], cx = (lm.eyeL[0] + lm.eyeR[0]) / 2, cy = (lm.eyeL[1] + lm.eyeR[1]) / 2;
  const f = (y) => (y - cy) / E;
  return {
    E, cx, cy, nz: lm.nose[2],
    eye: { x: (lm.eyeL[0] - cx) / E, ax: lm.eyeHalf[0] / E, ay: lm.eyeHalf[1] / E },
    brow: f(lm.browY), noseY: f(lm.nose[1]), mouthY: f(lm.mouth[1]), mouthX: (lm.mouth[0] - cx) / E,
    mouthW: lm.mouthHalfW / E, chin: f(lm.chinY), seamAt: null,
  };
}

// 영역 이동: (중심, 퍼짐, 이동량) 모두 E 단위
const region = (cx, cy, sx, sy, dx, dy, dz) => (v) => {
  const w = g2(v.x, v.y, cx, cy, sx, sy) * v.front; if (w < 2e-3) return null;
  return [dx * w * AMP, dy * w * AMP, dz * w * AMP];
};
const sum = (...fs) => (v) => { let r = null; for (const f of fs) { const d = f(v); if (d) { r = r || [0, 0, 0]; r[0] += d[0]; r[1] += d[1]; r[2] += d[2]; } } return r; };

function buildTargets(F) {
  const ex = F.eye.x, ax = F.eye.ax, ay = F.eye.ay, by = F.brow, my = F.mouthY, mx = F.mouthX, mw = F.mouthW;
  const blink = (s) => (v) => {
    if (v.front < 0.2) return null;
    const u = (v.x - s * ex) / (ax * 1.15); if (Math.abs(u) > 1) return null;
    const vt = Math.sqrt(1 - u * u), q = v.y / ay;
    let dq, f;
    if (q >= 0) { f = 1 - ss(vt, vt + 2.2, q); dq = -1.3 * vt * f; }      // 윗눈꺼풀이 내려와요
    else { f = 1 - ss(vt, vt + 1.4, -q); dq = 0.6 * vt * f; }            // 아랫눈꺼풀은 조금 올라와요
    if (vt * f < 1e-4) return null;
    return [0, dq * ay, 0.03 * f * v.front];
  };
  const look = (s, dx, dy) => (v) => {
    if (v.front < 0.2) return null;
    const u = (v.x - s * ex) / ax, q = v.y / ay, r = Math.hypot(u, q);
    const ball = 1 - ss(0.45, 0.95, r);                                        // 눈 틈 안쪽은 통째로
    const lid = dy ? ss(0.8, 1.1, r) * (1 - ss(1.2, 2.6, r)) * (q > 0 ? 0.5 : 0.2) : 0;   // 눈꺼풀은 조금만
    const w = ball + lid; if (w < 1e-3) return null;
    return [dx * ball, dy * w, 0];
  };
  // 턱: 입 아래를 귀 앞쪽 관절 축으로 돌려요. 목은 그대로
  // 입술 사이(갈라 둔 곳)는 아랫입술 전체가 같이 움직여야 벌어져요 → 입 폭 안에서는 경계를 날카롭게
  const jawMask = (v) => {
    const inMouth = (1 - ss(mw * 0.9, mw * 1.3, Math.abs(v.x - mx))) * ss(-1.0, -0.8, v.z);
    const corner = 1 - 0.65 * Math.min(1, ((v.x - mx) / mw) ** 2);     // 입꼬리 쪽은 덜 벌어져서 입 모양이 둥글게
    const below = inMouth * (v.y < (F.seamAt ? F.seamAt(v.x) : my) ? corner : 0) + (1 - inMouth) * ss(my + 0.02, my - 0.08, v.y);
    return below * (1 - ss(0.75, 1.15, Math.abs(v.x - mx))) * ss(F.chin - 0.6, F.chin - 0.1, v.y) * Math.max(inMouth, clamp(v.front * 2));
  };
  const hingeY = -0.3, hingeZ = -1.45;
  const jawOpen = (v) => {
    const w = jawMask(v); if (w < 1e-3) return null;
    const a = 0.17 * w * AMP, y = v.y - hingeY, z = v.z - hingeZ;
    return [0, (y * Math.cos(a) - z * Math.sin(a)) - y, (y * Math.sin(a) + z * Math.cos(a)) - z];
  };
  const jawSide = (s) => (v) => { const w = jawMask(v); return w < 1e-3 ? null : [0.05 * s * w * AMP, 0, 0]; };

  const T = {};
  for (const [s, n] of [[1, 'Left'], [-1, 'Right']]) {
    T['eyeBlink' + n] = blink(s);
    T['eyeWide' + n] = region(s * ex, 0.09, 0.17, 0.05, 0, 0.03, 0.004);
    T['eyeSquint' + n] = sum(region(s * ex, -0.07, 0.18, 0.045, 0, 0.026, 0.004), region(s * (ex + 0.02), -0.22, 0.2, 0.1, 0, 0.02, 0.01));
    T['browDown' + n] = region(s * (ex - 0.08), by, 0.2, 0.08, -s * 0.022, -0.04, 0.01);
    T['browOuterUp' + n] = region(s * (ex + 0.12), by, 0.13, 0.08, 0, 0.045, 0);
    T['noseSneer' + n] = region(s * 0.13, F.noseY + 0.15, 0.08, 0.08, s * 0.018, 0.02, 0.008);
    T['cheekSquint' + n] = region(s * (ex + 0.05), -0.3, 0.18, 0.12, 0, 0.028, 0.012);
    T['mouthStretch' + n] = region(mx + s * mw * 0.92, my, 0.09, 0.08, s * 0.045, -0.015, -0.008);
    T['mouthFrown' + n] = region(mx + s * mw * 0.92, my - 0.02, 0.08, 0.08, 0, -0.04, 0);
    T['mouthPress' + n] = sum(region(mx + s * mw * 0.4, my, 0.13, 0.05, 0, 0, -0.018),
      region(mx + s * mw * 0.4, my + 0.07, 0.13, 0.03, 0, -0.01, 0), region(mx + s * mw * 0.4, my - 0.08, 0.13, 0.03, 0, 0.01, 0));
    T['jaw' + n] = jawSide(s);
    // 시선: 스캔은 눈알이 피부와 한 덩어리라, 눈 틈 안쪽(흰자·홍채)을 통째로 옮겨 눈동자가 움직이는 것처럼 보여요.
    // 위·아래를 볼 땐 윗눈꺼풀도 조금 따라가요. Out = 바깥(그 눈 쪽 귀 방향), In = 코 방향
    T['eyeLookOut' + n] = look(s, s * 0.5 * ax, 0);
    T['eyeLookIn' + n] = look(s, -s * 0.5 * ax, 0);
    T['eyeLookUp' + n] = look(s, 0, 0.5 * ay);
    T['eyeLookDown' + n] = look(s, 0, -0.5 * ay);
  }
  T.browInnerUp = sum(region(0.18, by, 0.13, 0.08, 0, 0.05, 0.004), region(-0.18, by, 0.13, 0.08, 0, 0.05, 0.004));
  T.cheekPuff = sum(region(0.5, my, 0.18, 0.18, 0, 0, 0.07), region(-0.5, my, 0.18, 0.18, 0, 0, 0.07));
  T.jawOpen = sum(jawOpen, region(mx, my + 0.07, 0.15, 0.03, 0, 0.008, 0));
  T.mouthFunnel = sum(region(mx, my, 0.2, 0.08, 0, 0, 0.05), region(mx + mw, my, 0.06, 0.06, -0.035, 0, 0), region(mx - mw, my, 0.06, 0.06, 0.035, 0, 0));
  return T;
}

/**
 * 스캔은 입술이 붙어 있어서 턱을 내려도 입 안이 안 보여요.
 * 입술 사이 홈(안쪽 면)을 찾아 mouthInner(0~1)로 표시해 두면, 턱이 내려가며 이 면이 늘어날 때 어둡게 칠해져 입 안처럼 보여요.
 * 아랫입술이 한 덩어리로 내려가도록 홈 바닥을 따라 가를 선(F.seamAt)도 만들어요.
 */
function markMouth(mesh, F) {
  const g = mesh.geometry, pos = g.getAttribute('position'), n = pos.count;
  const E = F.E, mx = F.cx + F.mouthX * E, my = F.cy + F.mouthY * E, hw = F.mouthW * E;
  const NB = 40, x0 = mx - 1.15 * hw, bw = 2.3 * hw / NB;
  const bin = (x) => Math.floor((x - x0) / bw), near = (y) => Math.abs(y - my) < 0.15 * E;
  // x 구간마다 입술 앞면 높이와, 홈의 가장 깊은 점 높이
  const front = new Array(NB).fill(-Infinity), best = new Array(NB).fill(null);
  for (let i = 0; i < n; i++) { const b = bin(pos.getX(i)); if (b >= 0 && b < NB && near(pos.getY(i))) front[b] = Math.max(front[b], pos.getZ(i)); }
  for (let i = 0; i < n; i++) {
    const b = bin(pos.getX(i)), y = pos.getY(i), z = pos.getZ(i);
    if (b < 0 || b >= NB || Math.abs(y - my) > 0.1 * E || z > front[b] - 0.04 * E || z < front[b] - 0.6 * E) continue;
    if (!best[b] || z < best[b][1]) best[b] = [y, z];
  }
  const raw = best.map(v => v && v[0]);
  for (let b = 0; b < NB; b++) if (raw[b] == null) {   // 빈 구간은 가까운 값으로
    let l = b, r = b; while (l >= 0 && raw[l] == null) l--; while (r < NB && raw[r] == null) r++;
    raw[b] = l >= 0 && r < NB ? (raw[l] + raw[r]) / 2 : l >= 0 ? raw[l] : r < NB ? raw[r] : my;
  }
  const seam = raw.map((_, b) => { const w = raw.slice(Math.max(0, b - 2), b + 3).sort((p, q) => p - q); return w[w.length >> 1]; });
  const at = (arr, x) => { const u = clamp((x - x0) / bw - 0.5, 0, NB - 1), b = Math.floor(u), t = u - b; return arr[b] * (1 - t) + arr[Math.min(NB - 1, b + 1)] * t; };
  F.seamAt = (xf) => (at(seam, F.cx + xf * E) - F.cy) / E;
  const frontF = front.map(v => (Number.isFinite(v) ? v : -1e9));
  const inner = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), b = bin(x);
    if (b < 0 || b >= NB || !near(y)) continue;
    const depth = at(frontF, x) - z;                      // 입술 앞면보다 얼마나 들어갔나
    inner[i] = ss(0.02 * E, 0.06 * E, depth) * (1 - ss(0.5 * E, 0.7 * E, depth))
      * (1 - ss(hw * 0.95, hw * 1.1, Math.abs(x - mx))) * (1 - ss(0.035 * E, 0.06 * E, Math.abs(y - at(seam, x))));
  }
  g.setAttribute('mouthInner', new THREE.BufferAttribute(inner, 1));
}

/**
 * 스캔 메시에 블렌드셰이프 + 효과 영역(fxMask)을 만들어 넣어요.
 * @param {THREE.Mesh} mesh  위치가 장면 좌표로 구워진 메시
 * @param {Landmarks} lm
 */
export function rigScan(mesh, lm) {
  const g = mesh.geometry, pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), n = pos.count;
  const F = faceFrame(lm), E = F.E, T = buildTargets(F);
  markMouth(mesh, F);
  const names = CANONICAL.filter(k => T[k]);
  const deltas = names.map(() => new Float32Array(n * 3));
  const fx = new Float32Array(n * 3), v = { x: 0, y: 0, z: 0, front: 0 };
  for (let i = 0; i < n; i++) {
    v.x = (pos.getX(i) - F.cx) / E; v.y = (pos.getY(i) - F.cy) / E; v.z = (pos.getZ(i) - F.nz) / E;
    // 얼굴 앞면만 (뒤통수·귀 뒤는 움직이지 않게)
    v.front = (nrm ? ss(-0.1, 0.45, nrm.getZ(i)) : 1) * ss(-1.3, -0.8, v.z);
    names.forEach((k, t) => { const d = T[k](v); if (d) { deltas[t][i * 3] = d[0] * E; deltas[t][i * 3 + 1] = d[1] * E; deltas[t][i * 3 + 2] = d[2] * E; } });
    const ax = Math.abs(v.x - F.mouthX), fr = v.front;
    const cheeks = fr * Math.max(g2(Math.abs(v.x), v.y, 0.52, -0.42, 0.17, 0.17), 0.7 * g2(v.x, v.y, 0, F.noseY + 0.1, 0.1, 0.15));
    const lips = fr * (1 - ss(F.mouthW * 0.85, F.mouthW * 1.1, ax)) * (1 - ss(0.09, 0.15, Math.abs(v.y - F.mouthY)));
    const forehead = fr * ss(F.brow + 0.08, F.brow + 0.25, v.y) * (1 - ss(F.brow + 1.0, F.brow + 1.3, v.y)) * (1 - ss(0.6, 0.85, Math.abs(v.x)));
    const temples = fr * g2(Math.abs(v.x), v.y, 0.85, 0.35, 0.12, 0.2);
    fx[i * 3] = Math.max(cheeks, forehead * 0.4);
    fx[i * 3 + 1] = lips;
    fx[i * 3 + 2] = clamp(forehead + 0.6 * temples + 0.5 * g2(v.x, v.y, F.mouthX, F.mouthY + 0.13, 0.25, 0.05) + 0.4 * g2(v.x, v.y, 0, F.noseY + 0.15, 0.08, 0.2));
  }
  g.morphAttributes.position = deltas.map(d => new THREE.BufferAttribute(d, 3));
  g.morphTargetsRelative = true;
  g.setAttribute('fxMask', new THREE.BufferAttribute(fx, 3));
  mesh.updateMorphTargets();
  // updateMorphTargets는 이름을 모르면 숫자로 붙여요 → 기준 이름으로 다시
  mesh.morphTargetDictionary = Object.fromEntries(names.map((k, i) => [k, i]));
  mesh.morphTargetInfluences = new Array(names.length).fill(0);
  mesh.userData.landmarks = lm;
  mesh.userData.faceFrame = F;
  return names;
}
