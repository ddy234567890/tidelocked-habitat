// 사람 배치 실험의 계산 부분 (화면은 src/people.js). three.js 없이 돌아서 tests/people.test.js 가 그대로 검사한다.
// 사람마다 대원 얼굴과 같은 신체 엔진(src/face/physiology.js)을 하나씩 돌린다. 수치는 게임용 근사값이다 (의학 시뮬레이션 아님).
//
// 사람이 마시는 공기는 서 있는 자리로 정한다.
//  - 바깥: 그 지대의 바깥 기온(hud.json 범위의 가운데 값), 바깥 산소(hud.json outsideOxygen, 약 14%), 지금 하는 행동의 활동량(뛰면 숨이 더 차고 더 더워진다)
//  - 집 안(주거 모듈 바닥 반지름 안): 실내 기본값 + 지금까지 결정한 선지 stats. 산소는 산소 방식을 결정해야 실내 값이고, 그 전에는 바깥 공기다
// 대원 얼굴(crew.js)과 같은 기본값을 쓴다.
import { fromGameStats } from './face/envInput.js';
import { applyProtection } from './face/protection.js';
import { Physiology, GAME } from './face/physiology.js';
import hud from './hud.json' with { type: 'json' };

export const INDOOR = { tempC: 22, oxygenPct: 20.9, activityMET: 1.5 };   // crew.js · main.js 의 INDOOR 와 같은 값
export const OUTSIDE_MET = 4;                                             // crew.js OUTSIDE_MET 과 같은 값 (바깥에서 공사하는 활동량)
export const DOWN_AFTER = 2.5;    // 위험한 상태가 이만큼(초) 이어지면 쓰러진다 (사람마다 버티는 힘 fit 을 곱한다)
export const UP_AFTER = 3;        // 쓰러진 뒤 위험이 사라지고 이만큼(초) 지나면 다시 일어난다 (fit 으로 나눈다)
// 행동별 활동량 (MET): 바깥에서 쓰는 값. 뛰면 산소를 더 쓰고 몸이 더 더워진다
export const ACT_MET = { idle: 1.8, walk: 3, home: 3, out: 3, door: 2, work: 4, rest: 1.4, flinch: 2, run: 7, sprint: 9, crawl: 3.5, help: 3.5, carry: 5.5, carried: 1, shove: 6, shoved: 2, down: 1, getup: 1.5, talk: 1.6, tend: 3, inspect: 3, movein: 3, look: 1.8, fix: 4, operate: 2 };
export const STATUS_NAMES = { ok: '괜찮음', tired: '힘들어함', down: '쓰러짐' };
const CAUSES = [['hypoxia', '숨이 참'], ['heat', '더위'], ['cold', '추위'], ['pressure', '압력'], ['fatigue', '지침']];

/** (x, z) 자리가 집 안인지 바깥인지. homes 는 placement.js 의 { at: [x, y, z], r } */
export function placeOf(x, z, homes = []) {
  return homes.some(h => Math.hypot(x - h.at[0], z - h.at[2]) <= h.r) ? 'home' : 'outside';
}

/** 자리와 지금까지의 결정으로 그 사람이 겪는 환경 (게임 스탯 꼴: tempC · oxygenPct · activityMET) */
export function envFor({ site, place, stats = {}, decided = {}, met = OUTSIDE_MET }) {
  const range = hud.sites[site]?.temperature;
  const outsideTemp = range ? (range[0] + range[1]) / 2 : 22;
  const outsideO2 = hud.outsideOxygen ?? 14;
  if (place !== 'home') return { tempC: outsideTemp, oxygenPct: outsideO2, activityMET: met };
  const add = key => INDOOR[key] + (stats[key] ?? 0);
  return { tempC: add('tempC'), oxygenPct: decided.oxygen ? add('oxygenPct') : outsideO2, activityMET: add('activityMET') };
}

/** 신체 상태 → 위험한지(쓰러질 만큼), 힘든지, 가장 큰 원인 */
export function judge(s) {
  const [key, name] = CAUSES.map(c => [...c, s.level[c[0]], s.sev[c[0]]]).sort((a, b) => b[2] - a[2] || b[3] - a[3])[0];
  const critical = s.spo2Pct < 80 || s.coreC >= 39.5 || s.coreC <= 35 || s.level.hypoxia === 2 || s.level.heat === 2 || s.level.cold === 2;
  const strained = critical || Object.values(s.level).some(v => v >= 1);
  return { critical, strained, cause: strained ? name : null, causeKey: strained ? key : null };
}

/** 한 사람. step(환경, 초) 를 고정 간격으로 부르면 status 가 ok → tired → down 으로 바뀌고, 환경이 나아지면 돌아온다 */
export class Person {
  /** fit: 버티는 힘 (1 = 보통, 클수록 늦게 쓰러지고 빨리 일어난다). 같은 곳에 여럿을 놓아도 저마다 다른 때 쓰러지게 한다 */
  constructor(x, z, { fit = 1 } = {}) {
    this.x = x; this.z = z; this.fit = fit;
    this.downAfter = DOWN_AFTER * fit; this.upAfter = UP_AFTER / fit;
    this.body = new Physiology();
    this.status = 'ok'; this.cause = null; this.place = 'outside'; this.env = null; this.state = null;
    this.risk = 0;   // 위험한 상태가 이어진 시간 (초)
    this.calm = 0;   // 쓰러진 뒤 위험이 사라진 시간 (초)
  }
  step(envStats, dt = GAME.dt) {
    const env = fromGameStats(envStats);
    this.env = envStats;
    this.state = this.body.step(env, applyProtection(env), dt);
    const j = judge(this.state);
    this.cause = j.cause;
    if (this.status === 'down') {
      this.calm = j.critical ? 0 : this.calm + dt;
      if (this.calm >= this.upAfter) { this.status = j.strained ? 'tired' : 'ok'; this.risk = 0; }
    } else {
      this.risk = j.critical ? this.risk + dt : Math.max(0, this.risk - dt);
      if (this.risk >= this.downAfter) { this.status = 'down'; this.calm = 0; }
      else this.status = j.strained ? 'tired' : 'ok';
    }
    return this.status;
  }
  /** 쓰러지기까지 얼마나 왔는지 0~1 (행동을 고를 때: 많이 왔으면 기어서라도 피한다) */
  get danger() { return this.status === 'down' ? 1 : Math.min(1, this.risk / this.downAfter); }
}
