// 블렌드셰이프(표정) 이름 검사·매핑
// 얼굴 제어는 ARKit 52개 표준 이름 중 아래 목록을 "기준 이름"으로 써요.
// 실제 모델은 이름이 제각각이라(Eye_Blink_L, EyeBlink_L, blink_left …) 자동으로 짝을 찾고, 못 찾은 건 직접 고를 수 있게 해요.

export const CANONICAL = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeWideLeft', 'eyeWideRight', 'eyeSquintLeft', 'eyeSquintRight',
  'browInnerUp', 'browDownLeft', 'browDownRight', 'browOuterUpLeft', 'browOuterUpRight',
  'noseSneerLeft', 'noseSneerRight', 'cheekSquintLeft', 'cheekSquintRight', 'cheekPuff',
  'jawOpen', 'jawLeft', 'jawRight',
  'mouthFunnel', 'mouthStretchLeft', 'mouthStretchRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthPressLeft', 'mouthPressRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthRollLower', 'mouthRollUpper', 'mouthPucker', 'jawForward',
  'nostrilDilate',   // ARKit에는 없음: FACS AU38 콧구멍 벌림. 모델에 없으면 noseSneer로 대신해요
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
];

// 같은 뜻의 다른 표기 → 기준 단어
const SYN = {
  l: 'left', lf: 'left', lt: 'left', r: 'right', rt: 'right',
  close: 'blink', closed: 'blink', shut: 'blink', blinks: 'blink',
  raise: 'up', raised: 'up', raiser: 'up', lift: 'up', drop: 'down', lowered: 'down', lowerer: 'down',
  squeeze: 'squint', flare: 'sneer', eyes: 'eye', brows: 'brow', eyebrow: 'brow', cheeks: 'cheek',
  lips: 'mouth', lip: 'mouth', widen: 'wide',
};
// 이름 앞에 붙는 잡음 (blendShape1.xxx, CC_, Head_ 같은 것)
const NOISE = new Set(['blendshape', 'blendshapes', 'shape', 'shapes', 'bs', 'key', 'keys', 'morph', 'target', 'head', 'face', 'geo', 'mesh', 'cc', 'ctrl', 'arkit', 'wolf3d']);

export function tokens(name) {
  const parts = String(name)
    .replace(/^.*[.:|]/, '')                       // "blendShape1.eyeBlink_L" → "eyeBlink_L"
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')        // camelCase 쪼개기
    .replace(/[_\-\s]+/g, ' ')
    .toLowerCase().split(' ').filter(Boolean);
  return parts.map(p => SYN[p] || p).filter(p => !NOISE.has(p) && !/^[a-z]?\d+$/.test(p)).sort();
}
// 단어 묶음이 통째로 다른 경우 (모델 쪽 표기 → 기준 표기)
const ALIAS = { 'mouth open': 'jaw open', 'blink left': 'blink eye left', 'blink right': 'blink eye right',
  'down jaw': 'jaw open', 'inner up': 'brow inner up', 'brow up': 'brow inner up' };
const key = (n) => { const k = tokens(n).join(' '); return ALIAS[k] || k; };

/**
 * @param {string[]} modelNames  모델에 들어 있는 블렌드셰이프 이름
 * @returns {{map:Object<string,string|null>, unmapped:string[], unused:string[]}}
 */
export function autoMap(modelNames) {
  const exact = new Map(modelNames.map(n => [n.toLowerCase(), n]));
  const byKey = new Map(); for (const n of modelNames) { const k = key(n); if (!byKey.has(k)) byKey.set(k, n); }
  const map = {};
  for (const c of CANONICAL) map[c] = exact.get(c.toLowerCase()) || byKey.get(key(c)) || null;
  const used = new Set(Object.values(map).filter(Boolean));
  return { map, unmapped: CANONICAL.filter(c => !map[c]), unused: modelNames.filter(n => !used.has(n)) };
}

/** 장면 안의 모든 메시에서 블렌드셰이프 이름을 모아요 (머리·눈·치아가 따로 있어도) */
export function collectMorphMeshes(root) {
  const meshes = [];
  root.traverse(o => { if (o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) meshes.push(o); });
  const names = [...new Set(meshes.flatMap(m => Object.keys(m.morphTargetDictionary)))];
  return { meshes, names };
}

/**
 * 기준 이름 가중치 → 각 메시의 morphTargetInfluences에 적용
 * @param {THREE.Mesh[]} meshes @param {Object<string,string|null>} map @param {Object<string,number>} weights
 */
export function applyWeights(meshes, map, weights) {
  for (const m of meshes) {
    const inf = m.morphTargetInfluences, dict = m.morphTargetDictionary;
    for (const c in map) {
      const target = map[c]; if (!target) continue;
      const i = dict[target]; if (i === undefined) continue;
      inf[i] = Math.min(1, Math.max(0, weights[c] || 0));
    }
  }
}
