// 얼굴 패널 (Three.js). 신체 상태를 받아 얼굴에 그려요.
//   - 실제 모델: modelUrl(.glb)을 먼저 찾고, 없으면 임시 모델로 대신해요.
//   - 블렌드셰이프 이름은 자동 매핑 + 직접 고치기 가능.
//   - 땀(물방울)과 피부 광택은 블렌드셰이프와 따로 조절해요.
//   - 블렌드셰이프가 없는 스캔은 얼굴 기준점(<모델>.landmarks.json, 없으면 추정)으로 표정을 만들어 넣어요.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createTempHead } from './tempHead.js';
import { autoMap, collectMorphMeshes, applyWeights, CANONICAL } from './blendshapeMap.js';
import { createFaceController } from './faceController.js';
import { rigScan, estimateLandmarks } from './scanRig.js';
import { buildPointGeometry, createPointMaterial } from './pointCloud.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function dropTexture() {
  // 피부 위 물방울: 가운데는 거의 투명(피부가 비침), 가장자리는 살짝 어둡고, 위쪽에 밝은 반사점 [GAME]
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const body = g.createRadialGradient(32, 34, 4, 32, 34, 28);
  body.addColorStop(0, 'rgba(255,240,232,0.45)'); body.addColorStop(0.6, 'rgba(230,200,190,0.5)'); body.addColorStop(0.85, 'rgba(90,45,38,0.7)'); body.addColorStop(1, 'rgba(90,45,38,0)');
  g.fillStyle = body; g.beginPath(); g.arc(32, 34, 28, 0, Math.PI * 2); g.fill();
  const hl = g.createRadialGradient(24, 22, 0, 24, 22, 10);
  hl.addColorStop(0, 'rgba(255,255,255,1)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.6)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.beginPath(); g.arc(24, 22, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(40, 46, 3, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 메시의 정점 위치·법선을 장면 좌표로 */
function worldPN(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry, pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), n = pos.count;
  const p = new Float32Array(n * 3), q = new Float32Array(n * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(p, 3 * i);
    if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize().toArray(q, 3 * i); else q[3 * i + 2] = 1;
  }
  return { p, n: q };
}

/** 실제 모델에 땀·홍조·입술 영역 표시가 없을 때, 얼굴 위치와 입 블렌드셰이프로 대략 만들어요 */
function deriveMasks(mesh, map) {
  const g = mesh.geometry; if (g.getAttribute('fxMask')) return;
  const alt = g.getAttribute('_fxmask'); if (alt) { g.setAttribute('fxMask', alt); return; }
  const pos = g.getAttribute('position'), n = pos.count, dict = mesh.morphTargetDictionary;
  if (!dict || !g.morphAttributes.position) { g.setAttribute('fxMask', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return; } // 목·몸 등은 효과 없음
  // 모델마다 내부 좌표축이 달라서(눕혀 둔 모델 등) 장면 기준(위 +Y, 정면 +Z)으로 바꿔서 재요
  const W = worldPN(mesh), P = W.p, N = W.n;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[3 * i]); x1 = Math.max(x1, P[3 * i]); y0 = Math.min(y0, P[3 * i + 1]); y1 = Math.max(y1, P[3 * i + 1]); }
  const cx = (x0 + x1) / 2, w = x1 - x0 || 1, h = y1 - y0 || 1;
  const lipT = ['mouthFunnel', 'jawOpen'].map(k => map[k] ? dict[map[k]] : undefined).find(i => i !== undefined);
  const lipD = lipT !== undefined ? g.morphAttributes.position[lipT] : null; let lipMax = 1e-9;
  if (lipD) for (let i = 0; i < n; i++) lipMax = Math.max(lipMax, Math.hypot(lipD.getX(i), lipD.getY(i), lipD.getZ(i)));
  const fx = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = (P[3 * i] - cx) / w, v = (P[3 * i + 1] - y0) / h, front = clamp((N[3 * i + 2] - 0.2) / 0.6);
    const forehead = clamp(1 - Math.abs(v - 0.78) / 0.12) * clamp(1 - Math.abs(u) / 0.35) * front;
    const cheeks = clamp(1 - Math.abs(v - 0.5) / 0.12) * clamp(1 - Math.abs(Math.abs(u) - 0.22) / 0.12) * front;
    const lip = lipD ? clamp(Math.hypot(lipD.getX(i), lipD.getY(i), lipD.getZ(i)) / lipMax * 1.6 - 0.4) * clamp(1 - Math.abs(u) / 0.2) : 0;
    fx[i * 3] = Math.max(cheeks, forehead * 0.4); fx[i * 3 + 1] = lip; fx[i * 3 + 2] = forehead;
  }
  g.setAttribute('fxMask', new THREE.BufferAttribute(fx, 3));
}

/** 피부 재질에 홍조·창백함·청색증·광택을 얹어요 (원래 재질은 그대로 쓰고 셰이더만 덧붙임) */
function patchSkin(mat, U) {
  if (mat.userData.facePatched) return; mat.userData.facePatched = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 fxMask;\nattribute float mouthInner;\nvarying vec3 vFx;\nvarying float vMouth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = fxMask;\nvMouth = mouthInner;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFlush, uPallor, uCyan, uGloss;\nvarying vec3 vFx;\nvarying float vMouth;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 열로 붉어짐(피부 혈관이 넓어짐): 얼굴 전체가 조금, 볼·귀·코는 더 붉게
        float fl = uFlush * (0.4 + 0.6 * vFx.r);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.38, 0.62, 0.55), fl * 0.8);
        // 땀에 젖은 피부는 살짝 짙어 보여요
        diffuseColor.rgb *= 1.0 - 0.1 * uGloss * vFx.b;
        float gray = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gray) * vec3(0.96, 0.98, 1.03) + 0.03, uPallor * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.30, 0.48) * (0.6 + gray), uCyan * vFx.g * 0.8);
        // 입술 안쪽 점막: 얕은 곳은 촉촉한 분홍, 깊을수록 어두운 붉은색 (선형 색 공간 값)
        vec3 muc = mix(vec3(0.24, 0.055, 0.06), vec3(0.04, 0.007, 0.01), smoothstep(0.35, 1.0, vMouth));
        diffuseColor.rgb = mix(diffuseColor.rgb, muc, smoothstep(0.0, 0.35, vMouth));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, clamp(uGloss * (0.3 + 0.7 * vFx.b), 0.0, 1.0));\nroughnessFactor = mix(roughnessFactor, 0.38, smoothstep(0.0, 0.35, vMouth));');
  };
  mat.needsUpdate = true;
}

/**
 * @param {{container:HTMLElement, getBody:()=>object|null, modelUrl?:string, style?:'surface'|'hologram',
 *          onModel?:(info:object)=>void, reducedMotion?:boolean}} o
 */
export function createFacePanel({ container, getBody, modelUrl = 'models/face/face.glb', style = 'surface', onModel, reducedMotion,
  points: pointOpts = {}, holoPose = { yaw: 0, pitch: 0 } } = {}) {
  pointOpts = { density: 1, size: 1.6, color: 0xe8eeff, ...pointOpts };
  if (reducedMotion === undefined) { try { reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { reducedMotion = false; } }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xc4d2ff, 0x1c140e, 0.9));
  const key = new THREE.DirectionalLight(0xfff1e2, 2.4); key.position.set(-1.2, 1.4, 2.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db4ff, 0.6); fill.position.set(1.6, 0.2, 1.2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x8fc1ff, 2.2); rim.position.set(1.5, 1.2, -2.0); scene.add(rim);

  const U = { uFlush: { value: 0 }, uPallor: { value: 0 }, uCyan: { value: 0 }, uGloss: { value: 0 } };
  const pivot = new THREE.Group(); scene.add(pivot);
  const ctrl = createFaceController({ reducedMotion });
  let model = null, meshes = [], map = {}, info = null, drops = null, holo = [], baseY = 0, last = null, raf = 0, lastFace = null;
  let headMesh = null, faceSize = 1, refDist = 1, eyes = [];
  const EYE_YAW = 22 * Math.PI / 180, EYE_PITCH = 15 * Math.PI / 180;
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();

  function frame(root) {
    const lm = root.userData.landmarks;
    if (lm) return frameFace(root, lm);
    const headMesh = meshes.reduce((a, m) => (!a || Object.keys(m.morphTargetDictionary).length > Object.keys(a.morphTargetDictionary).length ? m : a), null) || root;
    root.updateMatrixWorld(true);
    // 기본 얼굴 모양만으로 크기를 재요 (표정 변형까지 넣으면 상자가 부풀어요)
    const bb = headMesh.isMesh ? new THREE.Box3().setFromBufferAttribute(headMesh.geometry.getAttribute('position')).applyMatrix4(headMesh.matrixWorld) : new THREE.Box3().setFromObject(headMesh);
    const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    // 목 근처를 축으로 돌도록 피벗을 옮겨요
    const neck = new THREE.Vector3(c.x, bb.min.y + size.y * 0.12, c.z - size.z * 0.15);
    root.position.sub(neck); pivot.position.copy(neck); baseY = neck.y;
    // 머리 전체가 여유 있게 들어오게
    const fh = size.y * 1.1, dist = fh / 2 / Math.tan((camera.fov * Math.PI / 180) / 2), fy = c.y - size.y * 0.02;
    camera.position.set(c.x, fy + size.y * 0.03, c.z + dist + size.z * 0.5);
    camera.lookAt(c.x, fy, c.z); camera.near = dist * 0.05; camera.far = dist * 10; camera.updateProjectionMatrix();
    return { headMesh, height: size.y, dist };
  }
  /** 기준점이 있는 스캔: 목·어깨는 빼고 얼굴 위주로 맞춰요 */
  function frameFace(root, lm) {
    const head = meshes[0];
    const E = lm.eyeL[0] - lm.eyeR[0], cx = (lm.eyeL[0] + lm.eyeR[0]) / 2, ey = lm.eyeL[1];
    const neck = new THREE.Vector3(cx, lm.chinY - 0.35 * E, lm.nose[2] - 1.7 * E);
    root.position.sub(neck); pivot.position.copy(neck); baseY = neck.y;
    const fh = 4.3 * E, fy = ey - 0.3 * E, dist = fh / 2 / Math.tan((camera.fov * Math.PI / 180) / 2);
    camera.position.set(cx, fy + 0.15 * E, lm.nose[2] + dist);
    camera.lookAt(cx, fy, lm.nose[2] - 0.6 * E); camera.near = dist * 0.05; camera.far = dist * 10; camera.updateProjectionMatrix();
    return { headMesh: head, height: 3.2 * E, dist };
  }

  function setupDrops(headMesh, height) {
    const fx = headMesh.geometry.getAttribute('fxMask'), pos = headMesh.geometry.getAttribute('position'), nrm = headMesh.geometry.getAttribute('normal');
    const wn = worldPN(headMesh).n;
    const cand = []; for (let i = 0; i < pos.count; i++) if (fx.getZ(i) > 0.25 && wn[3 * i + 2] > 0.1) cand.push(i);
    // 메시 안쪽 좌표에서의 '아래' 방향과 크기 (눕혀 둔 모델도 땀이 아래로 흐르게)
    const inv = new THREE.Matrix4().copy(headMesh.matrixWorld).invert(), unit = 1 / headMesh.matrixWorld.getMaxScaleOnAxis();
    const down = new THREE.Vector3(0, -1, 0).transformDirection(inv);
    const N = 140, geo = new THREE.BufferGeometry(), arr = new Float32Array(N * 3), al = new Float32Array(N), ps = new Float32Array(N);
    for (let k = 0; k < N; k++) ps[k] = 0.5 + Math.random() * Math.random() * 1.6;   // 작은 방울이 많고 큰 방울은 드물게
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); geo.setAttribute('alpha', new THREE.BufferAttribute(al, 1)); geo.setAttribute('psize', new THREE.BufferAttribute(ps, 1));
    const mat = new THREE.PointsMaterial({ size: height * unit * 0.07, map: dropTexture(), transparent: true, depthWrite: false, sizeAttenuation: true });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float alpha;\nattribute float psize;\nvarying float vA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = alpha;').replace('gl_PointSize = size;', 'gl_PointSize = size * psize;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.a *= vA;\n#include <premultiplied_alpha_fragment>');
    };
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.name = 'SweatDrops'; headMesh.add(pts);
    const d = Array.from({ length: N }, (_, k) => ({ v: cand.length ? cand[(k * 7919) % cand.length] : 0, life: Math.random(), speed: 0.4 + Math.random() * 0.8 }));
    return { pts, d, pos, nrm, cand, height, arr, al, down, unit };
  }
  function updateDrops(dt, amount) {
    if (!drops || !drops.cand.length) return;
    const { d, pos, nrm, arr, al, height, cand, down, unit } = drops, active = Math.round(amount * d.length);
    d.forEach((p, k) => {
      if (k >= active) { al[k] = 0; return; }
      p.life += dt * 0.12 * p.speed;
      if (p.life >= 1) { p.life = 0; p.v = cand[Math.floor(Math.random() * cand.length)]; p.speed = 0.4 + Math.random() * 0.8; }
      const slide = height * unit * 0.07 * Math.max(0, p.life - 0.35) ** 1.6;   // 처음엔 맺혔다가 천천히 흘러내림
      const o = height * unit * 0.006;
      arr[k * 3] = pos.getX(p.v) + nrm.getX(p.v) * o + down.x * slide; arr[k * 3 + 1] = pos.getY(p.v) + nrm.getY(p.v) * o + down.y * slide; arr[k * 3 + 2] = pos.getZ(p.v) + nrm.getZ(p.v) * o + down.z * slide;
      al[k] = Math.min(1, p.life * 5) * (1 - Math.max(0, p.life - 0.8) / 0.2) * clamp(amount * 1.4);
    });
    drops.pts.geometry.attributes.position.needsUpdate = true; drops.pts.geometry.attributes.alpha.needsUpdate = true;
  }

  /** 블렌드셰이프가 없는 스캔: 가장 큰 메시를 장면 좌표로 굽고 표정을 만들어 넣어요 */
  function prepareScan(root, landmarks) {
    let big = null;
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && (!big || o.geometry.getAttribute('position').count > big.geometry.getAttribute('position').count)) big = o; });
    if (!big) return { root, rigged: false };
    big.geometry = big.geometry.clone(); big.geometry.applyMatrix4(big.matrixWorld);
    if (!big.geometry.getAttribute('normal')) big.geometry.computeVertexNormals();
    big.removeFromParent(); big.position.set(0, 0, 0); big.rotation.set(0, 0, 0); big.scale.set(1, 1, 1);
    const g = new THREE.Group(); g.add(big);
    const lm = landmarks || estimateLandmarks(big.geometry);
    rigScan(big, lm);
    g.userData.landmarks = lm;
    return { root: g, rigged: true, estimated: !!lm.estimated };
  }

  function useModel(root, source, name, extra = {}) {
    if (model) { pivot.remove(model); }
    let scan = { rigged: false };
    if (!collectMorphMeshes(root).meshes.length) { scan = prepareScan(root, extra.landmarks); root = scan.root; }
    model = root; pivot.add(root); root.position.set(0, 0, 0); pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0);
    ({ meshes } = collectMorphMeshes(root));
    const names = [...new Set(meshes.flatMap(m => Object.keys(m.morphTargetDictionary)))];
    const r = autoMap(names); map = r.map;
    const skin = new Set(meshes);
    root.traverse(o => { if (o.isMesh && (o.name === 'Neck' || skin.has(o))) skin.add(o); });
    for (const m of skin) { deriveMasks(m, map); for (const mt of [].concat(m.material)) if (mt.isMeshStandardMaterial) patchSkin(mt, U); }
    // 눈알(이름이 eyeLeft·Eye_L 같은 노드)을 시선대로 돌려요. 쉬는 자세 기준으로 계산해 둬요
    root.updateMatrixWorld(true); eyes = [];
    root.traverse(o => {
      if (!/^eye[_\s-]?(left|right|l|r)$/i.test(o.name) || !o.parent) return;
      const pq = o.parent.getWorldQuaternion(new THREE.Quaternion());
      eyes.push({ o, q0: o.quaternion.clone(), pq, pqi: pq.clone().invert() });
    });
    const fr = frame(root); headMesh = fr.headMesh; faceSize = fr.height; refDist = fr.dist;
    if (drops) { drops.pts.parent && drops.pts.parent.remove(drops.pts); }
    drops = headMesh.isMesh ? setupDrops(headMesh, fr.height) : null;
    buildHolo();
    setStyle(style);
    info = { source, name, names, map: { ...map }, unmapped: r.unmapped, unused: r.unused, meshes: meshes.map(m => m.name || '(이름 없음)'),
      synthesized: scan.rigged, landmarksEstimated: !!scan.estimated, credit: extra.credit || null };
    onModel && onModel(info);
  }

  /** 점 구름 다시 만들기 (모델·밀도가 바뀔 때) */
  function buildHolo() {
    holo.forEach(h => { h.parent && h.parent.remove(h); h.geometry.dispose(); h.material.dispose(); }); holo = [];
    if (!headMesh || !headMesh.isMesh) return;
    // 점 간격은 머리 기준으로 정하고, 눈알·치아 같은 다른 메시도 같은 간격으로 찍어요 (눈알 점은 시선 따라 같이 돌아요)
    const parts = [headMesh];
    model.traverse(o => { if (o.isMesh && o !== headMesh && !/^(MouthCavity|MouthInner|Neck)$/.test(o.name)) parts.push(o); });
    model.updateMatrixWorld(true);
    let spacing = null;
    for (const mesh of parts) {
      const mat0 = [].concat(mesh.material)[0];
      const g = buildPointGeometry(mesh.geometry, { density: pointOpts.density, map: mat0 && mat0.map, spacing, scale: mesh.matrixWorld.getMaxScaleOnAxis() });
      spacing = spacing || g.userData.spacing;
      const p = new THREE.Points(g, createPointMaterial({ color: pointOpts.color, size: pointOpts.size, faceSize }));
      p.frustumCulled = false; p.renderOrder = 2; p.visible = style === 'hologram';
      mesh.add(p); p.updateMorphTargets(); holo.push(p);
    }
  }

  function setStyle(s) {
    style = s;
    const h = s === 'hologram';
    container.dataset.style = s;
    holo.forEach(p => { p.visible = h; });
    if (drops) drops.pts.visible = !h;
    model && model.traverse(o => {
      if (!o.isMesh) return;
      // 홀로그램: 표면은 색 없이 깊이만 그려서, 뒤쪽 점을 가리는 데만 써요
      for (const mt of [].concat(o.material)) { mt.colorWrite = !h; mt.transparent = false; mt.opacity = 1; mt.depthWrite = true; mt.needsUpdate = true; }
    });
  }

  // 압축 모델(KTX2 텍스처, meshopt 메시)도 읽을 수 있게
  let ktx2 = null;
  const gltfLoader = () => {
    if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/').detectSupport(renderer);
    return new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  };
  const sidecar = async (url, ext) => { try { const r = await fetch(url.replace(/\.glb(\.b64\.txt)?$/i, ext)); return r.ok ? await r.json() : null; } catch { return null; } };
  const creditOf = (gltf) => { const x = gltf.asset && gltf.asset.extras; return x && (x.author || x.license) ? { title: x.title, author: x.author, license: x.license, source: x.source } : null; };
  // .glb 또는 base64로 감싼 .glb.b64.txt (.glb를 바로 올릴 수 없는 곳에서 써요)
  async function loadUrl(url, { landmarks } = {}) {
    let gltf;
    if (/\.b64\.txt$/i.test(url)) {
      const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
      const bin = atob((await r.text()).trim()), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      gltf = await gltfLoader().parseAsync(buf.buffer, '');
    } else gltf = await gltfLoader().loadAsync(url);
    // 같은 이름의 곁 파일: face.glb → face.landmarks.json (얼굴 기준점), face.credit.json (출처 표기)
    if (!landmarks) landmarks = await sidecar(url, '.landmarks.json');
    const credit = creditOf(gltf) || await sidecar(url, '.credit.json');
    useModel(gltf.scene, 'file', url.split('/').pop().replace(/\.b64\.txt$/i, ''), { landmarks, credit });
  }
  async function loadArrayBuffer(buf, name = 'model.glb', { landmarks } = {}) {
    const gltf = await gltfLoader().parseAsync(buf, '');
    useModel(gltf.scene, 'file', name, { landmarks, credit: creditOf(gltf) });
  }
  function useTemp() { useModel(createTempHead(), 'temp', '임시 모델 (자동 생성)'); }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  function loop(ms) {
    raf = requestAnimationFrame(loop);
    const now = ms / 1000, dt = last === null ? 0.016 : Math.min(0.1, now - last); last = now;
    if (!model) return;
    const body = getBody ? getBody() : null;
    const f = ctrl.update(dt, body); lastFace = f;
    if (!map.nostrilDilate && f.weights.nostrilDilate) {   // 콧구멍 벌림(AU38)이 없는 모델은 코 찡그림을 조금 빌려 써요
      const k = 0.35 * f.weights.nostrilDilate;
      f.weights.noseSneerLeft = clamp(f.weights.noseSneerLeft + k); f.weights.noseSneerRight = clamp(f.weights.noseSneerRight + k);
    }
    applyWeights(meshes, map, f.weights);
    for (const e of eyes) {
      qTmp.setFromEuler(eTmp.set(-f.gaze.y * EYE_PITCH, f.gaze.x * EYE_YAW, 0, 'YXZ'));
      e.o.quaternion.copy(e.pqi).multiply(qTmp).multiply(e.pq).multiply(e.q0);
    }
    const h = style === 'hologram';
    holo.forEach(p => {
      const src = p.parent; if (src && src.morphTargetInfluences) p.morphTargetInfluences = src.morphTargetInfluences;
      const u = p.material.uniforms;
      u.uRefDist.value = refDist; u.uPx.value = pointOpts.size * renderer.getPixelRatio();
      u.uFlush.value = f.fx.flush; u.uPallor.value = f.fx.pallor; u.uCyan.value = f.fx.cyanosis;
    });
    const py = h ? holoPose.yaw : 0, pp = h ? holoPose.pitch : 0;
    pivot.rotation.set(f.head.pitch + pp, f.head.yaw + py, f.head.roll, 'YXZ'); pivot.position.y = baseY + f.head.lift * (drops ? drops.height : 1);
    U.uFlush.value = f.fx.flush; U.uPallor.value = f.fx.pallor; U.uCyan.value = f.fx.cyanosis; U.uGloss.value = f.fx.gloss;
    updateDrops(dt, f.fx.sweat);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  // 시작: 실제 모델이 있으면 그걸, 없으면 임시 모델
  (modelUrl ? loadUrl(modelUrl).catch(() => useTemp()) : Promise.resolve(useTemp()));

  return {
    get info() { return info; },
    get face() { return lastFace; },
    get mapping() { return { ...map }; },
    setMapping(next) { map = { ...map, ...next }; if (info) info.map = { ...map }; },
    setStyle, loadUrl, loadArrayBuffer, useTemp,
    /** 점 구름 설정: density 0|1, size(px), color */
    setPoints(next) {
      const rebuild = next.density !== undefined && next.density !== pointOpts.density;
      pointOpts = { ...pointOpts, ...next };
      if (rebuild) buildHolo();
      else holo.forEach(p => { p.material.uniforms.uColor.value.set(pointOpts.color); });
    },
    get points() { return { ...pointOpts, count: holo.reduce((s, p) => s + p.geometry.getAttribute('position').count, 0) }; },
    get model() { return model; },
    get camera() { return camera; },
    canonical: CANONICAL,
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
