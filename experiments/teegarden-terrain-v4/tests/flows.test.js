import assert from 'node:assert/strict';
import { flowsFor, FLOW_AMOUNT, roomAirFor } from '../src/choices.js';
import { buildFlowPoints, pairSpots, outSpots, arcPath, waterSources } from '../src/flows.js';
import { choiceData } from '../src/choices.js';

// 물 흐름은 고른 단계만 잇고, 아직 고르지 않은 단계는 건너뛴다
const base = { location: 'A', module: 'A1', oxygen: 'O1', power: 'P1', storage: 'S1', heat: 'T1' };
const water = selection => flowsFor(selection).filter(f => f.kind === 'water' || f.kind === 'usedWater');
assert.deepEqual(water(base), [], '3주차 전에는 물 흐름이 없다');
const one = water({ ...base, source: 'W1' });
assert.equal(one.length, 1);
assert.deepEqual(one[0].nodes.map(n => n.id), ['source', 'homes']);
assert.equal(one[0].amount, 1, 'W1 은 물을 많이 얻는다');
assert.equal(water({ ...base, source: 'W2' })[0].amount, 0.45, 'W2 는 나오는 물이 적다');

const r1 = water({ ...base, source: 'W2', reuse: 'R1', share: 'D2' });
assert.deepEqual(r1.map(f => f.kind), ['water', 'usedWater']);
assert.deepEqual(r1[0].nodes.map(n => n.overlay ?? n.id), ['soil_heater', 'basic_filter', 'zone_tanks', 'homes']);
assert.deepEqual(r1[1].nodes.map(n => n.id), ['homes', 'out'], 'R1 은 쓴 물을 버린다');
const r2 = water({ ...base, source: 'W1', reuse: 'R2' });
assert.deepEqual(r2[1].nodes.map(n => n.overlay ?? n.id), ['homes', 'water_plant'], 'R2 는 쓴 물을 재생 설비로 되돌린다');
assert.ok(FLOW_AMOUNT > 0 && FLOW_AMOUNT <= 1);

// 자리 잇기: 개수가 같으면 짝, 아니면 모두
assert.equal(pairSpots([[0, 0, 0]], [[1, 0, 0], [2, 0, 0], [3, 0, 0]]).length, 3);
assert.deepEqual(pairSpots([[0, 0, 0], [1, 0, 0]], [[5, 0, 0], [6, 0, 0]])[1], [[1, 0, 0], [6, 0, 0]]);
const [out] = outSpots([[1, 0, 0]], [0, 0, 0]);
assert.ok(out[0] > 1 && out[2] === 0, '버리는 흐름은 기지 바깥쪽으로 뻗는다');

// 길은 땅 위로 뜨고, 양이 많을수록 흐르는 점이 많다
const path = arcPath([0, 0, 0], [4, 0, 0], () => 0.5);
assert.ok(path.at(0.5)[1] > 0.5 && path.length >= 4);
const count = amount => buildFlowPoints([{ kind: 'water', amount, segments: [[[0, 0, 0], [4, 0, 0]]] }]).positions.length;
assert.ok(count(1) > count(0.45));
const flow = buildFlowPoints([{ kind: 'water', amount: 1, segments: [[[0, 0, 0], [4, 0, 0]]] }]);
const pos = flow.positions.slice(), col = flow.colors.slice();
flow.animate(pos, col, flow.colors, 0.7, 1);
assert.notDeepEqual(pos, flow.positions, '시간이 지나면 흐르는 점이 움직인다');
assert.ok([...col].every(Number.isFinite));

// 물이 나는 곳: 한 수원은 지대마다 물웅덩이(A·B)·얼음(C), 흙 추출은 넓은 흙 물기. 흐름은 그 자리에서 시작한다
const overlay = choiceData.layers.overlay;
assert.equal(waterSources(overlay.water_source, 'A', [[0, 0, 0]]).sources[0].type, 'pool');
assert.equal(waterSources(overlay.water_source, 'C', [[0, 0, 0]]).sources[0].type, 'ice');
const seep = waterSources(overlay.soil_heater, 'B', [[1, 0, 2]]);
assert.equal(seep.sources[0].type, 'seep');
assert.deepEqual(seep.anchors, [[1, 0, 2]]);
assert.ok(seep.sources[0].r > waterSources(overlay.water_source, 'A', [[0, 0, 0]]).sources[0].r * 2, '흙 물기는 물웅덩이보다 훨씬 넓게 퍼진다');
assert.deepEqual(waterSources(overlay.basic_filter, 'A', [[3, 0, 3]]), { anchors: [[3, 0, 3]], sources: [] });
for (const type of ['pool', 'ice', 'seep']) {
  const built = buildFlowPoints([], () => 0, [{ type, r: type === 'seep' ? 6 : 1, center: [0, 0, 0] }]);
  assert.ok(built.positions.length > 300, type + ' 점이 그려진다');
  const p = built.positions.slice(), c = built.colors.slice();
  built.animate(p, c, built.colors, 1.3, 1);
  assert.ok([...p, ...c].every(Number.isFinite));
}
// 굵기: 많이(1)는 적게(0.45)보다 흐르는 점이 훨씬 많다
assert.ok(count(1) > count(0.45) * 2);

// 산소: 장치 → 집. 물 회수형(O2)만 내쉰 공기가 장치로 돌아간다. 분산형(O3)은 장치마다 양이 적다
const air = flowsFor({ location: 'A', module: 'A1', oxygen: 'O2' });
assert.deepEqual(air.map(f => f.kind), ['oxygen', 'exhaled']);
assert.deepEqual(flowsFor({ location: 'A', module: 'A1', oxygen: 'O1' }).map(f => f.kind), ['oxygen']);
assert.ok(flowsFor({ location: 'A', module: 'A1', oxygen: 'O3' })[0].amount < flowsFor({ location: 'A', module: 'A1', oxygen: 'O1' })[0].amount);
// 전기: 발전 → 배터리 → 집·산소 장치. 배터리를 고르기 전에는 발전에서 바로 간다. 냉방기(T2)는 전기를 받는다. 태양광만 양이 오르내린다
const power = selection => flowsFor(selection).filter(f => f.kind === 'power');
assert.deepEqual(power({ ...base, storage: undefined, heat: undefined, power: 'P1' }).map(f => f.nodes.map(n => n.id)), [['power', 'homes'], ['power', 'oxygen']]);
assert.deepEqual(power(base).map(f => f.nodes.map(n => n.id)), [['power', 'storage', 'homes'], ['power', 'storage', 'oxygen']]);
assert.equal(power({ ...base, heat: 'T2' }).length, 3);
assert.ok(power(base)[0].vary > 0 && power({ ...base, power: 'P2' })[0].vary === 0);
const bolt = buildFlowPoints([{ kind: 'power', amount: 1, segments: [[[0, 0, 0], [4, 0, 0]]] }]);
assert.ok([...bolt.weights].filter(w => w === 0).length < bolt.weights.length / 10, '전기는 가는 선 점으로 그린다 (양 끝 불꽃만 굵다)');
const bp = bolt.positions.slice(), bc = bolt.colors.slice();
bolt.animate(bp, bc, bolt.colors, 0.9, 1);
assert.ok([...bp, ...bc].every(Number.isFinite));

// 분산형 산소는 집마다 구역 고리, 방열판·냉방기는 더운 공기를 내보낸다. 방열판은 집의 열을, 냉방기는 찬 공기를 옮긴다
const zone = waterSources(overlay.small_units, 'A', [[1, 0, 0], [5, 0, 0]], [{ at: [0, 0, 0], r: 0.5 }, { at: [4, 0, 0], r: 0.5 }]);
assert.deepEqual(zone.sources.map(s => s.type), ['zone', 'zone']);
assert.equal(waterSources(overlay.radiator, 'A', [[0, 0, 0]]).sources[0].type, 'radiate');
assert.equal(waterSources(overlay.air_conditioners, 'A', [[0, 0, 0], [1, 0, 0]]).sources.length, 0, '냉방기는 뜨거운 공기가 들어가고 찬 공기가 나오는 흐름만 그린다');
const heat = selection => flowsFor(selection).filter(f => f.kind === 'heat' || f.kind === 'cool').map(f => f.kind);
assert.deepEqual(heat(base), ['heat']);
assert.deepEqual(heat({ ...base, heat: 'T2' }), ['heat', 'cool']);
for (const source of [{ type: 'radiate', r: 1, center: [0, 0, 0] }, { type: 'zone', r: 1, center: [0, 0, 0], unit: [0.8, 0, 0] }]) {
  const built = buildFlowPoints([], () => 0, [source]);
  const p = built.positions.slice(), c = built.colors.slice();
  built.animate(p, c, built.colors, 2.1, 1);
  assert.ok(built.positions.length > 100 && [...p, ...c].every(Number.isFinite), source.type);
}

// 집 안 공기: 2주차에 열 방법을 고르기 전에는 덥고, 고르면 시원하다. 다른 주에는 그리지 않는다
assert.equal(roomAirFor({ ...base, heat: undefined }, 2), 'hot');
assert.equal(roomAirFor(base, 2), 'cool');
assert.equal(roomAirFor(base, 3), null);
for (const air of ['hot', 'cool']) {
  const built = buildFlowPoints([], () => 0, [{ type: 'room', air, r: 1, center: [0, 0, 0], top: 1.2 }]);
  const p = built.positions.slice(), c = built.colors.slice();
  built.animate(p, c, built.colors, 1.7, 1);
  assert.ok(built.positions.length > 100 && [...p, ...c].every(Number.isFinite), air);
}

// 배터리로 저장하러 가는 전기는 땅 밑으로 간다
assert.equal(power(base)[0].below, 'storage');
const under = arcPath([0, 0, 0], [4, 0, 0], () => 0, true);
assert.ok(under.at(0.5)[1] < -0.3 && Math.abs(under.at(0)[1]) < 1e-9, '땅속 전선은 가운데가 땅 밑으로 내려간다');
console.log('flows ok');
