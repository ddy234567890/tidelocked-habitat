// 임시 얼굴 모델 (실제 모델이 오기 전, 데이터 연결을 확인하는 용도)
// 일부러 ARKit 이름이 아닌 표기(Eye_Blink_L, Jaw_Open …)를 써서 자동 매핑이 실제로 동작하는지도 같이 확인해요.
// 좌우: _L = 얼굴 주인의 왼쪽 (+x, 화면에서는 오른쪽)
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const g2 = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)));
const EYE = { cx: 0.33, cy: 0.115, ax: 0.1, ay: 0.046 };
const MOUTH = { cy: -0.435, ax: 0.095 };
const AMP = 1.6; // 작은 패널에서도 보이게 임시 모델의 표정 폭을 키움

/** 방향(단위벡터)마다 머리 표면까지의 거리 */
function radius(dx, dy, dz) {
  const c = dz > 0 ? 0.93 : 1.02;
  let r = 1 / Math.sqrt((dx / 0.8) ** 2 + dy ** 2 + (dz / c) ** 2);
  r *= 1 - 0.16 * ss(-0.15, -0.85, dy);                       // 턱 쪽으로 좁아짐
  const fw = ss(0.25, 0.7, dz), ax = Math.abs(dx);            // 얼굴 앞면 가중치
  let o = -0.03 * fw * ss(0.3, 0.75, dy);                     // 이마 평평하게
  for (const s of [-1, 1]) {
    o += -0.07 * fw * g2(dx, dy, s * EYE.cx, EYE.cy, 0.12, 0.075);   // 눈구멍
    o += 0.05 * fw * g2(dx, dy, s * 0.30, 0.255, 0.17, 0.04);        // 눈썹뼈
    o += 0.07 * fw * g2(dx, dy, s * 0.085, -0.20, 0.04, 0.035);      // 콧방울
    o += 0.04 * fw * g2(dx, dy, s * 0.36, -0.12, 0.13, 0.12);        // 광대
    o += -0.03 * fw * g2(dx, dy, s * 0.13, MOUTH.cy, 0.025, 0.02);   // 입꼬리
    o += -0.035 * g2(dx, dy, s * 0.6, 0.25, 0.1, 0.15);              // 관자놀이
  }
  const ns = 0.05 + 0.05 * ss(0.1, -0.25, dy);
  o += fw * 0.24 * ss(0.20, -0.20, dy) * (1 - ss(-0.20, -0.27, dy)) * Math.exp(-dx * dx / (2 * ns * ns)); // 코
  o += fw * (0.035 * g2(dx, dy, 0, -0.41, 0.11, 0.02) + 0.035 * g2(dx, dy, 0, -0.462, 0.1, 0.022)
    + 0.07 * g2(dx, dy, 0, -0.72, 0.12, 0.09));                                                       // 입술, 턱끝
  o += 0.09 * Math.exp(-(dz * dz / (2 * 0.07 * 0.07) + (dy - 0.05) ** 2 / (2 * 0.14 * 0.14))) * ss(0.85, 0.97, ax); // 귀
  return r + o;
}
const unit = (x, y) => { const z2 = 1 - x * x - y * y; return [x, y, Math.sqrt(Math.max(0, z2))]; };
const surf = (d, out = 0) => { const r = radius(d[0], d[1], d[2]) + out; return [d[0] * r, d[1] * r, d[2] * r]; };

/** 표면을 따라 미끄러지게 옮기는 변형 (앞면에서만) */
function slide(d, p, ddx, ddy, out) {
  const nd = unit(d[0] + ddx, d[1] + ddy); const t = surf(nd, out);
  return [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
}
function region(cx, cy, sx, sy, ddx, ddy, out) {
  return (d, p) => { if (d[2] < 0.2) return null; const w = g2(d[0], d[1], cx, cy, sx, sy) * ss(0.2, 0.6, d[2]); if (w < 2e-3) return null; return slide(d, p, ddx * w * AMP, ddy * w * AMP, out * w * AMP); };
}
const sum = (...fs) => (d, p) => { let r = null; for (const f of fs) { const v = f(d, p); if (v) { r = r || [0, 0, 0]; r[0] += v[0]; r[1] += v[1]; r[2] += v[2]; } } return r; };

function blink(side) {
  return (d, p) => {
    if (d[2] < 0.3) return null;
    const cx = side * EYE.cx, u = (d[0] - cx) / EYE.ax; if (Math.abs(u) > 1) return null;
    const vt = Math.sqrt(1 - u * u), v = (d[1] - EYE.cy) / EYE.ay;
    let nv, f;
    if (v >= 0) { f = 1 - ss(vt, vt + 1.8, v); nv = v - 1.35 * vt * f; }     // 윗눈꺼풀이 내려와요
    else { f = 1 - ss(vt, vt + 1.2, -v); nv = v + 0.65 * vt * f; }         // 아랫눈꺼풀은 조금 올라와요
    if (vt * f < 1e-4) return null;
    const nd = unit(d[0], EYE.cy + nv * EYE.ay); const t = surf(nd, 0.014 * f);
    return [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
  };
}
// 턱 벌리기: 입선 아래쪽을 턱관절 축으로 돌려요
// 입 안쪽(|x|<입 폭)은 입선에서 바로 1이 되고, 입꼬리 바깥은 점점 넓게 부드럽게 이어져요 → 아랫입술이 늘어나지 않아요
const JAW = { py: -0.22, pz: -0.05, ang: 0.17 };
function jawMask(d) {
  const below = MOUTH.cy - d[1], ax = Math.abs(d[0]), ex = Math.max(0, ax - 0.06);
  const split = ss(-0.001 - 0.45 * ex, 0.003 + 0.6 * ex, below);   // 입꼬리 바깥은 위아래로 넓게 섞어서 주름선이 안 생겨요                 // 입선 위(0) / 아래(1)
  const lens = Math.pow(Math.max(0, 1 - (ax / MOUTH.ax) ** 2), 0.6);  // 가운데는 크게, 입꼬리는 0 → 렌즈 모양으로 벌어져요
  const reach = lens + (1 - lens) * ss(0.0, 0.09 + 0.35 * ex, below); // 아래로 갈수록 턱 전체가 같이
  return split * reach * (1 - ss(0.32, 0.72, ax)) * ss(0.0, 0.35, d[2]);
}
function jawRot(p, w) {
  const a = JAW.ang * w, y = p[1] - JAW.py, z = p[2] - JAW.pz;
  const ny = JAW.py + y * Math.cos(a) - z * Math.sin(a), nz = JAW.pz + y * Math.sin(a) + z * Math.cos(a);
  return [0, ny - p[1], nz - p[2]];
}
function jawOpen(d, p) { const w = jawMask(d); return w < 1e-3 ? null : jawRot(p, w); }
const jawSide = (s) => (d) => { const w = jawMask(d); return w < 1e-3 ? null : [0.035 * s * w, 0, 0]; };

const TARGETS = [];
for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
  TARGETS.push(
    [`Eye_Blink_${n}`, blink(s)],
    [`Eye_Wide_${n}`, region(s * 0.33, 0.16, 0.09, 0.035, 0, 0.02, 0.003)],
    [`Eye_Squint_${n}`, sum(region(s * 0.33, 0.07, 0.1, 0.03, 0, 0.015, 0.004), region(s * 0.34, -0.02, 0.12, 0.06, 0, 0.012, 0.006))],
    [`Brow_Drop_${n}`, region(s * 0.28, 0.25, 0.13, 0.05, -s * 0.015, -0.025, 0.006)],
    [`Brow_Raise_Outer_${n}`, region(s * 0.42, 0.25, 0.09, 0.05, 0, 0.03, 0)],
    [`Nose_Sneer_${n}`, region(s * 0.085, -0.19, 0.05, 0.05, s * 0.012, 0.012, 0.005)],
    [`Cheek_Squint_${n}`, region(s * 0.36, -0.05, 0.12, 0.08, 0, 0.018, 0.008)],
    [`Mouth_Stretch_${n}`, region(s * 0.14, -0.44, 0.06, 0.05, s * 0.03, -0.01, -0.005)],
    [`Mouth_Frown_${n}`, region(s * 0.14, -0.45, 0.05, 0.05, 0, -0.025, 0)],
    [`Mouth_Press_${n}`, sum(region(s * 0.06, -0.435, 0.08, 0.03, 0, 0, -0.012), region(s * 0.06, -0.40, 0.08, 0.02, 0, -0.006, 0), region(s * 0.06, -0.47, 0.08, 0.02, 0, 0.006, 0))],
    [`Jaw_${n}`, jawSide(s)],
  );
}
TARGETS.push(
  ['Brow_Raise_Inner', sum(region(0.12, 0.26, 0.09, 0.05, 0, 0.035, 0.004), region(-0.12, 0.26, 0.09, 0.05, 0, 0.035, 0.004))],
  ['Cheek_Puff', sum(region(0.33, -0.3, 0.12, 0.12, 0, 0, 0.05), region(-0.33, -0.3, 0.12, 0.12, 0, 0, 0.05))],
  ['Jaw_Open', sum(jawOpen, region(0, -0.40, 0.1, 0.02, 0, 0.006, 0))],
  ['Mouth_Funnel', sum(region(0, -0.435, 0.12, 0.05, 0, 0, 0.035), region(0.13, -0.435, 0.04, 0.04, -0.025, 0, 0), region(-0.13, -0.435, 0.04, 0.04, 0.025, 0, 0))],
);

/** 입 안 메시 (주머니·이·혀) — 아래쪽은 턱과 같은 축으로 회전 */
function createMouthInner() {
  const md = unit(0, MOUTH.cy), mr = radius(...md);
  const lip = [0, md[1] * mr, md[2] * mr];                      // 입선 가운데 피부 위치
  const parts = [];
  const add = (g, color, jawW) => { g = g.index ? g.toNonIndexed() : g; parts.push({ g, color, jawW }); };
  const ell = (sx, sy, sz, cx, cy, cz, ws = 24, hs = 16) => { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(sx, sy, sz); g.translate(cx, cy, cz); return g; };
  const cz = lip[2] - 0.135;                                     // 주머니 중심: 입술 뒤쪽 깊숙이
  add(ell(0.11, 0.075, 0.095, 0, lip[1] - 0.008, cz, 32, 20), [0.20, 0.06, 0.07], (p) => ss(lip[1] + 0.01, lip[1] - 0.03, p[1]));
  add(ell(0.07, 0.016, 0.04, 0, lip[1] + 0.010, lip[2] - 0.055), [0.90, 0.88, 0.83], () => 0);     // 윗니
  add(ell(0.062, 0.011, 0.034, 0, lip[1] - 0.016, lip[2] - 0.066), [0.84, 0.82, 0.76], () => 1);   // 아랫니
  add(ell(0.07, 0.02, 0.065, 0, lip[1] - 0.036, cz + 0.01), [0.55, 0.22, 0.24], () => 1);          // 혀
  let n = 0; for (const q of parts) n += q.g.getAttribute('position').count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), D = new Float32Array(n * 3);
  let o = 0;
  for (const q of parts) {
    const pa = q.g.getAttribute('position'), na = q.g.getAttribute('normal'), lin = q.color.map(v => Math.pow(v, 2.2));
    for (let k = 0; k < pa.count; k++, o++) {
      let p = [pa.getX(k), pa.getY(k), pa.getZ(k)];
      const l = Math.hypot(p[0], p[1], p[2]), lim = radius(p[0] / l, p[1] / l, p[2] / l) - 0.022;   // 피부 밖으로 절대 안 튀어나오게
      if (l > lim) p = p.map(v => v * lim / l);
      P.set(p, o * 3); N.set([na.getX(k), na.getY(k), na.getZ(k)], o * 3); C.set(lin, o * 3);
      const w = q.jawW(p); if (w > 1e-3) D.set(jawRot(p, w), o * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  geo.setAttribute('fxMask', new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // 입 안은 홍조·청색증 효과 없음
  geo.morphTargetsRelative = true;
  const mp = new THREE.BufferAttribute(D, 3); mp.name = 'Jaw_Open';
  geo.morphAttributes.position = [mp];
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));
  m.name = 'MouthInner'; m.updateMorphTargets();
  return m;
}

const SKIN = [0.78, 0.60, 0.50], LIP = [0.66, 0.38, 0.37], BROW = [0.30, 0.24, 0.21], HAIR = [0.16, 0.13, 0.12];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function morphNormals(geo, deltas) {
  const base = geo.getAttribute('normal').array, pos = geo.getAttribute('position').array, idx = geo.index;
  return deltas.map(dl => {
    const t = new THREE.BufferGeometry(); const p = new Float32Array(pos.length);
    for (let i = 0; i < p.length; i++) p[i] = pos[i] + dl[i];
    t.setAttribute('position', new THREE.BufferAttribute(p, 3)); t.setIndex(idx); t.computeVertexNormals();
    const n = t.getAttribute('normal').array, out = new Float32Array(n.length);
    for (let i = 0; i < n.length; i++) out[i] = n[i] - base[i];
    t.dispose(); return out;
  });
}

/** 임시 머리 만들기 → THREE.Group (Head 메시에 블렌드셰이프 27개) */
export function createTempHead({ nu = 192, nv = 150 } = {}) {
  const pos = [], col = [], fx = [], dirs = [];
  for (let j = 0; j <= nv; j++) {
    const ph = (j / nv) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const th = Math.PI + (i / nu) * Math.PI * 2;               // 이음매는 뒤통수에
      const d = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
      dirs.push(d); const p = surf(d); pos.push(...p);
      const [x, y, z] = d, fw = ss(0.1, 0.6, z);
      const lips = fw * Math.max(g2(x, y, 0, -0.405, 0.115, 0.018), g2(x, y, 0, -0.468, 0.1, 0.02));
      const brow = fw * (g2(x, y, 0.30, 0.27, 0.11, 0.016) + g2(x, y, -0.30, 0.27, 0.11, 0.016));
      const hair = ss(0.0, 0.08, y - (0.56 + 0.12 * fw - 0.25 * ss(0.3, 0.9, Math.abs(x)) * (1 - fw) - 0.35 * ss(0.0, -0.8, z)));
      let c = mix(SKIN, LIP, clamp(lips * 1.3, 0, 1)); c = mix(c, BROW, clamp(brow, 0, 0.9)); c = mix(c, HAIR, hair);
      col.push(...c.map(v => Math.pow(v, 2.2)));   // sRGB → 선형
      const flush = clamp(fw * (g2(x, y, 0.35, -0.1, 0.14, 0.12) + g2(x, y, -0.35, -0.1, 0.14, 0.12) + 0.8 * g2(x, y, 0, -0.12, 0.08, 0.12) + 0.4 * g2(x, y, 0, 0.45, 0.3, 0.12)), 0, 1);
      const sweat = clamp((fw * (g2(x, y, 0, 0.42, 0.32, 0.14) + 0.6 * g2(x, y, 0, -0.37, 0.1, 0.03) + 0.5 * g2(x, y, 0, -0.1, 0.07, 0.12)) + 0.6 * (g2(x, y, 0.6, 0.25, 0.1, 0.15) + g2(x, y, -0.6, 0.25, 0.1, 0.15))) * (1 - hair), 0, 1);
      fx.push(flush * (1 - hair), clamp(lips * 1.3, 0, 1), sweat);
    }
  }
  const index = [], row = nu + 1, holeV = new Uint8Array(dirs.length);
  for (let j = 0; j < nv; j++) {
    const yTop = Math.cos((j / nv) * Math.PI), yBot = Math.cos(((j + 1) / nv) * Math.PI);
    const mouthRow = yTop >= MOUTH.cy && yBot < MOUTH.cy;
    for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + row;
      const c = [0, 0, 0]; for (const k of [a, a + 1, b, b + 1]) { c[0] += dirs[k][0] / 4; c[1] += dirs[k][1] / 4; c[2] += dirs[k][2] / 4; }
      if (c[2] > 0) {
        const inEye = [-1, 1].some(s => ((c[0] - s * EYE.cx) / EYE.ax) ** 2 + ((c[1] - EYE.cy) / EYE.ay) ** 2 < 1);
        const inMouth = mouthRow && Math.abs(c[0]) < MOUTH.ax;
        if (inEye || inMouth) { for (const k of [a, a + 1, b, b + 1]) holeV[k] = inEye ? 1 : 2; continue; }      // 눈·입은 구멍
      }
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // 구멍 가장자리 점을 매끈한 곡선 위로 옮겨요 (눈은 아몬드 모양, 입은 거의 닫힌 선)
  const kept = new Uint8Array(dirs.length); for (const k of index) kept[k] = 1;
  const snap = (k, nd) => { dirs[k] = nd; const p = surf(nd); pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2]; };
  for (let k = 0; k < dirs.length; k++) {
    if (!kept[k] || !holeV[k]) continue;
    const d = dirs[k];
    if (holeV[k] === 1) {                       // 눈
      const s = d[0] > 0 ? 1 : -1, u = (d[0] - s * EYE.cx) / EYE.ax, v = (d[1] - EYE.cy) / EYE.ay, l = Math.hypot(u, v) || 1;
      snap(k, unit(s * EYE.cx + (u / l) * EYE.ax, EYE.cy + (v / l) * EYE.ay));
    } else {                                    // 입: 위·아래 입술이 거의 닿게
      const x = clamp(d[0] / MOUTH.ax, -1, 1), gap = 0.004 * Math.sqrt(1 - x * x);
      snap(k, unit(d[0], MOUTH.cy + (d[1] > MOUTH.cy ? gap : -gap)));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('fxMask', new THREE.Float32BufferAttribute(fx, 3));
  geo.setIndex(index); geo.computeVertexNormals();

  const n = dirs.length, deltas = TARGETS.map(([, fn]) => {
    const dl = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const v = fn(dirs[k], [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]); if (v) { dl[k * 3] = v[0]; dl[k * 3 + 1] = v[1]; dl[k * 3 + 2] = v[2]; } }
    return dl;
  });
  const nrm = morphNormals(geo, deltas);
  geo.morphTargetsRelative = true;
  geo.morphAttributes.position = deltas.map((dl, i) => { const a = new THREE.BufferAttribute(dl, 3); a.name = TARGETS[i][0]; return a; });
  geo.morphAttributes.normal = nrm.map((dl, i) => { const a = new THREE.BufferAttribute(dl, 3); a.name = TARGETS[i][0]; return a; });

  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const head = new THREE.Mesh(geo, skinMat); head.name = 'Head';
  const group = new THREE.Group(); group.name = 'TempHead'; group.add(head);

  // 눈알 (흰자·홍채·동공 색)
  for (const s of [1, -1]) {
    const dc = unit(s * EYE.cx, EYE.cy), rs = radius(...dc), R = 0.115;
    const eg = new THREE.SphereGeometry(R, 32, 24); eg.rotateX(Math.PI / 2);   // 극점이 앞(+z)을 보게
    const ec = [], ep = eg.getAttribute('position');
    for (let k = 0; k < ep.count; k++) { const a = Math.acos(clamp(ep.getZ(k) / R, -1, 1)); ec.push(...(a < 0.2 ? [0.02, 0.02, 0.03] : a < 0.42 ? [0.22, 0.30, 0.36] : [0.92, 0.91, 0.88]).map(v => Math.pow(v, 2.2))); }
    eg.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
    const eye = new THREE.Mesh(eg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 }));
    const k = rs - R - 0.006; eye.position.set(dc[0] * k, dc[1] * k, dc[2] * k);
    eye.lookAt(eye.position.clone().add(new THREE.Vector3(...dc))); eye.name = s > 0 ? 'Eye_L' : 'Eye_R';
    group.add(eye);
  }
  // 입 안: 어두운 주머니 + 윗니·아랫니 + 혀를 한 메시로 묶어요.
  // 아래쪽 절반은 Jaw_Open 블렌드셰이프로 턱과 같이 움직여서, 입을 벌려도 속이 비어 보이지 않아요.
  group.add(createMouthInner());
  // 목
  const neckG = new THREE.CylinderGeometry(0.36, 0.42, 0.9, 40, 1, true);
  neckG.setAttribute('color', new THREE.Float32BufferAttribute(new Array(neckG.getAttribute('position').count).fill(SKIN.map(v => Math.pow(v, 2.2))).flat(), 3));
  const neck = new THREE.Mesh(neckG, skinMat); neck.position.set(0, -0.98, -0.08); neck.name = 'Neck';
  group.add(neck);
  return group;
}
export const TEMP_TARGET_NAMES = TARGETS.map(t => t[0]);
