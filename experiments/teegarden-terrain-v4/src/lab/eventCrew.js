// 돌발상황 견본의 대원: 게임과 같은 사람 모델(human.glb)을 같은 점 머티리얼로 그린다 (people.js 의 방식).
// 멀쩡함 → 지침(웅크리고 주황으로 깜빡임) → 쓰러짐. 색은 palette.js 함수로만.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { blueStep, cream, orange } from '../palette.js';
import { prepareRig, createSkinner } from '../pointRig.js';
import humanUrl from '../models/human.glb';

const HEIGHT = 0.62, SAMPLES = 4000, WEIGHT = 1, GLOW = 0.5;
const COLLAPSE = 2; // 시간 초과일 때 쓰러지는 사람 수 (사건 글: 대원 둘이 쓰러졌어요)

/** spots: [[x, z], …]. addPoints·linear 는 eventLab 의 것 */
export async function createCrew({ spots, ground, addPoints, linear }) {
  const gltf = await new GLTFLoader().loadAsync(humanUrl), prep = prepareRig(gltf.scene, { samples: SAMPLES }), scale = HEIGHT / prep.height;
  const clip = name => gltf.animations.find(c => c.name === name) ?? gltf.animations.find(c => c.name === 'Idle_Loop');
  const tone = fn => {
    const out = new Float32Array(SAMPLES * 3);
    for (let k = 0; k < SAMPLES; k++) out.set(fn((prep.restY[k] - prep.bottom) / prep.height > 0.86, 0.5 + 0.5 * Math.max(0, prep.normalY[k])).map(c => c * GLOW), k * 3);
    return linear(out);
  };
  const tones = { ok: tone((head, lit) => (head ? cream(0.9) : blueStep(0.5 + 0.45 * lit))), tired: tone((head, lit) => (head ? orange(1.2) : orange(0.5 + 0.5 * lit))) };
  const people = spots.map(([x, z], i) => {
    const rig = cloneSkinned(gltf.scene), mixer = new THREE.AnimationMixer(rig);
    const drawn = addPoints({ positions: new Float32Array(SAMPLES * 3), colors: new Float32Array(SAMPLES * 3) }, WEIGHT);
    drawn.points.scale.setScalar(scale);
    drawn.points.position.set(x, ground(x, z) - prep.bottom * scale, z);
    drawn.points.rotation.y = i * 1.9 + 0.6;
    return { ...drawn, mixer, skin: createSkinner(rig, prep), action: null, name: '', phase: i * 1.3 };
  });
  function play(p, name, once = false) {
    if (p.name === name) return;
    const next = p.mixer.clipAction(clip(name));
    next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); next.clampWhenFinished = once;
    next.time = once ? 0 : p.phase % next.getClip().duration;
    next.play();
    if (p.action) next.crossFadeFrom(p.action, 0.35, false);
    p.action = next; p.name = name;
  }
  return {
    /** state: 'calm' | 'ask' | 'done', answer: 고른 대응 id, t: 사건 뒤 초 */
    frame(dt, state, answer, t, heal) {
      people.forEach((p, i) => {
        const late = i * 0.35, tired = state !== 'calm' && t > late;
        if (!tired || heal > 0.5) play(p, heal > 0.5 ? 'Idle_Loop' : 'Fixing_Kneeling');
        else if (answer === 'timeout' && i < COLLAPSE) play(p, 'Death01', true);
        else if (answer === 'push' && i >= COLLAPSE) play(p, 'Fixing_Kneeling');
        else play(p, 'Crouch_Idle_Loop');
        p.mixer.update(dt * (tired && heal < 0.5 && p.name !== 'Death01' ? 0.6 : 1));
        p.skin(p.pos.array); p.pos.needsUpdate = true;
        // 지치면 주황으로 천천히 깜빡인다. 쓰러지면 늘 주황
        const down = p.name === 'Death01', sick = tired && heal <= 0.5, tone = sick ? tones.tired : tones.ok, k = sick && !down ? 0.7 + 0.3 * Math.sin(t * 5 + p.phase) : 1; // 파랑과 섞지 않는다 (분홍빛이 된다)
        for (let j = 0; j < p.col.array.length; j++) p.col.array[j] = tone[j] * k;
        p.col.needsUpdate = true;
      });
    }
  };
}
