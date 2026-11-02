// 얼굴 패널 모듈 묶음. 게임에서는 이렇게 써요:
//   import { createBodyLoop, createFacePanel, fromGameStats } from './engine/face/index.js';
//   const body = createBodyLoop({ getEnv: () => fromGameStats(game.stats, game.extra) });
//   const face = createFacePanel({ container: el, getBody: () => body.state, modelUrl: '/models/face/face.glb' });
export { DEFAULT_ENV, ENV_RANGES, normalizeEnv, fromGameStats } from './envInput.js';
export { applyProtection, PROTECTION_TUNING } from './protection.js';
export { Physiology, SCI, GAME, LEVEL_NAMES, inspiredO2KPa, severinghausSpO2, wetBulbStullC } from './physiology.js';
export { createBodyLoop } from './bodyLoop.js';
export { createFaceController } from './faceController.js';
export { CANONICAL, autoMap, tokens, collectMorphMeshes, applyWeights } from './blendshapeMap.js';
export { createTempHead, TEMP_TARGET_NAMES } from './tempHead.js';
export { rigScan, estimateLandmarks } from './scanRig.js';
export { buildPointGeometry, createPointMaterial } from './pointCloud.js';
export { createFacePanel } from './facePanel.js';
