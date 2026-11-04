import { autoMap, tokens } from '../src/engine/face/blendshapeMap.js';
const sets = {
  arkit: ['eyeBlinkLeft','eyeBlinkRight','jawOpen','browInnerUp','mouthFunnel','noseSneerLeft','noseSneerRight','cheekPuff','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight','browDownLeft','browDownRight','mouthPressLeft','mouthPressRight'],
  prefixed: ['blendShape1.eyeBlink_L','blendShape1.eyeBlink_R','blendShape1.jawOpen','blendShape1.browInnerUp'],
  cc: ['Eye_Blink_L','Eye_Blink_R','Brow_Raise_Inner','Brow_Drop_L','Brow_Drop_R','Jaw_Open','Jaw_L','Jaw_R','Mouth_Press_L','Nose_Sneer_L','Cheek_Squint_L','Cheek_Puff','Mouth_Stretch_R'],
  vrm: ['Blink_L','Blink_R','A','I','U','E','O','Joy'],
  other: ['EyesClosed_L','MouthOpen','BrowsUp'],
};
for (const [k,v] of Object.entries(sets)) { const r = autoMap(v); console.log(k, Object.entries(r.map).filter(e=>e[1]).map(e=>e[0]+'←'+e[1]).join(', '), '| 못 찾음', r.unmapped.length, '| 안 쓰임', r.unused.join(',')); }
