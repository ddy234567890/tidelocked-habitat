// Teegarden c 전용 로우폴리 모델을 코드로 만든다 (팀 제작, CC0). 점 선으로 그려지므로 면 수보다 '꺾인 모서리 수'를 적게 한다.
// 둥근 것은 6~10각, 가는 기둥은 3각 기둥. 실행: node scripts/make-cold-models.mjs → src/models/cold-*.glb 와 modelSizes.json 갱신
import fs from 'node:fs';
import * as THREE from 'three';

const M = new THREE.Matrix4(), tau = Math.PI * 2;
const place = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => (g.index ? g.toNonIndexed() : g).applyMatrix4(M.makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z).clone());
const box = (w, h, d, x = 0, y = 0, z = 0, ...r) => place(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ...r);
const cyl = (top, bottom, h, seg, x = 0, y = 0, z = 0, ...r) => place(new THREE.CylinderGeometry(top, bottom, h, seg), x, y + h / 2, z, ...r);
const tri = (...points) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3)); return g; };
const quad = (a, b, c, d) => tri(a, b, c, a, c, d);
// 두 점을 잇는 가는 3각 기둥
const bar = (a, b, r = 0.03) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 3, 1, true).toNonIndexed();
  return g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize()), new THREE.Vector3(1, 1, 1)));
};
const ring = (n, r, y, turn = 0) => Array.from({ length: n }, (_, i) => [Math.cos((i + turn) / n * tau) * r, y, Math.sin((i + turn) / n * tau) * r]);
const skin = (a, b) => a.map((p, i) => quad(p, a[(i + 1) % a.length], b[(i + 1) % b.length], b[i]));            // 두 고리를 네모 면으로
const weave = (a, b) => a.flatMap((p, i) => [tri(p, a[(i + 1) % a.length], b[i]), tri(a[(i + 1) % a.length], b[(i + 1) % b.length], b[i])]); // 반 칸 돌린 고리를 세모 면으로
const cap = (a, y, x = 0, z = 0) => a.map((p, i) => tri(p, a[(i + 1) % a.length], [x, y, z]));
const move = (list, x, y, z, ry = 0) => list.map(g => place(g, x, y, z, 0, ry, 0));
const arch = (r, z, n = 8, d = 0.1, t = 0.07) => Array.from({ length: n }, (_, i) => { // 둥근 갈비뼈 하나
  const a = i / n * Math.PI, b = (i + 1) / n * Math.PI, p = (q, k) => [Math.cos(q) * k, Math.sin(q) * k, z];
  return [quad(p(a, r), p(b, r), p(b, r + t), p(a, r + t))];
}).flat();

const L = 'light', D = 'dark', O = 'mid';
/** 이름 → { 색: [도형…] } */
const MODELS = {
  // 집
  'cold-geodome': () => {
    const r = 1.5, a = ring(10, r, 0), b = ring(10, r * 0.86, 0.62, 0.5), c = ring(10, r * 0.52, 1.08, 1), petals = [];
    for (let i = 0; i < 8; i++) { const t = i / 8 * tau, q = (k, s, y) => [Math.cos(t + s) * k, y, Math.sin(t + s) * k]; petals.push(quad(q(1.72, -0.2, 0.06), q(1.72, 0.2, 0.06), q(2.3, 0.22, 0.75), q(2.3, -0.22, 0.75))); }
    return { [L]: [...weave(a, b), ...weave(b, c), ...cap(c, 1.28)], [O]: petals, [D]: [box(0.5, 0.6, 0.5, r, 0, 0)] };
  },
  'cold-doubleshell': () => {
    const half = (r, z0, z1, n = 8) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI, b = (i + 1) / n * Math.PI; return quad([Math.cos(a) * r, Math.sin(a) * r, z0], [Math.cos(b) * r, Math.sin(b) * r, z0], [Math.cos(b) * r, Math.sin(b) * r, z1], [Math.cos(a) * r, Math.sin(a) * r, z1]); });
    return { [D]: half(0.9, -1.4, 1.4, 6), [L]: [-1.5, -0.75, 0, 0.75, 1.5].flatMap(z => arch(1.22, z)), [O]: [bar([0, 1.26, -1.5], [0, 1.26, 1.5]), bar([0.9, 0.9, -1.5], [0.9, 0.9, 1.5]), bar([-0.9, 0.9, -1.5], [-0.9, 0.9, 1.5]), box(0.6, 0.8, 0.5, 0, 0, 1.7)] };
  },
  'cold-igloo': () => {
    const a = ring(9, 1.2, 0), b = ring(9, 1.08, 0.45, 0.5), c = ring(9, 0.78, 0.82, 1), d = ring(9, 0.36, 1.05, 1.5);
    const tunnel = [0, 1, 2, 3].flatMap(i => { const p = k => [Math.cos(k / 4 * Math.PI) * 0.45, Math.sin(k / 4 * Math.PI) * 0.6]; const [x0, y0] = p(i), [x1, y1] = p(i + 1); return [quad([x0, y0, 0.95], [x1, y1, 0.95], [x1, y1, 1.9], [x0, y0, 1.9])]; });
    return { [L]: [...skin(a, ring(9, 1.08, 0.45)), ...skin(b, ring(9, 0.78, 0.82, 0.5)), ...skin(c, ring(9, 0.36, 1.05, 1)), ...cap(d, 1.12)], [O]: tunnel, [D]: [cyl(0.08, 0.08, 0.7, 4, 0.45, 0.8, -0.3)] };
  },
  'cold-polarpod': () => { // 남극 기지처럼 눈썰매 다리 위에 뜬 각진 캡슐
    const sec = (z, k) => [[-0.55, 0.0], [0.55, 0.0], [0.95, 0.45], [0.7, 1.0], [-0.7, 1.0], [-0.95, 0.45]].map(([x, y]) => [x * k, 1.15 + (y - 0.5) * k + 0.5, z]);
    const A = sec(-1.35, 0.72), B = sec(-0.85, 1), C = sec(0.85, 1), E = sec(1.35, 0.72), legs = [];
    for (const x of [-0.6, 0.6]) for (const z of [-0.75, 0.75]) legs.push(bar([x * 0.8, 1.2, z], [x * 1.25, 0.08, z], 0.06), box(0.28, 0.08, 0.7, x * 1.25, 0, z));
    return { [L]: [...skin(A, B), ...skin(B, C), ...skin(C, E), ...cap(A, 1.65, 0, -1.35), ...cap(E, 1.65, 0, 1.35)], [D]: legs, [O]: [box(0.5, 0.28, 0.5, 0, 2.15, 0)] };
  },
  'cold-heathut': () => {
    const a = [[-0.9, 0, -0.9], [0.9, 0, -0.9], [0.9, 0, 0.9], [-0.9, 0, 0.9]], b = a.map(([x, , z]) => [x * 0.62, 0.95, z * 0.62]);
    return { [L]: [...skin(a, b), ...cap(b, 1.0)], [D]: [[-0.75, 0.75], [0.75, 0.75], [-0.75, -0.75], [0.75, -0.75]].flatMap(([x, z]) => [cyl(0.1, 0.1, 1.5, 5, x * 1.25, 0, z * 1.25)]), [O]: [-0.3, 0, 0.3].map(x => box(0.05, 0.45, 0.8, x, 1.0, 0)) };
  },
  'cold-pipeloop': () => { // 얼어 터지지 않게 U 자로 꺾은 열 배관
    const y = 0.55, p = [[-1.5, y, 0], [-0.6, y, 0], [-0.6, y, -0.7], [0.6, y, -0.7], [0.6, y, 0], [1.5, y, 0]], pipes = [];
    for (let i = 0; i < p.length - 1; i++) { const a = new THREE.Vector3(...p[i]), b = new THREE.Vector3(...p[i + 1]), g = new THREE.CylinderGeometry(0.13, 0.13, a.distanceTo(b) + 0.2, 6).toNonIndexed(); pipes.push(g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1)))); }
    return { [L]: pipes, [D]: [-1.2, 0, 1.2].flatMap(x => { const z = x === 0 ? -0.7 : 0; return [bar([x, 0, z - 0.25], [x, y, z], 0.04), bar([x, 0, z + 0.25], [x, y, z], 0.04)]; }) };
  },
  // 발전
  'cold-heliostat': () => {
    const p = (x, y) => { const t = -0.75; return [x, 1.0 + y * Math.cos(t), -y * Math.sin(t)]; };
    return { [L]: [quad(p(-0.62, -0.5), p(0.62, -0.5), p(0.62, 0.5), p(-0.62, 0.5)), quad(p(-0.62, 0), p(0.62, 0), p(0.62, 0.02), p(-0.62, 0.02)), quad(p(0, -0.5), p(0.02, -0.5), p(0.02, 0.5), p(0, 0.5))], [D]: [bar([0, 0, 0], [0, 1.0, 0], 0.07), box(0.5, 0.06, 0.5)] };
  },
  'cold-suntower': () => {
    const a = ring(6, 0.5, 0), b = ring(6, 0.26, 2.6), c = ring(6, 0.5, 2.7), d = ring(6, 0.5, 3.2);
    return { [L]: [...skin(a, b)], [O]: [...skin(c, d), ...cap(d, 3.5), ...cap(c, 2.7)], [D]: [box(0.9, 0.5, 0.7, 0.7, 0, 0.3)] };
  },
  'cold-geoplant': () => {
    const tower = (x, z) => { const a = ring(8, 0.55, 0), b = ring(8, 0.36, 0.75), c = ring(8, 0.44, 1.2); return move([...skin(a, b), ...skin(b, c)], x, 0, z); };
    return { [L]: [...tower(-0.65, -0.1), ...tower(0.5, -0.45)], [D]: [box(1.2, 0.5, 0.7, 0.35, 0, 0.75)], [O]: [cyl(0.1, 0.1, 0.9, 5, -0.6, 0.05, 0.75, 0, 0, Math.PI / 2), cyl(0.16, 0.16, 0.5, 5, -0.95, 0, 0.75)] };
  },
  'cold-rtg': () => {
    const fins = Array.from({ length: 8 }, (_, i) => { const t = i / 8 * tau, c = Math.cos(t), s = Math.sin(t); return quad([c * 0.25, 0.3, s * 0.25], [c * 0.75, 0.42, s * 0.75], [c * 0.75, 1.08, s * 0.75], [c * 0.25, 1.2, s * 0.25]); });
    return { [L]: [cyl(0.27, 0.27, 1.0, 8, 0, 0.25, 0)], [O]: fins, [D]: [[0.5, 0.5], [-0.5, 0.5], [0, -0.6]].map(([x, z]) => bar([x * 0.4, 0.3, z * 0.4], [x * 1.2, 0, z * 1.2], 0.05)) };
  },
  'cold-derrick': () => {
    const f = y => 0.75 - 0.55 * y / 3.0, at = (i, y) => { const s = [[1, 1], [-1, 1], [-1, -1], [1, -1]][i % 4]; return [s[0] * f(y), y, s[1] * f(y)]; }, legs = [];
    for (let i = 0; i < 4; i++) { legs.push(bar(at(i, 0), at(i, 3.0), 0.045)); for (const y of [0.9, 1.9, 3.0]) legs.push(bar(at(i, y), at(i + 1, y), 0.03)); legs.push(bar(at(i, 0), at(i + 1, 0.9), 0.025), bar(at(i, 0.9), at(i + 1, 1.9), 0.025)); }
    return { [O]: legs, [L]: [cyl(0.09, 0.09, 3.2, 5, 0, 0, 0), cyl(0.24, 0.24, 0.3, 6, 0, 3.0, 0)], [D]: [box(1.9, 0.12, 1.9)] };
  },
  // 저장 · 난방
  'cold-heatstore': () => { // 모래를 데워 담는 굵은 통: 아래가 좁은 단열 통 + 띠 + 원뿔 지붕
    const a = ring(10, 0.95, 0), b = ring(10, 0.95, 1.2), c = ring(10, 1.06, 0.5), d = ring(10, 1.06, 0.62), e = ring(10, 0.3, 1.6);
    return { [L]: [...skin(a, b), ...skin(b, e), ...cap(e, 1.62)], [O]: [...skin(c, d)], [D]: [cyl(0.1, 0.1, 0.5, 5, 0, 1.5, 0), box(0.4, 0.5, 0.4, 1.15, 0, 0)] };
  },
  'cold-spheretank': () => {
    const s = new THREE.IcosahedronGeometry(0.72, 0);
    return { [L]: [place(s, 0, 1.05, 0)], [D]: ring(5, 0.62, 0).map(([x, , z]) => bar([x, 0, z], [x * 0.85, 0.95, z * 0.85], 0.05)), [O]: [bar([0, 1.7, 0], [0, 2.05, 0], 0.06)] };
  },
  'cold-heatpump': () => {
    const fan = ring(8, 0.4, 0).map(([x, , z]) => [x, 0.55 + z, 0.36]), coil = [];
    for (let i = 0; i < 4; i++) { const x = 0.75 + i * 0.28; coil.push(...[0, 1, 2, 3, 4, 5].map(k => { const a = k / 6 * Math.PI, b = (k + 1) / 6 * Math.PI, r = 0.5; return bar([x, Math.sin(a) * r, Math.cos(a) * r], [x, Math.sin(b) * r, Math.cos(b) * r], 0.035); })); }
    return { [L]: [box(1.1, 1.1, 0.7)], [O]: [...fan.map((p, i) => tri(p, fan[(i + 1) % 8], [0, 0.55, 0.36]))], [D]: coil };
  },
  'cold-heater': () => ({ [L]: Array.from({ length: 6 }, (_, i) => box(0.1, 0.9, 0.28, -0.5 + i * 0.2, 0.12, 0)), [O]: [box(1.2, 0.06, 0.1, 0, 0.1, 0), box(1.2, 0.06, 0.1, 0, 0.92, 0)], [D]: [box(0.12, 0.14, 0.4, -0.5), box(0.12, 0.14, 0.4, 0.5)] }),
  'cold-foldwall': () => ({ [L]: Array.from({ length: 5 }, (_, i) => { const x0 = -1.25 + i * 0.5, z = k => (k % 2 ? 0.28 : -0.28); return quad([x0, 0, z(i)], [x0 + 0.5, 0, z(i + 1)], [x0 + 0.5, 1.2, z(i + 1)], [x0, 1.2, z(i)]); }), [D]: [box(0.5, 0.95, 0.12, 1.6, 0, 0)] }),
  // 물
  'cold-icecutter': () => { // 얼음을 네모나게 써는 톱 달린 썰매
    const disc = ring(10, 0.55, 0).map(([x, , z]) => [x, 0.55 + z, 0.0]);
    return { [L]: disc.map((p, i) => tri(p, disc[(i + 1) % 10], [0, 0.55, 0])), [D]: [box(1.6, 0.1, 0.12, -0.6, 0, 0.45), box(1.6, 0.1, 0.12, -0.6, 0, -0.45), bar([-1.0, 0.5, 0.3], [0, 0.55, 0.04], 0.05), bar([-1.0, 0.5, -0.3], [0, 0.55, -0.04], 0.05)], [O]: [box(0.8, 0.55, 0.8, -1.0, 0.1, 0)] };
  },
  'cold-icestack': () => ({ [L]: [box(0.62, 0.5, 0.62, -0.36, 0, 0.34, 0, 0.1), box(0.62, 0.5, 0.62, 0.36, 0, 0.3, 0, -0.08), box(0.62, 0.5, 0.62, -0.32, 0, -0.38), box(0.62, 0.5, 0.62, 0.4, 0, -0.36, 0, 0.14), box(0.62, 0.5, 0.62, 0.02, 0.5, 0, 0, 0.5)] }),
  'cold-melter': () => { const a = ring(6, 0.45, 0.3), b = ring(6, 0.85, 1.0); return { [L]: [...skin(a, b)], [O]: [cyl(0.5, 0.5, 0.28, 6), place(new THREE.OctahedronGeometry(0.34, 0), 0.1, 1.05, 0.05)], [D]: [bar([0.45, 0.35, 0], [1.1, 0.1, 0], 0.07)] }; },
  'cold-meltpan': () => { const fins = Array.from({ length: 6 }, (_, i) => quad([-0.75 + i * 0.3, 0, -0.5], [-0.75 + i * 0.3, 0, 0.5], [-0.75 + i * 0.3, 0.4, 0.5], [-0.75 + i * 0.3, 0.4, -0.5])); const a = [[-0.8, 0.4, -0.55], [0.8, 0.4, -0.55], [0.8, 0.4, 0.55], [-0.8, 0.4, 0.55]], b = a.map(([x, , z]) => [x * 1.2, 0.8, z * 1.25]); return { [O]: fins, [L]: [...skin(a, b)], [D]: [bar([-1.2, 0.2, 0], [1.2, 0.2, 0], 0.07)] }; },
  'cold-warmtank': () => { const coils = [0.25, 0.6, 0.95].flatMap(y => { const r = ring(8, 0.75, y); return r.map((p, i) => bar(p, r[(i + 1) % 8], 0.035)); }); return { [L]: [cyl(0.6, 0.6, 1.2, 8), cyl(0.2, 0.6, 0.25, 8, 0, 1.2, 0)], [O]: coils }; },
  'cold-loop': () => { // 물을 돌려 쓰는 고리형 순환 설비
    const r = ring(8, 0.8, 0.7); return { [L]: r.map((p, i) => { const q = r[(i + 1) % 8]; return bar(p, q, 0.12); }), [O]: [0, 2, 4, 6].map(i => cyl(0.22, 0.22, 0.75, 6, r[i][0], 0.25, r[i][2])), [D]: [0, 2, 4, 6].map(i => bar([r[i][0], 0, r[i][2]], [r[i][0], 0.3, r[i][2]], 0.06)) };
  },
  // 식량
  'cold-bioreactor': () => { const a = ring(8, 0.12, 0.35), b = ring(8, 0.42, 0.75), c = ring(8, 0.42, 1.75), d = ring(8, 0.2, 2.0); return { [L]: [...skin(a, b), ...skin(b, c), ...skin(c, d), ...cap(d, 2.02)], [O]: [bar([0, 2.0, 0], [0, 2.35, 0], 0.08), box(0.3, 0.2, 0.3, 0, 2.3, 0)], [D]: ring(3, 0.5, 0).map(([x, , z]) => bar([x, 0, z], [x * 0.75, 0.85, z * 0.75], 0.05)) }; },
  'cold-growrack': () => { const shelves = [0.15, 0.75, 1.35].flatMap(y => [box(1.5, 0.05, 0.5, 0, y, 0)]), lamps = [0.62, 1.22, 1.82].map(y => box(1.3, 0.04, 0.12, 0, y, 0)); const leaf = [0.2, 0.8, 1.4].flatMap(y => [-0.5, 0, 0.5].map(x => place(new THREE.TetrahedronGeometry(0.2, 0), x, y + 0.16, 0))); return { [D]: [[-0.75, 0.25], [0.75, 0.25], [-0.75, -0.25], [0.75, -0.25]].map(([x, z]) => bar([x, 0, z], [x, 1.9, z], 0.035)).concat(shelves), [O]: lamps, [L]: leaf }; },
  'cold-mushrack': () => { const caps = [0.2, 0.8, 1.4].flatMap((y, k) => [-0.45, 0, 0.45].map((x, i) => [cyl(0.02, 0.22, 0.14, 6, x, y + 0.18, (i + k) % 2 ? 0.06 : -0.06), cyl(0.05, 0.05, 0.18, 4, x, y, (i + k) % 2 ? 0.06 : -0.06)]).flat()); const arcN = arch(0.85, -0.35, 6, 0.1, 0.06).concat(arch(0.85, 0.35, 6, 0.1, 0.06)).map(g => place(g, 0, 1.0, 0)); return { [L]: caps, [O]: arcN, [D]: [0.15, 0.75, 1.35].map(y => box(1.5, 0.05, 0.6, 0, y, 0)).concat([-0.8, 0.8].flatMap(x => [bar([x, 0, 0.3], [x, 1.1, 0.3], 0.03), bar([x, 0, -0.3], [x, 1.1, -0.3], 0.03)])) }; },
  'cold-coldframe': () => ({ [L]: [quad([-0.8, 0.25, 0.5], [0.8, 0.25, 0.5], [0.8, 0.6, -0.5], [-0.8, 0.6, -0.5]), quad([-0.8, 0, 0.5], [0.8, 0, 0.5], [0.8, 0.25, 0.5], [-0.8, 0.25, 0.5]), quad([-0.8, 0, -0.5], [0.8, 0, -0.5], [0.8, 0.6, -0.5], [-0.8, 0.6, -0.5]), quad([-0.8, 0, 0.5], [-0.8, 0.25, 0.5], [-0.8, 0.6, -0.5], [-0.8, 0, -0.5]), quad([0.8, 0, 0.5], [0.8, 0.25, 0.5], [0.8, 0.6, -0.5], [0.8, 0, -0.5])], [O]: [-0.27, 0.27].map(x => bar([x, 0.26, 0.5], [x, 0.61, -0.5], 0.02)) }),
  'cold-hothouse': () => { const w = 0.65, l = 1.0, p = z => [[-w, 0, z], [-w, 0.7, z], [0, 1.15, z], [w, 0.7, z], [w, 0, z]], A = p(-l), B = p(l), M2 = p(0); const frame = [A, M2, B].flatMap(q => q.slice(0, 4).map((v, i) => bar(v, q[i + 1], 0.03))).concat([1, 2, 3].map(i => bar(A[i], B[i], 0.03))); return { [L]: frame, [O]: [0.2, 0.45].map(y => bar([-0.3, y, -l], [-0.3, y, l], 0.05)), [D]: [box(0.4, 0.5, 0.4, w + 0.35, 0, 0)] }; },
  'cold-compost': () => ({ [L]: [cyl(0.5, 0.5, 1.3, 8, 0, 0.1, 0, 0, 0, Math.PI / 2)], [O]: [-0.4, 0.4].map(x => cyl(0.56, 0.56, 0.1, 8, x, 0.7, 0, 0, 0, Math.PI / 2)), [D]: [-0.6, 0.6].flatMap(x => [bar([x, 0, -0.45], [x, 0.75, 0], 0.05), bar([x, 0, 0.45], [x, 0.75, 0], 0.05)]) }),
  'cold-sealed': () => ({ [L]: [cyl(0.36, 0.36, 0.75, 6, -0.42, 0, 0.2), cyl(0.36, 0.36, 0.75, 6, 0.42, 0, 0.2), cyl(0.36, 0.36, 0.75, 6, 0, 0, -0.5)], [O]: [cyl(0.4, 0.4, 0.08, 6, -0.42, 0.72, 0.2), cyl(0.4, 0.4, 0.08, 6, 0.42, 0.72, 0.2), cyl(0.4, 0.4, 0.08, 6, 0, 0.72, -0.5)] }),
  // 공기
  'cold-airstd': () => ({ [L]: [cyl(0.3, 0.3, 1.5, 6, -0.4, 0.1, 0), cyl(0.3, 0.3, 1.5, 6, 0.4, 0.1, 0)], [O]: [bar([-0.4, 1.6, 0], [-0.4, 1.85, 0], 0.07), bar([0.4, 1.6, 0], [0.4, 1.85, 0], 0.07), bar([-0.4, 1.85, 0], [0.4, 1.85, 0], 0.07)], [D]: [box(1.5, 0.12, 0.9)] }),
  'cold-airlow': () => { const b = ring(8, 0.3, 1.2), a = ring(8, 0.62, 0.6), c = ring(8, 0.3, 0.1); return { [L]: [...skin(c, a), ...skin(a, b), ...cap(b, 1.22)], [O]: [cyl(0.68, 0.68, 0.1, 8, 0, 0.55, 0)], [D]: ring(4, 0.6, 0).map(([x, , z]) => bar([x, 0, z], [x * 0.8, 0.45, z * 0.8], 0.05)) }; },
  'cold-airheat': () => ({ [L]: [cyl(0.34, 0.34, 1.4, 6, -0.55, 0, 0)], [O]: Array.from({ length: 6 }, (_, i) => box(0.04, 0.9, 0.9, 0.05 + i * 0.16, 0.25, 0)), [D]: [bar([-0.3, 1.1, 0], [1.0, 1.1, 0], 0.07), bar([-0.3, 0.3, 0], [1.0, 0.3, 0], 0.07), box(1.9, 0.1, 0.9, 0.1)] }),
  // 5주
  'cold-insulation': () => { const cells = [], n = 4, m = 3, s = 0.4; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const x = (i - n / 2) * s, y = j * s, c = [x + s / 2, y + s / 2, 0.16]; const q = [[x, y, 0], [x + s, y, 0], [x + s, y + s, 0], [x, y + s, 0]]; cells.push(...q.map((p, k) => tri(p, q[(k + 1) % 4], c))); } return { [L]: cells, [D]: [bar([-0.7, 0, -0.5], [-0.7, 1.15, 0], 0.04), bar([0.7, 0, -0.5], [0.7, 1.15, 0], 0.04)] }; },
  'cold-warmpost': () => { const a = ring(6, 0.5, 0), b = ring(6, 0.2, 0.6), f = [0.0, 0.5].map(t => ring(4, 0.28, 0.75, t)); return { [D]: [...skin(a, b)], [O]: [...cap(f[0], 1.5), ...cap(f[1], 1.25)], [L]: ring(6, 0.62, 0.1).map(p => bar(p, [p[0], 0.5, p[2]], 0.03)) }; },
  'cold-airpost': () => { const r = ring(8, 0.55, 0).map(([x, , z]) => [x, 1.1 + z, 0]); return { [L]: r.map((p, i) => bar(p, r[(i + 1) % 8], 0.05)), [O]: [0, 2, 4, 6].map(i => tri([0, 1.1, 0.06], r[i], r[(i + 1) % 8])), [D]: [bar([0, 0, 0], [0, 0.55, 0], 0.08), box(0.6, 0.08, 0.5)] }; },
  'cold-auxgen': () => { const w = ring(8, 0.42, 0).map(([x, , z]) => [0.62, 0.5 + x, z]); return { [L]: [box(1.0, 0.65, 0.6, -0.05, 0.12, 0)], [O]: w.map((p, i) => tri(p, w[(i + 1) % 8], [0.62, 0.5, 0])), [D]: [box(1.5, 0.1, 0.8, 0.1), cyl(0.07, 0.07, 0.5, 5, -0.35, 0.75, 0)] }; },
  'cold-lander': () => { const a = ring(8, 0.5, 0.55), b = ring(8, 0.85, 0.85), c = ring(8, 0.7, 1.5), d = ring(8, 0.3, 1.85); return { [L]: [...skin(a, b), ...skin(b, c), ...skin(c, d), ...cap(d, 1.87)], [D]: ring(4, 0.75, 0, 0.5).flatMap(([x, , z]) => [bar([x, 0.85, z], [x * 1.6, 0, z * 1.6], 0.06), box(0.28, 0.06, 0.28, x * 1.6, 0, z * 1.6)]), [O]: [cyl(0.32, 0.16, 0.35, 6, 0, 0.2, 0), box(0.4, 0.55, 0.12, 0.0, 0.95, 0.76)] }; },
};

const COLOR = { light: [0.85, 0.9, 1], mid: [0.6, 0.65, 0.75], dark: [0.35, 0.38, 0.45] };
function glb(groups, name) {
  // 바닥 가운데를 원점, 가장 긴 변을 1 로 (정리 도구와 같은 규칙)
  const all = new THREE.Box3();
  for (const list of Object.values(groups)) for (const g of list) { g.computeBoundingBox(); all.union(g.boundingBox); }
  const size = all.getSize(new THREE.Vector3()), longest = Math.max(size.x, size.y, size.z), mid = all.getCenter(new THREE.Vector3());
  const chunks = [], accessors = [], views = [], primitives = [], materials = [];
  let offset = 0, tris = 0;
  for (const [tone, list] of Object.entries(groups)) {
    const raw = list.flatMap(g => Array.from(g.getAttribute('position').array)), p = new Float32Array(raw.length), min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (let i = 0; i < raw.length; i++) { const k = i % 3; p[i] = (raw[i] - (k === 1 ? all.min.y : mid.getComponent(k))) / longest; min[k] = Math.min(min[k], p[i]); max[k] = Math.max(max[k], p[i]); }
    tris += p.length / 9;
    const buf = Buffer.from(p.buffer);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target: 34962 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: p.length / 3, type: 'VEC3', min, max });
    materials.push({ name: tone, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...COLOR[tone], 1] } });
    primitives.push({ attributes: { POSITION: accessors.length - 1 }, material: materials.length - 1 });
    chunks.push(buf); offset += buf.length;
  }
  const bin = Buffer.concat(chunks);
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0', generator: 'tidelocked-habitat scripts/make-cold-models.mjs', copyright: 'CC0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ primitives }], materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }] }));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + bin.length, 8);
  const chunk = (n, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(type, 4); return b; };
  return { data: Buffer.concat([head, chunk(json.length, 0x4E4F534A), json, chunk(bin.length, 0x004E4942), bin]), longest, tris };
}
const root = new URL('../src/', import.meta.url), sizesFile = new URL('modelSizes.json', root), sizes = JSON.parse(fs.readFileSync(sizesFile));
for (const [name, make] of Object.entries(MODELS)) {
  const { data, longest, tris } = glb(make(), name);
  fs.writeFileSync(new URL(`models/${name}.glb`, root), data);
  sizes.sizes[name] = Math.round(longest / sizes.tile * 1000) / 1000; // 여기 길이는 지역 단위라 tile 로 나눠 둔다 (scale 1 = 이 파일의 크기)
  console.log(name.padEnd(20), '삼각형', tris);
}
fs.writeFileSync(sizesFile, JSON.stringify(sizes, null, 2) + '\n');
