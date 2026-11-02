// 점 구름(홀로그램) 표현. 얼굴 표면에 고른 간격으로 점을 찍고, 표정 변형을 그대로 따라가요.
//   - 밝기: 한쪽에서 비추는 조명 + 윤곽 빛 (검은 배경 위 흰 점)
//   - 뒤쪽 점은 얼굴 표면이 가려요 (표면은 색 없이 깊이만 그림)
//   - 상태는 표정(블렌드셰이프)으로 보여 주고, 색은 살짝만 [GAME]: 열 = 따뜻한 색, 청색증 = 입술 푸른 색, 창백 = 어둡게
import * as THREE from 'three';

/**
 * @param {THREE.BufferGeometry} src  블렌드셰이프가 들어 있는 얼굴 메시
 * @param {{density?:0|1, map?:THREE.Texture}} o  density 0 = 보통 (약 3만 점), 1 = 촘촘 (약 7만 점)
 *   map: 피부 색 텍스처. 있으면 눈썹·속눈썹·입술처럼 어두운 곳의 점을 어둡게 해서 이목구비가 살아나요
 *   spacing: 점 하나가 맡을 면적(장면 단위). 머리에서 정한 값을 눈알·치아에도 넘겨 같은 간격으로 찍어요
 *   scale: 메시의 장면 배율 (모델 안 좌표 → 장면 단위)
 * 반환값의 userData.spacing = 실제로 쓴 면적
 */
export function buildPointGeometry(src, { density = 1, map = null, spacing = null, scale = 1 } = {}) {
  const pos = src.getAttribute('position'), nrm = src.getAttribute('normal'), fx = src.getAttribute('fxMask');
  const mouth = src.getAttribute('mouthInner'), mo = [0, 0, 0];
  const uv = src.getAttribute('uv'), col = src.getAttribute('color'), tex = map && uv ? readLuma(map) : null;
  const morph = src.morphAttributes.position || [], n = pos.count, idx = src.index ? src.index.array : null;
  const T = idx ? idx.length / 3 : 0;
  // 점 하나 = 삼각형 위 한 자리: 정점 3개 번호 + 무게 2개 (세 번째 무게 = 나머지)
  const smp = [];
  let target = spacing ? spacing / (scale * scale) : 0;
  if (!idx) { for (let i = 0; i < n; i++) smp.push(i, i, i, 1, 0); }
  else {
    // 스캔은 정점이 고르지 않아요 (눈·입술 주변이 볼보다 수백 배 촘촘). 그대로 찍으면 그 자리만 하얗게 뭉치고 볼은 비어요.
    // 그래서 점 하나가 맡을 면적을 정해 두고, 촘촘한 곳은 솎아 내고 성긴 곳은 삼각형 안을 채워요.
    const area = new Float32Array(n), triA = new Float32Array(T), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let total = 0;
    for (let t = 0; t < T; t++) {
      a.fromBufferAttribute(pos, idx[3 * t]); b.fromBufferAttribute(pos, idx[3 * t + 1]); c.fromBufferAttribute(pos, idx[3 * t + 2]);
      const s = b.sub(a).cross(c.sub(a)).length() / 2; triA[t] = s; total += s;
      for (let k = 0; k < 3; k++) area[idx[3 * t + k]] += s / 3;
    }
    if (!target) target = total / (density >= 1 ? 70000 : 30000);   // 점 하나가 맡을 면적
    const share = density >= 1 ? 4 : 1;                              // 정점 하나 몫을 나눠 갖는 점 수 (정점 + 선분 가운데 점)
    // 1) 정점(+ 선분 가운데 점): 스캔의 결을 따라 줄지어 찍혀서 보기 좋아요. 같은 자리는 한 번만 (UV 이음매)
    src.computeBoundingBox(); const q = (src.boundingBox.max.y - src.boundingBox.min.y) * 1e-5 || 1e-6, seen = new Set();
    const add = (i, j) => {
      const k = Math.round((pos.getX(i) + pos.getX(j)) / 2 / q) + ',' + Math.round((pos.getY(i) + pos.getY(j)) / 2 / q) + ',' + Math.round((pos.getZ(i) + pos.getZ(j)) / 2 / q);
      if (seen.has(k)) return; seen.add(k);
      if (Math.random() < (area[i] + area[j]) / 2 / share / target) smp.push(i, j, j, 0.5, 0.5);
    };
    for (let i = 0; i < n; i++) add(i, i);
    if (density >= 1) for (let t = 0; t < T; t++) { const i = idx[3 * t], j = idx[3 * t + 1], k = idx[3 * t + 2]; add(i, j); add(j, k); add(k, i); }
    // 2) 성긴 삼각형 안 채우기
    const base = share * n / T;
    for (let t = 0; t < T; t++) {
      let need = triA[t] / target - base;
      while (need > 0) {
        if (need >= 1 || Math.random() < need) {
          const r = Math.sqrt(Math.random()), r2 = Math.random();
          smp.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2], 1 - r, r * (1 - r2));
        }
        need -= 1;
      }
    }
  }
  const m = smp.length / 5, P = new Float32Array(m * 3), N = new Float32Array(m * 3), X = new Float32Array(m * 3), S = new Float32Array(m), L = new Float32Array(m);
  const M = morph.map(() => new Float32Array(m * 3));
  const nv = new THREE.Vector3(), tuv = [0, 0], tc = [0, 0, 0];
  const mixUV = (j) => {
    const i0 = smp[5 * j], i1 = smp[5 * j + 1], i2 = smp[5 * j + 2], w0 = smp[5 * j + 3], w1 = smp[5 * j + 4], w2 = 1 - w0 - w1;
    tuv[0] = uv.getX(i0) * w0 + uv.getX(i1) * w1 + uv.getX(i2) * w2; tuv[1] = uv.getY(i0) * w0 + uv.getY(i1) * w1 + uv.getY(i2) * w2;
  };
  const mixScalar = (attr, j, out) => {
    const w0 = smp[5 * j + 3], w1 = smp[5 * j + 4];
    out[0] = attr.getX(smp[5 * j]) * w0 + attr.getX(smp[5 * j + 1]) * w1 + attr.getX(smp[5 * j + 2]) * (1 - w0 - w1);
  };
  const mix = (attr, j, out) => {
    const i0 = smp[5 * j], i1 = smp[5 * j + 1], i2 = smp[5 * j + 2], w0 = smp[5 * j + 3], w1 = smp[5 * j + 4], w2 = 1 - w0 - w1;
    // getX/Y/Z: 압축 모델의 섞여 저장된(interleaved) 데이터에서도 동작해요
    out[j * 3] = attr.getX(i0) * w0 + attr.getX(i1) * w1 + attr.getX(i2) * w2;
    out[j * 3 + 1] = attr.getY(i0) * w0 + attr.getY(i1) * w1 + attr.getY(i2) * w2;
    out[j * 3 + 2] = attr.getZ(i0) * w0 + attr.getZ(i1) * w1 + attr.getZ(i2) * w2;
  };
  for (let j = 0; j < m; j++) {
    mix(pos, j, P);
    if (fx) mix(fx, j, X);
    morph.forEach((mt, t) => mix(mt, j, M[t]));
    if (nrm) { mix(nrm, j, N); nv.fromArray(N, j * 3).normalize().toArray(N, j * 3); }
    S[j] = Math.random();
    if (tex) { mixUV(j); L[j] = tex(tuv[0], tuv[1]); }
    else if (col) { mix(col, j, tc); L[j] = 0.3 * tc[0] + 0.59 * tc[1] + 0.11 * tc[2]; }
    else L[j] = 1;
  }
  // 밝기는 피부 기준(가운데 값)에 맞춰 나눠요: 피부 ≈ 1, 눈썹·입술 < 1
  const med = Float32Array.from(L).sort()[m >> 1] || 1;
  for (let j = 0; j < m; j++) L[j] = Math.min(1.3, L[j] / med);
  if (mouth) for (let j = 0; j < m; j++) { mixScalar(mouth, j, mo); L[j] *= 1 - mo[0]; }   // 입술 사이 안쪽(입 안)은 어둡게
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('fxMask', new THREE.BufferAttribute(X, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(S, 1));
  g.setAttribute('aTone', new THREE.BufferAttribute(L, 1));
  if (M.length) { g.morphAttributes.position = M.map(a => new THREE.BufferAttribute(a, 3)); g.morphTargetsRelative = src.morphTargetsRelative; }
  g.boundingSphere = src.boundingSphere || (src.computeBoundingSphere(), src.boundingSphere);
  g.userData.spacing = target * scale * scale;
  return g;
}

/** 텍스처 → (u, v)에서 밝기 0~1을 읽는 함수 (CPU에서 한 번만) */
function readLuma(map) {
  const img = map.image; if (!img || !img.width || map.isCompressedTexture) return null;   // 압축 텍스처(KTX2)는 CPU에서 못 읽어요
  const W = Math.min(1024, img.width), H = Math.min(1024, img.height);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  try { g.drawImage(img, 0, 0, W, H); } catch { return null; }
  const d = g.getImageData(0, 0, W, H).data;
  return (u, v) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.floor((map.flipY ? 1 - v : v) * H)), k = (y * W + x) * 4;
    return (0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]) / 255;
  };
}

const VERT = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
attribute vec3 fxMask;
attribute float aSeed;
attribute float aTone;
uniform float uTone, uPx, uRefDist, uLift, uFlush, uCyan, uPallor;
uniform vec3 uLight;
varying float vB, vA;
varying vec3 vTint;
void main() {
  #include <begin_vertex>
  #include <morphtarget_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec3 V = normalize(-mv.xyz);
  float ndv = dot(n, V);
  // 앞쪽 왼편 조명 + 윤곽 빛. 정면에서 눈·입 굴곡이 잘 보이게
  float ndl = dot(n, uLight);
  float lit = pow(max(ndl, 0.0), 2.2);
  float spec = pow(max(dot(n, normalize(uLight + V)), 0.0), 24.0);
  float rim = pow(1.0 - clamp(ndv, 0.0, 1.0), 4.0) * (0.35 + 0.65 * step(0.0, ndl));
  float b = 0.03 + 1.25 * lit + 0.9 * spec + 0.7 * rim;
  b *= mix(1.0, pow(aTone, 2.6), uTone);
  b *= 1.0 - 0.35 * uPallor;
  vB = b;
  vA = smoothstep(-0.25, 0.1, ndv);
  vTint = mix(vec3(1.0), vec3(1.0, 0.6, 0.42), uFlush * (0.3 + 0.7 * fxMask.r));
  vTint = mix(vTint, vec3(0.45, 0.55, 1.3), uCyan * fxMask.g);
  mv.xyz += V * uLift;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uPx * uRefDist / -mv.z);
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vB, vA;
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.04, r) * vA * uOpacity;
  gl_FragColor = vec4(uColor * vTint * vB * a, 1.0);
}`;

/** 점 구름 재질. 빛이 더해지는 방식이라 검은 배경에서 가장 잘 보여요 */
export function createPointMaterial({ color = 0xe8eeff, size = 1.6, faceSize = 1 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTone: { value: 1 },
      uPx: { value: size }, uRefDist: { value: 1 }, uLift: { value: faceSize * 0.004 },
      uFlush: { value: 0 }, uCyan: { value: 0 }, uPallor: { value: 0 },
      uLight: { value: new THREE.Vector3(-0.55, 0.45, 0.7).normalize() },    // 화면 왼쪽 위 앞에서 비춤 (보는 사람 기준)
    },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}
