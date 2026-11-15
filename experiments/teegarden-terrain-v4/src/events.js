// 돌발 사건 (체험판, 2026-11-16): 고른 선지와 선지 조합에서 사건이 생긴다. 데이터는 events.json.
// 한 판에 4번 (2·3·4주차를 마칠 때 + 5주차 입주 방법을 결정할 때). 사건은 한 주 앞서 뽑아 두고 그 주 브리핑에 예고(hint)를 띄운다.
// 사건이 뜨면 대응 버튼을 고르고, 그 효과는 gauges.js gaugeState 의 extras 로 들어간다.
// 기록장: 한 번이라도 만난 사건은 이 브라우저에 남는다 (localStorage). 아직 못 만난 사건은 ??? 와 힌트로만 보인다.
import data from './events.json' with { type: 'json' };
import { ALL_STEPS } from './choices.js';
import { mulberry32 } from './terrain.js';

export const EVENTS = data.events;
const byId = Object.fromEntries(EVENTS.map(event => [event.id, event]));
const SEEN_KEY = 'tidelocked.events.seen';
const LAST_WEEK = 5; // 마지막 주: 입주 방법(arrive)을 결정하면 사건이 뜬다

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
  let rand, scheduled, used, results, follow;
  const seen = loadSeen();
  function reset() {
    rand = mulberry32((Date.now() ^ 0x5eed) >>> 0);
    scheduled = {}; used = new Set(); results = []; follow = null;
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

  function play(event, week, selection) {
    return new Promise(resolve => {
      const firstTime = !seen.has(event.id);
      seen.add(event.id); saveSeen(seen); used.add(event.id);
      const adjusts = (event.adjust ?? []).filter(a => meets(a.requires, selection));
      const ask = () => {
        card.className = 'event-card ' + event.kind;
        const code = make('p', 'event-code', (event.kind === 'good' ? '좋은 소식' : '돌발 사건') + ' · ' + (week === LAST_WEEK ? '입주 날' : week + '주차 끝') + (firstTime ? ' · 새 사건' : ''));
        const title = make('h2', null, event.name); title.id = 'event-title';
        const parts = [code, title, make('p', 'event-text', event.text)];
        const linked = causes(event, selection);
        if (linked.length) parts.push(make('p', 'event-cause', '연결된 선택: ' + linked.join(' · ')));
        if (adjusts.length) {
          const why = make('ul', 'event-why');
          for (const a of adjusts) why.append(make('li', null, a.text));
          parts.push(why);
        }
        parts.push(make('p', 'event-ask', '어떻게 할까요?'));
        const options = make('div', 'event-options');
        for (const response of event.responses) {
          if (response.requires && !meets(response.requires, selection)) continue;
          const button = make('button', 'event-option' + (response.requires ? ' unlocked' : '')); button.type = 'button';
          button.append(make('b', null, response.label), make('span', null, response.line));
          if (response.requires) button.append(make('small', null, '열림 · ' + causes({ when: [response.requires] }, selection).join(' · ') + ' 덕분'));
          button.addEventListener('click', () => answer(response));
          options.append(button);
        }
        parts.push(options, footer(() => showBook(ask)));
        card.replaceChildren(...parts);
        options.querySelector('button')?.focus();
      };
      const answer = response => {
        // 사건 기본 피해(adjust)와 대응 효과를 한 항목으로 넣는다
        const now = {};
        for (const effect of [...adjusts.map(a => a.now ?? {}), response.now ?? {}]) for (const [key, value] of Object.entries(effect)) now[key] = (now[key] ?? 0) + value;
        results.push({ week, id: event.id, response: response.id, now, weekly: response.weekly, clearedBy: response.clearedBy });
        follow = response.follow ?? null;
        onChange();
        const done = () => {
          card.className = 'event-card ' + event.kind;
          const parts = [make('p', 'event-code', event.name + ' · 결과'), make('h2', null, response.label), make('p', 'event-text', response.result)];
          if (response.aftermath) parts.push(make('p', 'event-cause', response.aftermath));
          const next = make('button', 'decide', '▶ 계속'); next.type = 'button';
          next.addEventListener('click', () => { modal.hidden = true; document.body.classList.remove('event-alert'); resolve(); });
          parts.push(next, footer(() => showBook(done)));
          card.replaceChildren(...parts);
          next.focus();
        };
        done();
      };
      document.body.classList.add('event-alert');
      modal.hidden = false;
      ask();
    });
  }

  return {
    reset,
    /** gaugeState 의 extras */
    effects: () => results,
    /** 그 주 브리핑에 붙일 예고 문장 */
    hintFor: week => scheduled[week] ? [byId[scheduled[week]].hint] : [],
    /**
     * 주가 끝날 때 (5주차는 입주 방법을 결정했을 때) 부른다: 예약된 사건이 있으면 띄우고, 다음 사건을 뽑아 둔다.
     * 사건 창을 닫으면 끝나는 Promise
     */
    async endOfWeek(week, selection) {
      if (scheduled[week]) { const id = scheduled[week]; delete scheduled[week]; await play(byId[id], week, selection); }
      if (week < LAST_WEEK) {
        const next = pickEvent(selection, used, seen, rand, follow);
        follow = null;
        if (next) { scheduled[week + 1] = next.id; used.add(next.id); }
      }
    }
  };
}
