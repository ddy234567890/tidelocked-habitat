// 난이도 재기: 자동 플레이로 결말 비율을 센다 (화면 없이 게임의 게이지·사건·판정 코드를 그대로 쓴다)
//   node scripts/balance.mjs c [판 수=6000] [사건 세기=planet.json 값]
//   node scripts/balance.mjs c 4000 check  → planet.json target 범위를 벗어나면 실패한다 (npm test)
// 아무거나 = 선지·대응 무작위 / 신중 = 70% 는 게이지가 좋아지는 선지, 대응은 가장 나은 것 / 시간초과 = 선지 무작위, 대응 안 함
const [id = 'b', n = '6000', severity] = process.argv.slice(2);
globalThis.startParams = '?planet=' + id;
const { PLANET } = await import('../src/planets/index.js');
if (PLANET.id !== id) throw new Error('없는 행성: ' + id);
const check = severity === 'check';
if (severity && !check) PLANET.events.severity = Number(severity); // events.js 를 불러오기 전에 바꾼다
const { ALL_STEPS, WEEKS, availableChoices, choose } = await import('../src/choices.js');
const { gaugeState, GAUGE_KEYS } = await import('../src/gauges.js');
const { judge } = await import('../src/endingJudge.js');
const { pickEvent, outcome } = await import('../src/events.js');
const { mulberry32 } = await import('../src/terrain.js');
const copy = list => list.map(item => ({ ...item }));
const low = values => Math.min(...GAUGE_KEYS.map(k => values[k]));
const meets = (requires, s) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(s[step]));

function play(rand, policy) {
  const rules = PLANET.events, weeks = [2, 3, 4, 5], used = new Set(), decided = {}, met = [];
  let sel = {}, extras = [], follow = null, next = null, ease = 0;
  for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [weeks[i], weeks[j]] = [weeks[j], weeks[i]]; }
  const active = weeks.slice(0, rules.eventsPerGame);
  const kindOf = w => rules.goodPerGame == null ? null : active.indexOf(w) < rules.goodPerGame ? 'good' : 'bad';
  for (let w = 1; w <= 5; w++) {
    for (const step of WEEKS[w - 1].steps) {
      const options = availableChoices(step.id, sel).map(c => c.id);
      let pick = options[Math.floor(rand() * options.length)];
      if (policy === '신중' && rand() < 0.7) {
        let best = -Infinity;
        for (const o of options) {
          const g = gaugeState(choose(sel, step.id, o), { ...decided, [step.id]: true }, w, copy(extras));
          const ahead = GAUGE_KEYS.map(k => g.values[k] + g.weekly[k] * (6 - w));
          const score = Math.min(...ahead) + 0.15 * ahead.reduce((a, b) => a + b, 0) + rand() * 3;
          if (score > best) { best = score; pick = o; }
        }
      }
      sel = choose(sel, step.id, pick); decided[step.id] = true;
    }
    if (next) {
      used.add(next.id); met.push(next.id);
      const open = next.responses.filter(r => meets(r.requires, sel));
      const list = policy === '시간초과' && next.ignore ? [next.ignore] : policy === '신중' ? open : [open[Math.floor(rand() * open.length)]];
      let best = -Infinity, take = null;
      for (const r of list) {
        const tried = [...extras, ...outcome(next, r, sel, w)];
        const score = Math.min(low(gaugeState(sel, decided, w, copy(tried)).values), low(gaugeState(sel, decided, Math.min(w + 1, 5), copy(tried)).values)) + (r.ease ?? 0) * 0.5;
        if (score > best) { best = score; take = [r, tried]; }
      }
      extras = take[1]; follow = take[0].follow ?? null; ease += take[0].ease ?? 0;
    }
    const g = gaugeState(sel, decided, w, copy(extras));
    if (g.failed) return { j: { code: 'E1', key: g.failed.key }, sel, met };
    next = null;
    if (w < 5 && (active.includes(w + 1) || follow)) next = pickEvent(sel, used, new Set(), rand, follow, { kind: kindOf(w + 1), week: w + 1 });
    follow = null;
  }
  return { j: judge(sel, gaugeState(sel, decided, 5, copy(extras)).values, null, ease), sel, met };
}
const share = {};
const pct = (a, b) => (a / b * 100).toFixed(1) + '%';
console.log(`${PLANET.name} · 사건 세기 ${PLANET.events.severity} · ${n}판`);
for (const policy of ['아무거나', '신중', '시간초과']) {
  const rand = mulberry32(20261124), codes = {}, picks = {}, events = {}, keys = {};
  for (let i = 0; i < Number(n); i++) {
    const { j, sel, met } = play(rand, policy);
    codes[j.code] = (codes[j.code] ?? 0) + 1;
    if (j.code === 'E1') keys[j.key] = (keys[j.key] ?? 0) + 1;
    for (const c of Object.values(sel)) { picks[c] ??= [0, 0]; picks[c][0]++; if (j.code === 'E5') picks[c][1]++; }
    for (const e of met) { events[e] ??= [0, 0]; events[e][0]++; if (j.code === 'E1') events[e][1]++; }
  }
  share[policy] = Object.fromEntries(['E1', 'E5'].map(c => [c, (codes[c] ?? 0) / n * 100]));
  console.log(policy, ['E1', 'E2', 'E3', 'E4', 'E5'].map(c => `${c} ${pct(codes[c] ?? 0, n)}`).join(' · '), '| E1 원인', JSON.stringify(keys));
  if (policy === '신중') {
    console.log('  선지별 E5:', ALL_STEPS.map(s => s.choices.map(c => `${c.label} ${picks[c.id] ? pct(picks[c.id][1], picks[c.id][0]) : '-'}`).join(', ')).join(' / '));
    console.log('  나온 사건:', Object.entries(events).map(([e, [k]]) => `${e} ${pct(k, n)}`).join(', '));
  }
}
if (check) for (const [policy, ranges] of Object.entries(PLANET.target)) for (const [code, [from, to]] of Object.entries(ranges)) {
  if (share[policy][code] < from || share[policy][code] > to) throw new Error(`${PLANET.name} ${policy} ${code} ${share[policy][code].toFixed(1)}% 가 목표 ${from}~${to}% 밖이다`);
}
