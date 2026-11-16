// 장치 레이어가 스스로 움직이며 나타나는 방식 (main.js 는 data.animate 가 있으면 보통 '아래에서 위로 채우기' 대신 이것을 매 장면 부른다).
// animate(positions, colors, baseColor, ms) → 끝나면 true. positions·colors 는 그리는 배열, baseColor 는 레이어 원래 색(역할 색 포함), ms 는 나타난 뒤 지난 시간
const ease = t => 1 - (1 - t) ** 3;
const clamp = t => Math.min(1, Math.max(0, t));

/** 제자리에서 커지기: center 를 중심으로 from 배 크기에서 원래 크기로 부드럽게 커진다 (농장 크게 키우기) */
export function growMotion(center, from, duration = 1400) {
  let rest = null;
  return (positions, colors, base, ms) => {
    rest ??= positions.slice();
    const t = clamp(ms / duration), s = from + (1 - from) * ease(t);
    for (let i = 0; i < positions.length; i += 3)
      for (let j = 0; j < 3; j++) positions[i + j] = center[j] + (rest[i + j] - center[j]) * s;
    colors.set(base);
    return t >= 1;
  };
}

/** 차곡차곡 채우기: stage 0 점(창고 틀)은 먼저 나타나고, 그다음 stage 1, 2, … 점(상자)이 차례로 위에서 내려와 쌓인다 */
export function fillMotion(stages, drop, { frame = 900, gap = 320, fall = 380 } = {}) {
  let rest = null;
  const last = stages.reduce((m, s) => Math.max(m, s), 0);
  return (positions, colors, base, ms) => {
    rest ??= positions.slice();
    for (let p = 0; p < stages.length; p++) {
      const k = stages[p], i = p * 3;
      // 틀: 0.9초 동안 밝아진다. 상자 k: 틀이 다 선 뒤 gap 간격으로 하나씩 drop 높이에서 떨어져 제자리에 놓인다
      const t = k === 0 ? clamp(ms / frame) : clamp((ms - frame * 0.7 - (k - 1) * gap) / fall);
      const shown = k === 0 ? t : (t > 0 ? 0.35 + 0.65 * t : 0);
      positions[i] = rest[i]; positions[i + 2] = rest[i + 2];
      positions[i + 1] = rest[i + 1] + (k === 0 ? 0 : drop * (1 - ease(t)));
      for (let j = 0; j < 3; j++) colors[i + j] = base[i + j] * shown;
    }
    return ms >= frame * 0.7 + (last - 1) * gap + fall;
  };
}
