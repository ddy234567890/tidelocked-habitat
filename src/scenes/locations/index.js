import { buildPlain } from './plain.js';
import { buildLavaTube } from './lavaTube.js';

/**
 * 위치 무대 목록. 선지 JSON 의 layers.location.<id>.stage 값이 여기 이름이다.
 * 새 무대(용암동굴, 능선)를 만들면 이름과 함수를 한 줄 더하면 된다.
 * 각 함수는 (점 개수, JSON 정의) → { positions, colors, shake? } 를 돌려준다. 색은 이미 점 색 규칙에 맞춘 값이고,
 * shake(점마다 0~1)는 있으면 그 점이 미세하게 떨린다.
 */
const stages = {
  plain: buildPlain,
  lava_tube: buildLavaTube,
};

export function buildStage(name, count, def) {
  const build = stages[name];
  if (!build) throw new Error(`locations: '${name}' 무대가 없어요 (src/scenes/locations/index.js 에 추가하세요)`);
  return build(count, def);
}
