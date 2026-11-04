// 블렌드셰이프가 없는 얼굴 스캔에 표정(ARKit 기준 이름)을 자동으로 만들어 넣어요.
// 얼굴 기준점(눈·입·턱 위치)을 받아서, 그 주변 정점을 옮기는 방식이에요.
// 표정마다 실제 얼굴 근육(FACS 동작 단위)이 피부를 끄는 방향을 따랐고, 움직이는 양은 연출값 [GAME]이에요.
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


// ── 실측 기준 (얼굴 크기를 mm로 바꿀 때 씀) ──
// E(두 눈 중심 사이)를 성인 평균 동공 간 거리 약 63 mm로 봐요 (추정). 1 mm = MM (E 단위)
const MM = 1 / 63;

/**
 * 이 정점이 아랫입술(턱과 같이 움직임) 쪽인지.
 * 입술 사이 홈 안쪽은 높이만으로 가르면 가운데가 잘못 갈려 뾰족한 조각이 생겨요.
 * 그래서 홈 안쪽 벽은 면이 향하는 방향으로 구분해요: 아래를 보는 면 = 윗입술 안쪽, 위를 보는 면 = 아랫입술 안쪽
 */
function isLower(F, v) {
  const s = F.seamAt ? F.seamAt(v.x) : F.mouthY;
  const inside = Math.abs(v.x - F.mouthX) < F.mouthW * 0.95;   // 입 폭 안 홈에서만 (볼은 높이로)
  if (inside && v.dep > 0.05 && v.dep < 0.45 && Math.abs(v.ny) > 0.25 && Math.abs(v.y - s) < 0.12) return v.ny > 0;
  return v.y < s;
}

// 피부 쪽 보조 변형들
const below = (v, F) => (isLower(F, v) ? 1 : 0);   // 아랫입술 쪽만
const above = (v, F) => 1 - below(v, F);
const masked = (f, m) => (v) => { const k = m(v); if (k < 1e-3) return null; const d = f(v); return d ? [d[0] * k, d[1] * k, d[2] * k] : null; };
/** 주름: 근육이 수축하는 방향과 직각으로 피부가 접혀요. 정점을 앞뒤로 물결치게 밀어서 그림자로 보이게 해요 [GAME] */
const ripple = (cx, cy, sx, sy, axis, lam, amp) => (v) => {
  const w = g2(v.x, v.y, cx, cy, sx, sy) * v.front; if (w < 2e-3) return null;
  const c = axis === 'y' ? v.y - cy : v.x - cx;
  return [0, 0, amp * w * AMP * Math.sin((2 * Math.PI * c) / lam)];
};
/** 눈꼬리 주름(까마귀발): 눈꼬리에서 부채꼴로 퍼지는 줄 */
const crowsFeet = (s, ox, oy, amp) => (v) => {
  const dx = (v.x - ox) * s, dy = v.y - oy, r = Math.hypot(dx, dy); if (dx < -0.02 || r > 0.24) return null;
  const w = ss(0.03, 0.08, r) * (1 - ss(0.14, 0.24, r)) * v.front; if (w < 2e-3) return null;
  return [0, 0, amp * w * AMP * Math.sin(Math.atan2(dy, dx + 0.02) * 9)];
};

// ── 턱 (아래턱뼈) ──
// 귀 앞 턱관절을 축으로 돌아요. 실제로 입을 벌릴 때 처음 20~25 mm는 회전만 하고, 그 뒤로는 관절이 앞으로 미끄러져요.
// → 회전은 jawOpen, 앞으로 미끄러짐은 jawForward로 나눠 두고, 얼굴 제어에서 크게 벌릴 때(AU27)만 jawForward를 더해요.
// jawOpen 1 ≈ 앞니 사이 약 30 mm (성인 최대 약 50~56 mm의 60% 정도, 추정)
const HINGE = { y: -0.3, z: -1.45 };
const JAW_ROT = 0.36;   // rad
function jawRot(v, w) {
  const a = JAW_ROT * w, y = v.y - HINGE.y, z = v.z - HINGE.z;
  return [0, (y * Math.cos(a) - z * Math.sin(a)) - y, (y * Math.sin(a) + z * Math.cos(a)) - z];
}
const jawSlide = (w) => [0, -0.012 * w, 0.05 * w];     // 앞으로 약 3 mm (추정)
const jawSideMove = (s, w) => [0.05 * s * w * AMP, 0, 0];

function buildTargets(F) {
  const ex = F.eye.x, ax = F.eye.ax, ay = F.eye.ay, by = F.brow, my = F.mouthY, mx = F.mouthX, mw = F.mouthW, ny = F.noseY;
  const lo = (f) => masked(f, (v) => below(v, F)), up = (f) => masked(f, (v) => above(v, F));
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
    const ball = 1 - ss(0.45, 0.95, r);
    const lid = dy ? ss(0.8, 1.1, r) * (1 - ss(1.2, 2.6, r)) * (q > 0 ? 0.5 : 0.2) : 0;
    const w = ball + lid; if (w < 1e-3) return null;
    return [dx * ball, dy * w, 0];
  };
  // 아래턱에 붙어 움직이는 범위 (0~1)
  //  - 입 폭 안: 입선 바로 아래 아랫입술은 가운데가 크게, 입꼬리는 0 (렌즈 모양으로 벌어짐). 더 아래 턱끝은 뼈와 함께 통째로
  //  - 입 폭 밖(볼): 입 높이에서 턱 아래쪽까지 길게 점점 늘어나요. 그래야 입꼬리 옆 볼에 꺾인 주름(깨짐)이 안 생겨요
  const jawMask = (v) => {
    const dxu = Math.abs(v.x - mx) / mw, s = F.seamAt ? F.seamAt(v.x) : my, d = s - v.y;
    const inMouth = (1 - ss(0.9, 1.25, dxu)) * ss(-1.0, -0.8, v.z);
    const lens = Math.sqrt(1 - Math.min(1, dxu ** 4));
    const cheekW = ss(-0.03, 0.45, my - v.y);
    const lipW = isLower(F, v) ? lens + (1 - lens) * cheekW : 0;   // 입꼬리 쪽은 볼과 같은 비율로 이어져요
    const b = inMouth * lipW + (1 - inMouth) * cheekW;
    return b * (1 - ss(0.5, 1.35, Math.abs(v.x - mx))) * ss(F.chin - 1.1, F.chin + 0.02, v.y) * Math.max(inMouth, clamp(v.front * 2.5));
  };
  // 턱을 벌릴 때 아랫입술은 뼈처럼 같이 기울지 않아요. 입술은 거의 그대로 서 있는 채로 아래로 내려가고,
  // 안쪽 면은 아랫니를 감싸듯 뒤·아래로 말려요. 통째로 기울이면 입술 윗면(안쪽 점막)이 앞으로 드러나 입술이 두꺼워 보여요.
  const jawOpen = (v) => {
    const w = jawMask(v); if (w < 1e-3) return null;
    const r = jawRot(v, w);
    if (!isLower(F, v)) return r;
    const s = F.seamAt ? F.seamAt(v.x) : my, d = s - v.y;
    const lip = (1 - ss(mw * 0.85, mw * 1.2, Math.abs(v.x - mx))) * (1 - ss(0.08, 0.3, d)) * ss(-1.0, -0.8, v.z);
    if (lip < 1e-3) return r;
    const t = jawRot({ x: v.x, y: s - 0.22, z: v.z }, w);            // 입술 뿌리(턱뼈 위) 한 점이 움직인 만큼만 평행 이동
    const k = lip, roll = lip * ss(0.02, 0.14, v.dep || 0) * w;
    // 입을 벌리면 아랫입술이 아랫니 위로 팽팽하게 늘어나며 얇아져요: 윗가장자리만 조금 더 내려가고, 아래쪽은 그대로
    const thin = lip * (1 - ss(0.0, 0.13, Math.max(0, d))) * w;
    return [r[0] * (1 - k) + t[0] * k, r[1] * (1 - k) + t[1] * k - 0.06 * roll - 0.03 * thin, r[2] * (1 - k) + t[2] * k - 0.035 * roll - 0.006 * thin];
  };

  const T = {};
  for (const [s, n] of [[1, 'Left'], [-1, 'Right']]) {
    const cx = mx + s * mw;                                   // 입꼬리
    T['eyeBlink' + n] = blink(s);
    // AU5 윗눈꺼풀 올림 (눈꺼풀올림근)
    T['eyeWide' + n] = region(s * ex, 0.09, 0.17, 0.05, 0, 0.03, 0.004);
    // AU7 눈꺼풀 조임 (눈둘레근 눈꺼풀 부분): 아랫눈꺼풀이 올라오며 곧게 펴짐
    T['eyeSquint' + n] = sum(region(s * ex, -0.07, 0.18, 0.045, 0, 0.026, 0.004), region(s * (ex + 0.02), -0.22, 0.2, 0.1, 0, 0.02, 0.01));
    // AU4 눈썹 내림 (눈썹주름근·눈살근): 눈썹이 아래·안쪽으로, 미간에 세로 주름, 눈썹 안쪽이 불룩
    T['browDown' + n] = sum(region(s * (ex - 0.08), by, 0.2, 0.08, -s * 0.03, -0.04, 0.01),
      region(s * 0.1, by - 0.02, 0.07, 0.07, -s * 0.012, -0.01, 0.012), ripple(s * 0.07, by + 0.02, 0.05, 0.08, 'x', 0.07, 0.004));
    // AU2 바깥 눈썹 올림 (이마근 바깥 부분): 이마 옆쪽에 가로 주름
    T['browOuterUp' + n] = sum(region(s * (ex + 0.12), by, 0.13, 0.08, 0, 0.045, 0), ripple(s * (ex + 0.05), by + 0.35, 0.16, 0.16, 'y', 0.13, 0.003));
    // AU9 코 찡그림 (윗입술콧방울올림근): 콧방울·윗입술이 올라가고 콧등에 가로 주름
    T['noseSneer' + n] = sum(region(s * 0.13, ny + 0.15, 0.08, 0.08, s * 0.018, 0.02, 0.008), ripple(s * 0.04, -0.2, 0.06, 0.07, 'y', 0.05, 0.003));
    // AU6 볼 올림 (눈둘레근 눈확 부분): 볼이 위로 밀려 아랫눈꺼풀 밑이 불룩해지고 눈꼬리 주름
    T['cheekSquint' + n] = sum(region(s * (ex + 0.05), -0.3, 0.18, 0.12, 0, 0.032, 0.014), region(s * ex, -0.13, 0.13, 0.04, 0, 0.012, 0.008),
      crowsFeet(s, s * (ex + ax + 0.02), 0.0, 0.003));
    // AU10 윗입술 올림 (윗입술올림근): 윗입술 옆쪽이 올라가고 팔자주름이 깊어짐
    T['mouthUpperUp' + n] = sum(up(region(mx + s * mw * 0.45, my + 0.03, 0.12, 0.05, 0, 0.03, 0.006)), region(s * 0.4, my + 0.22, 0.1, 0.12, 0, 0.01, 0.012));
    // AU12 입꼬리 당김 (큰광대근): 입꼬리가 광대 쪽(위·바깥)으로, 볼이 불룩, 팔자주름
    T['mouthSmile' + n] = sum(region(cx, my, 0.09, 0.08, s * 0.04, 0.045, -0.012), region(s * 0.46, my + 0.24, 0.15, 0.14, 0, 0.022, 0.02),
      region(s * ex, -0.15, 0.13, 0.05, 0, 0.008, 0.004));
    // AU14 보조개 (볼근): 입꼬리가 뒤로 조여짐
    T['mouthDimple' + n] = region(cx, my, 0.06, 0.06, s * 0.012, 0, -0.022);
    // AU15 입꼬리 내림 (입꼬리내림근): 입꼬리가 아래로, 입꼬리 아래 턱에 주름이 불룩
    T['mouthFrown' + n] = sum(region(cx, my - 0.02, 0.08, 0.08, 0, -0.04, 0), region(mx + s * (mw + 0.08), my - 0.16, 0.06, 0.1, 0, -0.008, 0.008));
    // AU16 아랫입술 내림 (아랫입술내림근): 아랫입술이 아래·밖으로 뒤집히며 아랫니가 보임
    T['mouthLowerDown' + n] = lo(region(mx + s * mw * 0.4, my - 0.05, 0.14, 0.06, 0, -0.035, 0.012));
    // AU20 입술 늘림 (입꼬리당김근·넓은목근): 입꼬리가 옆으로, 입술이 얇아짐
    T['mouthStretch' + n] = region(cx, my, 0.09, 0.08, s * 0.045, -0.015, -0.008);
    // AU24 입술 누름 (입둘레근): 입술이 서로 눌리며 얇아지고 위아래가 불룩
    T['mouthPress' + n] = sum(region(mx + s * mw * 0.4, my, 0.13, 0.05, 0, 0, -0.018),
      region(mx + s * mw * 0.4, my + 0.07, 0.13, 0.03, 0, -0.01, 0.004), region(mx + s * mw * 0.4, my - 0.08, 0.13, 0.03, 0, 0.01, 0.004));
    T['jaw' + n] = (v) => { const w = jawMask(v); return w < 1e-3 ? null : jawSideMove(s, w); };
    T['eyeLookOut' + n] = look(s, s * 0.5 * ax, 0);
    T['eyeLookIn' + n] = look(s, -s * 0.5 * ax, 0);
    T['eyeLookUp' + n] = look(s, 0, 0.5 * ay);
    T['eyeLookDown' + n] = look(s, 0, -0.5 * ay);
  }
  // AU1 안쪽 눈썹 올림 (이마근 안쪽): 눈썹 안쪽이 올라가고 이마 가운데에 가로 주름
  T.browInnerUp = sum(region(0.18, by, 0.13, 0.08, 0, 0.05, 0.004), region(-0.18, by, 0.13, 0.08, 0, 0.05, 0.004),
    ripple(0, by + 0.38, 0.24, 0.18, 'y', 0.13, 0.0035));
  T.cheekPuff = sum(region(0.5, my, 0.18, 0.18, 0, 0, 0.07), region(-0.5, my, 0.18, 0.18, 0, 0, 0.07));
  // AU26 턱 내림 / AU27 입 크게 벌림
  T.jawOpen = sum(jawOpen, up(region(mx, my + 0.05, 0.18, 0.03, 0, 0.006, 0)));
  T.jawForward = (v) => { const w = jawMask(v); return w < 1e-3 ? null : jawSlide(w); };
  // AU17 턱끝 올림 (턱끝근): 턱끝이 위·앞으로 밀리며 오돌토돌, 아랫입술이 밀려 올라감
  T.mouthShrugLower = sum(region(mx, my - 0.38, 0.2, 0.13, 0, 0.03, 0.022), lo(region(mx, my - 0.06, 0.25, 0.06, 0, 0.02, 0.012)),
    (v) => { const w = g2(v.x, v.y, mx, my - 0.36, 0.13, 0.08) * v.front; return w < 2e-3 ? null : [0, 0, 0.002 * AMP * w * Math.sin(v.x * 90) * Math.sin(v.y * 90)]; });
  T.mouthShrugUpper = up(region(mx, my + 0.04, 0.25, 0.05, 0, 0.012, 0.008));
  // AU28 입술 말아 넣기 (입둘레근)
  T.mouthRollLower = lo(region(mx, my - 0.05, 0.3, 0.05, 0, 0.012, -0.03));
  T.mouthRollUpper = up(region(mx, my + 0.04, 0.3, 0.05, 0, -0.01, -0.03));
  // AU18 입술 내밀기 (입둘레근): 입술이 앞으로, 폭이 좁아짐
  T.mouthPucker = sum(region(mx, my, 0.22, 0.09, 0, 0, 0.04), region(mx + mw, my, 0.07, 0.07, -0.045, 0, 0), region(mx - mw, my, 0.07, 0.07, 0.045, 0, 0));
  // AU22 입술 깔때기
  T.mouthFunnel = sum(region(mx, my, 0.2, 0.08, 0, 0, 0.05), region(mx + mw, my, 0.06, 0.06, -0.035, 0, 0), region(mx - mw, my, 0.06, 0.06, 0.035, 0, 0));
  // AU38 콧구멍 벌림 (코근 날개 부분) — ARKit에는 없는 이름이라 따로 만들어요
  T.nostrilDilate = sum(region(0.13, ny + 0.12, 0.06, 0.06, 0.022, 0.004, 0.004), region(-0.13, ny + 0.12, 0.06, 0.06, -0.022, 0.004, 0.004));
  return T;
}

/**
 * 입술 사이 홈 찾기.
 * 스캔은 입술이 붙어 있어요. x 구간마다 입술 앞면과 홈의 가장 깊은 점을 찾아 "가를 선"(F.seamAt)을 만들고,
 * 홈 안쪽 면(입술 안쪽 점막)은 깊이에 따라 mouthInner(0~1)로 표시해 점막 색을 입혀요.
 */
function markMouth(mesh, F) {
  const g = mesh.geometry, pos = g.getAttribute('position'), n = pos.count;
  const E = F.E, mx = F.cx + F.mouthX * E, my = F.cy + F.mouthY * E, hw = F.mouthW * E;
  const NB = 40, x0 = mx - 1.15 * hw, bw = 2.3 * hw / NB;
  const bin = (x) => Math.floor((x - x0) / bw), near = (y) => Math.abs(y - my) < 0.15 * E;
  const front = new Array(NB).fill(-Infinity), best = new Array(NB).fill(null);
  for (let i = 0; i < n; i++) { const b = bin(pos.getX(i)); if (b >= 0 && b < NB && near(pos.getY(i))) front[b] = Math.max(front[b], pos.getZ(i)); }
  for (let i = 0; i < n; i++) {
    const b = bin(pos.getX(i)), y = pos.getY(i), z = pos.getZ(i);
    if (b < 0 || b >= NB || Math.abs(y - my) > 0.1 * E || z > front[b] - 0.04 * E || z < front[b] - 0.6 * E) continue;
    if (!best[b] || z < best[b][1]) best[b] = [y, z];
  }
  const raw = best.map(v => v && v[0]);
  for (let b = 0; b < NB; b++) if (raw[b] == null) {
    let l = b, r = b; while (l >= 0 && raw[l] == null) l--; while (r < NB && raw[r] == null) r++;
    raw[b] = l >= 0 && r < NB ? (raw[l] + raw[r]) / 2 : l >= 0 ? raw[l] : r < NB ? raw[r] : my;
  }
  const seam = raw.map((_, b) => { const w = raw.slice(Math.max(0, b - 2), b + 3).sort((p, q) => p - q); return w[w.length >> 1]; });
  const at = (arr, x) => { const u = clamp((x - x0) / bw - 0.5, 0, NB - 1), b = Math.floor(u), t = u - b; return arr[b] * (1 - t) + arr[Math.min(NB - 1, b + 1)] * t; };
  F.seamAt = (xf) => (at(seam, F.cx + xf * E) - F.cy) / E;
  const frontF = front.map(v => (Number.isFinite(v) ? v : -1e9));
  F.frontAt = (x) => at(frontF, x);
  const mid = best.slice(NB * 0.35 | 0, NB * 0.65 | 0).filter(Boolean);
  F.grooveZ = mid.length ? mid.reduce((a, v) => a + v[1], 0) / mid.length : Math.max(...front.filter(Number.isFinite)) - 0.15 * E;
  const inner = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), b = bin(x);
    if (b < 0 || b >= NB || !near(y)) continue;
    const depth = at(frontF, x) - z;
    // 얕은 곳 = 입술 안쪽 분홍 점막, 깊은 곳 = 어두운 점막
    inner[i] = ss(0.025 * E, 0.22 * E, depth) * (1 - ss(0.55 * E, 0.75 * E, depth))
      * (1 - ss(hw * 0.95, hw * 1.12, Math.abs(x - mx))) * (1 - ss(0.05 * E, 0.09 * E, Math.abs(y - at(seam, x))));
  }
  g.setAttribute('mouthInner', new THREE.BufferAttribute(inner, 1));
}

/**
 * 입술 사이를 실제로 갈라요.
 * 홈 바닥에서 위(윗입술)·아래(아랫입술)를 잇는 삼각형만 지우고, 갈라진 가장자리는 들쭉날쭉하지 않게 고르게 펴요.
 * 이 가장자리는 홈 가장 깊은 곳이라 앞에서는 입술 안쪽 면 뒤에 숨어요.
 */
function cutSeam(mesh, F) {
  const g = mesh.geometry, idx = g.index; if (!idx) return;
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), E = F.E, mx = F.cx + F.mouthX * E, a = idx.array, n = pos.count;
  const side = new Int8Array(n), zone = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const xf = (pos.getX(i) - F.cx) / E, yf = (pos.getY(i) - F.cy) / E;
    const s = F.seamAt(xf), depth = F.frontAt(pos.getX(i)) - pos.getZ(i);
    side[i] = isLower(F, { x: xf, y: yf, ny: nrm ? nrm.getY(i) : 0, dep: depth / E }) ? -1 : 1;
    zone[i] = Math.abs(pos.getX(i) - mx) < F.mouthW * E * 0.88 && Math.abs(yf - s) < 0.12 && depth > 0.04 * E ? 1 : 0;
  }
  const keep = [];
  for (let t = 0; t < a.length; t += 3) {
    const i = a[t], j = a[t + 1], k = a[t + 2];
    const cut = zone[i] && zone[j] && zone[k] && !(side[i] === side[j] && side[j] === side[k]);
    if (!cut) keep.push(i, j, k);
  }
  // 가장자리 찾기 (삼각형 하나만 쓰는 변) → 이웃끼리 평균 내서 매끈하게
  const ek = (p, q) => (p < q ? p * n + q : q * n + p), cnt = new Map();
  for (let t = 0; t < keep.length; t += 3) for (const [p, q] of [[keep[t], keep[t + 1]], [keep[t + 1], keep[t + 2]], [keep[t + 2], keep[t]]]) { const key = ek(p, q); cnt.set(key, (cnt.get(key) || 0) + 1); }
  const nb = new Map();
  for (const [key, c] of cnt) {
    if (c !== 1) continue;
    const p = Math.floor(key / n), q = key % n; if (!zone[p] && !zone[q]) continue;
    (nb.get(p) || nb.set(p, []).get(p)).push(q); (nb.get(q) || nb.set(q, []).get(q)).push(p);
  }
  for (let it = 0; it < 6; it++) {
    const ny = new Map();
    for (const [p, list] of nb) { if (list.length !== 2) continue; ny.set(p, [(pos.getY(list[0]) + pos.getY(list[1])) / 2, (pos.getZ(list[0]) + pos.getZ(list[1])) / 2]); }
    for (const [p, [y, z]] of ny) { pos.setY(p, pos.getY(p) * 0.5 + y * 0.5); pos.setZ(p, pos.getZ(p) * 0.5 + z * 0.5); }
  }
  // 다문 입에서는 위·아래 가장자리가 같은 선에서 만나게 (틈으로 안쪽이 비치지 않게)
  for (const p of nb.keys()) { if (!zone[p]) continue; const s = F.cy + F.seamAt((pos.getX(p) - F.cx) / E) * E, d = Math.abs(pos.getY(p) - s) / E; if (d < 0.03) pos.setY(p, pos.getY(p) * 0.4 + s * 0.6); }
  pos.needsUpdate = true;
  g.setIndex(keep);
}

/** 법선 계산 (블렌드셰이프마다 그림자가 같이 바뀌게) */
function vertexNormals(P, I, out) {
  out.fill(0);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { out[k] += nx; out[k + 1] += ny; out[k + 2] += nz; }
  }
  for (let k = 0; k < out.length; k += 3) { const l = Math.hypot(out[k], out[k + 1], out[k + 2]) || 1; out[k] /= l; out[k + 1] /= l; out[k + 2] /= l; }
  return out;
}

/**
 * 스캔 메시에 블렌드셰이프 + 효과 영역(fxMask) + 입 안을 만들어 넣어요.
 * @param {THREE.Mesh} mesh  위치가 장면 좌표로 구워진 메시
 * @param {Landmarks} lm
 */
export function rigScan(mesh, lm) {
  const g = mesh.geometry, nrm = g.getAttribute('normal');
  const F = faceFrame(lm), E = F.E, T = buildTargets(F);
  markMouth(mesh, F);
  cutSeam(mesh, F);
  const pos = g.getAttribute('position'), n = pos.count;
  const names = CANONICAL.filter(k => T[k]);
  const deltas = names.map(() => new Float32Array(n * 3));
  const fx = new Float32Array(n * 3), v = { x: 0, y: 0, z: 0, front: 0, ny: 0, dep: 0 };
  for (let i = 0; i < n; i++) {
    v.x = (pos.getX(i) - F.cx) / E; v.y = (pos.getY(i) - F.cy) / E; v.z = (pos.getZ(i) - F.nz) / E;
    v.front = (nrm ? ss(-0.1, 0.45, nrm.getZ(i)) : 1) * ss(-1.3, -0.8, v.z);
    v.ny = nrm ? nrm.getY(i) : 0; v.dep = (F.frontAt(pos.getX(i)) - pos.getZ(i)) / E;
    names.forEach((k, t) => { const d = T[k](v); if (d) { deltas[t][i * 3] = d[0] * E; deltas[t][i * 3 + 1] = d[1] * E; deltas[t][i * 3 + 2] = d[2] * E; } });
    const ax = Math.abs(v.x - F.mouthX), fr = v.front;
    const cheeks = fr * Math.max(g2(Math.abs(v.x), v.y, 0.52, -0.42, 0.17, 0.17), 0.7 * g2(v.x, v.y, 0, F.noseY + 0.1, 0.1, 0.15));
    const lips = fr * (1 - ss(F.mouthW * 0.85, F.mouthW * 1.1, ax)) * (1 - ss(0.09, 0.15, Math.abs(v.y - F.mouthY)));
    const forehead = fr * ss(F.brow + 0.08, F.brow + 0.25, v.y) * (1 - ss(F.brow + 1.0, F.brow + 1.3, v.y)) * (1 - ss(0.6, 0.85, Math.abs(v.x)));
    const temples = fr * g2(Math.abs(v.x), v.y, 0.85, 0.35, 0.12, 0.2);
    // 열로 붉어지는 곳: 볼·코·이마·귀·목 (얼굴 전체가 붉어지되 볼과 귀가 더 진하게)
    const ears = g2(Math.abs(v.x), v.y, 0.95, -0.05, 0.12, 0.25), neck = ss(F.chin - 0.1, F.chin - 0.5, v.y) * 0.5;
    fx[i * 3] = clamp(Math.max(cheeks, forehead * 0.6, 0.8 * ears, neck, 0.7 * g2(v.x, v.y, 0, F.noseY + 0.05, 0.1, 0.12)));
    fx[i * 3 + 1] = lips;
    fx[i * 3 + 2] = clamp(forehead + 0.8 * temples + 0.6 * g2(v.x, v.y, F.mouthX, F.mouthY + 0.13, 0.25, 0.05) + 0.5 * g2(v.x, v.y, 0, F.noseY + 0.15, 0.08, 0.2) + 0.35 * g2(Math.abs(v.x), v.y, 0.55, -0.3, 0.15, 0.2));   // 땀: 이마·관자놀이·윗입술·코·볼
  }
  // 블렌드셰이프별 법선 변화 (주름·불룩함이 그림자로 보여요)
  const P = pos.array, I = g.index.array, base = vertexNormals(P, I, new Float32Array(n * 3)), tmpP = new Float32Array(n * 3), tmpN = new Float32Array(n * 3);
  const ndeltas = deltas.map(d => {
    for (let k = 0; k < tmpP.length; k++) tmpP[k] = P[k] + d[k];
    vertexNormals(tmpP, I, tmpN);
    const out = new Float32Array(n * 3); for (let k = 0; k < out.length; k++) { const q = tmpN[k] - base[k]; out[k] = Math.abs(q) > 1e-4 ? q : 0; }
    return out;
  });
  // 같은 자리에 겹친 정점(텍스처 이음매)은 법선 변화도 같게 → 이음매에 금이 가 보이지 않게
  { const key = new Map(), q = 1e-4 * E;
    for (let i = 0; i < n; i++) { const k = Math.round(P[i * 3] / q) + ',' + Math.round(P[i * 3 + 1] / q) + ',' + Math.round(P[i * 3 + 2] / q); (key.get(k) || key.set(k, []).get(k)).push(i); }
    const groups = [...key.values()].filter(gp => gp.length > 1);
    for (const d of ndeltas) for (const gp of groups) for (let c = 0; c < 3; c++) { let a = 0; for (const i of gp) a += d[i * 3 + c]; a /= gp.length; for (const i of gp) d[i * 3 + c] = a; } }
  g.morphAttributes.position = deltas.map(d => new THREE.BufferAttribute(d, 3));
  g.morphAttributes.normal = ndeltas.map(d => new THREE.BufferAttribute(d, 3));
  g.morphTargetsRelative = true;
  g.setAttribute('fxMask', new THREE.BufferAttribute(fx, 3));
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = Object.fromEntries(names.map((k, i) => [k, i]));
  mesh.morphTargetInfluences = new Array(names.length).fill(0);
  mesh.userData.landmarks = lm;
  mesh.userData.faceFrame = F;
  if (mesh.parent) for (const m of createMouthInterior(F)) mesh.parent.add(m);
  return names;
}

// ───────────────────────── 입 안 ─────────────────────────
// 실측 참고값 (mm). 출처 없는 값은 "추정"이에요.
//   윗니 가운데 앞니: 길이 9.0 · 폭 8.2 (실측 평균) / 쉴 때 윗입술 아래로 보이는 앞니 약 2.6 (한국인 실측 평균)
//   송곳니 사이 너비: 위 35.4 · 아래 26.9 / 큰어금니 사이: 위 53.8 · 아래 51.7 (실측 평균)
//   나머지 치아 폭·길이, 윗니가 아랫니를 덮는 정도(약 2.5), 앞뒤 차이(약 3), 혀 크기 = 추정
const TEETH_U = [ // [폭, 길이, 두께] mm
  [8.2, 9.0, 7.0], [6.5, 8.0, 6.0], [7.5, 10.0, 8.0], [7.0, 8.0, 9.0], [6.5, 7.5, 9.0], [10.0, 7.0, 11.0], [9.0, 6.5, 10.5]];
const TEETH_L = [
  [5.4, 8.5, 6.0], [5.9, 9.0, 6.2], [6.9, 10.0, 7.5], [7.0, 8.0, 7.5], [7.1, 7.5, 8.0], [11.0, 7.0, 10.5], [10.5, 6.5, 10.0]];
const lin = (c) => c.map(x => Math.pow(x, 2.2));

/** 치열 곡선: z(x) = z0 - a·x² - b·x⁴ (송곳니·큰어금니 위치를 지나게) */
function archCurve(z0, cw, cd, mw, md) {
  const A = [[cw ** 2, cw ** 4], [mw ** 2, mw ** 4]], r = [cd, md];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const a = (r[0] * A[1][1] - A[0][1] * r[1]) / det, b = (A[0][0] * r[1] - r[0] * A[1][0]) / det;
  const z = (x) => z0 - a * x * x - b * x ** 4, dz = (x) => -2 * a * x - 4 * b * x ** 3;
  // 곡선 길이 표 (가운데에서 x까지)
  const xs = [0], ls = [0]; for (let x = 0.002; x < 0.6; x += 0.002) { const d = Math.hypot(0.002, z(x) - z(x - 0.002)); xs.push(x); ls.push(ls[ls.length - 1] + d); }
  const xAt = (l) => { let i = 1; while (i < ls.length - 1 && ls[i] < l) i++; const t = (l - ls[i - 1]) / (ls[i] - ls[i - 1] || 1); return xs[i - 1] + t * (xs[i] - xs[i - 1]); };
  return { z, dz, xAt };
}

/** 둥근 상자(초타원체) 하나를 만들어요: 치아 모양 */
function toothGeo(w, h, t, upper, e = 0.45) {
  const g = new THREE.SphereGeometry(1, 14, 12), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = (q) => Math.sign(q) * Math.pow(Math.abs(q), e);
    x = f(x); y = f(y); z = f(z);
    const edge = upper ? (1 - y) / 2 : (1 + y) / 2;            // 0 = 잇몸 쪽, 1 = 씹는 끝
    z *= 1 - 0.55 * edge;                                        // 끝으로 갈수록 얇아요 (앞니)
    p.setXYZ(i, x * w / 2, y * h / 2, z * t / 2 - t / 2);          // 앞면(z=0)이 치열 곡선에 오게
  }
  g.computeVertexNormals();
  return g;
}

function createMouthInterior(F) {
  const E = F.E, mx = F.mouthX, seam = F.seamAt(mx);
  const toW = (x, y, z) => [F.cx + x * E, F.cy + y * E, F.nz + z * E];
  // 기준 높이·깊이 (E 단위, 코끝 기준 z)
  const grooveZ = (F.grooveZ - F.nz) / E;
  // 다문 입에서는 아랫입술 뒤에 숨도록 입술보다 조금 더 안쪽에 둬요
  const zU = grooveZ - 3.0 * MM, yU = seam - 2.6 * MM;          // 윗니 앞면, 윗니 끝 (쉴 때 윗입술 아래로 약 2.6 mm)
  const zL = zU - 3.0 * MM, yL = yU + 2.5 * MM;                 // 아랫니 앞면, 아랫니 끝 (윗니에 살짝 덮임)
  const archU = archCurve(zU, 17.7 * MM, 9 * MM, 26.9 * MM, 30 * MM);
  const archL = archCurve(zL, 13.4 * MM, 6 * MM, 25.9 * MM, 28 * MM);

  const teeth = { P: [], N: [], C: [], D: [], L: [], R: [], Fw: [] }, soft = { P: [], N: [], C: [], D: [], L: [], R: [], Fw: [] };
  const v = { x: 0, y: 0, z: 0 };
  // 아래턱에 붙은 부분은 턱 블렌드셰이프와 똑같이 움직여요 (jawOpen·jawLeft·jawRight·jawForward)
  function push(buf, p, nrm, col, w) {
    const W = toW(...p); buf.P.push(...W); buf.N.push(...nrm); buf.C.push(...col);
    v.x = p[0]; v.y = p[1]; v.z = p[2];
    const d = w > 1e-3 ? jawRot(v, w) : [0, 0, 0]; buf.D.push(d[0] * E, d[1] * E, d[2] * E);
    const sl = jawSideMove(1, w); buf.L.push(sl[0] * E, 0, 0); buf.R.push(-sl[0] * E, 0, 0);
    const f = jawSlide(w); buf.Fw.push(0, f[1] * E, f[2] * E);
  }
  function addGeo(buf, g, map, w) {   // map(local p, local n) → { p, n, col }
    g = g.index ? g.toNonIndexed() : g;
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) { const r = map([pa.getX(i), pa.getY(i), pa.getZ(i)], [na.getX(i), na.getY(i), na.getZ(i)]); push(buf, r.p, r.n, r.col, typeof w === 'function' ? w(r.p) : w); }
  }
  // 안쪽은 빛이 덜 들어요: 입술에서 멀수록(깊을수록) 어둡게 — 간단한 그늘(AO) [GAME]
  const shade = (z, z0) => 0.95 - 0.75 * ss(0, 0.5, z0 - z);

  // 치아
  const ENAMEL = [0.93, 0.91, 0.86], NECK = [0.86, 0.80, 0.66], TIP = [0.80, 0.83, 0.86];
  for (const [list, arch, y0, upper] of [[TEETH_U, archU, yU, true], [TEETH_L, archL, yL, false]]) {
    for (const s of [1, -1]) {
      let l = 0;
      list.forEach(([wm, hm, tm], k) => {
        const w = wm * MM, h = hm * MM, t = tm * MM;
        const xc = arch.xAt(l + w / 2) * s; l += w + 0.15 * MM;
        const zc = arch.z(Math.abs(xc)), slope = arch.dz(Math.abs(xc)) * s;
        const ang = Math.atan2(-slope, 1);                        // 바깥 방향을 보게 돌려요
        const lift = [0, 0.7, 0.2, 0.8, 1.0, 1.3, 1.6][k] * MM;   // 뒤쪽 치아일수록 끝이 조금 높아요 (추정)
        const yc = upper ? y0 + lift + h / 2 : y0 - lift - h / 2;
        const g = toothGeo(w, h, t, upper, k < 3 ? 0.42 : 0.55);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        addGeo(teeth, g, (p, nn) => {
          const x = p[0] * ca + p[2] * sa, z = -p[0] * sa + p[2] * ca;
          const nx = nn[0] * ca + nn[2] * sa, nz = -nn[0] * sa + nn[2] * ca;
          const P = [xc + x + mx * 0, yc + p[1], zc + z];
          const e = upper ? clamp(0.5 - p[1] / h) : clamp(0.5 + p[1] / h);   // 0 = 잇몸 쪽, 1 = 끝
          let c = e < 0.25 ? mixc(NECK, ENAMEL, e / 0.25) : e > 0.85 ? mixc(ENAMEL, TIP, (e - 0.85) / 0.15) : ENAMEL;
          const sh = shade(P[2], zU) * (k < 3 ? 1 : 0.8);
          return { p: [P[0] + mx, P[1], P[2]], n: [nx, nn[1], nz], col: lin(c.map(q => q * sh)) };
        }, upper ? 0 : 1);
      });
    }
  }
  // 잇몸: 치열 곡선을 따라 띠 모양. 치아 사이로 살짝 내려와요(치간유두)
  const GUM = [0.80, 0.42, 0.45], GUM_D = [0.55, 0.22, 0.26];
  for (const [arch, y0, list, upper] of [[archU, yU, TEETH_U, true], [archL, yL, TEETH_L, false]]) {
    const xs = [], NS = 70; let total = 0; list.forEach(([w]) => { total += (w + 0.15) * MM; });
    const xmax = arch.xAt(total);
    for (let i = 0; i <= NS; i++) xs.push(-xmax + (2 * xmax * i) / NS);
    const rows = 6, gumH = 7 * MM;
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (const x of xs) {
        const ax = Math.abs(x), z = arch.z(ax), sl = arch.dz(ax) * Math.sign(x), nl = Math.hypot(sl, 1);
        const nx = -sl / nl, nz = 1 / nl;
        const crown = 8.5 * MM;
        const scal = 0.6 * MM;
        const u = r / rows, yy = upper ? y0 + crown - scal + u * gumH : y0 - crown + scal - u * gumH;
        const bulge = 0.9 * MM * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 2.5 * MM * ss(0.7, 1, u);   // 위로 갈수록 입술 쪽 홈(구강전정)으로 말려 들어가요
        row.push({ p: [x + nx * (0.4 * MM + bulge) + mx, yy, z + nz * (0.4 * MM + bulge)], n: [nx, upper ? 0.3 : -0.3, nz], u });
      }
      grid.push(row);
    }
    for (let r = 0; r < rows; r++) for (let i = 0; i < xs.length - 1; i++) {
      const q = [grid[r][i], grid[r + 1][i], grid[r][i + 1], grid[r][i + 1], grid[r + 1][i], grid[r + 1][i + 1]];
      for (const o of q) { const c = mixc(GUM, GUM_D, o.u), sh = shade(o.p[2], zU); push(soft, o.p, o.n, lin(c.map(t => t * sh)), upper ? 0 : 1); }
    }
  }
  // 혀: 아랫니 안쪽 바닥에 놓여요. 가운데에 얕은 고랑
  {
    const hw = 0.29, hh = 0.07, hl = 0.36, cz = zL - 0.12 - hl, cy = yL - 0.11;   // 혀끝은 아랫앞니 안쪽, 윗면은 아랫니 끝보다 조금 낮게
    const g = new THREE.SphereGeometry(1, 40, 24);
    addGeo(soft, g, (p, nn) => {
      let [x, y, z] = p;
      if (y > 0) y *= 0.55 + 0.45 * (1 - Math.abs(x));             // 위쪽은 납작하게
      y -= 0.18 * Math.exp(-(x * x) / 0.01) * (y > 0 ? 1 : 0);      // 가운데 고랑
      const P = [mx + x * hw, cy + y * hh, cz + z * hl];
      const speck = 0.92 + 0.08 * Math.sin(x * 70) * Math.sin(z * 60);
      const c = mixc([0.78, 0.40, 0.42], [0.55, 0.22, 0.25], clamp(0.5 - z * 0.8)).map(t => t * speck * shade(P[2], zL));
      return { p: P, n: nn, col: lin(c) };
    }, 1);
  }
  // 입 안 공간: 입천장·볼 안쪽·목 쪽을 감싸는 주머니. 위 절반은 고정, 아래 절반은 턱을 따라가요
  {
    const sx = 0.42, sy = 0.24, sz = 0.47, cy = seam - 0.05, cz = zU - 0.06 - sz;
    const g = new THREE.SphereGeometry(1, 48, 32);
    addGeo(soft, g, (p, nn) => {
      const P = [mx + p[0] * sx, cy + p[1] * sy, cz + p[2] * sz];
      const deep = clamp((zU - P[2]) / 0.8);
      const roof = p[1] > 0 ? mixc([0.62, 0.30, 0.33], [0.42, 0.16, 0.19], clamp(Math.abs(p[0]))) : [0.42, 0.14, 0.17];
      const c = mixc(roof, [0.05, 0.01, 0.015], ss(0.15, 0.85, deep));
      return { p: P, n: nn, col: lin(c.map(t => t * 0.8)) };
    }, (P) => ss(seam + 0.01, seam - 0.08, P[1]));
  }
  const make = (buf, name, rough) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.C, 3));
    g.setAttribute('fxMask', new THREE.BufferAttribute(new Float32Array(buf.P.length), 3));   // 홍조·청색증 없음
    g.morphAttributes.position = [buf.D, buf.L, buf.R, buf.Fw].map(d => new THREE.Float32BufferAttribute(d, 3));
    g.morphTargetsRelative = true;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, side: THREE.DoubleSide }));
    m.name = name; m.updateMorphTargets();
    m.morphTargetDictionary = { jawOpen: 0, jawLeft: 1, jawRight: 2, jawForward: 3 }; m.morphTargetInfluences = [0, 0, 0, 0];
    return m;
  };
  return [make(soft, 'MouthInner', 0.5), make(teeth, 'Teeth', 0.25)];
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
