// 엔딩 (2026-11-16 체험판 → 2026-11-23 결말 5개). 1~5주차는 가상 대원으로 준비하는 단계이고,
// 5주차 마지막 단계(입주 방법 M1/M2)를 결정하면 진짜 이주민이 들어와 엔딩이 시작된다.
// 결말은 src/endingJudge.js 가 팀 플레이테스트 기준(E1~E5)으로 정한다:
//   1 생존 실패(준비 중 게이지 0) · 2 수용 준비 미달(착륙 보류) · 3 시한부 정착(입주 후 바닥나 철수)
//   4 취약한 정착(버티지만 여유 없음) · 5 안정적 이주(첫 마을). 결말 1 은 게임의 '기지 운영 실패' 창이 뜰 때 대신 시작한다.
// 연출: 옆 창들이 사라지고 가운데 3D 기지만 남는다(교수님 제안). 위에는 시계(날짜 · 중심 게이지 값 · 기지 인원·쓰러진 수),
//   아래에는 그날 장면이 자막으로 뜨고 기지에서 그 장면이 벌어진다(이주민 도착, 힘들어함·쓰러짐·부축, 고장, 깜빡임 등).
//   마지막에 카메라가 '← 행성으로'를 눌러 행성까지 빠지고 결말 글이 뜬다. 그림은 없다.
// 지난 선택은 '몇 주차에 골랐다'고 말하지 않고 결과로만 보여 준다(사용자: 브리핑 느낌은 재미없다). 말투는 담담한 기록체.
// 이야기 문구는 src/ending-story.json. main.js 는 건드리지 않는다: 화면(DOM)에서 고른 선지·게이지를 읽고,
//   사람은 window.people 과 peopleSim.js 의 Person.step 에 끼워 넣은 환경 덮어쓰기로만 움직인다 (엔딩 때만 켜진다).
import { WEEKS } from './choices.js';
import { effectsFor, GAUGE_KEYS, GAUGE_LABELS } from './gauges.js';
import { Person, INDOOR } from './peopleSim.js';
import { judge, ENDINGS, strategy } from './endingJudge.js';
import STORY from './ending-story.json' with { type: 'json' };
import './ending.css';

const SCENE = {
  water: '빈 물탱크 앞에서 마지막 인원이 철수를 준비한다.',
  food: '빈 식량 선반을 뒤로하고 마지막 인원이 철수를 준비한다.',
  power: '전력이 끊긴 기지에서 손전등을 든 인원이 철수를 준비한다.',
  air: '마지막 산소통을 나눠 쓰며 인원이 철수를 준비한다.',
};
const MOVE = {
  M1: { line: '전원이 한꺼번에 입주했던 기지에서, 전원이 다시 이주선에 오른다.', cost: '기지에는 불이 켜진 채 아무도 남지 않았다.' },
  M2: { line: '먼저 온 절반은 이주선으로 돌아가고, 2주 늦게 지구를 떠난 나머지 절반은 도착을 앞두고 착륙 중지 신호를 받는다.', cost: '늦게 떠난 절반은 아직 돌아갈 곳 없이 항해 중이다.' },
};
// 바닥난 게이지에 따라 사람들이 겪는 환경 (peopleSim 의 envFor 결과를 덮어쓴다). 수치는 게임용 근사값.
// 세기 1 이면 약 2초 뒤 힘들어하고 4~8초 사이에 저마다 다른 때 쓰러진다. 0.75 면 힘들어하기만 한다 (16초까지 확인)
const HARDSHIP = {
  air: env => ({ ...env, oxygenPct: Math.min(env.oxygenPct, 11) }),                                   // 산소가 묽어져 숨이 참
  power: env => ({ ...env, tempC: Math.max(env.tempC, 51) }),                                         // 냉방이 멈춰 찜통
  water: env => ({ ...env, tempC: Math.max(env.tempC, 45), activityMET: env.activityMET + 2.5 }),       // 물이 모자라 더위를 못 견딤
  food: env => ({ ...env, tempC: Math.max(env.tempC, 42), activityMET: env.activityMET + 4.5 }),      // 먹지 못해 쉽게 지침
};
const ARRIVALS = { M1: 14, M2: 6 };

// 받침에 맞는 조사: 괄호 등 한글이 아닌 끝 글자는 건너뛰고 마지막 한글 글자로 정한다
function particle(word, yes, no) {
  const last = [...String(word)].reverse().find(ch => ch >= '가' && ch <= '힣');
  return word + (last && (last.charCodeAt(0) - 0xAC00) % 28 ? yes : no);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// {g} {g이} {g은} {g을} {g였} {name}{이} 같은 자리를 채운다
const PAIRS = { 이: ['이', '가'], 은: ['은', '는'], 을: ['을', '를'], 였: ['이었', '였'] };
function fill(text, values) {
  return String(text ?? '')
    .replace(/\{(\w+)\}\{(이|은|을|였)\}/g, (_, k, p) => particle(values[k] ?? '', ...PAIRS[p]))
    .replace(/\{(\w+?)(이|은|을|였)\}/g, (_, k, p) => particle(values[k] ?? '', ...PAIRS[p]))
    .replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
}

// 고른 선지 → { 단계id: 선지id }. 육각형 판에는 지금 주차만 있어서, 지난 주차는 왼쪽 칸 W1~W5 주차 요약
// (단계 순서대로 선지 이름이 한 줄씩)을 하나씩 열어 읽는다. 다 읽으면 '현재' 탭으로 돌려놓는다
function readSelection() {
  const selection = {};
  const tabs = [...document.querySelectorAll('.p-left .tabs .tab')];
  tabs.slice(1).forEach((tab, w) => {
    if (tab.hidden || !WEEKS[w]) return;
    tab.click();
    [...document.querySelectorAll('#hud-week .week-rows li span')].forEach((span, i) => {
      const step = WEEKS[w].steps[i], text = span.textContent.trim();
      const choice = step?.choices?.find(c => text === c.label || text.endsWith(' ' + c.label));
      if (choice) selection[step.id] = choice.id;
    });
  });
  tabs[0]?.click();
  for (const node of document.querySelectorAll('.hb-node.s-chosen')) selection[node.dataset.step] = node.dataset.id;
  return selection;
}
// 왼쪽 게이지 칸의 지금 값 → { air, water, food, power }
function readGauges() {
  const byLabel = Object.fromEntries(GAUGE_KEYS.map(k => [GAUGE_LABELS[k], k])), values = {};
  for (const row of document.querySelectorAll('#hud-gauges .gauge-row')) {
    const key = byLabel[row.querySelector('.g-name')?.textContent]; if (key) values[key] = Number(row.querySelector('.g-val')?.textContent);
  }
  return values;
}
const choiceOf = (stepId, selection) => WEEKS.flatMap(w => w.steps).find(s => s.id === stepId)?.choices?.find(c => c.id === selection[stepId]);
// 그 게이지를 가장 많이 깎은 선지 (즉시 효과 + 매주 효과 × 남은 주)
function causeFor(key, selection) {
  let worst = null;
  WEEKS.forEach(({ steps }, w) => steps.forEach(step => {
    const id = selection[step.id]; if (!id) return;
    const hit = effectsFor(id, selection).reduce((sum, e) => sum + (e.now?.[key] ?? 0) + (e.weekly?.[key] ?? 0) * (WEEKS.length - w), 0);
    const choice = step.choices?.find(c => c.id === id);
    if (hit < 0 && (!worst || hit < worst.hit)) worst = { hit, id, week: w + 1, label: choice?.label ?? id };
  }));
  return worst;
}
// 그 게이지를 깎은 선지가 하나도 없을 때(식량·공기): 그 게이지를 만드는 선지를 '넉넉히 못 채운 것'으로 짚는다
const MAKER = { food: 'crop', air: 'oxygen', water: 'source', power: 'power' };
function makerFor(key, selection) {
  const stepId = MAKER[key], id = selection[stepId];
  const week = WEEKS.findIndex(w => w.steps.some(s => s.id === stepId)) + 1;
  return id ? { id, week, label: choiceOf(stepId, selection)?.label ?? id, lack: true } : null;
}
// 원인 선지의 결과를 현재형 한 줄로 (ending-story.json symptom)
function symptomText(key, selection, g) {
  const cause = causeFor(key, selection) ?? makerFor(key, selection), S = STORY.symptom;
  const parts = cause
    ? [cause.lack ? fill(S.lack, { label: `「${cause.label}」`, g }) : S.lead, S[`${cause.id}:${key}`] ?? S[cause.id]]
    : [S.none];
  return { cause, parts };
}

// 날짜 글: 0 → 입주 D+0, 7의 배수 → N주째, 그 밖 → N일째
const dayLabel = d => d === 0 ? '입주 D+0' : d % 7 === 0 ? `입주 ${d / 7}주째` : `입주 ${d}일째`;
// 검증 기록(trace: 입주 날, 1주, 2주 …)에서 d 일째 그 게이지 값 (주 사이는 곧게 잇는다)
function valueAt(trace, key, d) {
  const w = d / 7, i = Math.min(Math.floor(w), trace.length - 1), j = Math.min(i + 1, trace.length - 1);
  const v = trace[i][key] + (trace[j][key] - trace[i][key]) * (w - i);
  return Math.max(0, Math.round(v));
}

/**
 * 결말 판정 + 이야기 → { j, code, key, beats: [{ text, cue, day, value }], cause, final: { tag, title, line, cost } }
 * selection: 고른 선지, start: 입주 날(또는 실패한 날) 게이지, failed: { key, week } | null, move: 'M1' | 'M2'
 */
export function buildStory({ selection, start, failed = null, move = selection.arrive ?? 'M1' }) {
  const j = judge(selection, start, failed), key = j.key, g = GAUGE_LABELS[key] ?? '물';
  const label = id => choiceOf(id, selection)?.label ?? '';
  const beats = [];
  const add = (day, value, parts, cue) => {
    const text = parts.filter(Boolean).map(t => fill(t, { g, value: start[key] })).join(' ');
    if (text) beats.push({ text, cue, day, value: Math.max(0, Math.round(value)) });
  };
  const steady = selection.oxygen && selection.crop ? fill(STORY.steady, { oxygen: `「${label('oxygen')}」`, crop: `「${label('crop')}」` }) : null;
  const sym = symptomText(key, selection, g);
  // 고장 시험은 입주 날 값으로 판정한다. 이야기에서는 판정과 어긋나지 않게 입주 1주째에 같은 고장이 일어나고,
  // 그때 값에서 시험과 같은 만큼 떨어진 값을 보여 준다 (3주째로 미루면 이주민 소비로 이미 줄어 '안정적 이주'에서도 0 이 됐다)
  const test = j.B?.worst, tg = test ? GAUGE_LABELS[test.low] : '';
  const week1 = j.H?.trace ? valueAt(j.H.trace, test?.low ?? key, 7) : start[key];
  const bmin = test ? Math.max(0, Math.round(week1 - (start[test.low] - test.min))) : 0;
  const testValues = { g, value: start[key], test: test?.name ?? '', tg, bmin, strategy: strategy(selection), week: j.week };
  let final;

  if (j.code === 'E1') {   // 준비 중 바닥: 이주민은 오지 않는다
    const wk = `${j.week}주차`;
    add(wk, 0, [fill(STORY.E1.start, { g, week: j.week }), ...sym.parts], 'symptom');
    add(`${wk} · 사흘 뒤`, 0, [STORY.E1.crisis], 'crisis');
    add('철수 결정', 0, [STORY.E1.end], 'end');
    final = { tag: `ORI · 준비 ${wk} · 이주 중단`, title: STORY.final.E1.title[key], line: fill(STORY.final.E1.line, testValues), cost: STORY.final.E1.cost };
  } else if (j.code === 'E2') {   // 착륙 보류: 이주민은 궤도에서 돌아간다
    const v = start[key];
    add('도착 당일', v, [fill(STORY.E2.orbit, { g, value: v })], 'calm');
    add('도착 1일째', v, [STORY.E2.check, ...sym.parts], 'symptom');
    add('도착 3일째', v, [STORY.E2.talk], 'strain');
    add('도착 7일째', v, [STORY.E2.hold, move === 'M2' && STORY.E2.M2], 'hold');
    final = { tag: 'ORI · 이주선 궤도 도착 · 착륙 보류', title: STORY.final.E2.title, line: fill(STORY.final.E2.line, testValues), cost: STORY.final.E2.cost };
  } else if (j.code === 'E3') {   // 입주 후 바닥나 철수. 바닥나는 주(j.week)에 맞춰 날짜를 줄인다
    const trace = j.H.trace, scale = j.week / 4;
    const days = [0, 3, 7, 14, 21, 28].map((d, i) => i === 0 ? 0 : Math.max(i, Math.round(d * scale)));
    for (let i = 1; i < days.length; i++) if (days[i] <= days[i - 1]) days[i] = days[i - 1] + 1;
    const at = i => valueAt(trace, key, days[i]);
    add(dayLabel(days[0]), start[key], [STORY.arrive[move], STORY.place[selection.module]], 'arrive');
    add(dayLabel(days[1]), at(1), [steady], 'calm');
    add(dayLabel(days[2]), at(2), [...sym.parts, STORY.symptom.tail], 'symptom');
    const picks = new Set(Object.values(selection));
    const detail = Object.entries(STORY.detail).find(([k]) => { const [gauge, id] = k.split(':'); return gauge === key && picks.has(id) && id !== sym.cause?.id; });
    add(dayLabel(days[3]), at(3), [STORY.ration[key], detail?.[1], move === 'M2' && STORY.ration.M2], 'ration');
    add(dayLabel(days[4]), at(4), [STORY.crisis[key], STORY.crisis[selection.pool]], 'crisis');
    add(dayLabel(days[5]), 0, [STORY.end.lead, STORY.end[selection.fix], STORY.end.call], 'end');
    const text = MOVE[move] ?? MOVE.M1;
    final = { tag: `ORI · 입주 후 ${j.week}주 · 철수`, title: fill(STORY.final.E3.title, { g }), line: `${SCENE[key]} ${text.line}`, cost: text.cost };
  } else {   // E4 취약한 정착 · E5 안정적 이주: 4주를 버틴다. 1주째에 고장 시험과 같은 고장이 실제로 일어난다
    const trace = j.H.trace, at = d => valueAt(trace, key, d), E = STORY[j.code];
    add(dayLabel(0), start[key], [STORY.arrive[move], STORY.place[selection.module]], 'arrive');
    add(dayLabel(3), at(3), [steady], 'calm');
    if (j.code === 'E4') {
      const low = j.weakBy === 'low';
      add(dayLabel(7), test && test.low === key ? bmin : at(7), [fill(E.shock, testValues)], 'shock');
      add(dayLabel(14), at(14), [fill(low ? E.weekLow : E.weekTest, testValues), low && sym.parts[1]], 'symptom');
      add(dayLabel(21), at(21), [fill(low ? E.rationLow : E.rationTest, testValues), move === 'M2' && STORY.ration.M2], low ? 'strain' : 'calm');
      add(dayLabel(28), at(28), [fill(low ? E.endLow : E.endTest, testValues)], 'hold');
      final = { tag: 'ORI · 입주 후 4주 · 정착 유지', title: STORY.final.E4.title[j.weakBy], line: fill(STORY.final.E4.line[j.weakBy], testValues), cost: STORY.final.E4.cost };
    } else {
      add(dayLabel(7), test && test.low === key ? bmin : at(7), [fill(E.shock, testValues)], 'shockSmall');
      add(dayLabel(14), at(14), [fill(E.week, testValues)], 'calm');
      add(dayLabel(21), at(21), [E.drill], 'calm');
      add(dayLabel(28), at(28), [E.harvest[selection.crop], move === 'M2' && E.M2, E.end], 'thrive');
      final = { tag: 'ORI · 입주 후 4주 · 정착 완료', title: STORY.final.E5.title, line: fill(STORY.final.E5.line, testValues), cost: STORY.final.E5.cost };
    }
  }
  // 이번 판 기록: 마지막 게이지 값과 버틴 날
  const lastTrace = j.H?.trace?.[j.H.trace.length - 1];
  const values = (j.code === 'E3' || j.code === 'E4' || j.code === 'E5') && lastTrace ? lastTrace : start;
  const span = { E1: `준비 ${j.week}주차`, E2: '착륙 보류', E3: `${(j.week ?? 4) * 7}일`, E4: '28일', E5: '28일' }[j.code];
  const report = { values: Object.fromEntries(GAUGE_KEYS.map(k => [k, Math.max(0, Math.round(values[k] ?? 0))])), span };
  return { j, code: j.code, key, beats, cause: sym.cause, final, report };
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : ms));

// ---- 기지에서 벌어지는 일 ----
let hardship = null, hardLevel = 0, inBase = false;   // 엔딩 때만 켜지는 환경 덮어쓰기와 그 세기 (0.75: 힘들어함, 1: 쓰러짐)
const baseStep = Person.prototype.step;
const mixEnv = (a, b, k) => ({ tempC: a.tempC + (b.tempC - a.tempC) * k, oxygenPct: a.oxygenPct + (b.oxygenPct - a.oxygenPct) * k, activityMET: a.activityMET + (b.activityMET - a.activityMET) * k });
// 세 명 중 한 명은 덜 겪는다(spared): 끝까지 버티며 쓰러진 사람에게 달려가 돌보고 부축한다 (people.js 의 돕기 동작)
// 엔딩 동안(inBase)은 서 있는 자리와 상관없이 모두 기지 안 공기(INDOOR)를 기준으로 한다: 새로 온 사람이 바깥에 서 있어도
// 입주 날부터 쓰러지지 않고, 바닥나는 정도(hardLevel)에 따라서만 힘들어하고 쓰러진다
Person.prototype.step = function (env, dt) {
  const base = inBase ? { ...INDOOR } : env;
  if (!hardship || hardLevel <= 0) return baseStep.call(this, base, dt);
  return baseStep.call(this, mixEnv(base, hardship(base), this.spared ? hardLevel * 0.3 : hardLevel), dt);
};

// 새로 온 사람들: 기지 둘레 착륙선 쪽에서 무리 지어 나타난다
function arrive(count) {
  const crew = window.people?.list ?? [];
  if (!window.people || !crew.length) return;
  const cx = crew.reduce((s, p) => s + p.x, 0) / crew.length, cz = crew.reduce((s, p) => s + p.z, 0) / crew.length;
  let added = 0;
  for (let i = 0; added < count && i < 12; i++) {
    const a = 0.6 + i * 0.9, r = 2.2 + (i % 3) * 0.5;
    added += (window.people.addGroup(cx + Math.cos(a) * r, cz + Math.sin(a) * r) ?? []).length;
  }
}
// 카메라를 조금 당기거나(-1) 민다(+1): 3D 화면에 휠 신호를 나눠 보낸다
async function dolly(direction, total = 520, steps = 20) {
  const canvas = document.querySelector('#canvas-host canvas');
  if (!canvas) return;
  for (let i = 0; i < (reducedMotion ? 1 : steps); i++) {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * (reducedMotion ? total : total / steps), clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
    await wait(1800 / steps);
  }
}
// 처음 쓰러진 사람에게 이름표를 띄운다
let watchDown = null;
function followFallen() {
  clearInterval(watchDown);
  watchDown = setInterval(() => {
    const fallen = window.people?.list.find(p => p.status === 'down');
    if (fallen) { window.people.pin(fallen); clearInterval(watchDown); }
  }, 300);
}
let story = null;   // 지금 틀고 있는 이야기 (cue 가 결말·이주 방식·고장 게이지를 본다)
function cue(name) {
  const stage = document.body, key = story.key;
  const flash = () => { stage.classList.remove('ending-flash'); void stage.offsetWidth; stage.classList.add('ending-flash'); };
  const spare = () => (window.people?.list ?? []).forEach((p, i) => { p.spared = i % 3 === 1; });
  const hurt = (k, level) => { spare(); hardship = HARDSHIP[k] ?? HARDSHIP.water; hardLevel = level; };
  if (name === 'arrive') { arrive(ARRIVALS[story.move] ?? 8); dolly(-1); }
  if (name === 'symptom') stage.dataset.endingDim = '1';
  if (name === 'strain') { hurt(key, 0.75); stage.dataset.endingDim = '2'; }                         // 아끼며 버팀: 힘들어하지만 쓰러지지 않는다
  if (name === 'ration') { hurt(key, 0.75); stage.dataset.endingDim = '2'; }
  if (name === 'crisis') { hurt(key, 1); flash(); followFallen(); }                                    // 바닥: 하나둘 쓰러지고, 버티는 사람이 돕는다
  if (name === 'end') { stage.dataset.endingDim = '3'; stage.classList.add('ending-flicker'); }
  if (name === 'shock') {                                                                              // 고장: 잠깐 쓰러지는 사람이 생기고, 복구되면 다시 일어난다
    hurt(story.j.B?.worst.low ?? key, 1); flash(); stage.dataset.endingDim = '2'; followFallen();
    setTimeout(() => { hardLevel = 0.2; stage.dataset.endingDim = '1'; }, reducedMotion ? 0 : 6500);   // 6.5초면 몇 사람이 쓰러졌다가 복구 뒤 일어난다
  }
  if (name === 'shockSmall') { flash(); stage.dataset.endingDim = '1'; setTimeout(() => { stage.dataset.endingDim = '0'; }, reducedMotion ? 0 : 2500); }
  if (name === 'hold') { hardLevel = 0; stage.dataset.endingDim = '2'; }
  if (name === 'calm' && story.code === 'E5') { hardLevel = 0; stage.dataset.endingDim = '0'; }
  if (name === 'thrive') { hardLevel = 0; stage.dataset.endingDim = '0'; stage.classList.add('ending-bright'); }
}

// 옆 창을 숨기고 가운데 3D 화면만 남긴다 (CSS: body.ending-mode)
function clearScreen() {
  document.getElementById('fail')?.setAttribute('hidden', '');
  document.querySelectorAll('.crew-modal, .data-modal').forEach(el => { el.hidden = true; });
  document.body.classList.add('ending-mode');
  inBase = true;
}
// 마지막: 카메라가 기지에서 살짝 물러난 뒤 '← 행성으로'로 행성 전체가 보이는 곳까지 날아간다
// (지역 화면은 따로 떼어 낸 땅이라 휠로는 행성까지 못 간다). 게임 안 선택 단계는 처음으로 돌아가지만,
// 엔딩 동안 칸은 모두 숨겨져 있고 '처음부터 다시'는 새로 불러온다.
async function pullBack() {
  await dolly(1, 2400, 24);
  clearInterval(watchDown); window.people?.pin(null);
  document.body.dataset.endingDim = '0'; document.body.classList.remove('ending-flicker', 'ending-bright');
  document.getElementById('back')?.click();
}

// 위 시계: 날짜 · 중심 게이지(값이 바뀌는 막대) · 기지 인원
function makeClock(key) {
  const root = document.createElement('div');
  root.className = 'ending-clock'; root.setAttribute('aria-live', 'polite');
  root.innerHTML = `<b class="ec-day"></b><span class="ec-gauge"><small>${esc(GAUGE_LABELS[key] ?? '물')}</small><i><em></em></i><strong></strong></span><span class="ec-people"></span>`;
  document.body.append(root);
  const day = root.querySelector('.ec-day'), bar = root.querySelector('em'), num = root.querySelector('strong'), ppl = root.querySelector('.ec-people');
  let shownValue = null, anim = null;
  const count = () => {
    const list = window.people?.list ?? [], down = list.filter(p => p.status === 'down').length;
    if (story) { story.peakDown = Math.max(story.peakDown ?? 0, down); story.headcount = list.length; }
    ppl.textContent = `기지 인원 ${list.length}명${down ? ` · 쓰러짐 ${down}` : ''}`;
  };
  const people = setInterval(count, 500);   // 쓰러지는 사람 수가 바로 바뀐다
  return {
    root,
    stop: () => clearInterval(people),
    show(beat) {
      day.textContent = beat.day;
      day.classList.remove('tick'); void day.offsetWidth; day.classList.add('tick');
      const from = shownValue ?? beat.value, to = beat.value, t0 = performance.now();
      cancelAnimationFrame(anim);
      const step = now => {   // 숫자가 1.6초에 걸쳐 바뀐다
        const k = reducedMotion ? 1 : Math.min(1, (now - t0) / 1600), v = Math.round(from + (to - from) * k);
        num.textContent = v; bar.style.width = `${Math.max(0, Math.min(100, v))}%`;
        root.classList.toggle('low', v <= 20);
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step); shownValue = to;
      count();
    },
  };
}

// 이야기를 자막처럼 한 줄씩 보여 주고, 줄마다 기지에서 그 장면을 벌인다. 글 길이에 맞춰 오래 머문다
// 글을 누르면 다음 줄로, '건너뛰기'는 바로 마지막으로 간다
const EXTRA_HOLD = { crisis: 5000, shock: 5000, ration: 1500, strain: 1500 };
function playSubtitles(beats, key) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'ending-subs'; box.setAttribute('aria-live', 'polite');
    box.innerHTML = '<p class="ending-sub"></p><div class="ending-subs-bar"><span class="ending-subs-dots"></span><button type="button" class="ending-skip">건너뛰기 ▶▶</button></div>';
    document.body.append(box);
    const clock = makeClock(key);
    const line = box.querySelector('.ending-sub'), dots = box.querySelector('.ending-subs-dots');
    dots.innerHTML = beats.map(() => '<i></i>').join('');
    let index = -1, timer = null, done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      clock.show(beats[beats.length - 1]); box.classList.add('out'); clock.root.classList.add('out');
      setTimeout(() => { clock.stop(); box.remove(); clock.root.remove(); }, 2400); resolve();
    };
    const next = () => {
      index += 1;
      if (index >= beats.length) return finish();
      const beat = beats[index];
      line.classList.remove('in'); void line.offsetWidth;
      line.textContent = beat.text; line.classList.add('in');
      dots.querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i <= index));
      cue(beat.cue); clock.show(beat);
      const hold = Math.max(4600, beat.text.length * 85) + (EXTRA_HOLD[beat.cue] ?? 0);
      timer = setTimeout(next, reducedMotion ? 6000 : hold);
    };
    box.querySelector('.ending-skip').addEventListener('click', finish);
    line.addEventListener('click', () => { clearTimeout(timer); next(); });
    box.querySelector('.ending-skip').focus({ preventScroll: true });
    next();
  });
}

// 결말 모으기: 이 브라우저에서 본 결말을 남긴다 (저장이 막혀 있으면 이번 결말만 보인다)
const SEEN_KEY = 'tidelocked.endings.seen';
function rememberEnding(code) {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); } catch { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  if (!seen.includes(code)) seen.push(code);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* 저장 안 됨: 이번만 보인다 */ }
  return seen;
}
// 얻은 칭호: 결과로 얻는 것 먼저, 그다음 고른 선지로 얻는 것 (ending-story.json badges)
function badgesFor(selection, st) {
  const B = STORY.badges, out = [], code = st.code, down = st.peakDown ?? 0;
  if (down === 0 && code !== 'E1' && code !== 'E3') out.push(B.noDown);
  if (down > 0) out.push(B.helpers);
  if (code === 'E5') out.push(B.harvest);
  if ((code === 'E4' || code === 'E5') && selection.fix === 'U2') out.push(B.sturdy);
  if (selection.oxygen === 'O2' && selection.reuse === 'R2') out.push(B.loop);
  if (selection.power === 'P2') out.push(B.reactor);
  if (selection.arrive === 'M2' && code !== 'E1') out.push(B.staged);
  out.push({ A: B.plain, B: B.cave, C: B.ridge }[selection.location] ?? B.plain);
  return out.filter(Boolean);
}
// 이번 판 기록의 숫자와 막대가 0 에서 차오른다
function countUp(root) {
  const t0 = performance.now() + (reducedMotion ? 0 : 2200);
  const targets = [...root.querySelectorAll('[data-to]')];
  const step = now => {
    const k = reducedMotion ? 1 : Math.max(0, Math.min(1, (now - t0) / 1400)), e = 1 - (1 - k) ** 3;
    for (const el of targets) {
      const v = Math.round(Number(el.dataset.to) * e);
      if (el.tagName === 'EM') el.style.width = `${Math.min(100, v)}%`; else el.textContent = v;
    }
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let shown = false;
async function showEnding({ move = 'M1', start, failed = null, selection = readSelection() }) {
  if (shown) return; shown = true;
  story = { ...buildStory({ selection, start, failed, move }), move };
  const { j, code, key, beats, cause, final } = story;
  clearScreen();
  await wait(1600);
  await playSubtitles(beats, key);
  await pullBack();
  await wait(2600);   // 행성까지 날아가는 동안

  const name = GAUGE_LABELS[key] ?? '물';
  const verdict = j.H ? `입주 날 최저 ${j.M} · 입주 후 4주 검증 ${j.H.ok ? '통과' : `실패 (${j.H.week}주째 ${GAUGE_LABELS[j.H.key]} 0)`} · 고장 시험 최저 ${Math.max(0, j.B.B)} (${j.B.worst.name})` : '';
  const seen = rememberEnding(code);
  const badges = badgesFor(selection, story).slice(0, 3);
  const rv = story.report.values, lowest = GAUGE_KEYS.reduce((a, b) => rv[a] <= rv[b] ? a : b);   // 가장 낮게 끝난 게이지를 주황으로
  const gauges = GAUGE_KEYS.map(k => `<li class="${k === lowest ? 'key' : ''}"><small>${esc(GAUGE_LABELS[k])}</small><i><em data-to="${story.report.values[k]}"></em></i><b data-to="${story.report.values[k]}">0</b></li>`).join('');
  const slots = Object.entries(ENDINGS).map(([c, e]) => seen.includes(c)
    ? `<li class="got${c === code ? ' now' : ''}"><b>${e.n}</b>${esc(e.name)}</li>`
    : `<li class="locked"><b>${e.n}</b>???<small>${esc(STORY.hint[c])}</small></li>`).join('');
  const root = document.createElement('div');
  root.className = `ending ending-${code}`; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ending-title');
  root.innerHTML = `
    <div class="ending-frame">
      <p class="ending-tag rv" style="--d:.3s">${esc(final.tag)}</p>
      <div class="ending-main">
        <div class="ending-text">
          <p class="ending-code rv" style="--d:.7s">결말 ${ENDINGS[code].n} · ${esc(ENDINGS[code].name)}</p>
          <h2 id="ending-title" class="rv" style="--d:1.1s">${esc(final.title)}</h2>
          <p class="rv" style="--d:1.7s">${esc(final.line)}</p>
          <p class="ending-cost rv" style="--d:2.3s">${esc(final.cost)}</p>
          <div class="ending-epilogue rv" style="--d:3.2s"><small>10년 뒤</small><p>${esc(STORY.epilogue[code])}</p></div>
        </div>
        <div class="ending-report rv" style="--d:2s" aria-label="이번 판 기록">
          <h3>이번 판 기록</h3>
          <ul class="ending-gauges">${gauges}</ul>
          <dl class="ending-facts">
            <div><dt>기지 인원</dt><dd data-to="${story.headcount ?? 0}">0</dd></div>
            <div><dt>쓰러진 사람</dt><dd data-to="${story.peakDown ?? 0}">0</dd></div>
            <div><dt>버틴 기간</dt><dd>${esc(story.report.span)}</dd></div>
          </dl>
          ${badges.length ? `<h3>얻은 칭호</h3><ul class="ending-badges">${badges.map(([title, why], n) => `<li class="rv" style="--d:${3.6 + n * 0.4}s"><b>${esc(title)}</b><small>${esc(why)}</small></li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <div class="ending-collect rv" style="--d:4.4s">
        <h3>결말 모으기 <b>${seen.length} / 5</b></h3>
        <ul>${slots}</ul>
      </div>
      <div class="ending-actions rv" style="--d:4.8s">
        <button type="button" class="decide" id="ending-restart">▶ 다른 결말 찾으러 가기</button>
        <details class="ending-story"><summary>되짚어 보기</summary>
          ${cause && code !== 'E5' ? `<p class="ending-cause">${cause.week}주차 「${esc(cause.label)}」에서 ${esc(particle(name, '이', '가'))} 부족해지기 시작했다.</p>` : ''}
          ${verdict ? `<p class="ending-verdict">${esc(verdict)}</p>` : ''}
          <ol>${beats.map(b => `<li><b>${esc(b.day)}</b> ${esc(b.text)}</li>`).join('')}</ol></details>
      </div>
    </div>`;
  document.body.append(root);
  countUp(root);
  const button = root.querySelector('#ending-restart');
  button.addEventListener('click', () => { location.href = location.pathname; });
  button.focus({ preventScroll: true });
}

// 5주차 마지막 단계(입주) 결정 버튼: 고른 입주 방식과 게이지를 읽고, 게이지가 다시 그려진 뒤 엔딩을 띄운다
document.addEventListener('click', (event) => {
  if (!event.target.closest('.hb-decide')) return;
  const node = document.querySelector('.hb-node.s-chosen[data-step="arrive"]');
  if (!node) return;
  const move = node.dataset.id;
  setTimeout(() => { if (document.getElementById('fail')?.hidden !== false) showEnding({ move, start: readGauges() }); }, 1800);
}, true);
// 결말 1 생존 실패: 준비 중 게이지가 0 이 되어 게임의 '기지 운영 실패' 창이 뜨면, 그 창 대신 엔딩을 튼다
const failBox = document.getElementById('fail');
if (failBox) new MutationObserver(() => {
  if (failBox.hidden || shown) return;
  const start = readGauges(), key = GAUGE_KEYS.reduce((a, b) => start[a] <= start[b] ? a : b);
  const week = [...document.querySelectorAll('.p-left .tabs .tab')].slice(1).filter(t => !t.hidden).length || 1;
  showEnding({ start, failed: { key, week } });
}).observe(failBox, { attributes: true, attributeFilter: ['hidden'] });
// 개발용: window.ending.show({ move: 'M2', start: { air: 60, water: 20, food: 50, power: 40 } }), window.ending.story({ selection, start })
window.ending = { show: showEnding, story: buildStory };
