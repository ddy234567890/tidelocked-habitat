import assert from 'node:assert/strict';
import { fromGameStats } from '../src/face/envInput.js';
import { applyProtection } from '../src/face/protection.js';
import { Physiology } from '../src/face/physiology.js';
import hud from '../src/hud.json' with { type: 'json' };

// 기온만 정해진 값으로 넣고 나머지는 평소 공기일 때의 신체 상태 (crew.js 와 같은 방식)
function run(stats, seconds) {
  const env = fromGameStats(stats), eff = applyProtection(env), body = new Physiology();
  let state;
  for (let t = 0; t < seconds; t += 0.1) state = body.step(env, eff, 0.1);
  return state;
}
const calm = run({}, 30);
assert.equal(Object.values(calm.level).every(v => v === 0), true, '평소 상태는 모두 정상');
assert.ok(calm.spo2Pct >= 95 && calm.coreC < 37.5);

// 지대 기온 범위의 가운데 값(평원 60.5°C)에서는 열 스트레스가 올라간다
const [lo, hi] = hud.sites.plain.temperature;
const hot = run({ tempC: (lo + hi) / 2 }, 60);
assert.ok(hot.level.heat >= 1, '평원 기온에서 열 스트레스');
assert.ok(hot.coreC > calm.coreC);
assert.equal(hot.level.hypoxia, 0, '기온만으로 호흡곤란이 되지는 않는다');

// 용암동굴(25~30°C)은 쾌적한 범위
const [clo, chi] = hud.sites.lavaTube.temperature;
assert.equal(run({ tempC: (clo + chi) / 2 }, 60).level.heat, 0);

// 산소가 모자라면 호흡곤란 단계가 올라간다
assert.ok(run({ oxygenPct: 10 }, 60).level.hypoxia >= 1);
// 입력이 이상해도 계산이 멈추지 않는다
assert.ok(Number.isFinite(run({ tempC: NaN, oxygenPct: undefined }, 5).spo2Pct));
console.log('PASS: crew face body model — calm baseline, plain heat, cave comfort, low oxygen, bad input.');
