// 4단계: 신체 상태 → 얼굴 애니메이션 (기준 이름 = ARKit 블렌드셰이프)
// 여기의 표정 배합은 모두 연출값 [GAME]이에요. 신체 상태 숫자는 physiology.js에서 와요.
// 화면 프레임마다 update(dt, bodyState)를 불러요. 신체 계산(0.1초 간격)과 따로 돌아요.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

export function createFaceController({ random = Math.random, reducedMotion = false } = {}) {
  let t = 0, breath = 0, lastBreathRate = 14;
  const blink = { next: 1.5, start: -1, dur: [0.08, 0.04, 0.14], double: false };
  const eq = { next: 0, start: -10 };          // 귀 압력 맞추기(턱 움직이기) 동작
  const gz = { x: 0, y: 0, tx: 0, ty: 0, next: 0.6 };   // 시선 (-1~1, +x = 얼굴 주인의 왼쪽, +y = 위)
  const sm = {};                               // 화면용으로 한 번 더 부드럽게 만든 값
  const smooth = (k, v, dt, tau = 0.25) => { sm[k] = sm[k] === undefined ? v : sm[k] + (v - sm[k]) * (1 - Math.exp(-dt / tau)); return sm[k]; };
  const noise = (x, a, b, c) => 0.5 * Math.sin(x * a) + 0.3 * Math.sin(x * b + 1.7) + 0.2 * Math.sin(x * c + 4.1);

  function blinkValue(F) {
    if (t >= blink.next && blink.start < 0) {
      blink.start = t; const k = 1 + 1.5 * F;                // 피로하면 천천히 감고 오래 감아요
      blink.dur = [0.08 * k, 0.04 * (1 + 2 * F), 0.14 * k];
    }
    if (blink.start < 0) return 0;
    const u = t - blink.start, [c, h, o] = blink.dur;
    let v = u < c ? u / c : u < c + h ? 1 : u < c + h + o ? 1 - (u - c - h) / o : -1;
    if (v < 0) {                                              // 끝: 다음 깜빡임 예약 (평소 약 3~4초에 한 번)
      blink.start = -1;
      const dbl = !blink.double && random() < 0.15; blink.double = dbl;
      blink.next = t + (dbl ? 0.12 : 1.8 + random() * 3.2 * (1 - 0.35 * F));
      v = 0;
    }
    return v * v * (3 - 2 * v);
  }

  /** 시선: 가끔 빠르게 튕기듯 옮기고(saccade) 그 사이엔 멈춰 있어요. 큰 이동엔 깜빡임이 따라오기도 해요 [GAME]
   *  호흡곤란 = 불안하게 자주·넓게, 피로 = 아래로 처지고 느리게, 추위 = 살짝 아래 */
  function gazeStep(dt, H, F, C, motion) {
    if (t >= gz.next) {
      const spread = (0.16 + 0.38 * H) * motion, baseY = -0.35 * F - 0.12 * C;
      let tx = (random() * 2 - 1) * spread, ty = baseY + (random() * 2 - 1) * spread * 0.55;
      if (random() < 0.4) { tx *= 0.2; ty = baseY; }                       // 자주 정면으로 돌아와요
      if (Math.hypot(tx - gz.tx, ty - gz.ty) > 0.25 && random() < 0.35 && blink.start < 0) blink.next = t;
      gz.tx = tx; gz.ty = ty;
      gz.next = t + (0.7 + random() * 2.4) * (1 - 0.6 * H) * (1 + 0.8 * F);
    }
    const tau = 0.035 + 0.15 * F + 0.2 * ss(0.75, 1, H);                   // 힘들면 시선이 굼떠요
    const k = 1 - Math.exp(-dt / tau);
    gz.x += (gz.tx - gz.x) * k; gz.y += (gz.ty - gz.y) * k;
    const jitter = 0.006 * motion;                                          // 아주 작은 떨림
    return { x: gz.x + jitter * noise(t * 7, 3.1, 5.3, 8.9), y: gz.y + jitter * noise(t * 7 + 9, 2.7, 4.9, 7.7) };
  }

  /**
   * @param {number} dt  초 (화면 프레임 간격)
   * @param {object} body physiology state
   */
  function update(dt, body) {
    dt = Math.min(dt, 0.1); t += dt;
    const s = body ? body.sev : { hypoxia: 0, heat: 0, sweat: 0, cold: 0, shiver: 0, pressure: 0, fatigue: 0 };
    const H = smooth('H', s.hypoxia, dt), Q = smooth('Q', s.heat, dt), W = smooth('W', s.sweat, dt, 0.6),
      C = smooth('C', s.cold, dt), S = smooth('S', s.shiver, dt), P = smooth('P', s.pressure, dt, 0.15), F = smooth('F', s.fatigue, dt, 0.6);
    const rate = body ? body.breathsPerMin : 14; lastBreathRate += (rate - lastBreathRate) * Math.min(1, dt * 2);
    breath = (breath + dt * lastBreathRate / 60) % 1;
    const b = Math.sin(Math.PI * breath) ** 2;                // 0 = 다 내쉼, 1 = 다 들이쉼
    const motion = reducedMotion ? 0.25 : 1;

    // 귀 압력 맞추기: 불편이 '경미' 이상이면 몇 초마다 턱을 움직여요 (실제로 쓰는 방법)
    let eqv = 0, eqSide = 0;
    if (body && body.level.pressure >= 1 && t >= eq.next) { eq.start = t; eq.next = t + 2.5 + random() * 1.5; }
    if (t - eq.start < 0.9) { const u = (t - eq.start) / 0.9; eqv = Math.sin(Math.PI * u); eqSide = Math.sin(Math.PI * 4 * u) * eqv; }
    const chatter = S * 0.08 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 9 * t)) * motion;   // 이가 딱딱 [GAME]

    // 상태별 표정 (얼굴만 보고도 상태가 읽히게 크게) [GAME]
    //   호흡곤란: 입을 벌려 헐떡이고 콧구멍 벌름, 걱정스러운 눈썹, 심하면 눈이 풀림
    //   열: 찡그린 눈, 내려간 눈썹, 입 벌려 헐떡임 · 추위: 입술 꽉, 이 딱딱, 웅크린 눈
    //   압력: 한쪽 눈을 찡그리며 턱을 움직임 · 피로: 처진 눈꺼풀, 처진 입꼬리
    const gaze = gazeStep(dt, H, F, C, motion);
    const lid = clamp(0.4 * F + 0.35 * ss(0.6, 1, H) + 0.15 * Q);
    const bl = blinkValue(F);
    const gasp = H * (0.3 + 0.6 * b), pant = Q * (0.18 + 0.3 * b);
    const w = {
      browInnerUp: clamp(0.95 * H + 0.35 * Q + 0.15 * C + 0.2 * F),
      browDownLeft: clamp(0.45 * Q + 0.4 * C + 0.75 * P), browDownRight: clamp(0.45 * Q + 0.4 * C + 0.35 * P),
      browOuterUpLeft: clamp(0.3 * H * (1 - F)), browOuterUpRight: clamp(0.3 * H * (1 - F)),
      eyeWideLeft: clamp(0.6 * H * (1 - ss(0.55, 0.9, H))), eyeWideRight: clamp(0.6 * H * (1 - ss(0.55, 0.9, H))),
      eyeSquintLeft: clamp(0.65 * Q + 0.5 * C + 0.85 * P), eyeSquintRight: clamp(0.65 * Q + 0.5 * C + 0.35 * P),
      eyeBlinkLeft: Math.max(lid + 0.35 * P, bl), eyeBlinkRight: Math.max(lid, bl),
      noseSneerLeft: clamp(H * (0.35 + 0.65 * b) + 0.35 * C + 0.3 * Q * b + 0.4 * P), noseSneerRight: clamp(H * (0.35 + 0.65 * b) + 0.35 * C + 0.3 * Q * b + 0.15 * P),
      cheekSquintLeft: clamp(0.3 * C + 0.35 * Q + 0.6 * P), cheekSquintRight: clamp(0.3 * C + 0.35 * Q + 0.2 * P),
      cheekPuff: 0,
      jawOpen: clamp(gasp + pant + 0.1 * F + chatter * 1.5 + 0.35 * eqv),
      jawLeft: clamp(0.3 * Math.max(0, eqSide)), jawRight: clamp(0.3 * Math.max(0, -eqSide)),
      mouthFunnel: clamp(0.25 * Q * (1 - b) + 0.2 * H * (1 - b)),
      mouthStretchLeft: clamp(0.35 * H + 0.3 * Q + 0.25 * C + 0.45 * P), mouthStretchRight: clamp(0.35 * H + 0.3 * Q + 0.25 * C + 0.1 * P),
      mouthFrownLeft: clamp(0.3 * P + 0.45 * F + 0.3 * C + 0.25 * Q), mouthFrownRight: clamp(0.15 * P + 0.45 * F + 0.3 * C + 0.25 * Q),
      mouthPressLeft: clamp(0.7 * C * (1 - 0.5 * S) + 0.15 * P), mouthPressRight: clamp(0.7 * C * (1 - 0.5 * S) + 0.15 * P),
      // 시선 (눈꺼풀이 눈동자를 따라가요). 왼눈의 Out = 왼쪽을 봄, 오른눈의 In = 왼쪽을 봄
      eyeLookOutLeft: clamp(1.3 * gaze.x), eyeLookInLeft: clamp(-1.3 * gaze.x),
      eyeLookInRight: clamp(1.3 * gaze.x), eyeLookOutRight: clamp(-1.3 * gaze.x),
      eyeLookUpLeft: clamp(1.3 * gaze.y), eyeLookUpRight: clamp(1.3 * gaze.y),
      eyeLookDownLeft: clamp(-1.3 * gaze.y), eyeLookDownRight: clamp(-1.3 * gaze.y),
    };
    for (const k in w) if (!k.startsWith('eyeBlink') && !k.startsWith('eyeLook') && !k.startsWith('jaw')) w[k] = smooth('w_' + k, w[k], dt, 0.08);

    const shake = S * 0.6 * DEG * motion;
    const head = {
      yaw: (2.2 * noise(t, 0.13, 0.31, 0.07) * DEG) * motion + shake * Math.sin(2 * Math.PI * 8.3 * t),
      pitch: (1.5 * noise(t + 20, 0.11, 0.23, 0.05) * DEG - 5 * F * DEG + 0.6 * b * (1 + 2 * H) * DEG) * motion,
      roll: (1.0 * noise(t + 40, 0.09, 0.19, 0.04) * DEG + 4 * P * DEG) * motion + shake * Math.sin(2 * Math.PI * 7.1 * t + 1),
      lift: 0.004 * b * (1 + 2 * H) * motion,                // 숨 쉴 때 머리·어깨가 살짝 오르내림
    };
    const spo2 = body ? body.spo2Pct : 98;
    const fx = {
      sweat: clamp(W),                                         // 땀방울 양
      gloss: clamp(0.06 + 0.9 * W),                            // 피부 광택 (땀과 따로 조절)
      flush: clamp(0.9 * Q + 0.3 * W * (1 - C)),               // 열로 붉어짐
      pallor: clamp(0.35 * H + 0.4 * C + 0.2 * F),             // 창백함
      cyanosis: clamp(ss(88, 70, spo2) + 0.35 * C),            // 입술이 푸르스름 (산소포화도가 많이 낮을 때 보이기 시작)
    };
    return { weights: w, head, fx, breath: b, gaze };
  }
  return { update };
}
