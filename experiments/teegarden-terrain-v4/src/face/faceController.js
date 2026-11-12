// 4단계: 신체 상태 → 얼굴 근육(FACS 동작 단위, AU) → 블렌드셰이프(ARKit 이름)
//
// FACS = 얼굴 표정을 "어떤 근육이 얼마나 움직였나"로 나눠 적는 표준 방법이에요. 근육 하나(또는 한 묶음)의 움직임을 AU라고 불러요.
//   예) AU1 안쪽 눈썹 올림 = 이마근 안쪽, AU4 눈썹 내림 = 눈썹주름근, AU26 턱 내림, AU38 콧구멍 벌림 = 코근
// 상태마다 "어떤 근육을 쓰는지"는 FACS의 근육 설명과 실제 행동(입으로 숨쉬기, 이 딱딱거림, 하품으로 귀 압력 맞추기 등)을 따랐고,
// 얼마나 세게·얼마나 빨리 움직이는지는 연출값 [GAME]이에요. 신체 상태 숫자는 physiology.js에서 와요.
// 화면 프레임마다 update(dt, bodyState)를 불러요. 신체 계산(0.1초 간격)과 따로 돌아요.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
/** 여러 원인이 같은 근육을 쓸 때: 그냥 더하면 1을 넘으니 "겹쳐서 더 세지되 1을 넘지 않게" 합쳐요 */
const union = (...xs) => 1 - xs.reduce((p, x) => p * (1 - clamp(x)), 1);

/** 화면에 보여 줄 AU 이름 (FACS 이름 · 근육) */
export const AU_NAMES = {
  1: '안쪽 눈썹 올림 · 이마근', 2: '바깥 눈썹 올림 · 이마근', 4: '눈썹 내림 · 눈썹주름근', 5: '윗눈꺼풀 올림 · 눈꺼풀올림근',
  6: '볼 올림 · 눈둘레근', 7: '눈꺼풀 조임 · 눈둘레근', 9: '코 찡그림 · 윗입술콧방울올림근', 10: '윗입술 올림 · 윗입술올림근',
  12: '입꼬리 당김 · 큰광대근', 14: '보조개 · 볼근', 15: '입꼬리 내림 · 입꼬리내림근', 16: '아랫입술 내림 · 아랫입술내림근',
  17: '턱끝 올림 · 턱끝근', 18: '입술 내밀기 · 입둘레근', 20: '입술 늘림 · 입꼬리당김근', 22: '입술 깔때기 · 입둘레근',
  24: '입술 누름 · 입둘레근', 25: '입술 벌림', 26: '턱 내림 · 깨물근 이완', 27: '입 크게 벌림 · 날개근·두힘살근',
  28: '입술 말아 넣기 · 입둘레근', 30: '턱 옆으로', 38: '콧구멍 벌림 · 코근', 41: '눈꺼풀 처짐', 43: '눈 감음',
};
// 근육이 켜질 때·풀릴 때 걸리는 시간(초). 대개 켜질 때가 빠르고 풀릴 때가 느려요 [GAME 추정]
const TAU = { on: 0.22, off: 0.55 };
const TAU_AU = { 26: [0.12, 0.3], 27: [0.15, 0.35], 38: [0.1, 0.25], 25: [0.12, 0.35], 41: [0.9, 1.4], 43: [0.25, 0.5], 22: [0.2, 0.3] };
const SIDED = [2, 4, 6, 7, 9, 10, 12, 14, 15, 16, 20, 24];

export function createFaceController({ random = Math.random, reducedMotion = false } = {}) {
  let t = 0, breath = 0, phase = 0, lastBreathRate = 14;
  const blink = { next: 1.5, start: -1, dur: [0.08, 0.04, 0.14], double: false };
  const act = { kind: null, start: -10, dur: 0, next: 0 };      // 하품·삼키기·턱 움직이기 같은 한 번짜리 동작
  const gz = { x: 0, y: 0, tx: 0, ty: 0, next: 0.6 };
  const sm = {}, au = {};
  const smooth = (k, v, dt, tau = 0.25) => { sm[k] = sm[k] === undefined ? v : sm[k] + (v - sm[k]) * (1 - Math.exp(-dt / tau)); return sm[k]; };
  const noise = (x, a, b, c) => 0.5 * Math.sin(x * a) + 0.3 * Math.sin(x * b + 1.7) + 0.2 * Math.sin(x * c + 4.1);
  // 사람 얼굴은 좌우가 똑같이 움직이지 않아요. 좌우 세기를 조금 다르게 [GAME]
  const gainL = 0.92 + random() * 0.08, gainR = 0.92 + random() * 0.08;

  let blinkUrge = 0;
  function blinkValue(F, H) {
    if (t >= blink.next && blink.start < 0) {
      blink.start = t; const k = 1 + 1.5 * F + 0.6 * ss(0.6, 1, H);   // 피로하면 천천히 감고 오래 감아요
      blink.dur = [0.08 * k, 0.04 * (1 + 3 * F), 0.14 * k];
    }
    if (blink.start < 0) return 0;
    const u = t - blink.start, [c, h, o] = blink.dur;
    let v = u < c ? u / c : u < c + h ? 1 : u < c + h + o ? 1 - (u - c - h) / o : -1;
    if (v < 0) {
      blink.start = -1;
      const dbl = !blink.double && random() < 0.15; blink.double = dbl;
      blink.next = t + (dbl ? 0.12 : (1.8 + random() * 3.2 * (1 - 0.35 * F)) * (1 - 0.45 * blinkUrge));   // 숨이 차거나 춥거나 더우면 더 자주 깜빡여요 [GAME]
      v = 0;
    }
    return v * v * (3 - 2 * v);
  }
  function gazeStep(dt, H, F, C, motion) {
    if (t >= gz.next) {
      const spread = (0.16 + 0.38 * H) * motion, baseY = -0.35 * F - 0.12 * C;
      let tx = (random() * 2 - 1) * spread, ty = baseY + (random() * 2 - 1) * spread * 0.55;
      if (random() < 0.4) { tx *= 0.2; ty = baseY; }
      if (Math.hypot(tx - gz.tx, ty - gz.ty) > 0.25 && random() < 0.35 && blink.start < 0) blink.next = t;
      gz.tx = tx; gz.ty = ty;
      gz.next = t + (0.7 + random() * 2.4) * (1 - 0.6 * H) * (1 + 0.8 * F);
    }
    const tau = 0.035 + 0.15 * F + 0.2 * ss(0.75, 1, H);
    const k = 1 - Math.exp(-dt / tau);
    gz.x += (gz.tx - gz.x) * k; gz.y += (gz.ty - gz.y) * k;
    const jitter = 0.006 * motion;
    return { x: gz.x + jitter * noise(t * 7, 3.1, 5.3, 8.9), y: gz.y + jitter * noise(t * 7 + 9, 2.7, 4.9, 7.7) };
  }
  /** 한 번짜리 동작의 진행 모양: 천천히 시작 → 유지 → 천천히 끝 (0~1) */
  function actCurve(kind) {
    if (act.kind !== kind) return 0;
    const u = (t - act.start) / act.dur; if (u < 0 || u > 1) return 0;
    return kind === 'yawn' ? ss(0, 0.35, u) * (1 - ss(0.7, 1, u)) : Math.sin(Math.PI * u);
  }

  /** AU 값을 목표로 부드럽게 옮겨요 (켜질 때 빠르게, 풀릴 때 느리게) */
  function drive(id, target, dt) {
    const [on, off] = TAU_AU[id] || [TAU.on, TAU.off];
    const cur = au[id] ?? 0, tau = target > cur ? on : off;
    au[id] = cur + (target - cur) * (1 - Math.exp(-dt / tau));
    return au[id];
  }

  /**
   * @param {number} dt  초 (화면 프레임 간격)
   * @param {object} body physiology state
   */
  function update(dt, body) {
    dt = Math.min(dt, 0.1); t += dt;
    const s = body ? body.sev : { hypoxia: 0, heat: 0, sweat: 0, cold: 0, shiver: 0, pressure: 0, fatigue: 0 };
    const H = smooth('H', s.hypoxia, dt), Q = smooth('Q', s.heat, dt), W = smooth('W', s.sweat, dt, 0.3),
      C = smooth('C', s.cold, dt), S = smooth('S', s.shiver, dt), P = smooth('P', s.pressure, dt, 0.15), F = smooth('F', s.fatigue, dt, 0.3);
    // 더위를 "느끼는" 정도: 심부 체온(heat)은 몇 분에 걸쳐 천천히 오르지만, 덥다는 느낌·얼굴 붉어짐은 피부 온도로 바로 와요.
    // 느끼는 기온 30~42°C, 습구온도가 높을수록(땀이 안 마름) 더 세게 [GAME 근사]
    const hotFeel = body && body.eff ? smooth('HF', ss(30, 42, body.eff.tempC) * (0.55 + 0.45 * ss(20, 30, body.wetBulbC ?? 20)), dt, 0.5) : 0;
    const Qx = union(Q, 0.75 * hotFeel);   // 표정에 쓰는 더위
    const motion = reducedMotion ? 0.25 : 1;

    // 숨: 들숨이 날숨보다 짧아요 (쉴 때 대략 1:2). 숨이 가쁠수록 1:1에 가까워져요 [GAME 근사]
    const rate = body ? body.breathsPerMin : 14; lastBreathRate += (rate - lastBreathRate) * Math.min(1, dt * 2);
    breath = (breath + dt * lastBreathRate / 60) % 1;
    const inFrac = 0.34 + 0.14 * H;
    const b = breath < inFrac ? ss(0, 1, breath / inFrac) : 1 - ss(0, 1, (breath - inFrac) / (1 - inFrac));   // 0 = 다 내쉼, 1 = 다 들이쉼
    const inhaling = breath < inFrac ? 1 : 0;

    // 한 번짜리 동작 고르기
    //  - 귀 압력: 하품·침 삼키기·턱 좌우로 움직이기 (실제로 귀를 뚫는 방법) — 불편이 '경미' 이상일 때 몇 초마다
    //  - 피로: 가끔 하품
    if (t >= act.next && (t - act.start) > act.dur) {
      const pr = body && body.level.pressure >= 1, tired = F > 0.5;
      if (pr) { const r = random(); act.kind = r < 0.25 ? 'yawn' : r < 0.5 ? 'swallow' : r < 0.72 ? 'jaw' : 'wince'; }   // wince = 아파서 눈을 질끈
      else if (tired && random() < 0.35) act.kind = 'yawn';
      else act.kind = null;
      act.dur = act.kind === 'yawn' ? 2.6 : act.kind === 'swallow' ? 0.8 : act.kind === 'wince' ? 0.7 : 1.0;
      act.start = t; act.next = t + act.dur + (pr ? 2 + random() * 2 : 8 + random() * 12);
    }
    const yawn = actCurve('yawn'), swallow = actCurve('swallow'), wiggle = actCurve('jaw'), wince = actCurve('wince');
    const wigSide = act.kind === 'jaw' ? Math.sin(2 * Math.PI * 2 * (t - act.start)) : 0;
    // 이 딱딱거림: 떨림이 심할 때 턱이 빠르게 작게 여닫혀요 (초당 약 8~10번, 추정)
    const chatter = S * 0.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 9 * t)) * motion;
    const sev = ss(0.6, 1, H);   // 아주 심한 저산소: 의식이 흐려짐

    // ── 상태 → AU 목표값 ──  (L = 얼굴 주인의 왼쪽)
    // ── 상태 → AU 목표값 ──  (L = 얼굴 주인의 왼쪽)
    // 실제 사례를 바탕으로 얼굴 전체를 같이 움직여요:
    //  · 호흡곤란: 호흡곤란 관찰 척도(RDOS)의 "두려운 표정" = 눈을 크게 뜨고, 얼굴 근육이 긴장, 미간을 찌푸리고, 입을 벌림.
    //    여기에 콧구멍 벌름, 들숨마다 목·어깨 근육으로 숨을 도움(고개가 살짝 젖혀짐), 가만히 있지 못함(고개를 자주 움직임)
    //    → AU1+2+4(겁먹은 눈썹) + AU5(눈 크게) + AU7(긴장) + AU20(입술 옆으로) + AU25/26 + AU38. 아주 심하면 눈꺼풀이 처져요(AU41)
    //  · 통증(귀 압력): 통증 표정 점수(PSPI) = AU4 + AU6/7 + AU9/10 + AU43(눈 감기) → 한쪽을 찡그리며 가끔 눈을 질끈 감아요
    //  · 피로: 수면 부족 얼굴 연구 = 처진 눈꺼풀, 부은 눈, 눈 밑 그늘, 처진 입꼬리, 창백함, 슬퍼 보임(AU1 약하게)
    //  · 더위: 찡그리며 눈을 가늘게(AU4+6+7), 눈꺼풀이 무겁고, 입으로 숨쉬기
    //  · 추위: 찡그림(AU4+7), 코 찡그림(AU9), 입술 꽉(AU24) + 턱끝(AU17), 이 딱딱, 몸 움츠림
    const fear = H * (1 - 0.55 * sev), effort = H * b;
    blinkUrge = clamp(0.8 * H + 0.5 * C + 0.4 * Qx);
    const tg = {
      1: union(0.6 * fear + 0.15 * effort, 0.15 * Qx, 0.3 * F, 0.35 * yawn),
      2: union(0.4 * fear + 0.1 * effort, 0.3 * yawn),
      4: [union(0.45 * H, 0.45 * Qx, 0.45 * C, 0.8 * P, 0.6 * wince), union(0.45 * H, 0.45 * Qx, 0.45 * C, 0.35 * P, 0.4 * wince)],
      5: union(0.65 * fear + 0.2 * effort * (1 - sev)),
      6: [union(0.1 * H, 0.35 * Qx, 0.25 * C, 0.6 * P, 0.8 * wince), union(0.1 * H, 0.35 * Qx, 0.25 * C, 0.2 * P, 0.4 * wince)],
      7: [union(0.3 * H, 0.5 * Qx, 0.5 * C, 0.85 * P, 0.7 * wince), union(0.3 * H, 0.5 * Qx, 0.5 * C, 0.3 * P, 0.4 * wince)],
      41: union(0.55 * F, 0.4 * sev, 0.3 * Qx),
      43: union(0.75 * yawn, 0.85 * wince),
      38: union(H * (0.3 + 0.7 * b), 0.3 * Qx * b, 0.25 * F * b * inhaling),
      9: [union(0.2 * effort, 0.25 * C, 0.3 * P, 0.5 * wince), union(0.2 * effort, 0.25 * C, 0.12 * P, 0.3 * wince)],
      10: [union(0.15 * Qx, 0.15 * H, 0.25 * P, 0.4 * wince), union(0.15 * Qx, 0.15 * H, 0.1 * P, 0.25 * wince)],
      25: union(ss(0.12, 0.35, H), ss(0.25, 0.6, Qx), 0.25 * S, yawn, 0.3 * F),
      26: union(H * (0.2 + 0.5 * b), Qx * (0.1 + 0.3 * b), chatter, 0.6 * wiggle, 0.12 * F),
      27: union(sev * b * 0.8, yawn),
      22: union(0.3 * H * (1 - b) * (1 - sev)),
      20: [union(0.4 * fear, 0.2 * Qx, 0.35 * C, 0.3 * S, 0.45 * P, 0.5 * wince), union(0.4 * fear, 0.2 * Qx, 0.35 * C, 0.3 * S, 0.15 * P, 0.3 * wince)],
      15: [union(0.25 * Qx, 0.45 * F, 0.25 * C, 0.25 * P), union(0.25 * Qx, 0.45 * F, 0.25 * C, 0.12 * P)],
      16: [union(0.25 * H * b, 0.15 * Qx), union(0.25 * H * b, 0.15 * Qx)],
      24: [union(0.7 * C * (1 - 0.6 * S), 0.6 * swallow, 0.15 * P), union(0.7 * C * (1 - 0.6 * S), 0.6 * swallow, 0.15 * P)],
      17: union(0.45 * C * (1 - 0.5 * S), 0.7 * swallow, 0.2 * F),
      28: union(0.25 * C * (1 - S)),
      14: [union(0.15 * C), union(0.15 * C)],
      12: [0, 0], 18: 0,
      30: wiggle * wigSide,
    };


    // ── 근육끼리 같이 움직이는 관계 (따로 놀지 않게) [FACS 근육 해부 + GAME] ──
    //  코 찡그림(AU9)을 만드는 윗입술콧방울올림근은 윗입술도 끌어올리고 볼을 밀어 올려요 → AU10·AU6
    //  눈썹을 세게 내리면(AU4) 눈둘레근도 같이 조여요 → AU7
    //  입꼬리 내림(AU15)엔 턱끝근(AU17)이 자주 같이 써요 · 입을 크게 벌리면(AU27) 입술이 옆으로 늘어나요 → AU20
    //  들숨에 턱을 내리면(AU26) 콧구멍도 같이 벌어져요 → AU38
    const side = (v, i) => (Array.isArray(v) ? v[i] : v);
    const syn = (id, add) => { const v = tg[id]; tg[id] = Array.isArray(v) ? [union(v[0], side(add, 0)), union(v[1], side(add, 1))] : union(v, side(add, 0)); };
    const sc = (v, k) => (Array.isArray(v) ? v.map(x => x * k) : v * k);
    syn(10, sc(tg[9], 0.45)); syn(6, sc(tg[9], 0.35)); syn(7, sc(tg[4], 0.35)); syn(17, union(side(tg[15], 0), side(tg[15], 1)) * 0.3);
    syn(20, tg[27] * 0.35); syn(38, tg[26] * 0.3); syn(1, tg[27] * 0.15);

    // ── AU를 부드럽게 움직이고, 아주 작은 흔들림을 더해요 (살아 있는 느낌) ──
    const A = {};
    for (const id in tg) {
      const v = tg[id];
      if (+id === 30) { A[30] = drive(30, v, dt); continue; }
      if (Array.isArray(v)) {
        const l = drive(id + 'L', clamp(v[0] * gainL), dt), r = drive(id + 'R', clamp(v[1] * gainR), dt);
        A[id] = [l, r];
      } else A[id] = drive(id, clamp(v), dt);
    }
    // 빠른 리듬은 따로 (숨·이 딱딱) — 부드럽게 만들면 리듬이 사라져요
    A[26] = clamp(Math.max(A[26], chatter)); A[38] = Math.max(A[38], tg[38] * 0.9);
    const L = (id) => (Array.isArray(A[id]) ? A[id][0] : A[id]), R = (id) => (Array.isArray(A[id]) ? A[id][1] : A[id]);
    const tremor = 0.02 * motion;
    const jit = (k) => tremor * noise(t * 1.3 + k * 7, 1.1, 2.3, 3.7);

    // ── AU → ARKit 블렌드셰이프 ──
    const gaze = gazeStep(dt, H, F, C, motion);
    const bl = blinkValue(F, H);
    const lid = clamp(0.45 * A[41] + A[43]);
    const jaw = clamp(0.55 * A[26] + 0.45 * A[27]);
    const w = {
      browInnerUp: clamp(A[1] + jit(1)),
      browOuterUpLeft: L(2), browOuterUpRight: R(2),
      browDownLeft: clamp(L(4) + jit(2)), browDownRight: clamp(R(4) + jit(3)),
      eyeWideLeft: L(5) * (1 - lid), eyeWideRight: R(5) * (1 - lid),
      cheekSquintLeft: L(6), cheekSquintRight: R(6),
      eyeSquintLeft: L(7), eyeSquintRight: R(7),
      eyeBlinkLeft: Math.max(lid, bl), eyeBlinkRight: Math.max(lid, bl),
      noseSneerLeft: L(9), noseSneerRight: R(9),
      nostrilDilate: A[38],
      mouthUpperUpLeft: clamp(L(10) + 0.12 * A[25]), mouthUpperUpRight: clamp(R(10) + 0.12 * A[25]),
      mouthSmileLeft: L(12), mouthSmileRight: R(12),
      mouthDimpleLeft: L(14), mouthDimpleRight: R(14),
      mouthFrownLeft: L(15), mouthFrownRight: R(15),
      mouthLowerDownLeft: clamp(L(16) + 0.3 * A[25] + 0.25 * A[27]), mouthLowerDownRight: clamp(R(16) + 0.3 * A[25] + 0.25 * A[27]),
      mouthShrugLower: A[17], mouthShrugUpper: 0.35 * A[17],
      mouthPucker: clamp(A[18]),
      mouthFunnel: A[22],
      mouthStretchLeft: clamp(L(20) + 0.3 * A[27]), mouthStretchRight: clamp(R(20) + 0.3 * A[27]),
      mouthPressLeft: L(24), mouthPressRight: R(24),
      mouthRollLower: A[28], mouthRollUpper: 0.6 * A[28],
      cheekPuff: 0,
      jawOpen: jaw,
      jawForward: clamp(0.6 * A[27]),                  // 크게 벌릴 때만 턱관절이 앞으로 미끄러져요
      jawLeft: clamp(0.35 * Math.max(0, A[30])), jawRight: clamp(0.35 * Math.max(0, -A[30])),
      eyeLookOutLeft: clamp(1.3 * gaze.x), eyeLookInLeft: clamp(-1.3 * gaze.x),
      eyeLookInRight: clamp(1.3 * gaze.x), eyeLookOutRight: clamp(-1.3 * gaze.x),
      eyeLookUpLeft: clamp(1.3 * gaze.y), eyeLookUpRight: clamp(1.3 * gaze.y),
      eyeLookDownLeft: clamp(-1.3 * gaze.y), eyeLookDownRight: clamp(-1.3 * gaze.y),
    };

    // ── 머리 (FACS 51~58): 숨이 차면 들숨에 고개가 살짝 젖혀지고(목 근육으로 숨을 도움), 피로하면 숙여요 ──
    const shake = S * 0.6 * DEG * motion;
    const head = {
      yaw: ((2.2 + 3.5 * fear) * noise(t * (1 + 1.5 * H), 0.13, 0.31, 0.07) * DEG) * motion + shake * Math.sin(2 * Math.PI * 8.3 * t),   // 숨이 차면 가만히 있지 못해요
      pitch: (1.5 * noise(t + 20, 0.11, 0.23, 0.05) * DEG - 6 * F * DEG - 3 * C * DEG + (0.6 + 2.4 * H) * b * DEG - 6 * yawn * DEG + 2 * swallow * DEG) * motion,
      roll: (1.0 * noise(t + 40, 0.09, 0.19, 0.04) * DEG + 4 * P * DEG) * motion + shake * Math.sin(2 * Math.PI * 7.1 * t + 1),
      lift: (0.004 * b * (1 + 2 * H) - 0.004 * C) * motion,   // 숨 쉴 때 머리·어깨가 오르내림, 추우면 움츠림
    };
    const spo2 = body ? body.spo2Pct : 98;
    const fx = {
      sweat: clamp(Math.max(W, 0.6 * hotFeel)), gloss: clamp(0.06 + 0.9 * Math.max(W, 0.6 * hotFeel)), flush: clamp(union(0.9 * Q, 0.8 * hotFeel) + 0.15 * W * (1 - C)),
      pallor: clamp(0.35 * H + 0.4 * C + 0.25 * F), tired: clamp(F + 0.3 * sev), cyanosis: clamp(ss(88, 70, spo2) + 0.35 * C),
    };
    // 화면 표시용 AU (좌우는 평균)
    const aus = {};
    for (const id in A) { const v = Array.isArray(A[id]) ? (A[id][0] + A[id][1]) / 2 : Math.abs(A[id]); if (v > 0.03) aus[id] = v; }
    return { weights: w, head, fx, breath: b, gaze, aus };
  }
  return { update };
}
