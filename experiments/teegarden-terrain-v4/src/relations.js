// 지난 선택끼리의 연관: 앞에서 고른 선지가 뒤에서 고른 선지에 어떤 영향을 줬는지 데이터에서 찾아 점수를 매긴다.
// 메모장(fieldNotes.js)이 주차를 넘는 선과 굵기로 보여 준다. 화면 없이 돌아서 tests/relations.test.js 가 검사한다.
//   열림 조건   뒤 선지가 앞 선지를 골라야 열렸다 (requires)                       3점
//   효과        뒤 선지의 게이지 효과가 앞 선지에 따라 달라졌다 (gauges.json requires) 2점
//   설명        뒤 선지 카드의 글이 앞 선지에 따라 붙었다 (extra)                      1점
//   사건        둘 다 같은 돌발 사건에 얽힌다 (when · adjust · 대응 조건)              사건마다 1점 (최대 3)
//   고장 시험   둘 다 엔딩의 같은 고장 시험 결과를 바꾼다 (judge.json tests)           1점
import { ALL_STEPS, WEEKS } from './choices.js';
import { PLANET } from './planets/index.js';

const SCORE = { unlock: 3, effect: 2, text: 1, event: 1, test: 1 }, EVENT_CAP = 3;
const has = (requires, step, id) => Boolean(requires?.[step]?.includes(id));
const weekOf = Object.fromEntries(WEEKS.flatMap((w, k) => w.steps.map((s, i) => [s.id, { week: k + 1, order: i }])));
const choiceOf = (step, id) => ALL_STEPS.find(s => s.id === step)?.choices.find(c => c.id === id);

// 사건마다 그 사건에 얽힌 '단계:선지' 모음
const eventLinks = (PLANET.eventData?.events ?? []).map(e => {
  const set = new Set();
  const add = r => { for (const [step, ids] of Object.entries(r ?? {})) for (const id of ids) set.add(step + ':' + id); };
  (e.when ?? []).forEach(add); (e.adjust ?? []).forEach(a => add(a.requires)); e.responses.forEach(r => add(r.requires));
  return { name: e.name, set };
});
const testLinks = (PLANET.judge?.tests ?? []).map(t => {
  const set = new Set();
  for (const a of t.adjust) for (const [step, ids] of Object.entries(a.requires ?? {})) for (const id of ids) set.add(step + ':' + id);
  return { name: t.name, set };
});

/** selection: { 단계id: 선지id } → [{ from, to, score, reasons: [{ kind, text }] }] 점수 높은 순. from 이 늘 앞 단계다 */
export function relationsFor(selection) {
  const picked = Object.entries(selection).filter(([step]) => weekOf[step]).map(([step, id]) => ({ step, id, ...weekOf[step], label: choiceOf(step, id)?.label ?? id }))
    .sort((a, b) => a.week - b.week || a.order - b.order);
  const out = [];
  for (let j = 0; j < picked.length; j++) for (let i = 0; i < j; i++) {
    const a = picked[i], b = picked[j], to = choiceOf(b.step, b.id), reasons = [];
    if (has(to?.requires, a.step, a.id)) reasons.push({ kind: 'unlock', text: `「${a.label}」을 골라야 열리는 선택이에요` });
    const effects = (PLANET.gauges.choices[b.id] ?? []).filter(e => has(e.requires, a.step, a.id));
    if (effects.length) reasons.push({ kind: 'effect', text: `「${a.label}」 때문에 게이지 효과가 달라졌어요` });
    if ((to?.extra ?? []).some(x => has(x.requires, a.step, a.id))) reasons.push({ kind: 'text', text: `「${a.label}」에 따라 설명이 붙었어요` });
    const ka = a.step + ':' + a.id, kb = b.step + ':' + b.id;
    const events = eventLinks.filter(e => e.set.has(ka) && e.set.has(kb));
    events.slice(0, EVENT_CAP).forEach(e => reasons.push({ kind: 'event', text: `같은 사건 「${e.name}」에 함께 얽혀요` }));
    testLinks.filter(t => t.set.has(ka) && t.set.has(kb)).forEach(t => reasons.push({ kind: 'test', text: `엔딩의 「${t.name}」 시험 결과를 함께 바꿔요` }));
    if (!reasons.length) continue;
    out.push({ from: a, to: b, score: reasons.reduce((s, r) => s + SCORE[r.kind], 0), reasons });
  }
  return out.sort((x, y) => y.score - x.score || x.from.week - y.from.week);
}

// 선택 하나의 무게 (2026-11-28, 메모장 거품 크기): 치명적이거나 중대한 선택일수록 크다.
//   게이지 효과의 크기 (매주 효과는 3배, 제곱근으로 눌러 한 선택이 혼자 커지지 않게) · 얽힌 돌발 사건 수 · 바꾸는 엔딩 시험 수. 연관 점수 합은 메모장이 더한다
const size = e => Object.values(e.now ?? {}).reduce((s, v) => s + Math.abs(v), 0) + 3 * Object.values(e.weekly ?? {}).reduce((s, v) => s + Math.abs(v), 0);
const meets = (requires, selection) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
/** selection → { 단계id: { effect, events, tests, weight } } */
export function weightsFor(selection) {
  const out = {};
  for (const [step, id] of Object.entries(selection)) {
    if (!weekOf[step]) continue;
    const key = step + ':' + id;
    const effect = (PLANET.gauges.choices[id] ?? []).filter(e => meets(e.requires, selection)).reduce((s, e) => s + size(e), 0);
    const events = eventLinks.filter(e => e.set.has(key)).length, tests = testLinks.filter(t => t.set.has(key)).length;
    out[step] = { effect, events, tests, weight: 1 + 0.6 * Math.sqrt(effect) + 0.6 * events + 0.5 * tests };
  }
  return out;
}

// 득실 (2026-11-28, 메모장 전개도): 그 선택이 게이지에 준 효과를 더한다. 매주 효과는 남은 주 수(그 주 포함)만큼 곱한다.
// gain = 올린 합, loss = 내린 합(양수), net = gain − loss. 처음 보는 사람이 "득이 많았나 실이 많았나"를 바로 알 수 있게
/** selection → { 단계id: { gain, loss, net } } */
export function balanceFor(selection) {
  const out = {}, last = WEEKS.length;
  for (const [step, id] of Object.entries(selection)) {
    if (!weekOf[step]) continue;
    const left = last - weekOf[step].week + 1;
    let gain = 0, loss = 0;
    for (const e of (PLANET.gauges.choices[id] ?? []).filter(x => meets(x.requires, selection))) {
      for (const v of Object.values(e.now ?? {})) (v > 0 ? (gain += v) : (loss -= v));
      for (const v of Object.values(e.weekly ?? {})) (v > 0 ? (gain += v * left) : (loss -= v * left));
    }
    out[step] = { gain, loss, net: gain - loss };
  }
  return out;
}
