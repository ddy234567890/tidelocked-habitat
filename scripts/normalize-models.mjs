// .glb 일괄 정리: public/models/raw 의 모든 .glb 를 같은 기준으로 맞춰 public/models 에 저장한다.
//   - 텍스처는 지운다 (점으로 그리므로 필요 없다. 재질 기본 색은 남겨 palette.js toneColors 가 밝기로 쓴다)
//   - 삼각형이 너무 많으면 줄인다 (점이 표면을 따라갈 만큼만 남긴다)
//   - 바닥 가운데를 원점에, 가장 긴 변을 1로 맞춘다
// 실행: npm run normalize:models
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TRIANGLES = Number(process.env.MAX_TRIANGLES) || 50000; // 이보다 많으면 줄인다 (환경 변수로 바꿀 수 있다)
const rawDir = fileURLToPath(new URL('../public/models/raw/', import.meta.url));
const outDir = fileURLToPath(new URL('../public/models/', import.meta.url));

await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const files = readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith('.glb'));
if (!files.length) {
  console.log('public/models/raw 에 .glb 파일이 없어요. 받은 모델을 넣고 다시 실행해 주세요.');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const input = join(rawDir, file);
  const output = join(outDir, basename(file));
  try {
    const report = await normalize(input, output);
    console.log(
      `✓ ${file}\n` +
        `    원래 크기  ${report.size.map((v) => v.toFixed(2)).join(' × ')} (가로 × 높이 × 깊이)\n` +
        `    삼각형    ${report.trisBefore.toLocaleString()} → ${report.trisAfter.toLocaleString()}\n` +
        `    파일      ${kb(statSync(input).size)} → ${kb(statSync(output).size)}`,
    );
  } catch (err) {
    failed++;
    const msg = String(err?.message ?? err);
    if (/draco/i.test(msg)) {
      console.error(`✗ ${file}: Draco로 압축된 모델이라 읽을 수 없어요. 받은 곳에서 압축하지 않은(.glb 기본) 버전으로 다시 받아 주세요.`);
    } else {
      console.error(`✗ ${file}: ${msg}`);
    }
  }
}
if (failed) process.exitCode = 1;

async function normalize(input, output) {
  const doc = await io.read(input);
  const root = doc.getRoot();
  const trisBefore = countTriangles(root);

  // 텍스처와 텍스처 좌표를 지운다 (재질의 기본 색 값은 남는다)
  for (const texture of root.listTextures()) texture.dispose();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (semantic.startsWith('TEXCOORD_') || semantic === 'TANGENT') prim.getAttribute(semantic).dispose();
      }
    }
  }

  // 삼각형이 많으면 줄인다
  if (trisBefore > MAX_TRIANGLES) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIANGLES / trisBefore, error: 0.001 }));
  }

  // 바닥 가운데를 원점으로, 가장 긴 변을 1로: 장면의 모든 노드를 새 뿌리 노드 아래로 옮기고 그 노드를 옮기고 키운다
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('모델에 장면(scene)이 없어요');
  const { min, max } = getBounds(scene);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(...size);
  if (!(longest > 0)) throw new Error('모델 크기가 0이에요 (표면이 있는 메시가 없어요)');
  const s = 1 / longest;
  const wrapper = doc.createNode('normalized');
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  wrapper.setScale([s, s, s]);
  wrapper.setTranslation([-((min[0] + max[0]) / 2) * s, -min[1] * s, -((min[2] + max[2]) / 2) * s]);

  await doc.transform(prune(), dedup());
  await io.write(output, doc);
  return { size, trisBefore, trisAfter: countTriangles(root) };
}

function countTriangles(root) {
  let total = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // 삼각형 목록만 센다
      const indices = prim.getIndices();
      total += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return total;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
