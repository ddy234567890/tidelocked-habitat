// 게이지 4개 (공기 · 물 · 식량 · 전력): 숫자는 gauges.json (플레이테스트 페이지 가정값).
// 상태를 따로 들고 있지 않고, 지금까지 '결정한' 선지와 주차로 매번 처음부터 다시 계산한다 (결정은 되돌릴 수 없으므로 같은 결과가 나온다).
// 한 주 안에서는 결정하자마자 now 가 반영되고, '다음 주로'를 누르면 그 주가 끝나며 매주 변화(weekly + 수확)가 한 번 반영된다.
import data from './gauges.json' with { type: 'json' };
import { WEEKS } from './choices.js';

export const GAUGE_KEYS = Object.keys(data.labels);
export const GAUGE_LABELS = data.labels;
export const GAUGE_WARN = data.warn;

const meets = (requires, selection) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
const clamp = value => Math.max(data.clamp[0], Math.min(data.clamp[1], Math.round(value)));
const lowestKey = values => GAUGE_KEYS.reduce((a, b) => values[a] <= values[b] ? a : b);

/** 그 선지가 지금 선택에서 갖는 효과 항목들 */
export const effectsFor = (choiceId, selection) => (data.choices[choiceId] ?? []).filter(entry => meets(entry.requires, selection));

/**
 * selection: { 단계id: 선지id }, decided: { 단계id: true }, week: 지금 주차 (1~5)
 * → { values: {air…}, weekly: {air…} (다음 주에 더해질 양), failed: null | { key, week } }
 */
export function gaugeState(selection, decided, week) {
  const values = Object.fromEntries(GAUGE_KEYS.map(key => [key, data.start]));
  const rates = { ...data.weekly };
  const harvests = [];
  let harvestScale = 1, failed = null;
  const check = w => { if (!failed) { const key = GAUGE_KEYS.find(k => values[k] <= 0); if (key) failed = { key, week: w }; } };
  const harvestAt = w => {
    const out = Object.fromEntries(GAUGE_KEYS.map(key => [key, 0]));
    for (const h of harvests) if (w >= h.from) for (const key of GAUGE_KEYS) out[key] += h[key] ?? 0;
    return out;
  };
  for (let w = 1; w <= week && WEEKS[w - 1]; w++) {
    for (const step of WEEKS[w - 1].steps) {
      if (!decided[step.id] || !selection[step.id]) continue;
      for (const entry of effectsFor(selection[step.id], selection)) {
        const lowest = lowestKey(values); // 'lowest' 는 결정하는 순간 가장 낮은 게이지 하나 (즉시·매주 모두 같은 게이지)
        for (const [key, value] of Object.entries(entry.now ?? {})) {
          const target = key === 'lowest' ? lowest : key;
          values[target] = clamp(values[target] + value);
        }
        for (const [key, value] of Object.entries(entry.weekly ?? {})) rates[key === 'lowest' ? lowest : key] += value;
        if (entry.harvestScale) harvestScale *= entry.harvestScale;
        if (entry.harvest) harvests.push({ ...entry.harvest, food: Math.round((entry.harvest.food ?? 0) * harvestScale) });
      }
      check(w);
    }
    if (w < week) { // 지난 주차는 끝났다: 한 주치 변화를 더한다
      const h = harvestAt(w);
      for (const key of GAUGE_KEYS) values[key] = clamp(values[key] + rates[key] + h[key]);
      check(w);
    }
  }
  const h = harvestAt(week);
  return { values, weekly: Object.fromEntries(GAUGE_KEYS.map(key => [key, rates[key] + h[key]])), failed };
}

/** 요약 글: '즉시 전력 −2 · 매주 전력 −2' */
export function gaugeText(choiceId, selection) {
  const sign = v => (v > 0 ? '+' : '−') + Math.abs(v);
  const label = key => key === 'lowest' ? '가장 낮은 것' : GAUGE_LABELS[key];
  const now = [], weekly = [];
  for (const entry of effectsFor(choiceId, selection)) {
    for (const [key, value] of Object.entries(entry.now ?? {})) if (value) now.push(label(key) + ' ' + sign(value));
    for (const [key, value] of Object.entries(entry.weekly ?? {})) if (value) weekly.push(label(key) + ' ' + sign(value));
    if (entry.harvest) weekly.push(entry.harvest.from + '주차 끝부터 수확');
  }
  return [now.length && '즉시 ' + now.join(', '), weekly.length && '매주 ' + weekly.join(', ')].filter(Boolean).join(' · ');
}
