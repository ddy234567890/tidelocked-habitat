// 돌발 사건 (체험판, 2026-11-16): 고른 선지와 선지 조합에서 사건이 생긴다. 데이터는 events.json.
// 2~5주차에 한 번씩. 사건은 한 주 앞서 뽑아 두고 그 주 브리핑에 예고(hint)를 띄운다.
// 언제 터질지는 무작위다: 그 주 단계 중 하나를 결정하고 1~3초 뒤, 또는 '다음 주로'를 누를 때 (5주차는 단계 중 하나).
// 사건이 뜨면 대응 버튼을 고르고, 그 효과는 gauges.js gaugeState 의 extras 로 들어간다.
// 기록장: 한 번이라도 만난 사건은 이 브라우저에 남는다 (localStorage). 아직 못 만난 사건은 ??? 와 힌트로만 보인다.
import data from './events.json' with { type: 'json' };
import { ALL_STEPS, WEEKS } from './choices.js';
import { mulberry32 } from './terrain.js';

export const EVENTS = data.events;
const byId = Object.fromEntries(EVENTS.map(event => [event.id, event]));
const SEEN_KEY = 'tidelocked.events.seen';
const LAST_WEEK = 5; // 마지막 주에는 '다음 주로'가 없어서 단계를 결정할 때만 사건이 뜬다

// 사건 피해 세기 (events.json severity): 줄어드는 값(음수)에만 곱한다. 좋아지는 값은 그대로다
export const SEVERITY = data.severity ?? 1;
export const harsh = effect => effect && Object.fromEntries(Object.entries(effect).map(([key, value]) => [key, value < 0 ? Math.round(value * SEVERITY) : value]));
const meets = (requires, selection) => Object.entries(requires ?? {}).every(([step, ids]) => ids.includes(selection[step]));
/** 지금 선택으로 그 사건이 나올 수 있나 */
export function eligible(event, selection) {
  if (event.followOnly) return false;
  if (!event.when?.length) return true;
  const hits = event.when.filter(cond => meets(cond, selection)).length;
  return hits >= (event.atLeast ?? 1);
}
/** 사건이 나오게 만든 내 선지 이름들 (카드의 '연결된 선택') */
export function causes(event, selection) {
  const ids = new Set();
  for (const cond of event.when ?? []) if (meets(cond, selection)) for (const step of Object.keys(cond)) ids.add(step + ':' + selection[step]);
  for (const adjust of event.adjust ?? []) if (meets(adjust.requires, selection)) for (const step of Object.keys(adjust.requires)) ids.add(step + ':' + selection[step]);
  return [...ids].map(key => {
    const [stepId, choiceId] = key.split(':');
    return ALL_STEPS.find(step => step.id === stepId)?.choices.find(choice => choice.id === choiceId)?.label;
  }).filter(Boolean);
}
/** 다음 사건 하나 뽑기. used: 이번 판에 이미 나온 id, seen: 기록장, rand: 0~1 */
export function pickEvent(selection, used, seen, rand, follow = null) {
  if (follow && byId[follow] && !used.has(follow)) return byId[follow];
  const goodUsed = [...used].some(id => byId[id]?.kind === 'good');
  const pool = EVENTS.filter(event => !used.has(event.id) && eligible(event, selection) && !(goodUsed && event.kind === 'good'));
  const weights = pool.map(event => (event.weight ?? (event.when?.length ? 3 : 1)) * (seen.has(event.id) ? 1 : 2));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) return pool[i]; }
  return pool.at(-1) ?? null;
}

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* 저장이 막혀 있어도 게임은 그대로 */ }
}
const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

/** onChange: 대응을 고를 때마다 불린다 (게이지 다시 그리기) */
export function createEvents({ onChange = () => {} } = {}) {
  let rand, scheduled, used, results, follow, pending = null, playing = false;
  const seen = loadSeen();
  function reset() {
    rand = mulberry32((Date.now() ^ 0x5eed) >>> 0);
    if (pending) clearTimeout(pending.timer);
    scheduled = {}; used = new Set(); results = []; follow = null; pending = null;
  }
  reset();

  // 화면: 사건 카드 하나를 body 에 붙여 두고 내용만 바꾼다
  const modal = make('div', 'event-modal');
  modal.hidden = true;
  modal.setAttribute('role', 'alertdialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'event-title');
  const card = make('div', 'event-card');
  modal.append(card);
  document.body.append(modal);

  function footer(onBook) {
    const foot = make('p', 'event-foot');
    foot.append('발견한 사건 ' + EVENTS.filter(e => seen.has(e.id)).length + ' / ' + EVENTS.length + ' · ');
    const book = make('button', 'event-book', '기록장 보기'); book.type = 'button';
    book.addEventListener('click', onBook);
    foot.append(book);
    return foot;
  }
  function showBook(back) {
    const list = make('ul', 'event-list');
    for (const event of EVENTS) {
      const known = seen.has(event.id), row = make('li', known ? event.kind : 'unknown');
      row.append(make('b', null, known ? event.name : '???'), make('span', null, known ? event.text : event.lockedHint));
      list.append(row);
    }
    const close = make('button', 'decide', '◀ 돌아가기'); close.type = 'button';
    close.addEventListener('click', back);
    card.className = 'event-card book';
    card.replaceChildren(make('p', 'event-code', '사건 기록장'), make('h2', null, EVENTS.filter(e => seen.has(e.id)).length + ' / ' + EVENTS.length + ' 발견'), list, close);
    close.focus();
  }

  // 나쁜 사건은 제한 시간 안에 대응을 골라야 한다 (events.json timerSeconds). 기록장을 보는 동안은 시간이 멈춘다.
  // 시간이 다 되면 아무 조치도 못 한 것이다: 사건의 ignore(손 놓았을 때 피해)가 그대로 들어온다. 어떤 대응보다 손해가 크다
  const TIMER_MS = (data.timerSeconds ?? 20) * 1000, URGENT_MS = 5000;
  const timeoutResponse = event => ({ ...event.ignore, id: 'timeout', timeout: true, label: '시간 초과',
    result: '아무 조치도 하지 못했어요. ' + event.ignore.result });

  function play(event, week, selection) {
    return new Promise(resolve => {
      const firstTime = !seen.has(event.id);
      seen.add(event.id); saveSeen(seen); used.add(event.id);
      const adjusts = (event.adjust ?? []).filter(a => meets(a.requires, selection));
      const open = event.responses.filter(r => !r.requires || meets(r.requires, selection));
      const timed = event.kind === 'bad';
      let left = TIMER_MS, last = null, frame = 0, answered = false, view = null;
      const stopClock = () => { cancelAnimationFrame(frame); last = null; };
      const tick = time => {
        if (answered) return;
        if (last != null) left -= time - last;
        last = time;
        if (view) {
          const shown = Math.max(0, Math.ceil(left / 1000));
          view.num.textContent = shown + '초';
          view.fill.style.width = Math.max(0, left / TIMER_MS * 100) + '%';
          view.box.classList.toggle('urgent', left <= URGENT_MS);
          view.box.setAttribute('aria-valuenow', String(shown));
        }
        if (left <= 0) return answer(timeoutResponse(event));
        frame = requestAnimationFrame(tick);
      };
      const onKey = e => { // 숫자 키 1·2·3 으로 바로 고른다
        const index = Number(e.key) - 1;
        if (!answered && view && open[index]) { e.preventDefault(); answer(open[index]); }
      };
      const ask = () => {
        card.className = 'event-card ' + event.kind + (timed ? ' timed' : '');
        const code = make('p', 'event-code', (event.kind === 'good' ? '좋은 소식' : '경보 · 돌발 사건') + ' · ' + week + '주차' + (firstTime ? ' · 새 사건' : ''));
        const title = make('h2', null, event.name); title.id = 'event-title';
        const parts = [code, title];
        if (timed) {
          const box = make('div', 'event-timer'), bar = make('span', 'event-timer-bar'), fill = make('i'), num = make('b', null, Math.ceil(left / 1000) + '초');
          box.setAttribute('role', 'timer'); box.setAttribute('aria-label', '남은 시간');
          bar.append(fill); box.append(make('span', 'event-timer-label', '남은 시간'), bar, num);
          parts.push(box);
          view = { box, fill, num };
        }
        parts.push(make('p', 'event-text', event.text));
        const linked = causes(event, selection);
        if (linked.length) parts.push(make('p', 'event-cause', '연결된 선택: ' + linked.join(' · ')));
        if (adjusts.length) {
          const why = make('ul', 'event-why');
          for (const a of adjusts) why.append(make('li', null, a.text));
          parts.push(why);
        }
        parts.push(make('p', 'event-ask', timed ? '빨리 정해야 해요! 어떻게 할까요?' : '어떻게 할까요?'));
        const options = make('div', 'event-options');
        open.forEach((response, i) => {
          const button = make('button', 'event-option' + (response.requires ? ' unlocked' : '')); button.type = 'button';
          button.append(make('b', null, (i + 1) + '. ' + response.label), make('span', null, response.line));
          if (response.requires) button.append(make('small', null, '열림 · ' + causes({ when: [response.requires] }, selection).join(' · ') + ' 덕분'));
          button.addEventListener('click', () => answer(response));
          options.append(button);
        });
        parts.push(options, footer(() => { stopClock(); view = null; showBook(ask); }));
        card.replaceChildren(...parts);
        options.querySelector('button')?.focus();
        if (timed) { stopClock(); frame = requestAnimationFrame(tick); }
      };
      const answer = response => {
        if (answered) return;
        answered = true; stopClock(); view = null;
        document.removeEventListener('keydown', onKey);
        // 사건 기본 피해(adjust)와 대응 효과를 한 항목으로 넣는다
        const now = {};
        for (const effect of [...adjusts.map(a => a.now ?? {}), response.now ?? {}]) for (const [key, value] of Object.entries(effect)) now[key] = (now[key] ?? 0) + value;
        results.push({ week, id: event.id, response: response.id, now: harsh(now), weekly: harsh(response.weekly), clearedBy: response.clearedBy });
        follow = response.follow ?? null;
        onChange();
        const done = () => {
          card.className = 'event-card ' + event.kind + (response.timeout ? ' timeout' : '');
          const parts = [make('p', 'event-code', event.name + ' · 결과'), make('h2', null, response.timeout ? '시간 초과 · 아무 조치도 못 했어요' : response.label), make('p', 'event-text', response.result)];
          if (response.aftermath) parts.push(make('p', 'event-cause', response.aftermath));
          const next = make('button', 'decide', '▶ 계속'); next.type = 'button';
          next.addEventListener('click', () => { modal.hidden = true; playing = false; document.body.classList.remove('event-alert'); resolve(); });
          parts.push(next, footer(() => showBook(done)));
          card.replaceChildren(...parts);
          next.focus();
        };
        done();
      };
      playing = true;
      document.body.classList.add('event-alert');
      document.addEventListener('keydown', onKey);
      modal.hidden = false;
      ask();
    });
  }

  return {
    reset,
    /** gaugeState 의 extras */
    effects: () => results,
    /** 그 주 브리핑에 붙일 예고 문장 */
    hintFor: week => (scheduled[week] ?? []).map(plan => byId[plan.id].hint),
    /** 사건 창이 떠 있으면 true ('다음 주로'를 막는다) */
    busy: () => playing,
    /**
     * 단계를 결정할 때마다 부른다. 이번 주 사건이 이 단계 뒤로 잡혀 있으면 1~3초 뒤 갑자기 뜬다
     * (다른 사건이 곧 뜰 참이면 그 사건이 끝난 뒤). 사건 창을 닫으면 true 로 끝나는 Promise (사건이 없으면 바로 false)
     */
    afterDecide(week, stepId, selection) {
      const list = scheduled[week] ?? [], index = list.findIndex(plan => plan.at === stepId);
      if (index < 0) return Promise.resolve(false);
      const [plan] = list.splice(index, 1);
      const before = pending?.promise ?? Promise.resolve();
      return before.then(() => {
        let run;
        const promise = new Promise(resolve => { run = () => { pending = null; play(byId[plan.id], week, selection).then(() => resolve(true)); }; });
        pending = { run, promise, timer: setTimeout(() => pending?.run(), plan.delay) };
        return promise;
      });
    },
    /**
     * '다음 주로'를 누를 때 부른다: 아직 안 뜬 이번 주 사건이 있으면 지금 띄우고, 다음 주 사건과 터질 때를 뽑아 둔다.
     * 한 주에 사건은 1개, secondChance 확률로 2개. 사건 창을 닫으면 끝나는 Promise
     */
    async endOfWeek(week, selection) {
      while (pending) { clearTimeout(pending.timer); const { promise } = pending; pending.run(); await promise; } // 곧 뜰 참이던 사건은 지금 띄운다
      for (const plan of scheduled[week]?.splice(0) ?? []) await play(byId[plan.id], week, selection);
      if (week >= LAST_WEEK) return;
      const moments = [...WEEKS[week].steps.map(step => step.id), ...(week + 1 < LAST_WEEK ? ['end'] : [])];
      const count = 1 + (rand() < (data.secondChance ?? 0) ? 1 : 0);
      scheduled[week + 1] = [];
      for (let k = 0; k < count && moments.length; k++) {
        const next = pickEvent(selection, used, seen, rand, follow);
        follow = null;
        if (!next) break;
        const at = moments.splice(Math.floor(rand() * moments.length), 1)[0];
        scheduled[week + 1].push({ id: next.id, at, delay: 1000 + Math.floor(rand() * 2000) });
        used.add(next.id);
      }
    }
  };
}
