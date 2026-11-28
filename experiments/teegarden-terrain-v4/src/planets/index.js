// 행성 목록과 지금 하는 행성. 행성을 더할 때는 폴더를 만들고 PLANETS 에 한 줄 더한다.
// 어느 행성을 할지는 주소 뒤 ?planet=c 로 정한다 (없거나 모르는 이름이면 b). 접속 화면에서 다른 행성을 고르면 그 주소로 새로 불러온다 (prologue.js).
import b from './b/index.js';
import c from './c/index.js';

export const PLANETS = { b, c };
const asked = new URLSearchParams(globalThis.startParams ?? globalThis.location?.search ?? '').get('planet');
// 준비가 덜 된 행성(planet.json ready: false)은 화면에서는 열리지 않고, 화면 없는 시험에서만 고를 수 있다
const open = Object.hasOwn(PLANETS, asked ?? '') && (PLANETS[asked].ready || !globalThis.document);
/** 다시 시작할 때 주소에 붙일 것 (b 는 없음) */
export const restartQuery = open && asked !== 'b' ? '?planet=' + asked : '';
export const PLANET = open ? PLANETS[asked] : PLANETS.b;

/** 접속 화면에서 고른 행성으로 시작할 주소(?…). 지금 행성이거나 할 수 없는 행성이면 null (새로 불러올 필요 없음) */
export function planetSearch(id, search = '') {
  if (id === PLANET.id || !Object.hasOwn(PLANETS, id) || !PLANETS[id].ready) return null;
  const params = new URLSearchParams(search);
  for (const key of ['week', 'site']) params.delete(key); // 다른 행성의 바로가기 값은 버린다
  params.set('planet', id);
  params.set('prologue', '0'); // 방금 접속 화면을 지나왔다
  return '?' + params;
}
