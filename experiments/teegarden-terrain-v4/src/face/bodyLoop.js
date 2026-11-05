// 환경 입력 → 보호장비·실내 반영 → 신체 상태 계산을 고정 간격으로 돌리는 루프.
// 화면(requestAnimationFrame)과 분리되어 있어서, 프레임이 떨어져도 계산 속도는 같아요.
import { normalizeEnv } from './envInput.js';
import { applyProtection } from './protection.js';
import { Physiology, GAME } from './physiology.js';

/**
 * @param {{getEnv:()=>object, dt?:number, onState?:(s:object)=>void, onLevelChange?:(key:string, from:number, to:number)=>void, autoStart?:boolean}} o
 */
export function createBodyLoop({ getEnv, dt = GAME.dt, onState, onLevelChange, autoStart = true } = {}) {
  const phys = new Physiology();
  let env = normalizeEnv(getEnv ? getEnv() : {});
  let timer = null, last = null, acc = 0, prevLevel = null;

  function tick() {
    env = normalizeEnv(getEnv ? getEnv() : {});
    const eff = applyProtection(env);
    const s = phys.step(env, eff, dt);
    s.env = env;
    if (prevLevel && onLevelChange) for (const k in s.level) if (s.level[k] !== prevLevel[k]) onLevelChange(k, prevLevel[k], s.level[k]);
    prevLevel = { ...s.level };
    if (onState) onState(s);
    return s;
  }
  // 실제 흐른 시간만큼 고정 간격 step을 따라잡아요 (탭이 잠깐 멈춰도 최대 2초까지만)
  function pump() {
    const now = performance.now() / 1000;
    if (last === null) last = now;
    acc = Math.min(acc + (now - last), 2); last = now;
    while (acc >= dt) { tick(); acc -= dt; }
  }
  const api = {
    start() { if (!timer) { last = null; timer = setInterval(pump, dt * 1000); tick(); } return api; },
    stop() { clearInterval(timer); timer = null; return api; },
    /** 게임 루프에서 직접 돌리고 싶을 때: 고정 간격 한 번 */
    tick,
    reset() { phys.reset(); prevLevel = null; return api; },
    get state() { return phys.state; },
    get env() { return env; },
  };
  if (autoStart) api.start();
  return api;
}
